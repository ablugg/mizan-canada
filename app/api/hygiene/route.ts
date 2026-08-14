import { NextRequest, NextResponse } from "next/server";
import { db, ensureLocalUser } from "@/lib/db";

const RETENTION_DAYS = 7;

/**
 * GET -- run hygiene pass: delete unpinned conversations and attorney sessions older than 7 days.
 * Called once on app startup from the client.
 */
export async function GET() {
  await ensureLocalUser();

  const cutoff = new Date();
  cutoff.setDate(cutoff.getDate() - RETENTION_DAYS);

  const { count: convCount } = await db.conversation.deleteMany({
    where: { pinned: false, updatedAt: { lt: cutoff } },
  });

  const { count: sessionCount } = await db.attorneySession.deleteMany({
    where: { pinned: false, updatedAt: { lt: cutoff } },
  });

  if (convCount > 0)
    console.log(`[hygiene] Deleted ${convCount} conversation(s) older than ${RETENTION_DAYS} days`);
  if (sessionCount > 0)
    console.log(`[hygiene] Deleted ${sessionCount} attorney session(s) older than ${RETENTION_DAYS} days`);

  return NextResponse.json({ deleted: convCount + sessionCount });
}

/**
 * PATCH -- toggle pinned on a conversation.
 * Body: { id: string, pinned: boolean }
 */
export async function PATCH(req: NextRequest) {
  const { id, pinned } = await req.json();
  if (!id || typeof pinned !== "boolean")
    return NextResponse.json({ error: "Missing id or pinned" }, { status: 400 });

  await db.conversation.updateMany({
    where: { id },
    data: { pinned },
  });

  return NextResponse.json({ ok: true });
}
