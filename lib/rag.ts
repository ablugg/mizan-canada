import path from "path";
import { getOllama, EMBEDDING_MODEL } from "./llm";

// LanceDB is loaded dynamically to avoid build-time issues in non-Electron environments
async function getLanceDB() {
  const lancedb = await import("@lancedb/lancedb");
  return lancedb;
}

const TABLE_NAME = "legal_chunks";
const USER_TABLE_NAME = "user_chunks";

// Per-jurisdiction connection caches
const connectionCaches: Record<string, unknown> = {};

// Track whether we've attempted to create an index
let indexEnsured = false;

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

export interface LegalChunk {
  id: string;
  text: string;
  source: string;
  jurisdiction: string;
  statute?: string;
  section?: string;
  language?: string;
}

// Extract case names and legal keywords from a query for keyword search.
// Looks for patterns like "v." (case names), statute names, and SCC citations.
function extractKeywords(query: string): string[] {
  const keywords: string[] = [];

  // Match case names: "X v. Y" or "X v Y"
  const casePattern = /([A-Z][\w''\-éèêëàâîïôùûü]+(?:\s+\([^)]*\))?)\s+v\.?\s+([A-Z][\w''\-éèêëàâîïôùûü]+(?:\s+\([^)]*\))?)/gi;
  let match;
  while ((match = casePattern.exec(query)) !== null) {
    // Use both party names for keyword search
    keywords.push(match[1].trim());
    keywords.push(match[2].trim());
  }

  // Match SCC/SCR citations like "2013 SCC 72" or "[2013] 3 SCR 1101"
  const citPattern = /\d{4}\s+SCC\s+\d+|\[\d{4}\]\s+\d+\s+S\.?C\.?R\.?\s+\d+/gi;
  while ((match = citPattern.exec(query)) !== null) {
    keywords.push(match[0].trim());
  }

  // Match common statute references like "section 210" or "s. 7"
  const sectionPattern = /(?:section|s\.)\s+\d+/gi;
  while ((match = sectionPattern.exec(query)) !== null) {
    keywords.push(match[0].trim());
  }

  return keywords;
}

export async function retrieveContext(
  query: string,
  topK = 6,
  jurisdiction = "ca"
): Promise<string> {
  const queryEmbedding = await embed(query);
  const db = await getConnection(jurisdiction);

  async function searchTable(tableName: string): Promise<LegalChunk[]> {
    try {
      const table = await db.openTable(tableName);

      // Create IVF_PQ index on first search if table is large enough
      if (!indexEnsured && tableName === TABLE_NAME) {
        indexEnsured = true;
        try {
          const count = await table.countRows();
          if (count > 10000) {
            const indices = await table.listIndices();
            if (!indices.some((idx: { columns?: string[] }) => idx.columns?.includes("vector"))) {
              console.log(`[rag] Building IVF_PQ index on ${count} rows...`);
              await table.createIndex("vector");
              console.log("[rag] Index built.");
            }
          }
        } catch (e) {
          console.error("[rag] Index creation skipped:", e);
        }
      }

      return await table.search(queryEmbedding).limit(topK).toArray() as LegalChunk[];
    } catch {
      return [];
    }
  }

  // Keyword search: find chunks matching case names or citations in the source field.
  // Headnote chunks (section="headnote") are prioritized.
  async function keywordSearch(tableName: string): Promise<LegalChunk[]> {
    const keywords = extractKeywords(query);
    if (keywords.length === 0) return [];

    try {
      const table = await db.openTable(tableName);
      const results: LegalChunk[] = [];

      for (const kw of keywords) {
        try {
          // Escape single quotes in keywords for SQL
          const escaped = kw.replace(/'/g, "''");
          const matches = await table
            .query()
            .where(`source LIKE '%${escaped}%'`)
            .select(["id", "text", "source", "jurisdiction", "statute", "section", "language"])
            .limit(6)
            .toArray() as LegalChunk[];
          results.push(...matches);
        } catch {
          // Keyword filter failed for this term, skip
        }
      }

      // Sort headnote chunks first — they contain the holdings and key legal tests
      results.sort((a, b) => {
        const aHn = a.section === "headnote" ? 0 : 1;
        const bHn = b.section === "headnote" ? 0 : 1;
        return aHn - bHn;
      });

      return results;
    } catch {
      return [];
    }
  }

  const [baseResults, userResults, keywordResults] = await Promise.all([
    searchTable(TABLE_NAME),
    searchTable(USER_TABLE_NAME),
    keywordSearch(TABLE_NAME),
  ]);

  // Merge: keyword results first (highest relevance), then vector results, deduplicated.
  // Headnote chunks are prioritized within each group.
  // Limit to 2 chunks per source to avoid one case dominating context.
  const seen = new Set<string>();
  const sourceCount = new Map<string, number>();
  const MAX_PER_SOURCE = 2;
  const merged: LegalChunk[] = [];

  function addChunk(chunk: LegalChunk): boolean {
    const key = chunk.id ?? `${chunk.source}-${chunk.text.slice(0, 50)}`;
    if (seen.has(key)) return false;
    const srcKey = chunk.source?.split("(")[0]?.trim() ?? chunk.source;
    const count = sourceCount.get(srcKey) ?? 0;
    if (count >= MAX_PER_SOURCE) return false;
    seen.add(key);
    sourceCount.set(srcKey, count + 1);
    merged.push(chunk);
    return true;
  }

  // Keyword matches get priority — headnotes first within keyword results
  const kwHeadnotes = keywordResults.filter((c) => c.section === "headnote");
  const kwOther = keywordResults.filter((c) => c.section !== "headnote");
  for (const chunk of [...kwHeadnotes, ...kwOther]) addChunk(chunk);

  // Then vector results — headnotes first
  const vecAll = [...baseResults, ...userResults];
  const vecHeadnotes = vecAll.filter((c) => c.section === "headnote");
  const vecOther = vecAll.filter((c) => c.section !== "headnote");
  for (const chunk of [...vecHeadnotes, ...vecOther]) addChunk(chunk);

  // Limit total to avoid overflowing context window
  const limited = merged.slice(0, topK + 4);

  if (!limited.length) return "";

  console.log(`[rag] Hybrid search: ${keywordResults.length} keyword + ${baseResults.length + userResults.length} vector = ${limited.length} unique chunks`);

  return limited
    .map((meta, i) => `[Source ${i + 1}] ${meta.source} | Jurisdiction: ${meta.jurisdiction}${meta.statute ? ` | Statute: ${meta.statute}` : ""}${meta.section ? ` | Type: ${meta.section}` : ""}\n${meta.text}`)
    .join("\n\n---\n\n");
}

/**
 * Retrieve legal context relevant to a document's content.
 * Takes a sample from the document (intro + key sections), embeds it,
 * and retrieves relevant statutes/case law from the vector store.
 */
export async function retrieveDocumentContext(
  documentText: string,
  topK = 3,
  jurisdiction = "ca"
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
    return await retrieveContext(sample, topK, jurisdiction);
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
    const embedding = await embed(chunks[i]);
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

/**
 * Extract case citations from a response and verify them against the vector store.
 * Returns a list of citations with their verification status.
 */
export async function verifyCitations(
  response: string,
  retrievedContext: string,
  jurisdiction = "ca"
): Promise<{ citation: string; verified: boolean }[]> {
  // Extract "X v. Y" or "X v Y" patterns from the response
  const casePattern = /([A-Z][\w''\-éèêëàâîïôùûü]+(?:\s+\([^)]*\))?)\s+v\.?\s+([A-Z][\w''\-éèêëàâîïôùûü]+(?:\s+\([^)]*\))?)/gi;
  const citations: string[] = [];
  let match;
  while ((match = casePattern.exec(response)) !== null) {
    citations.push(match[0].trim());
  }

  if (citations.length === 0) return [];

  // Deduplicate
  const unique = [...new Set(citations)];

  // Check each citation against the retrieved context first (fast), then vector store
  const contextLower = retrievedContext.toLowerCase();
  const results: { citation: string; verified: boolean }[] = [];

  const db = await getConnection(jurisdiction);
  let table: Awaited<ReturnType<typeof db.openTable>> | null = null;
  try {
    table = await db.openTable(TABLE_NAME);
  } catch {}

  for (const cite of unique) {
    // Check if it appears in the retrieved context
    if (contextLower.includes(cite.toLowerCase())) {
      results.push({ citation: cite, verified: true });
      continue;
    }

    // Check vector store by keyword search on source field
    if (table) {
      try {
        const party = cite.split(/\s+v\.?\s+/i)[0].trim().replace(/'/g, "''");
        const matches = await table
          .query()
          .where(`source LIKE '%${party}%'`)
          .select(["source"])
          .limit(1)
          .toArray();
        results.push({ citation: cite, verified: matches.length > 0 });
      } catch {
        results.push({ citation: cite, verified: false });
      }
    } else {
      results.push({ citation: cite, verified: false });
    }
  }

  return results;
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
