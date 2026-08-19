/**
 * Ingests Supreme Court of Canada case law from the A2AJ Canadian Legal Data
 * (via Hugging Face) into Mizan's LanceDB vector store.
 *
 * Downloads full text of SCC decisions, chunks them, embeds with
 * nomic-embed-text, and adds to the existing vector store.
 *
 * Run with: npx tsx data/ingestion/ingest-cases.ts
 * Options:
 *   --court=SCC,FCA,ONCA   Only ingest specific courts (comma-separated)
 *   --dry-run               Count documents without downloading or embedding
 *
 * Available court codes: SCC, FCA, BCCA, ONCA, NSCA, YKCA, FC, TCC, CMAC,
 *   BCSC, NSSC, NSPC, NSFC, NSSM, CHRT, CIRB, CITT, CT, FPSLREB, OHSTC,
 *   OIC, PSDPT, RAD, RPD, RLLR, SST, TATC, CART, SCT
 *
 * Requires: pip3 install datasets
 * Requires: Ollama running with nomic-embed-text pulled.
 */
import { config } from "dotenv";
config({ path: ".env" });

import * as fs from "fs";
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

const COURT_LABELS: Record<string, string> = {
  SCC: "Supreme Court of Canada",
  FCA: "Federal Court of Appeal",
  FC: "Federal Court",
  ONCA: "Ontario Court of Appeal",
  BCCA: "BC Court of Appeal",
  BCSC: "BC Supreme Court",
  NSCA: "Nova Scotia Court of Appeal",
  TCC: "Tax Court of Canada",
  CHRT: "Canadian Human Rights Tribunal",
};

async function embedBatch(texts: string[]): Promise<number[][]> {
  const embeddings: number[][] = [];
  for (const text of texts) {
    const truncated = text.split(/\s+/).slice(0, 2000).join(" ");
    try {
      const res = await ollama.embeddings({ model: EMBEDDING_MODEL, prompt: truncated });
      embeddings.push(res.embedding);
    } catch {
      const shorter = truncated.split(/\s+/).slice(0, 500).join(" ");
      const res = await ollama.embeddings({ model: EMBEDDING_MODEL, prompt: shorter });
      embeddings.push(res.embedding);
    }
  }
  return embeddings;
}

interface HFCaseRow {
  dataset: string;
  citation_en?: string;
  citation_fr?: string;
  name_en?: string;
  name_fr?: string;
  unofficial_text_en?: string;
  unofficial_text_fr?: string;
  document_date_en?: string;
}

function streamCases(courtCodes: string[]): HFCaseRow[] {
  const os = require("os") as typeof import("os");
  const filterJson = JSON.stringify(courtCodes);
  const scriptPath = path.join(os.tmpdir(), "mizan_hf_cases.py");

  fs.writeFileSync(scriptPath, `
import json, sys
from datasets import load_dataset

ds = load_dataset('a2aj/canadian-case-law', split='train', streaming=True)
filters = set(${filterJson})
count = 0

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
        'document_date_en': row.get('document_date_en', ''),
    }
    print(json.dumps(out, ensure_ascii=False))
    sys.stdout.flush()
    count += 1

print(json.dumps({'_done': True, '_count': count}), file=sys.stderr)
`);

  console.log("Streaming from Hugging Face (a2aj/canadian-case-law)...");
  console.log(`Filtering for courts: ${courtCodes.join(", ")}\n`);
  console.log("This may take several minutes to stream through the full dataset.\n");

  const result = execSync(`python3 "${scriptPath}"`, {
    encoding: "utf-8",
    maxBuffer: 4 * 1024 * 1024 * 1024, // 4GB buffer for large datasets
    timeout: 3600000, // 1 hour timeout
  });

  fs.unlinkSync(scriptPath);

  const rows: HFCaseRow[] = [];
  for (const line of result.split("\n")) {
    if (!line.trim()) continue;
    try {
      const parsed = JSON.parse(line);
      if (!parsed._done) rows.push(parsed);
    } catch {
      // skip malformed
    }
  }

  return rows;
}

async function main() {
  const args = process.argv.slice(2);
  const courtFilter = args.find((a) => a.startsWith("--court="))?.split("=")[1]?.split(",") ?? ["SCC"];
  const dryRun = args.includes("--dry-run");

  console.log("Mizan Case Law Ingestion Pipeline");
  console.log("Source: A2AJ Canadian Legal Data (Hugging Face)\n");
  console.log(`Courts: ${courtFilter.join(", ")}`);
  if (dryRun) console.log("DRY RUN MODE\n");

  if (dryRun) {
    console.log("Target courts:");
    for (const c of courtFilter) {
      console.log(`  ${c} (${COURT_LABELS[c] || c})`);
    }
    console.log("\nDry run complete.");
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

  // Download cases
  const rows = streamCases(courtFilter);
  console.log(`Downloaded ${rows.length} cases.\n`);

  if (rows.length === 0) {
    console.log("No cases found.");
    return;
  }

  // Group by court for reporting
  const byCourt: Record<string, number> = {};
  for (const r of rows) {
    byCourt[r.dataset] = (byCourt[r.dataset] ?? 0) + 1;
  }
  for (const [court, count] of Object.entries(byCourt).sort()) {
    console.log(`  ${court}: ${count} cases`);
  }
  console.log();

  // Connect to LanceDB
  const lancedb = await import("@lancedb/lancedb");
  const db = await lancedb.connect(VECTOR_DB_PATH);

  let tableExists = false;
  try {
    await db.openTable(TABLE_NAME);
    tableExists = true;
  } catch {}

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
    const court = COURT_LABELS[row.dataset] || row.dataset;

    try {
      // Only process English text for case law (French adds too much volume)
      const text = row.unofficial_text_en;
      const name = row.name_en || row.name_fr || citation;

      if (!text || text.length < 200) {
        skippedDocs++;
        continue;
      }

      const chunks = chunkText(text, CHUNK_SIZE);
      if (chunks.length === 0) {
        skippedDocs++;
        continue;
      }

      console.log(`[${i + 1}/${rows.length}] ${name} (${row.dataset}) - ${chunks.length} chunks`);

      const embeddings = await embedBatch(chunks);

      for (let j = 0; j < chunks.length; j++) {
        allRecords.push({
          id: `case-${row.dataset}-${citation.replace(/[^a-z0-9]/gi, "-")}-${j}`,
          vector: embeddings[j],
          text: chunks[j],
          source: `${name} (${citation})`,
          jurisdiction: court,
          statute: citation,
          section: "",
          language: "en",
        });
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
  console.log(`  Cases ingested: ${completedDocs}`);
  console.log(`  Cases skipped:  ${skippedDocs}`);
  console.log(`  Total vector records added: ${totalRecords}`);
  console.log(`\nVector store: ${VECTOR_DB_PATH}`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
