/**
 * Builds the local LanceDB vector store from the Justice Canada laws-lois-xml repo.
 * Clones the repo, parses XML Acts & Regulations, chunks, embeds, and stores vectors.
 *
 * Run with: npm run build:vectors
 * Requires Ollama to be running with nomic-embed-text pulled.
 */
import { config } from "dotenv";
config({ path: ".env" });

import * as fs from "fs";
import * as path from "path";
import { execSync } from "child_process";
import { Ollama } from "ollama";

const OLLAMA_HOST = process.env.OLLAMA_HOST ?? "http://127.0.0.1:11434";
const EMBEDDING_MODEL = process.env.OLLAMA_EMBEDDING_MODEL ?? "nomic-embed-text";
const VECTOR_DB_PATH = process.env.VECTOR_DB_PATH ?? path.join(process.cwd(), "data/vector-store");
const TABLE_NAME = "legal_chunks";
const CHUNK_SIZE = 400;
const CHUNK_OVERLAP = 50;
const REPO_URL = "https://github.com/justicecanada/laws-lois-xml.git";
const CLONE_DIR = path.join(process.cwd(), "data/sources/laws-lois-xml");

const ollama = new Ollama({ host: OLLAMA_HOST });

export function chunkText(text: string, chunkSize = CHUNK_SIZE, overlap = CHUNK_OVERLAP): string[] {
  const words = text.split(/\s+/);
  const chunks: string[] = [];
  for (let i = 0; i < words.length; i += chunkSize - overlap) {
    const chunk = words.slice(i, i + chunkSize).join(" ");
    if (chunk.trim().length > 50) chunks.push(chunk.trim());
  }
  return chunks;
}

async function embedBatch(texts: string[]): Promise<number[][]> {
  const embeddings: number[][] = [];
  for (const text of texts) {
    const res = await ollama.embeddings({ model: EMBEDDING_MODEL, prompt: text });
    embeddings.push(res.embedding);
  }
  return embeddings;
}

// ── XML text extraction ─────────────────────────────────────────────────────

function stripXmlTags(xml: string): string {
  // Remove XML declaration and processing instructions
  let text = xml.replace(/<\?[^?]*\?>/g, "");
  // Remove all XML tags but keep text content
  text = text.replace(/<[^>]+>/g, " ");
  // Decode common XML entities
  text = text
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&#\d+;/g, "");
  // Collapse whitespace
  text = text.replace(/\s+/g, " ").trim();
  return text;
}

function extractTitle(xml: string): string {
  // Try ShortTitle first, then LongTitle
  const shortMatch = xml.match(/<ShortTitle[^>]*>([^<]+)<\/ShortTitle>/);
  if (shortMatch) return shortMatch[1].trim();
  const longMatch = xml.match(/<LongTitle[^>]*>([^<]+)<\/LongTitle>/);
  if (longMatch) return longMatch[1].trim();
  return "";
}

function extractStatuteRef(xml: string): string {
  // For acts: ConsolidatedNumber
  const consolMatch = xml.match(/<ConsolidatedNumber[^>]*>([^<]+)<\/ConsolidatedNumber>/);
  if (consolMatch) return consolMatch[1].trim();
  // For regulations: InstrumentNumber
  const instrMatch = xml.match(/<InstrumentNumber[^>]*>([^<]+)<\/InstrumentNumber>/);
  if (instrMatch) return instrMatch[1].trim();
  return "";
}

function detectType(xml: string): "act" | "regulation" {
  if (xml.includes("<Regulation")) return "regulation";
  return "act";
}

// ── Clone or update repo ────────────────────────────────────────────────────

function ensureRepo(): void {
  if (fs.existsSync(path.join(CLONE_DIR, ".git"))) {
    console.log("Repo exists, pulling latest…");
    execSync("git pull --ff-only", { cwd: CLONE_DIR, stdio: "inherit" });
  } else {
    console.log("Cloning Justice Canada laws repo (shallow)…");
    fs.mkdirSync(path.dirname(CLONE_DIR), { recursive: true });
    execSync(`git clone --depth 1 "${REPO_URL}" "${CLONE_DIR}"`, { stdio: "inherit" });
  }
}

// ── Discover all XML files ──────────────────────────────────────────────────

interface LawFile {
  filePath: string;
  language: "en" | "fr";
  category: "act" | "regulation";
}

function discoverLawFiles(): LawFile[] {
  const files: LawFile[] = [];

  for (const lang of [{ dir: "eng", code: "en" as const }, { dir: "fra", code: "fr" as const }]) {
    for (const cat of [{ dir: "acts", code: "act" as const }, { dir: "regulations", code: "regulation" as const }]) {
      const dir = path.join(CLONE_DIR, lang.dir, cat.dir);
      if (!fs.existsSync(dir)) continue;

      const xmlFiles = fs.readdirSync(dir).filter((f) => f.endsWith(".xml"));
      for (const f of xmlFiles) {
        files.push({
          filePath: path.join(dir, f),
          language: lang.code,
          category: cat.code,
        });
      }
    }
  }

  return files;
}

// ── Main ────────────────────────────────────────────────────────────────────

export async function main() {
  console.log("Building Mizan vector store — Canadian law\n");
  console.log(`Output: ${VECTOR_DB_PATH}\n`);

  // Ensure Ollama is reachable
  try {
    await ollama.list();
    console.log("Ollama connection confirmed.\n");
  } catch {
    console.error("Ollama is not running. Start Ollama and pull nomic-embed-text first:");
    console.error("  ollama pull nomic-embed-text");
    process.exit(1);
  }

  // Clone/update repo
  ensureRepo();

  // Discover files
  const lawFiles = discoverLawFiles();
  console.log(`\nFound ${lawFiles.length} XML files\n`);

  const lancedb = await import("@lancedb/lancedb");
  const db = await lancedb.connect(VECTOR_DB_PATH);

  let allRecords: Record<string, unknown>[] = [];
  let completed = 0;
  let skipped = 0;
  let totalRecords = 0;
  let tableCreated = false;
  const failed: string[] = [];

  const FLUSH_THRESHOLD = 1000; // flush every 1000 records

  // Drop existing table for a clean build
  try { await db.dropTable(TABLE_NAME); } catch { /* didn't exist */ }

  async function flush() {
    if (allRecords.length === 0) return;
    console.log(`\n  Flushing ${allRecords.length} records (total so far: ${totalRecords + allRecords.length})…\n`);
    if (!tableCreated) {
      await db.createTable(TABLE_NAME, allRecords);
      tableCreated = true;
    } else {
      const table = await db.openTable(TABLE_NAME);
      await table.add(allRecords);
    }
    totalRecords += allRecords.length;
    allRecords = [];
  }

  for (let i = 0; i < lawFiles.length; i++) {
    const law = lawFiles[i];
    const num = i + 1;
    const fileName = path.basename(law.filePath);

    try {
      const xml = fs.readFileSync(law.filePath, "utf-8");

      const title = extractTitle(xml);
      if (!title) {
        skipped++;
        continue;
      }

      const statuteRef = extractStatuteRef(xml);
      const type = detectType(xml);
      const text = stripXmlTags(xml);

      if (text.length < 100) {
        skipped++;
        continue;
      }

      const chunkSize = law.language === "fr" ? 300 : CHUNK_SIZE;
      const chunks = chunkText(text, chunkSize);

      if (chunks.length === 0) {
        skipped++;
        continue;
      }

      console.log(`[${num}/${lawFiles.length}] ${title} (${law.language.toUpperCase()}, ${type}) — ${chunks.length} chunks`);

      const embeddings = await embedBatch(chunks);

      for (let j = 0; j < chunks.length; j++) {
        allRecords.push({
          id: `${fileName.replace(/[^a-z0-9]/gi, "-")}-${law.language}-${j}`,
          vector: embeddings[j],
          text: chunks[j],
          source: title,
          jurisdiction: "Canada",
          statute: statuteRef ? `${type === "act" ? "R.S.C." : ""} ${statuteRef}`.trim() : "",
          section: "",
          language: law.language,
        });
      }

      completed++;

      if (allRecords.length >= FLUSH_THRESHOLD) {
        await flush();
      }
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      console.error(`[${num}/${lawFiles.length}] FAILED ${fileName}: ${msg}`);
      failed.push(fileName);
    }
  }

  // Write remaining records
  await flush();

  console.log("\nVector store built successfully.\n");
  console.log("Summary:");
  console.log(`  Completed: ${completed}`);
  console.log(`  Skipped: ${skipped}`);
  console.log(`  Failed: ${failed.length}`);
  if (failed.length > 0) {
    failed.slice(0, 20).forEach((f) => console.log(`    - ${f}`));
    if (failed.length > 20) console.log(`    … and ${failed.length - 20} more`);
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
