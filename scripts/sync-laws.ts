#!/usr/bin/env npx tsx
/**
 * Private admin script — run locally only, never distributed in the app.
 *
 * Usage:
 *   GITHUB_TOKEN=ghp_xxx GITHUB_LAWS_REPO=ablugg/mizan-laws npx tsx scripts/sync-laws.ts
 *
 * Or set GITHUB_TOKEN and GITHUB_LAWS_REPO in your local .env and run:
 *   npx tsx scripts/sync-laws.ts
 */

import path from "path";
import fs from "fs";
import os from "os";
import { execFile } from "child_process";
import { promisify } from "util";
import dotenv from "dotenv";

dotenv.config();

const execFileAsync = promisify(execFile);

const VECTOR_DB_PATH = process.env.VECTOR_DB_PATH ?? path.join(process.cwd(), "data/vector-store");
const TABLE_DIR = path.join(VECTOR_DB_PATH, "legal_chunks.lance");

async function zipDirectory(sourceDir: string, outputPath: string): Promise<void> {
  await execFileAsync("zip", ["-r", outputPath, path.basename(sourceDir)], {
    cwd: path.dirname(sourceDir),
  });
}

async function uploadToGitHub(zipPath: string): Promise<string> {
  const token = process.env.GITHUB_TOKEN;
  const repo = process.env.GITHUB_LAWS_REPO;
  if (!token || !repo) {
    throw new Error("GITHUB_TOKEN and GITHUB_LAWS_REPO must be set in your environment or .env");
  }

  const tag = `laws-${new Date().toISOString().replace(/[:.]/g, "-").slice(0, 19)}`;
  const headers = {
    Authorization: `Bearer ${token}`,
    Accept: "application/vnd.github+json",
    "X-GitHub-Api-Version": "2022-11-28",
    "Content-Type": "application/json",
    "User-Agent": "mizan-admin",
  };

  console.log(`Creating GitHub release: ${tag}`);
  const createRes = await fetch(`https://api.github.com/repos/${repo}/releases`, {
    method: "POST",
    headers,
    body: JSON.stringify({
      tag_name: tag,
      name: `Law Library — ${new Date().toLocaleDateString("en-GB", { day: "numeric", month: "long", year: "numeric" })}`,
      body: "Law library update.",
      draft: false,
      prerelease: false,
    }),
  });

  if (!createRes.ok) throw new Error(`GitHub release creation failed: ${await createRes.text()}`);
  const release = await createRes.json() as { id: number };

  console.log("Uploading law pack zip...");
  const zipBuffer = fs.readFileSync(zipPath);
  const uploadUrl = `https://uploads.github.com/repos/${repo}/releases/${release.id}/assets?name=legal_chunks.lance.zip`;

  const uploadRes = await fetch(uploadUrl, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${token}`,
      Accept: "application/vnd.github+json",
      "X-GitHub-Api-Version": "2022-11-28",
      "Content-Type": "application/zip",
      "User-Agent": "mizan-admin",
    },
    body: zipBuffer,
  });

  if (!uploadRes.ok) throw new Error(`GitHub asset upload failed: ${await uploadRes.text()}`);
  const asset = await uploadRes.json() as { browser_download_url: string };
  return asset.browser_download_url;
}

async function main() {
  console.log("Step 1: Rebuilding vector store...");
  const { main: buildVectors } = await import("../data/ingestion/build-vectors");
  await buildVectors();

  if (!fs.existsSync(TABLE_DIR)) {
    throw new Error("Vector store not found after rebuild: " + TABLE_DIR);
  }

  console.log("Step 2: Zipping legal_chunks.lance...");
  const tmpZip = path.join(os.tmpdir(), `mizan-laws-${Date.now()}.zip`);
  await zipDirectory(TABLE_DIR, tmpZip);
  console.log(`Zip created: ${tmpZip} (${(fs.statSync(tmpZip).size / 1024 / 1024).toFixed(1)} MB)`);

  console.log("Step 3: Uploading to GitHub Releases...");
  const downloadUrl = await uploadToGitHub(tmpZip);
  fs.unlinkSync(tmpZip);

  console.log("\nDone!");
  console.log("Download URL:", downloadUrl);
}

main().catch((err) => {
  console.error("Sync failed:", err.message);
  process.exit(1);
});
