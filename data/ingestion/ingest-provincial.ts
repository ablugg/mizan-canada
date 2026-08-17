/**
 * Ingests provincial legislation and regulations from the A2AJ Canadian Legal Data
 * (via Hugging Face) into Mizan's LanceDB vector store.
 *
 * Downloads full text of all provincial/territorial statutes and regulations,
 * chunks them, embeds with nomic-embed-text, and adds to the existing vector store.
 *
 * Run with: npx tsx data/ingestion/ingest-provincial.ts
 * Options:
 *   --province=ON,QC,BC   Only ingest specific provinces (comma-separated codes)
 *   --type=legislation     Only ingest legislation (skip regulations)
 *   --type=regulations     Only ingest regulations (skip legislation)
 *   --dry-run              Count documents without downloading or embedding
 *
 * Requires: pip3 install datasets
 * Requires: Ollama running with nomic-embed-text pulled.
 */
import { config } from "dotenv";
config({ path: ".env" });

import * as path from "path";
import { execSync } from "child_process";
import { Ollama } from "ollama";
import { chunkText } from "./build-vectors";

const OLLAMA_HOST = process.env.OLLAMA_HOST ?? "http://127.0.0.1:11434";
const EMBEDDING_MODEL = process.env.OLLAMA_EMBEDDING_MODEL ?? "nomic-embed-text";
const VECTOR_DB_PATH = process.env.VECTOR_DB_PATH ?? path.join(process.cwd(), "data/vector-store");
const TABLE_NAME = "legal_chunks";

const CHUNK_SIZE = 400;
const FLUSH_THRESHOLD = 500;

const ollama = new Ollama({ host: OLLAMA_HOST });

const PROVINCE_MAP: Record<string, string> = {
  AB: "Alberta", BC: "British Columbia", MB: "Manitoba", NB: "New Brunswick",
  NL: "Newfoundland and Labrador", NS: "Nova Scotia", NT: "Northwest Territories",
  ON: "Ontario", PE: "Prince Edward Island", QC: "Quebec", SK: "Saskatchewan", YT: "Yukon",
};

function datasetToProvince(dataset: string): string {
  const match = dataset.match(/-(AB|BC|MB|NB|NL|NS|NT|ON|PE|QC|SK|YT)$/);
  if (match) return PROVINCE_MAP[match[1]] ?? match[1];
  return "Canada";
}

async function embedBatch(texts: string[]): Promise<number[][]> {
  const embeddings: number[][] = [];
  for (const text of texts) {
    // nomic-embed-text has a ~8192 token context; truncate to ~2000 words to be safe
    const truncated = text.split(/\s+/).slice(0, 2000).join(" ");
    try {
      const res = await ollama.embeddings({ model: EMBEDDING_MODEL, prompt: truncated });
      embeddings.push(res.embedding);
    } catch (err) {
      // If still too long, truncate harder
      const shorter = truncated.split(/\s+/).slice(0, 500).join(" ");
      const res = await ollama.embeddings({ model: EMBEDDING_MODEL, prompt: shorter });
      embeddings.push(res.embedding);
    }
  }
  return embeddings;
}

interface HFRow {
  dataset: string;
  citation_en?: string;
  citation_fr?: string;
  name_en?: string;
  name_fr?: string;
  unofficial_text_en?: string;
  unofficial_text_fr?: string;
}

function streamHuggingFace(filterDatasets: string[]): HFRow[] {
  const fs = require("fs") as typeof import("fs");
  const os = require("os") as typeof import("os");

  const filterJson = JSON.stringify(filterDatasets);
  const scriptPath = path.join(os.tmpdir(), "mizan_hf_download.py");

  fs.writeFileSync(scriptPath, `
import json, sys
from datasets import load_dataset

ds = load_dataset('a2aj/canadian-laws', split='train', streaming=True)
filters = set(${filterJson})

for row in ds:
    d = row.get('dataset', '')
    if d not in filters:
        continue
    out = {
        'dataset': d,
        'citation_en': row.get('citation_en', ''),
        'citation_fr': row.get('citation_fr', ''),
        'name_en': row.get('name_en', ''),
        'name_fr': row.get('name_fr', ''),
        'unofficial_text_en': row.get('unofficial_text_en', '') or '',
        'unofficial_text_fr': row.get('unofficial_text_fr', '') or '',
    }
    print(json.dumps(out, ensure_ascii=False))
    sys.stdout.flush()
`);

  console.log("Streaming from Hugging Face (a2aj/canadian-laws)...");
  console.log(`Filtering for datasets: ${filterDatasets.join(", ")}\n`);

  const result = execSync(`python3 "${scriptPath}"`, {
    encoding: "utf-8",
    maxBuffer: 1024 * 1024 * 1024,
    timeout: 1800000,
  });

  fs.unlinkSync(scriptPath);

  const rows: HFRow[] = [];
  for (const line of result.split("\n")) {
    if (!line.trim()) continue;
    try {
      rows.push(JSON.parse(line));
    } catch {
      // skip malformed lines
    }
  }

  return rows;
}

async function main() {
  const args = process.argv.slice(2);
  const provinceFilter = args.find((a) => a.startsWith("--province="))?.split("=")[1]?.split(",") ?? [];
  const typeFilter = args.find((a) => a.startsWith("--type="))?.split("=")[1] ?? "";
  const dryRun = args.includes("--dry-run");

  console.log("Mizan Provincial Law Ingestion Pipeline");
  console.log("Source: A2AJ Canadian Legal Data (Hugging Face)\n");

  if (provinceFilter.length > 0) console.log(`Province filter: ${provinceFilter.join(", ")}`);
  if (typeFilter) console.log(`Type filter: ${typeFilter}`);
  if (dryRun) console.log("DRY RUN MODE\n");

  // Build list of target datasets
  const allProvinces = Object.keys(PROVINCE_MAP);
  const provinces = provinceFilter.length > 0 ? provinceFilter : allProvinces;

  const targetDatasets: string[] = [];
  for (const prov of provinces) {
    if (!typeFilter || typeFilter === "legislation") {
      targetDatasets.push(`LEGISLATION-${prov}`);
    }
    if (!typeFilter || typeFilter === "regulations") {
      targetDatasets.push(`REGULATIONS-${prov}`);
    }
  }

  console.log(`Target datasets: ${targetDatasets.length}`);
  for (const ds of targetDatasets) {
    console.log(`  ${ds} (${datasetToProvince(ds)})`);
  }
  console.log();

  if (dryRun) {
    console.log("Dry run complete.");
    return;
  }

  // Check Ollama
  try {
    await ollama.list();
    console.log("Ollama connection confirmed.\n");
  } catch {
    console.error("Ollama is not running. Start Ollama and pull nomic-embed-text first.");
    process.exit(1);
  }

  // Download all matching rows from HF
  const rows = streamHuggingFace(targetDatasets);
  console.log(`Downloaded ${rows.length} documents from Hugging Face.\n`);

  if (rows.length === 0) {
    console.log("No documents found. Check your filters.");
    return;
  }

  // Group by dataset for reporting
  const byDataset: Record<string, number> = {};
  for (const r of rows) {
    byDataset[r.dataset] = (byDataset[r.dataset] ?? 0) + 1;
  }
  for (const [ds, count] of Object.entries(byDataset).sort()) {
    console.log(`  ${ds}: ${count} documents`);
  }
  console.log();

  // Connect to LanceDB
  const lancedb = await import("@lancedb/lancedb");
  const db = await lancedb.connect(VECTOR_DB_PATH);

  let tableExists = false;
  try {
    await db.openTable(TABLE_NAME);
    tableExists = true;
  } catch {
    // table doesn't exist yet
  }

  let allRecords: Record<string, unknown>[] = [];
  let totalRecords = 0;
  let completedDocs = 0;
  let skippedDocs = 0;

  async function flush() {
    if (allRecords.length === 0) return;
    console.log(`  Flushing ${allRecords.length} records (total: ${totalRecords + allRecords.length})...`);
    if (!tableExists) {
      await db.createTable(TABLE_NAME, allRecords);
      tableExists = true;
    } else {
      const table = await db.openTable(TABLE_NAME);
      await table.add(allRecords);
    }
    totalRecords += allRecords.length;
    allRecords = [];
  }

  for (let i = 0; i < rows.length; i++) {
    const row = rows[i];
    const citation = row.citation_en ?? row.citation_fr ?? "";
    const province = datasetToProvince(row.dataset);

    try {
    // Process English and French
    for (const lang of ["en", "fr"] as const) {
      const text = lang === "en" ? row.unofficial_text_en : row.unofficial_text_fr;
      const name = lang === "en" ? (row.name_en || row.name_fr || citation) : (row.name_fr || row.name_en || citation);

      if (!text || text.length < 100) continue;

      const chunkSize = lang === "fr" ? 300 : CHUNK_SIZE;
      const chunks = chunkText(text, chunkSize);
      if (chunks.length === 0) continue;

      if (lang === "en") {
        console.log(`[${i + 1}/${rows.length}] ${name} (${province}, ${lang.toUpperCase()}) - ${chunks.length} chunks`);
      }

      const embeddings = await embedBatch(chunks);

      for (let j = 0; j < chunks.length; j++) {
        allRecords.push({
          id: `prov-${row.dataset}-${citation.replace(/[^a-z0-9]/gi, "-")}-${lang}-${j}`,
          vector: embeddings[j],
          text: chunks[j],
          source: name,
          jurisdiction: province,
          statute: citation,
          section: "",
          language: lang,
        });
      }
    }

    completedDocs++;
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      console.error(`  FAILED [${i + 1}/${rows.length}] ${citation}: ${msg}`);
      skippedDocs++;
    }

    if (allRecords.length >= FLUSH_THRESHOLD) {
      await flush();
    }
  }

  await flush();

  console.log("\n\nIngestion complete.\n");
  console.log("Summary:");
  console.log(`  Documents ingested: ${completedDocs}`);
  console.log(`  Documents skipped:  ${skippedDocs}`);
  console.log(`  Total vector records added: ${totalRecords}`);
  console.log(`\nVector store: ${VECTOR_DB_PATH}`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
