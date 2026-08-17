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

export async function retrieveContext(
  query: string,
  topK = 2,
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

  const [baseResults, userResults] = await Promise.all([
    searchTable(TABLE_NAME),
    searchTable(USER_TABLE_NAME),
  ]);

  const all = [...baseResults, ...userResults];
  if (!all.length) return "";

  return all
    .map((meta) => `[${meta.source} -- ${meta.jurisdiction}${meta.statute ? ` -- ${meta.statute}` : ""}]\n${meta.text}`)
    .join("\n\n---\n\n");
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
