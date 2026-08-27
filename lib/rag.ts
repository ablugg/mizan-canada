import path from "path";
import fs from "fs";
import { getOllama, EMBEDDING_MODEL, SOURCE_BLOCK_HEADER, LIGHT_MODEL } from "./llm";
import { PROVINCE_LABELS } from "./provinces";
import { rerank, bestScore } from "./reranker";

// LanceDB is loaded dynamically to avoid build-time issues in non-Electron environments
async function getLanceDB() {
  const lancedb = await import("@lancedb/lancedb");
  return lancedb;
}

/**
 * Formats an array of LegalChunk results into the numbered source block
 * that gets injected into the user message. Each source gets a stable [S#] tag
 * that the model must use when citing.
 */
export function renderSources(chunks: LegalChunk[]): string {
  if (!chunks.length) return "";
  return chunks
    .map((meta, i) => {
      const tag = `[S${i + 1}]`;
      const parts = [meta.source, `Jurisdiction: ${meta.jurisdiction}`];
      if (meta.statute) parts.push(`Statute: ${meta.statute}`);
      if (meta.section) parts.push(`Section: ${meta.section}`);
      if (meta.docType) parts.push(`Type: ${meta.docType}`);
      return `${tag} ${parts.join(" | ")}\n${meta.text}`;
    })
    .join("\n\n---\n\n");
}

const TABLE_NAME = "legal_chunks";
const USER_TABLE_NAME = "user_chunks";

// Per-jurisdiction connection caches
const connectionCaches: Record<string, unknown> = {};

// ANN search tuning — configurable via env for sweep testing
const RAG_NPROBES = parseInt(process.env.RAG_NPROBES ?? "20", 10);
const RAG_REFINE_FACTOR = parseInt(process.env.RAG_REFINE_FACTOR ?? "5", 10);

// Cheap pre-filter: if the best vector cosine distance exceeds this,
// skip the expensive reranker — nothing in the corpus is even vaguely close.
// Deliberately very permissive; the reranker makes the real abstention decision.
export const ABSTENTION_THRESHOLD = parseFloat(process.env.RAG_ABSTENTION_THRESHOLD ?? "0.45");

// Reranker-based abstention: if the best reranker score (raw logit) is below
// this threshold, the retrieved sources are not relevant enough to ground an
// answer. bge-reranker-base: relevant passages typically score > -5, irrelevant < -7.
//
// Score distribution on eval set (30 cases):
//   Relevant cases:   -6.2 to +7.4  (crim-04 is the outlier at -6.2)
//   abstain-01 (Tokyo): -4.9  |  abstain-02 (France): -0.2  |  abstain-03 (US): -5.3
//
// The abstention cases score high because the corpus IS legal text and the
// reranker correctly identifies semantic overlap (e.g. "succession law" matches
// Canadian succession provisions). Jurisdiction mismatch is a grounding problem,
// not a relevance problem — the model must learn not to apply Canadian law to
// non-Canadian questions via its system prompt. The reranker catches truly
// off-topic queries (cooking recipes, sports scores) that score < -8.
//
// Sweep with: RAG_RERANK_ABSTAIN_SCORE=-7 npm run eval -- --rag-only
export const RERANK_ABSTAIN_SCORE = parseFloat(process.env.RAG_RERANK_ABSTAIN_SCORE ?? "-7");

// Sentinel returned by retrieveContext when nothing clears the relevance bar.
export const NO_AUTHORITY_SENTINEL = "__NO_AUTHORITY__";

export function resetConnection(jurisdiction = "ca") {
  delete connectionCaches[jurisdiction];
}

function getDbPath(_jurisdiction: string): string {
  if (process.env.VECTOR_DB_PATH) return process.env.VECTOR_DB_PATH;
  return path.join(process.cwd(), "data/vector-store");
}

async function getConnection(jurisdiction = "ca") {
  if (connectionCaches[jurisdiction]) {
    return connectionCaches[jurisdiction] as Awaited<ReturnType<(typeof import("@lancedb/lancedb"))["connect"]>>;
  }

  const lancedb = await getLanceDB();
  const dbPath = getDbPath(jurisdiction);

  connectionCaches[jurisdiction] = await lancedb.connect(dbPath);
  return connectionCaches[jurisdiction] as Awaited<ReturnType<(typeof import("@lancedb/lancedb"))["connect"]>>;
}

// LRU embedding cache: avoids re-embedding identical or very similar queries
const embeddingCache = new Map<string, { embedding: number[]; ts: number }>();
const CACHE_MAX = 50;
const CACHE_TTL = 5 * 60 * 1000; // 5 minutes

async function embed(text: string): Promise<number[]> {
  const key = text.trim().toLowerCase().slice(0, 200);
  const cached = embeddingCache.get(key);
  if (cached && Date.now() - cached.ts < CACHE_TTL) {
    return cached.embedding;
  }

  const response = await getOllama().embeddings({
    model: EMBEDDING_MODEL,
    prompt: text,
  });

  // Evict oldest if cache is full
  if (embeddingCache.size >= CACHE_MAX) {
    const oldest = [...embeddingCache.entries()].sort((a, b) => a[1].ts - b[1].ts)[0];
    if (oldest) embeddingCache.delete(oldest[0]);
  }
  embeddingCache.set(key, { embedding: response.embedding, ts: Date.now() });

  return response.embedding;
}

/** Uncached embedding for ingestion paths — avoids the 200-char cache key collision. */
async function embedRaw(text: string): Promise<number[]> {
  const response = await getOllama().embeddings({
    model: EMBEDDING_MODEL,
    prompt: text,
  });
  return response.embedding;
}

export interface LegalChunk {
  id: string;
  text: string;
  source: string;
  jurisdiction: string;
  statute?: string;
  section?: string;
  language?: string;
  docType?: string;
  _distance?: number;
}

// Well-known Canadian statute names for keyword matching.
// AUDIT NOTE: entries must be specific enough not to substring-match unrelated
// sources. Removed: "Charter" (matches Chartered Professional Accountants,
// Charter Flights, etc. — use "Charter of Rights" instead), "IRPA" (matches
// "Airpark"), "Insurance Act" (matches Civil Service Insurance, Marine
// Insurance, etc. — use specific act names), "Child and Family" (matches
// case party names, not the statute).
const STATUTE_NAMES = [
  "Criminal Code", "Charter of Rights", "Income Tax Act",
  "Canada Labour Code", "CBCA", "Canada Business Corporations Act",
  "PIPEDA", "Competition Act", "Bankruptcy and Insolvency Act",
  "Canada Evidence Act", "Immigration and Refugee Protection Act",
  "Canadian Environmental Protection Act", "CEPA", "Federal Courts Act",
  "Divorce Act", "Indian Act", "Youth Criminal Justice Act",
  "Controlled Drugs and Substances Act", "Constitution Act",
  "Employment Insurance Act", "Canada Health Act", "Firearms Act",
  "National Defence Act", "Excise Tax Act", "Copyright Act",
  "Trade-marks Act", "Patent Act", "Access to Information Act",
  "Privacy Act", "Official Languages Act", "Elections Act",
  "Highway Traffic Act", "Planning Act", "Landlord and Tenant",
  "Residential Tenancies Act", "Family Law Act",
  "Human Rights Code", "Securities Act",
  "Civil Code of Quebec", "Code of Civil Procedure",
];

// Well-known legal tests/doctrines for keyword matching
const LEGAL_TESTS = [
  "Oakes test", "Anns test", "Dunsmuir", "Vavilov", "Jordan",
  "Stinchcombe", "Grant", "Waterloo", "Doré", "Gladue",
  "duty to consult", "reasonable expectation of privacy",
  "standard of review", "habeas corpus", "certiorari",
  "solicitor-client privilege", "work product privilege",
  "burden of proof", "balance of probabilities", "beyond reasonable doubt",
  "fiduciary duty", "duty of care", "negligence", "mens rea", "actus reus",
];

/**
 * Word-boundary match: returns true if `needle` appears in `haystack` as a
 * whole word (not as a substring of a longer word). E.g. "Charter" must NOT
 * match "Chartered" or "Charter Flights" when used as a statute filter.
 * For multi-word needles, checks that the match is not embedded in a longer
 * proper-noun phrase.
 */
function wordBoundaryMatch(haystack: string, needle: string): boolean {
  const escaped = needle.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const re = new RegExp(`\\b${escaped}\\b`, "i");
  return re.test(haystack);
}

function extractKeywords(query: string): string[] {
  const keywords: string[] = [];
  let match;

  // Match case names: "X v. Y" or "X v Y"
  const casePattern = /([A-Z][\w''\-éèêëàâîïôùûü]*\.?(?:\s+\([^)]*\))?)\s+v\.?\s+([A-Z][\w''\-éèêëàâîïôùûü]+(?:\s+\([^)]*\))?)/gi;
  while ((match = casePattern.exec(query)) !== null) {
    keywords.push(match[0].trim());
    const party2 = match[2].trim();
    if (party2.length > 2) keywords.push(party2);
  }

  // Match SCC/SCR citations like "2013 SCC 72" or "[2013] 3 SCR 1101"
  const citPattern = /\d{4}\s+SCC\s+\d+|\[\d{4}\]\s+\d+\s+S\.?C\.?R\.?\s+\d+/gi;
  while ((match = citPattern.exec(query)) !== null) {
    keywords.push(match[0].trim());
  }

  // Match section references like "section 210" or "s. 7"
  const sectionPattern = /(?:section|s\.)\s+\d+/gi;
  while ((match = sectionPattern.exec(query)) !== null) {
    keywords.push(match[0].trim());
  }

  // Match known statute names
  const queryLower = query.toLowerCase();
  for (const statute of STATUTE_NAMES) {
    if (queryLower.includes(statute.toLowerCase())) {
      keywords.push(statute);
    }
  }

  // Match known legal tests/doctrines
  for (const test of LEGAL_TESTS) {
    if (queryLower.includes(test.toLowerCase())) {
      keywords.push(test);
    }
  }

  return keywords;
}

// --- Source resolution map ---
// Maps STATUTE_NAMES substrings → exact `source` values from the vector store.
// Cached to disk at data/source-index.json to avoid scanning on every query.
const SOURCE_INDEX_PATH = path.join(process.cwd(), "data/source-index.json");
let sourceIndex: Record<string, string[]> | null = null;

async function getSourceIndex(): Promise<Record<string, string[]>> {
  if (sourceIndex) return sourceIndex;

  // Try loading from disk cache
  try {
    const raw = fs.readFileSync(SOURCE_INDEX_PATH, "utf-8");
    sourceIndex = JSON.parse(raw);
    return sourceIndex!;
  } catch {
    // Cache miss — build from vector store
  }

  console.log("[rag] Building source index...");
  const index: Record<string, string[]> = {};
  try {
    const db = await getConnection();
    const table = await db.openTable(TABLE_NAME);
    const rows = await table.query()
      .select(["source"])
      .limit(500000)
      .toArray() as { source: string }[];

    // Collect all distinct source values
    const allSources = new Set<string>();
    for (const r of rows) {
      if (r.source) allSources.add(r.source);
    }

    // For each STATUTE_NAME, find matching source values
    for (const statute of STATUTE_NAMES) {
      const sLower = statute.toLowerCase();
      const matches = [...allSources].filter(s => s.toLowerCase().includes(sLower));
      if (matches.length > 0) {
        index[statute] = matches;
      }
    }

    // Write to disk cache
    try {
      fs.writeFileSync(SOURCE_INDEX_PATH, JSON.stringify(index, null, 2));
      console.log(`[rag] Source index built: ${Object.keys(index).length} statutes mapped`);
    } catch (e) {
      console.warn("[rag] Could not write source index cache:", e);
    }
  } catch (e) {
    console.error("[rag] Failed to build source index:", e);
  }

  sourceIndex = index;
  return index;
}

// --- Query rewrite for follow-up messages ---
async function rewriteQuery(
  query: string,
  messages?: { role: string; content: string }[]
): Promise<string> {
  if (!messages || messages.length < 2) return query;

  // Only rewrite short or pronoun-referencing follow-ups
  const words = query.trim().split(/\s+/);
  const hasPronouns = /\b(it|its|this|that|they|them|their|those|these|he|she|his|her)\b/i.test(query);
  if (words.length > 12 && !hasPronouns) return query;

  // Build conversation context from last 4 messages
  const recentMessages = messages.slice(-4);
  const context = recentMessages
    .map(m => `${m.role === "user" ? "User" : "Assistant"}: ${m.content.slice(0, 300)}`)
    .join("\n");

  try {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 3000);

    const response = await getOllama().chat({
      model: LIGHT_MODEL,
      messages: [
        {
          role: "system",
          content: "Rewrite the user's follow-up question as a standalone legal research query. Output ONLY the rewritten query, nothing else. If the question is already standalone, output it unchanged.",
        },
        {
          role: "user",
          content: `Conversation:\n${context}\n\nRewrite this follow-up as a standalone query:\n"${query}"`,
        },
      ],
      think: false,
      options: { num_ctx: 4096, temperature: 0.1 },
    });

    clearTimeout(timeout);
    const rewritten = response.message.content.trim().replace(/^["']|["']$/g, "");
    if (rewritten && rewritten.length > 5 && rewritten.length < 500) {
      console.log(`[rag] Query rewrite: "${query}" → "${rewritten}"`);
      return rewritten;
    }
  } catch {
    // Timeout or model error — use original query
  }

  return query;
}

export interface RetrieveOpts {
  province?: string;
  language?: "en" | "fr";
  /** Pre-computed query embedding (skips embed cache — used by retrieveDocumentContext). */
  queryEmbedding?: number[];
  /** Recent conversation messages for query rewrite on follow-ups. */
  messages?: { role: string; content: string }[];
}

export async function retrieveContext(
  query: string,
  topK = 6,
  opts: RetrieveOpts = {}
): Promise<string> {
  // Rewrite follow-up queries into standalone form
  const effectiveQuery = opts.queryEmbedding ? query : await rewriteQuery(query, opts.messages);

  const queryEmbedding = opts.queryEmbedding ?? await embed(effectiveQuery);
  const db = await getConnection();

  // Build a WHERE clause for jurisdiction + language filtering
  const filterParts: string[] = [];
  const lang = opts.language ?? "en";
  filterParts.push(`language = '${lang}'`);
  if (opts.province && opts.province !== "federal" && PROVINCE_LABELS[opts.province]) {
    const provName = PROVINCE_LABELS[opts.province].replace(/'/g, "''");
    filterParts.push(`jurisdiction IN ('${provName}', 'Canada')`);
  }
  const whereClause = filterParts.join(" AND ");

  // Over-fetch factor for ANN to compensate for IVF_PQ approximation
  const annLimit = topK * 6;

  async function searchTable(tableName: string): Promise<LegalChunk[]> {
    try {
      const table = await db.openTable(tableName);

      let search = table.search(queryEmbedding)
        .nprobes(RAG_NPROBES)
        .refineFactor(RAG_REFINE_FACTOR);
      if (whereClause) search = search.where(whereClause);
      return await search.limit(annLimit).toArray() as LegalChunk[];
    } catch {
      return [];
    }
  }

  // Keyword search: find chunks matching case names, statutes, or legal tests.
  // Uses source resolution map + btree-indexed `source IN (...)` queries,
  // then scores results in TypeScript with heading-weighted matching.
  async function keywordSearch(tableName: string): Promise<LegalChunk[]> {
    const keywords = extractKeywords(effectiveQuery);
    if (keywords.length === 0) return [];

    try {
      const table = await db.openTable(tableName);
      const srcIndex = await getSourceIndex();
      // Prepend jurisdiction/language filter to every WHERE clause
      const wf = (condition: string) => whereClause ? `${whereClause} AND ${condition}` : condition;

      const allResults: LegalChunk[] = [];
      const selectCols = ["id", "text", "source", "jurisdiction", "statute", "section", "language", "docType"];

      // Extract significant query terms for TypeScript scoring
      const stopwords = new Set(["the", "and", "for", "are", "what", "under", "with", "from", "that", "this", "have", "include", "specific", "which", "does", "how"]);
      const queryTerms = effectiveQuery.toLowerCase().split(/\s+/)
        .filter(w => w.length > 3 && !stopwords.has(w))
        .slice(0, 6);

      for (const kw of keywords) {
        const isStatuteName = STATUTE_NAMES.some((s) => s.toLowerCase() === kw.toLowerCase());
        const isLegalTest = LEGAL_TESTS.some((t) => t.toLowerCase() === kw.toLowerCase());

        if (isStatuteName) {
          // Use source resolution map for btree-indexed lookup
          const exactSources = srcIndex[kw];
          if (exactSources && exactSources.length > 0) {
            const inList = exactSources.map(s => `'${s.replace(/'/g, "''")}'`).join(", ");
            try {
              const rows = await table.query()
                .where(wf(`source IN (${inList})`))
                .select(selectCols)
                .limit(30)
                .toArray() as LegalChunk[];
              allResults.push(...rows);
            } catch { /* skip */ }
          } else {
            // Fallback: substring search if not in source index
            const escaped = kw.replace(/'/g, "''");
            try {
              const rows = await table.query()
                .where(wf(`source LIKE '%${escaped}%'`))
                .select(selectCols)
                .limit(10)
                .toArray() as LegalChunk[];
              allResults.push(...rows);
            } catch { /* skip */ }
          }
        } else if (isLegalTest) {
          // Legal tests: search by id prefix 'test-' + text match.
          // Generic terms like "Jordan" or "Grant" match country names and party
          // names in hundreds of unrelated records, so we do a targeted lookup
          // for legal_test records first (there are only ~10).
          // NOTE: LanceDB WHERE with quoted "docType" returns 0 rows due to a
          // query planner bug, so we use id LIKE 'test-%' as a reliable proxy.
          const escaped = kw.replace(/'/g, "''");
          try {
            const testRows = await table.query()
              .where(wf(`id LIKE 'test-%' AND text LIKE '%${escaped}%'`))
              .select(selectCols)
              .limit(4)
              .toArray() as LegalChunk[];
            allResults.push(...testRows);
          } catch { /* skip */ }
          // Also search general text for broader coverage
          try {
            const rows = await table.query()
              .where(wf(`text LIKE '%${escaped}%'`))
              .select(selectCols)
              .limit(6)
              .toArray() as LegalChunk[];
            allResults.push(...rows);
          } catch { /* skip */ }
        } else {
          // Case names, citations: search source field
          const escaped = kw.replace(/'/g, "''");
          try {
            const rows = await table.query()
              .where(wf(`source LIKE '%${escaped}%'`))
              .select(selectCols)
              .limit(6)
              .toArray() as LegalChunk[];
            allResults.push(...rows);
          } catch { /* skip */ }
        }
      }

      // Word-boundary filter: discard keyword results where the matched
      // keyword appears only as a substring of a longer word in the source.
      // E.g., "Charter" in query matches STATUTE_NAMES but the source is
      // "Chartered Professional Accountants" — discard.
      const filtered = allResults.filter(chunk => {
        const src = (chunk.source ?? "").toLowerCase();
        // At least one keyword must word-boundary match in source or text
        return keywords.some(kw => {
          const kwLower = kw.toLowerCase();
          // For statute name matches, check source field specifically
          if (STATUTE_NAMES.some(s => s.toLowerCase() === kwLower)) {
            return wordBoundaryMatch(chunk.source ?? "", kw);
          }
          // For other keywords (case names, citations), substring is fine
          return src.includes(kwLower) || (chunk.text ?? "").toLowerCase().includes(kwLower);
        });
      });

      // Score all results in TypeScript with heading-weighted matching
      const scored = filtered.map(chunk => {
        const chunkText = (chunk.text ?? "").toLowerCase();
        const head = chunkText.slice(0, 100);
        let score = 0;
        for (const term of queryTerms) {
          if (head.includes(term)) score += 3;
          else if (chunkText.includes(term)) score += 1;
        }
        // Bonus for headnotes
        if (chunk.section === "headnote") score += 2;
        // Bonus for legal_test docType
        if (chunk.docType === "legal_test") score += 2;
        return { chunk, score };
      });

      // Sort by score descending
      scored.sort((a, b) => b.score - a.score);

      return scored.map(s => s.chunk);
    } catch {
      return [];
    }
  }

  const t0 = Date.now();
  const [baseResults, userResults, keywordResults] = await Promise.all([
    searchTable(TABLE_NAME),
    searchTable(USER_TABLE_NAME),
    keywordSearch(TABLE_NAME),
  ]);
  console.log(`[rag] Search timing: vector+keyword=${Date.now() - t0}ms (vec=${baseResults.length}, user=${userResults.length}, kw=${keywordResults.length})`);

  // Cheap pre-filter: if nothing is even vaguely close in embedding space,
  // skip the expensive reranker. The real abstention decision happens after reranking.
  const bestDistance = baseResults.length > 0 ? (baseResults[0]._distance ?? Infinity) : Infinity;
  if (bestDistance > ABSTENTION_THRESHOLD) {
    console.log(`[rag] Abstaining (pre-filter): best cosine distance=${bestDistance.toFixed(4)} > threshold=${ABSTENTION_THRESHOLD}`);
    return NO_AUTHORITY_SENTINEL;
  }

  // Sibling expansion: for statute chunks with a specific section (e.g. "s. 130"),
  // fetch other chunks from the same section + source so the model gets the full
  // picture (e.g. offence definition + penalty subsection together).
  // Only expand the FIRST unique section per source to avoid flooding context.
  async function fetchSiblings(chunks: LegalChunk[]): Promise<LegalChunk[]> {
    const siblings: LegalChunk[] = [];
    const fetched = new Set<string>();
    try {
      const table = await db.openTable(TABLE_NAME);

      // If the query mentions a specific section, only expand that section
      const queryMentionsSection = effectiveQuery.match(/section\s+(\d+)|s\.\s*(\d+)/i);
      const querySecNum = queryMentionsSection ? (queryMentionsSection[1] || queryMentionsSection[2]) : null;

      for (const chunk of chunks) {
        if (!chunk.section || chunk.section === "headnote" || !chunk.section.startsWith("s. ")) continue;
        const key = `${chunk.source}::${chunk.section}`;
        if (fetched.has(key)) continue;

        // If query specifies a section, only expand that one
        if (querySecNum) {
          const chunkSec = chunk.section.replace("s. ", "");
          if (chunkSec !== querySecNum) continue;
        }

        fetched.add(key);
        const escaped = chunk.section.replace(/'/g, "''");
        const srcEscaped = (chunk.source ?? "").replace(/'/g, "''");
        try {
          const sibWhere = whereClause
            ? `${whereClause} AND section = '${escaped}' AND source = '${srcEscaped}'`
            : `section = '${escaped}' AND source = '${srcEscaped}'`;
          const related = await table.query()
            .where(sibWhere)
            .select(["id", "text", "source", "jurisdiction", "statute", "section", "language", "docType"])
            .limit(4)
            .toArray() as LegalChunk[];
          siblings.push(...related);
        } catch { /* skip */ }

        // Limit to 3 section expansions to avoid too many DB queries
        if (fetched.size >= 3) break;
      }
    } catch { /* table might not exist */ }
    return siblings;
  }

  // Expand siblings — keyword results first (targeted hits are more precise than vec)
  const tSib = Date.now();
  const siblingResults = await fetchSiblings([...keywordResults, ...baseResults]);
  console.log(`[rag] Sibling expansion: ${Date.now() - tSib}ms, ${siblingResults.length} siblings`);

  // ── Reciprocal Rank Fusion (RRF) merge ──────────────────────────────
  // Score each candidate as  Σ 1/(k + rank_in_list)  across all lists.
  // k=60 (standard RRF constant) ensures that 50 keyword results ranked
  // 20th+ cannot outweigh a single rank-1 vector hit.
  const RRF_K = 60;

  // Assign a stable key to each chunk for dedup
  function chunkKey(c: LegalChunk): string {
    return c.id ?? `${c.source}-${c.text.slice(0, 50)}`;
  }

  // Build ranked lists
  const vecAll = [...baseResults, ...userResults];
  const allLists: LegalChunk[][] = [vecAll, keywordResults, siblingResults];

  // Accumulate RRF scores
  const scoreMap = new Map<string, number>();
  const chunkMap = new Map<string, LegalChunk>();

  for (const list of allLists) {
    for (let rank = 0; rank < list.length; rank++) {
      const key = chunkKey(list[rank]);
      const rrfScore = 1 / (RRF_K + rank + 1); // rank is 0-indexed, RRF formula uses 1-indexed
      scoreMap.set(key, (scoreMap.get(key) ?? 0) + rrfScore);
      if (!chunkMap.has(key)) chunkMap.set(key, list[rank]);
    }
  }

  // Boost: headnotes and legal_test chunks get a small additive bonus
  // so they float to the top when vector distance is comparable.
  for (const [key, chunk] of chunkMap) {
    if (chunk.section === "headnote" || chunk.docType === "legal_test") {
      scoreMap.set(key, (scoreMap.get(key) ?? 0) + 0.005);
    }
  }

  // Sort by fused score descending
  const ranked = [...scoreMap.entries()]
    .sort((a, b) => b[1] - a[1])
    .map(([key]) => chunkMap.get(key)!);

  // Apply per-source and per-section limits to prevent domination
  const queryKeywords = extractKeywords(effectiveQuery);
  const primaryCaseTerms = queryKeywords.map((k) => k.toLowerCase());
  const DEFAULT_MAX_PER_SOURCE = 2;
  const PRIMARY_MAX_PER_SOURCE = 5;
  const MAX_PER_SECTION = 2;

  function getMaxForSource(srcKey: string): number {
    if (primaryCaseTerms.length === 0) return DEFAULT_MAX_PER_SOURCE;
    const srcLower = srcKey.toLowerCase();
    for (const term of primaryCaseTerms) {
      if (srcLower.includes(term) || term.includes(srcLower)) return PRIMARY_MAX_PER_SOURCE;
    }
    return DEFAULT_MAX_PER_SOURCE;
  }

  const sourceCount = new Map<string, number>();
  const sectionCount = new Map<string, number>();
  const merged: LegalChunk[] = [];

  for (const chunk of ranked) {
    const srcKey = chunk.source?.split("(")[0]?.trim() ?? chunk.source;
    const count = sourceCount.get(srcKey) ?? 0;
    if (count >= getMaxForSource(srcKey)) continue;

    if (chunk.section && chunk.section.startsWith("s. ") && chunk.section !== "headnote") {
      const secKey = `${srcKey}::${chunk.section}`;
      const secCount = sectionCount.get(secKey) ?? 0;
      if (secCount >= MAX_PER_SECTION) continue;
      sectionCount.set(secKey, secCount + 1);
    }

    sourceCount.set(srcKey, count + 1);
    merged.push(chunk);

    if (merged.length >= topK + 4) break;
  }

  if (!merged.length) return "";

  console.log(`[rag] Hybrid search: ${keywordResults.length} keyword + ${vecAll.length} vector = ${merged.length} unique chunks`);

  // ── Cross-encoder reranking ────────────────────────────────────────
  // Rerank the RRF-merged candidates using a cross-encoder. This gives
  // a calibratable relevance score that makes abstention reliable and
  // ensures the most relevant passages appear first regardless of how
  // they entered the candidate pool.
  const passages = merged.map(c => c.text);
  const rerankResults = await rerank(effectiveQuery, passages);

  // Log reranker scores for diagnostics
  for (const r of rerankResults.slice(0, 8)) {
    const src = merged[r.index];
    console.log(`[rag] rerank #${r.index}: score=${r.score.toFixed(2)} ${src.source?.slice(0, 60)}`);
  }

  // Reranker-based abstention: if the best score is below the threshold,
  // nothing in the candidate pool is actually relevant to the query.
  const topScore = bestScore(rerankResults);
  if (topScore < RERANK_ABSTAIN_SCORE) {
    console.log(`[rag] Abstaining (reranker): best score=${topScore.toFixed(2)} < threshold=${RERANK_ABSTAIN_SCORE}`);
    return NO_AUTHORITY_SENTINEL;
  }

  // Reorder merged array by reranker score, drop irrelevant passages, take topK.
  // A score < -5 on bge-reranker-base means the passage is almost certainly
  // irrelevant. Including it wastes context window and distracts the model.
  const RERANK_MIN_SCORE = parseFloat(process.env.RAG_RERANK_MIN_SCORE ?? "-6");
  const reranked = rerankResults
    .filter(r => r.score >= RERANK_MIN_SCORE)
    .slice(0, topK)
    .map(r => merged[r.index]);

  if (reranked.length === 0) {
    console.log(`[rag] Abstaining (reranker): all scores below min=${RERANK_MIN_SCORE}`);
    return NO_AUTHORITY_SENTINEL;
  }

  console.log(`[rag] Reranker kept ${reranked.length}/${merged.length} (min_score=${RERANK_MIN_SCORE})`);
  return renderSources(reranked);
}

/**
 * Retrieve legal context relevant to a document's content.
 * Takes a sample from the document (intro + key sections), embeds it,
 * and retrieves relevant statutes/case law from the vector store.
 */
export async function retrieveDocumentContext(
  documentText: string,
  topK = 3,
  opts: RetrieveOpts = {}
): Promise<string> {
  // Take the first ~1500 chars (usually contains parties, subject matter, key terms)
  // plus a sample from the middle for broader coverage
  const intro = documentText.slice(0, 1500);
  const mid = documentText.slice(
    Math.floor(documentText.length * 0.3),
    Math.floor(documentText.length * 0.3) + 800
  );
  const sample = `${intro}\n${mid}`;

  try {
    // Use embedRaw to avoid cache key collision on long document samples
    const embedding = await embedRaw(sample);
    return await retrieveContext(sample, topK, { ...opts, queryEmbedding: embedding });
  } catch {
    return "";
  }
}

export async function addUserLaw(doc: {
  lawId: string;
  text: string;
  source: string;
  jurisdiction?: string;
  statute?: string;
  language?: string;
}): Promise<number> {
  const { chunkText } = await import("../data/ingestion/build-vectors");
  const lancedb = await getLanceDB();
  const jurisdiction = doc.jurisdiction ?? "ca";
  const db = await getConnection(jurisdiction);

  const chunks = chunkText(doc.text);
  if (chunks.length === 0) return 0;

  const records = [];
  for (let i = 0; i < chunks.length; i++) {
    const embedding = await embedRaw(chunks[i]);
    records.push({
      id: `ul-${doc.lawId}-${i}`,
      vector: embedding,
      text: chunks[i],
      source: doc.source,
      jurisdiction: doc.jurisdiction ?? "User-added",
      statute: doc.statute ?? "",
      section: "",
      language: doc.language ?? "en",
    });
  }

  try {
    const table = await db.openTable(USER_TABLE_NAME);
    await table.add(records);
  } catch {
    // Table doesn't exist yet -- create it
    const freshDb = await lancedb.connect(getDbPath(jurisdiction));
    await freshDb.createTable(USER_TABLE_NAME, records);
    delete connectionCaches[jurisdiction]; // force reconnect so cache points to same db
  }

  return records.length;
}

// --- Structural citation verification ---

export interface VerifyFailure {
  tag: string;
  claim: string;
  reason: string;
}

export interface VerifyResult {
  ok: boolean;
  failures: VerifyFailure[];
}

/**
 * Deterministic verification of the model's response against the source set.
 *
 * 1. Every [S#] tag in the response must refer to a source that was provided.
 * 2. For each tagged sentence, dollar amounts ($X), section numbers (s. N),
 *    and month/day durations (N months/days/years) must appear verbatim in
 *    that specific source's text.
 */
export function verifyAnswer(response: string, sourceTexts: Map<string, string>): VerifyResult {
  const failures: VerifyFailure[] = [];

  // Extract all [S#] tags used in the response
  const tagPattern = /\[S(\d+)\]/g;
  const usedTags = new Set<string>();
  let m;
  while ((m = tagPattern.exec(response)) !== null) {
    usedTags.add(m[0]);
  }

  // Check 1: every tag must be in the source set
  for (const tag of usedTags) {
    if (!sourceTexts.has(tag)) {
      failures.push({
        tag,
        claim: "(invalid source reference)",
        reason: `${tag} does not correspond to any provided source`,
      });
    }
  }

  // Split response into sentences, keeping their tags
  const sentences = response.split(/(?<=[.!?])\s+/);

  for (const sentence of sentences) {
    // Find all tags in this sentence
    const sentenceTags: string[] = [];
    const sentenceTagPattern = /\[S(\d+)\]/g;
    let st;
    while ((st = sentenceTagPattern.exec(sentence)) !== null) {
      sentenceTags.push(st[0]);
    }
    if (sentenceTags.length === 0) continue;

    // Extract factual claims: dollar amounts, section numbers, durations
    const dollarPattern = /\$[\d,]+(?:\.\d{2})?/g;
    const sectionPattern = /(?:section|s\.)\s*\d+(?:\.\d+)?(?:\s*\(\d+\))?/gi;
    const durationPattern = /\b(\d+)\s*(months?|days?|years?|hours?)\b/gi;

    const claims: { value: string; type: string }[] = [];

    let dm;
    while ((dm = dollarPattern.exec(sentence)) !== null) {
      claims.push({ value: dm[0], type: "dollar amount" });
    }
    while ((dm = sectionPattern.exec(sentence)) !== null) {
      claims.push({ value: dm[0].trim(), type: "section reference" });
    }
    while ((dm = durationPattern.exec(sentence)) !== null) {
      claims.push({ value: dm[0], type: "duration" });
    }

    // For each claim, verify it appears in the cited source's text
    for (const claim of claims) {
      for (const tag of sentenceTags) {
        const srcText = sourceTexts.get(tag);
        if (!srcText) continue; // already flagged as invalid tag

        // Normalize for comparison: strip commas from dollar amounts,
        // normalize whitespace
        const normalizedClaim = claim.value.replace(/,/g, "").toLowerCase();
        const normalizedSrc = srcText.replace(/,/g, "").toLowerCase();

        if (!normalizedSrc.includes(normalizedClaim)) {
          // For section references, also try without the "section " prefix
          // since the source might use "s. " and the model might say "section "
          const altClaim = claim.value
            .replace(/^section\s+/i, "s. ")
            .replace(/^s\.\s*/i, "section ")
            .toLowerCase();
          if (!normalizedSrc.includes(altClaim)) {
            failures.push({
              tag,
              claim: claim.value,
              reason: `${claim.type} "${claim.value}" not found in ${tag}`,
            });
          }
        }
      }
    }
  }

  return { ok: failures.length === 0, failures };
}

/**
 * Parse the rendered source block back into a map of tag → text.
 * Used by verifyAnswer to look up source content by tag.
 */
export function parseSourceTags(renderedSources: string): Map<string, string> {
  const map = new Map<string, string>();
  // Split on the --- separator between sources
  const blocks = renderedSources.split(/\n\n---\n\n/);
  for (const block of blocks) {
    const tagMatch = block.match(/^\[S(\d+)\]/);
    if (tagMatch) {
      map.set(`[S${tagMatch[1]}]`, block);
    }
  }
  return map;
}

export async function deleteUserLawChunks(lawId: string): Promise<void> {
  const db = await getConnection();
  try {
    const table = await db.openTable(USER_TABLE_NAME);
    await (table as unknown as { delete: (filter: string) => Promise<void> }).delete(
      `id LIKE 'ul-${lawId}-%'`
    );
  } catch {
    // Table may not exist -- nothing to delete
  }
}
