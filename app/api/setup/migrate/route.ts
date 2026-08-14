import { NextResponse } from "next/server";
import { db, ensureLocalUser } from "@/lib/db";

/**
 * POST — runs on every app startup to apply any missing schema columns.
 * Uses ALTER TABLE IF NOT EXISTS equivalent: attempt the column add and ignore
 * "duplicate column" errors. Safe to call repeatedly.
 */
export async function POST() {
  await ensureLocalUser();

  const migrations = [
    `ALTER TABLE "AttorneySession" ADD COLUMN "pinned" BOOLEAN NOT NULL DEFAULT false`,
    `ALTER TABLE "Conversation" ADD COLUMN "pinned" BOOLEAN NOT NULL DEFAULT false`,
  ];

  for (const sql of migrations) {
    try {
      await db.$executeRawUnsafe(sql);
    } catch {
      // Column already exists — expected on most launches
    }
  }

  return NextResponse.json({ ok: true });
}
