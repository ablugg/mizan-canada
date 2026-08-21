/**
 * Adds headnote-only chunks for SCC decisions to the existing vector store.
 * Does NOT re-ingest body chunks — only adds new headnote chunks tagged
 * with section="headnote" for priority retrieval.
 *
 * Run with: npx tsx data/ingestion/ingest-headnotes.ts
 *
 * Requires: pip3 install datasets
 * Requires: Ollama running with nomic-embed-text pulled.
 */
import { config } from "dotenv";
config({ path: ".env" });

import * as fs from "fs";
import * as path from "path";
import { Ollama } from "ollama";
import { chunkText } from "./build-vectors";

const OLLAMA_HOST = process.env.OLLAMA_HOST ?? "http://127.0.0.1:11434";
const EMBEDDING_MODEL = process.env.OLLAMA_EMBEDDING_MODEL ?? "nomic-embed-text";
const VECTOR_DB_PATH = process.env.VECTOR_DB_PATH ?? path.join(process.cwd(), "data/vector-store");
const TABLE_NAME = "legal_chunks";

const HEADNOTE_CHUNK_SIZE = 600;
const FLUSH_THRESHOLD = 500;

const ollama = new Ollama({ host: OLLAMA_HOST });

const COURT_LABELS: Record<string, string> = {
  SCC: "Supreme Court of Canada",
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

/**
 * Extract the headnote/summary section from an SCC decision.
 * SCC decisions follow: metadata -> parties -> headnote -> full opinion.
 * The headnote contains "Held:", issue summaries, and the disposition.
 */
function extractHeadnote(text: string): string {
  const headnoteMarkers = [
    /\bHeld\s*[:,]/i,
    /\b(?:Constitutional law|Criminal law|Civil procedure|Administrative law|Charter of Rights)\s*[—–-]/i,
    /\bAppeal\s+(?:from|allowed|dismissed)/i,
  ];

  let startIdx = -1;
  for (const marker of headnoteMarkers) {
    const match = marker.exec(text);
    if (match && (startIdx === -1 || match.index < startIdx)) {
      const before = text.lastIndexOf("\n", match.index);
      startIdx = before > 0 ? before : match.index;
    }
  }

  if (startIdx === -1) {
    const issuePattern = /(?:under what circumstances|whether|the question|at issue|this appeal)/i;
    const issueMatch = issuePattern.exec(text);
    if (issueMatch) {
      const before = text.lastIndexOf("\n", issueMatch.index);
      startIdx = before > 0 ? before : issueMatch.index;
    }
  }

  if (startIdx === -1) return "";

  const opinionMarkers = [
    /\n\s*\[1\]\s/,
    /\n\s*The (?:Chief Justice|judgment|reasons|following)/i,
    /\n\s*Per\s+\w+\s+(?:C\.?J\.?|J\.)\s/i,
    /\n\s*(?:I|II|III|IV|V)\.\s+[A-Z]/,
    /\bReasons for [Jj]udgment/,
  ];

  let endIdx = text.length;
  for (const marker of opinionMarkers) {
    const match = marker.exec(text.slice(startIdx));
    if (match) {
      const candidateEnd = startIdx + match.index;
      if (candidateEnd > startIdx + 100 && candidateEnd < endIdx) {
        endIdx = candidateEnd;
      }
    }
  }

  const maxLen = 3000;
  if (endIdx - startIdx > maxLen) {
    endIdx = startIdx + maxLen;
  }

  const headnote = text.slice(startIdx, endIdx).trim();
  return headnote.length >= 100 ? headnote : "";
}

interface HFCaseRow {
  dataset: string;
  citation_en?: string;
  citation_fr?: string;
  name_en?: string;
  name_fr?: string;
  unofficial_text_en?: string;
  unofficial_text_fr?: string;
}

function streamCases(): Promise<HFCaseRow[]> {
  return new Promise((resolve, reject) => {
    const os = require("os") as typeof import("os");
    const { spawn } = require("child_process") as typeof import("child_process");
    const scriptPath = path.join(os.tmpdir(), "mizan_hf_headnotes.py");

    fs.writeFileSync(scriptPath, `
import json, sys, os
from datasets import load_dataset

token = os.environ.get('HF_TOKEN') or None
ds = load_dataset('a2aj/canadian-case-law', split='train', streaming=True, token=token)
count = 0

for row in ds:
    d = row.get('dataset', '')
    if d != 'SCC':
        continue
    out = {
        'dataset': d,
        'citation_en': row.get('citation_en', ''),
        'name_en': row.get('name_en', ''),
        'name_fr': row.get('name_fr', ''),
        'unofficial_text_en': row.get('unofficial_text_en', '') or '',
    }
    print(json.dumps(out, ensure_ascii=False))
    sys.stdout.flush()
    count += 1

print(f"Streamed {count} SCC cases", file=sys.stderr)
`);

    console.log("Streaming SCC cases from Hugging Face...\n");

    const rows: HFCaseRow[] = [];
    const proc = spawn("python3", [scriptPath], { stdio: ["ignore", "pipe", "pipe"] });

    let buffer = "";
    proc.stdout.on("data", (chunk: Buffer) => {
      buffer += chunk.toString("utf-8");
      const lines = buffer.split("\n");
      buffer = lines.pop() ?? "";
      for (const line of lines) {
        if (!line.trim()) continue;
        try {
          rows.push(JSON.parse(line));
        } catch { /* skip */ }
      }
      if (rows.length % 1000 === 0 && rows.length > 0) {
        console.log(`  ...streamed ${rows.length} cases`);
      }
    });

    proc.stderr.on("data", (chunk: Buffer) => {
      console.log(`  [python] ${chunk.toString("utf-8").trim()}`);
    });

    proc.on("close", (code: number) => {
      if (buffer.trim()) {
        try { rows.push(JSON.parse(buffer)); } catch {}
      }
      try { fs.unlinkSync(scriptPath); } catch {}
      if (code !== 0) reject(new Error(`Python exited with code ${code}`));
      else resolve(rows);
    });

    proc.on("error", (err: Error) => {
      try { fs.unlinkSync(scriptPath); } catch {}
      reject(err);
    });
  });
}

async function main() {
  console.log("Mizan Headnote Ingestion Pipeline");
  console.log("Adds headnote chunks to existing vector store (no duplicates of body text)\n");

  // Check Ollama
  try {
    await ollama.list();
    console.log("Ollama connection confirmed.\n");
  } catch {
    console.error("Ollama is not running. Start Ollama and pull nomic-embed-text first.");
    process.exit(1);
  }

  const rows = await streamCases();
  console.log(`\nDownloaded ${rows.length} SCC cases.\n`);

  if (rows.length === 0) {
    console.log("No cases found.");
    return;
  }

  // Connect to LanceDB
  const lancedb = await import("@lancedb/lancedb");
  const db = await lancedb.connect(VECTOR_DB_PATH);

  let tableExists = false;
  try {
    await db.openTable(TABLE_NAME);
    tableExists = true;
  } catch {}

  if (!tableExists) {
    console.error("Vector store table not found. Run full ingestion first.");
    process.exit(1);
  }

  let allRecords: Record<string, unknown>[] = [];
  let totalRecords = 0;
  let headnoteCount = 0;
  let noHeadnote = 0;

  async function flush() {
    if (allRecords.length === 0) return;
    console.log(`  Flushing ${allRecords.length} headnote records (total: ${totalRecords + allRecords.length})...`);
    const table = await db.openTable(TABLE_NAME);
    await table.add(allRecords);
    totalRecords += allRecords.length;
    allRecords = [];
  }

  for (let i = 0; i < rows.length; i++) {
    const row = rows[i];
    const citation = row.citation_en ?? "";
    const name = row.name_en || row.name_fr || citation;
    const text = row.unofficial_text_en;

    if (!text || text.length < 200) {
      noHeadnote++;
      continue;
    }

    const headnote = extractHeadnote(text);
    if (!headnote) {
      noHeadnote++;
      continue;
    }

    const chunks = chunkText(headnote, HEADNOTE_CHUNK_SIZE);
    if (chunks.length === 0) {
      noHeadnote++;
      continue;
    }

    if ((i + 1) % 500 === 0) {
      console.log(`[${i + 1}/${rows.length}] Processing headnotes... (${headnoteCount} extracted so far)`);
    }

    const embeddings = await embedBatch(chunks);

    for (let j = 0; j < chunks.length; j++) {
      allRecords.push({
        id: `case-SCC-${citation.replace(/[^a-z0-9]/gi, "-")}-hn-${j}`,
        vector: embeddings[j],
        text: chunks[j],
        source: `${name} (${citation})`,
        jurisdiction: "Supreme Court of Canada",
        statute: citation,
        section: "headnote",
        language: "en",
      });
    }

    headnoteCount++;

    if (allRecords.length >= FLUSH_THRESHOLD) {
      await flush();
    }
  }

  await flush();

  console.log("\n\nHeadnote ingestion complete.\n");
  console.log("Summary:");
  console.log(`  Cases with headnotes: ${headnoteCount}`);
  console.log(`  Cases without headnotes: ${noHeadnote}`);
  console.log(`  Headnote chunks added: ${totalRecords}`);
  console.log(`\nVector store: ${VECTOR_DB_PATH}`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
