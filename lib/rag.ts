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

async function embed(text: string): Promise<number[]> {
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
