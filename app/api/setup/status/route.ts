import { NextResponse } from "next/server";
import { db, ensureLocalUser } from "@/lib/db";
import { DEFAULT_MODEL, EMBEDDING_MODEL } from "@/lib/llm";

/**
 * Returns the current setup state:
 * - dbReady: local SQLite DB is accessible
 * - modelReady: the main Ollama model is pulled and ready
 * - embeddingReady: the embedding model is pulled and ready
 * - vectorsReady: the LanceDB vector store exists and has data
 */
export async function GET() {
  try {
    // Ensure local user exists
    let dbReady = false;
    try {
      await ensureLocalUser();
      dbReady = true;
    } catch (dbErr) {
      console.error("[setup/status] DB error:", dbErr);
      return NextResponse.json({
        dbReady: false, modelReady: false, embeddingReady: false, vectorsReady: false,
        _dbError: String(dbErr),
      });
    }

    const OLLAMA_HOST = process.env.OLLAMA_HOST ?? "http://127.0.0.1:11434";

    let modelReady = false;
    let embeddingReady = false;

    try {
      const res = await fetch(`${OLLAMA_HOST}/api/tags`, { signal: AbortSignal.timeout(3000) });
      if (res.ok) {
        const data = (await res.json()) as { models: Array<{ name: string }> };
        const names = data.models.map((m) => m.name);
        modelReady = names.some((n) => n === DEFAULT_MODEL || n.startsWith(DEFAULT_MODEL.split(":")[0] + ":"));
        embeddingReady = names.some((n) => n === EMBEDDING_MODEL || n.startsWith(EMBEDDING_MODEL.split(":")[0] + ":"));
      }
    } catch (ollamaErr) {
      console.error("[setup/status] Ollama check failed:", ollamaErr);
    }

    let vectorsReady = false;
    try {
      await Promise.race([
        (async () => {
          const lancedb = await import("@lancedb/lancedb");
          const path = await import("path");
          const dbPath = process.env.VECTOR_DB_PATH ?? path.join(process.cwd(), "data/vector-store");
          const vdb = await lancedb.connect(dbPath);
          const tables = await vdb.tableNames();
          vectorsReady = tables.includes("legal_chunks");
        })(),
        new Promise<void>((_, reject) => setTimeout(() => reject(new Error("lancedb timeout")), 5000)),
      ]);
    } catch {
      // Vector store not ready or timed out
    }

    return NextResponse.json({
      dbReady,
      modelReady,
      embeddingReady,
      vectorsReady,
      defaultModel: DEFAULT_MODEL,
      embeddingModel: EMBEDDING_MODEL,
    });
  } catch (topErr) {
    console.error("[setup/status] Unhandled error:", topErr);
    return NextResponse.json(
      { dbReady: false, modelReady: false, embeddingReady: false, vectorsReady: false, _error: String(topErr) },
      { status: 200 }
    );
  }
}
