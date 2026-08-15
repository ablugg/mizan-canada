import { NextResponse } from "next/server";
import { db, ensureLocalUser } from "@/lib/db";
import { execSync } from "child_process";
import path from "path";

/**
 * POST -- runs on every app startup to ensure the database schema exists
 * and apply any missing columns. Safe to call repeatedly.
 */
export async function POST() {
  // Check if tables exist; if not, push the schema
  try {
    await db.$queryRawUnsafe(`SELECT 1 FROM "User" LIMIT 1`);
  } catch {
    // Tables don't exist yet -- push the schema
    try {
      const schemaPath = path.join(process.cwd(), "prisma", "schema.prisma");
      execSync(`npx prisma db push --skip-generate --schema="${schemaPath}"`, {
        cwd: process.cwd(),
        env: { ...process.env, DATABASE_URL: process.env.DATABASE_URL },
        timeout: 30000,
        stdio: "pipe",
      });
    } catch (pushErr) {
      console.error("[migrate] prisma db push failed:", pushErr);
      return NextResponse.json({ ok: false, error: "Schema push failed" }, { status: 500 });
    }
  }

  await ensureLocalUser();

  const migrations = [
    `ALTER TABLE "AttorneySession" ADD COLUMN "pinned" BOOLEAN NOT NULL DEFAULT false`,
    `ALTER TABLE "Conversation" ADD COLUMN "pinned" BOOLEAN NOT NULL DEFAULT false`,
  ];

  for (const sql of migrations) {
    try {
      await db.$executeRawUnsafe(sql);
    } catch {
      // Column already exists -- expected on most launches
    }
  }

  return NextResponse.json({ ok: true });
}
