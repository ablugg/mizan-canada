/**
 * Eval harness for Mizan RAG + model grounding.
 *
 * For each case in cases.jsonl:
 *   1. Calls retrieveContext → measures recall@k (did the gold source appear?)
 *   2. Calls the model with the retrieved context → checks:
 *      - gold section appears in answer
 *      - gold figure appears in answer
 *      - every legal claim carries an [S#] tag
 *      - abstention fires when it should (and doesn't when it shouldn't)
 *   3. Runs verifyAnswer for structural integrity
 *
 * Outputs a summary table to stdout and a JSON results file.
 *
 * Usage: npx tsx evals/run.ts [--rag-only] [--filter=<id-prefix>] [--topk=8]
 *
 *   --rag-only    Skip model inference (only test retrieval)
 *   --filter=X    Only run cases whose id starts with X
 *   --topk=N      Override topK for retrieval (default 8)
 */

import { config } from "dotenv";
config({ path: ".env" });

import * as fs from "fs";
import * as path from "path";
import {
  retrieveContext,
  resetConnection,
  verifyAnswer,
  parseSourceTags,
  NO_AUTHORITY_SENTINEL,
} from "../lib/rag";
import { chat, SYSTEM_PROMPT, SOURCE_BLOCK_HEADER } from "../lib/llm";
import type { ChatMessage } from "../lib/llm";

// --- Types ---

interface EvalCase {
  id: string;
  question: string;
  province: string;
  expectedJurisdiction: string;
  goldSource: string | null;
  goldSection: string | null;
  goldFigure: string | null;
  expectAbstention: boolean;
}

interface CaseResult {
  id: string;
  question: string;

  // Retrieval
  retrievalTimeMs: number;
  abstained: boolean;
  sourceCount: number;
  recallHit: boolean;           // gold source name found in retrieved sources
  recallRank: number | null;    // 1-indexed rank where gold source appeared, null if not found

  // Generation (null if --rag-only)
  generationTimeMs: number | null;
  answerLength: number | null;
  sectionFound: boolean | null;  // gold section appears in model answer
  figureFound: boolean | null;   // gold figure appears in model answer
  tagCoverage: number | null;    // fraction of legal sentences that have an [S#] tag
  verifyOk: boolean | null;      // verifyAnswer returned ok
  verifyFailures: number | null;

  // Abstention correctness
  abstentionCorrect: boolean;    // abstained === expectAbstention

  pass: boolean;
}

interface EvalSummary {
  timestamp: string;
  totalCases: number;
  ragOnly: boolean;
  topK: number;

  // Retrieval
  recallAtK: number;        // fraction of non-abstention cases where gold source was found
  meanRetrievalMs: number;
  abstentionPrecision: number | null; // of cases that abstained, how many should have (null if 0/0)
  abstentionRecall: number | null;    // of cases that should abstain, how many did (null if 0/0)

  // Generation (null if --rag-only)
  sectionAccuracy: number | null;
  figureAccuracy: number | null;
  meanTagCoverage: number | null;
  verifyPassRate: number | null;
  meanGenerationMs: number | null;

  passRate: number;
  results: CaseResult[];
}

// --- Helpers ---

function loadCases(filterPrefix?: string): EvalCase[] {
  const casesPath = path.join(__dirname, "cases.jsonl");
  const lines = fs.readFileSync(casesPath, "utf-8").split("\n").filter(l => l.trim());
  const cases: EvalCase[] = lines.map(l => JSON.parse(l));
  if (filterPrefix) {
    return cases.filter(c => c.id.startsWith(filterPrefix));
  }
  return cases;
}

/** Check if a gold source name appears in the rendered sources string. */
function findSourceInContext(
  context: string,
  goldSource: string
): { found: boolean; rank: number | null } {
  if (!goldSource || !context) return { found: false, rank: null };

  // Parse the [S#] tagged blocks
  const blocks = context.split(/\n\n---\n\n/);
  const goldLower = goldSource.toLowerCase();

  for (let i = 0; i < blocks.length; i++) {
    const block = blocks[i];
    // The first line contains [S#] tag + metadata
    const firstLine = block.split("\n")[0] ?? "";
    if (firstLine.toLowerCase().includes(goldLower)) {
      return { found: true, rank: i + 1 };
    }
  }
  return { found: false, rank: null };
}

/** Count how many "legal sentences" have an [S#] tag vs don't.
 *  A "legal sentence" is one containing keywords like section, act, offence,
 *  penalty, fine, liable, conviction, court, etc. — filtering out fluff. */
function measureTagCoverage(answer: string): number {
  const legalKeywords = /\b(section|s\.\s*\d|act|offence|offense|penalty|fine|liable|conviction|convicted|imprison|sentence|court|statute|charter|subsection|paragraph|regulation|pursuant|contravention)\b/i;

  const sentences = answer.split(/(?<=[.!?])\s+/).filter(s => s.length > 20);
  const legalSentences = sentences.filter(s => legalKeywords.test(s));

  if (legalSentences.length === 0) return 1.0; // no legal claims = nothing to tag

  const tagged = legalSentences.filter(s => /\[S\d+\]/.test(s));
  return tagged.length / legalSentences.length;
}

/** Check if a string (section ref or figure) appears in the answer, case-insensitive. */
function containsGold(answer: string, gold: string | null): boolean | null {
  if (gold === null) return null; // not applicable
  return answer.toLowerCase().includes(gold.toLowerCase());
}

// --- Main ---

async function main() {
  const args = process.argv.slice(2);
  const ragOnly = args.includes("--rag-only");
  const filterArg = args.find(a => a.startsWith("--filter="));
  const filterPrefix = filterArg?.split("=")[1];
  const topKArg = args.find(a => a.startsWith("--topk="));
  const topK = topKArg ? parseInt(topKArg.split("=")[1], 10) : 8;

  const cases = loadCases(filterPrefix);
  console.log(`\nMizan Eval Harness`);
  console.log(`Cases: ${cases.length}${filterPrefix ? ` (filter: ${filterPrefix}*)` : ""}`);
  console.log(`Mode: ${ragOnly ? "RAG-only" : "RAG + model"}`);
  console.log(`topK: ${topK}\n`);

  const results: CaseResult[] = [];

  for (let i = 0; i < cases.length; i++) {
    const c = cases[i];
    const prefix = `[${i + 1}/${cases.length}] ${c.id}`;
    process.stdout.write(`${prefix} ... `);

    // --- Retrieval (with retry on Ollama crash) ---
    const t0 = Date.now();
    let context: string;
    let retrivalAttempts = 0;
    const maxRetries = 2;
    while (true) {
      try {
        context = await retrieveContext(c.question, topK, {
          province: c.province === "federal" ? undefined : c.province,
          language: "en",
        });
        break;
      } catch (err) {
        retrivalAttempts++;
        const errMsg = err instanceof Error ? err.message : String(err);
        if (retrivalAttempts <= maxRetries && (errMsg.includes("Compute error") || errMsg.includes("500"))) {
          console.log(`RETRIEVAL ERROR (attempt ${retrivalAttempts}/${maxRetries + 1}), restarting Ollama...`);
          const { execSync } = await import("child_process");
          try { execSync("pkill -f ollama", { timeout: 5000 }); } catch { /* may already be dead */ }
          await new Promise(r => setTimeout(r, 3000));
          try { execSync("open -a Ollama", { timeout: 5000 }); } catch { /* fallback */ }
          await new Promise(r => setTimeout(r, 8000));
          resetConnection();
          continue;
        }
        console.log("RETRIEVAL ERROR");
        console.error(err);
        results.push({
          id: c.id, question: c.question,
          retrievalTimeMs: Date.now() - t0, abstained: false, sourceCount: 0,
          recallHit: false, recallRank: null,
          generationTimeMs: null, answerLength: null,
          sectionFound: null, figureFound: null, tagCoverage: null,
          verifyOk: null, verifyFailures: null,
          abstentionCorrect: false, pass: false,
        });
        break;
      }
    }
    if (!context!) continue;
    const retrievalMs = Date.now() - t0;

    const abstained = context === NO_AUTHORITY_SENTINEL;
    const sourceCount = abstained ? 0 : (context.match(/\[S\d+\]/g) ?? []).length;

    let recallHit = false;
    let recallRank: number | null = null;
    if (!abstained && c.goldSource) {
      const r = findSourceInContext(context, c.goldSource);
      recallHit = r.found;
      recallRank = r.rank;
    }

    const abstentionCorrect = abstained === c.expectAbstention;

    // --- Generation ---
    let generationTimeMs: number | null = null;
    let answerLength: number | null = null;
    let sectionFound: boolean | null = null;
    let figureFound: boolean | null = null;
    let tagCoverage: number | null = null;
    let verifyOk: boolean | null = null;
    let verifyFailures: number | null = null;

    if (!ragOnly && !abstained) {
      const userContent = context
        ? `${c.question}\n\n---\n${SOURCE_BLOCK_HEADER}\n\n${context}`
        : c.question;

      const messages: ChatMessage[] = [{ role: "user", content: userContent }];

      const tGen = Date.now();
      try {
        let answer: string;
        try {
          answer = await chat(messages);
        } catch (chatErr) {
          const chatErrMsg = chatErr instanceof Error ? chatErr.message : String(chatErr);
          if (chatErrMsg.includes("Compute error") || chatErrMsg.includes("500")) {
            console.log("MODEL CRASH, restarting Ollama...");
            const { execSync } = await import("child_process");
            try { execSync("pkill -f ollama", { timeout: 5000 }); } catch { /* */ }
            await new Promise(r => setTimeout(r, 3000));
            try { execSync("open -a Ollama", { timeout: 5000 }); } catch { /* */ }
            await new Promise(r => setTimeout(r, 8000));
            answer = await chat(messages);
          } else {
            throw chatErr;
          }
        }
        // Strip think blocks if present
        answer = answer.replace(/<think>[\s\S]*?<\/think>/g, "").trim();
        generationTimeMs = Date.now() - tGen;
        answerLength = answer.length;

        sectionFound = containsGold(answer, c.goldSection);
        figureFound = containsGold(answer, c.goldFigure);
        tagCoverage = measureTagCoverage(answer);

        if (context) {
          const sourceMap = parseSourceTags(context);
          const vResult = verifyAnswer(answer, sourceMap);
          verifyOk = vResult.ok;
          verifyFailures = vResult.failures.length;
        }
      } catch (err) {
        console.log("GENERATION ERROR");
        console.error(err);
        generationTimeMs = Date.now() - tGen;
      }
    }

    // --- Pass/fail ---
    let pass = abstentionCorrect;
    if (!c.expectAbstention && !abstained) {
      if (c.goldSource) pass = pass && recallHit;
      if (!ragOnly) {
        if (c.goldSection !== null) pass = pass && (sectionFound === true);
        if (c.goldFigure !== null) pass = pass && (figureFound === true);
      }
    }

    results.push({
      id: c.id, question: c.question,
      retrievalTimeMs: retrievalMs, abstained, sourceCount,
      recallHit, recallRank,
      generationTimeMs, answerLength,
      sectionFound, figureFound, tagCoverage,
      verifyOk, verifyFailures,
      abstentionCorrect, pass,
    });

    // Compact status line
    const parts: string[] = [];
    if (abstained) {
      parts.push(abstentionCorrect ? "ABSTAIN-OK" : "ABSTAIN-WRONG");
    } else {
      parts.push(recallHit ? `recall@${recallRank}` : "recall-MISS");
      if (!ragOnly) {
        if (sectionFound !== null) parts.push(sectionFound ? "sec-OK" : "sec-MISS");
        if (figureFound !== null) parts.push(figureFound ? "fig-OK" : "fig-MISS");
        if (tagCoverage !== null) parts.push(`tags=${(tagCoverage * 100).toFixed(0)}%`);
        if (verifyOk !== null) parts.push(verifyOk ? "verify-OK" : `verify-FAIL(${verifyFailures})`);
      }
    }
    parts.push(`${retrievalMs}ms`);
    if (generationTimeMs !== null) parts.push(`+${generationTimeMs}ms`);
    console.log(`${pass ? "PASS" : "FAIL"} ${parts.join(" | ")}`);
  }

  // --- Summary ---
  const nonAbstentionCases = results.filter(r => !cases.find(c => c.id === r.id)!.expectAbstention);
  const abstentionCases = results.filter(r => cases.find(c => c.id === r.id)!.expectAbstention);
  const casesWithGoldSource = nonAbstentionCases.filter(r => {
    const c = cases.find(cc => cc.id === r.id)!;
    return c.goldSource !== null;
  });

  const recallAtK = casesWithGoldSource.length > 0
    ? casesWithGoldSource.filter(r => r.recallHit).length / casesWithGoldSource.length
    : 0;

  const meanRetrievalMs = results.reduce((s, r) => s + r.retrievalTimeMs, 0) / results.length;

  const trueAbstentions = abstentionCases.filter(r => r.abstained);
  const falseAbstentions = nonAbstentionCases.filter(r => r.abstained);
  const totalAbstentions = trueAbstentions.length + falseAbstentions.length;
  // 0/0 is undefined, not 100% — report null so the display layer can show "N/A"
  const abstentionPrecision = totalAbstentions > 0
    ? trueAbstentions.length / totalAbstentions
    : null;
  const abstentionRecall = abstentionCases.length > 0
    ? trueAbstentions.length / abstentionCases.length
    : null;

  let sectionAccuracy: number | null = null;
  let figureAccuracy: number | null = null;
  let meanTagCoverage: number | null = null;
  let verifyPassRate: number | null = null;
  let meanGenerationMs: number | null = null;

  if (!ragOnly) {
    const withSection = results.filter(r => r.sectionFound !== null);
    sectionAccuracy = withSection.length > 0
      ? withSection.filter(r => r.sectionFound).length / withSection.length : null;

    const withFigure = results.filter(r => r.figureFound !== null);
    figureAccuracy = withFigure.length > 0
      ? withFigure.filter(r => r.figureFound).length / withFigure.length : null;

    const withTags = results.filter(r => r.tagCoverage !== null);
    meanTagCoverage = withTags.length > 0
      ? withTags.reduce((s, r) => s + r.tagCoverage!, 0) / withTags.length : null;

    const withVerify = results.filter(r => r.verifyOk !== null);
    verifyPassRate = withVerify.length > 0
      ? withVerify.filter(r => r.verifyOk).length / withVerify.length : null;

    const withGen = results.filter(r => r.generationTimeMs !== null);
    meanGenerationMs = withGen.length > 0
      ? withGen.reduce((s, r) => s + r.generationTimeMs!, 0) / withGen.length : null;
  }

  const passRate = results.filter(r => r.pass).length / results.length;

  const summary: EvalSummary = {
    timestamp: new Date().toISOString(),
    totalCases: results.length,
    ragOnly,
    topK,
    recallAtK,
    meanRetrievalMs: Math.round(meanRetrievalMs),
    abstentionPrecision,
    abstentionRecall,
    sectionAccuracy,
    figureAccuracy,
    meanTagCoverage,
    verifyPassRate,
    meanGenerationMs: meanGenerationMs !== null ? Math.round(meanGenerationMs) : null,
    passRate,
    results,
  };

  // --- Print table ---
  console.log("\n" + "=".repeat(70));
  console.log("EVAL SUMMARY");
  console.log("=".repeat(70));

  const pct = (n: number | null) => n !== null ? `${(n * 100).toFixed(1)}%` : "n/a";

  const table: [string, string][] = [
    ["Cases", `${summary.totalCases}`],
    ["Mode", ragOnly ? "RAG-only" : "RAG + model"],
    ["Pass rate", pct(passRate)],
    ["", ""],
    ["RETRIEVAL", ""],
    ["Recall@K", pct(recallAtK)],
    ["Mean retrieval", `${summary.meanRetrievalMs}ms`],
    ["Abstention precision", abstentionPrecision !== null ? pct(abstentionPrecision) : `N/A (0 abstentions)`],
    ["Abstention recall", abstentionRecall !== null ? pct(abstentionRecall) : `N/A (no abstention cases)`],
  ];

  if (!ragOnly) {
    table.push(
      ["", ""],
      ["GENERATION", ""],
      ["Section accuracy", pct(sectionAccuracy)],
      ["Figure accuracy", pct(figureAccuracy)],
      ["Mean tag coverage", pct(meanTagCoverage)],
      ["Verify pass rate", pct(verifyPassRate)],
      ["Mean generation", meanGenerationMs !== null ? `${meanGenerationMs}ms` : "n/a"],
    );
  }

  for (const [label, value] of table) {
    if (label === "") {
      console.log("");
    } else {
      console.log(`  ${label.padEnd(24)} ${value}`);
    }
  }

  // Per-case failures
  const failures = results.filter(r => !r.pass);
  if (failures.length > 0) {
    console.log("\nFAILED CASES:");
    for (const f of failures) {
      const reasons: string[] = [];
      if (!f.abstentionCorrect) reasons.push(f.abstained ? "false-abstention" : "missed-abstention");
      if (!f.recallHit && !f.abstained) reasons.push("recall-miss");
      if (f.sectionFound === false) reasons.push("section-miss");
      if (f.figureFound === false) reasons.push("figure-miss");
      console.log(`  ${f.id}: ${reasons.join(", ")}`);
    }
  }

  console.log("\n" + "=".repeat(70));

  // --- Write JSON ---
  const outDir = path.join(__dirname, "results");
  fs.mkdirSync(outDir, { recursive: true });
  const timestamp = new Date().toISOString().replace(/[:.]/g, "-").slice(0, 19);
  const outPath = path.join(outDir, `eval-${timestamp}.json`);
  fs.writeFileSync(outPath, JSON.stringify(summary, null, 2));
  console.log(`\nResults written to ${outPath}`);
}

main().catch((err) => {
  console.error("Eval harness failed:", err);
  process.exit(1);
});
