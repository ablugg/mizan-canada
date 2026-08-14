import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { encryptMessage, decryptMessage } from "@/lib/message-crypto";
import { LOCAL_USER_ID } from "@/lib/local-auth";

function encryptTitle(title: string): string {
  return "enc:" + encryptMessage(title);
}

function decryptTitle(stored: string): string {
  if (stored.startsWith("enc:")) {
    try {
      return decryptMessage(stored.slice(4));
    } catch {
      return stored;
    }
  }
  return stored;
}

function encryptData(data: unknown): string {
  return JSON.stringify({ __enc: encryptMessage(JSON.stringify(data)) });
}

function decryptData(stored: string): unknown {
  try {
    const parsed = JSON.parse(stored);
    if (parsed && typeof parsed === "object" && "__enc" in parsed) {
      return JSON.parse(decryptMessage(parsed.__enc));
    }
    return parsed;
  } catch {
    return stored;
  }
}

function extractPreview(dataStr: string, tool: string): string {
  try {
    const d = decryptData(dataStr) as Record<string, unknown>;
    if (tool === "DRAFT" && typeof d.content === "string")
      return d.content.slice(0, 120).replace(/\s+/g, " ").trim();
    if (tool === "REVIEW" && d.result && typeof (d.result as Record<string, unknown>).summary === "string")
      return ((d.result as Record<string, unknown>).summary as string).slice(0, 120);
    if (tool === "REDLINE" && d.result && typeof (d.result as Record<string, unknown>).summary === "string")
      return ((d.result as Record<string, unknown>).summary as string).slice(0, 120);
    if (tool === "RESEARCH" && Array.isArray(d.messages)) {
      const first = (d.messages as { role: string; content: string }[]).find((m) => m.role === "assistant");
      if (first) return first.content.slice(0, 120).replace(/\s+/g, " ").trim();
    }
    return "";
  } catch {
    return "";
  }
}

export async function GET(req: NextRequest) {
  const tool = req.nextUrl.searchParams.get("tool");
  const sessions = await db.attorneySession.findMany({
    where: { userId: LOCAL_USER_ID, ...(tool ? { tool } : {}) },
    orderBy: [{ pinned: "desc" }, { updatedAt: "desc" }],
    select: { id: true, tool: true, title: true, data: true, pinned: true, createdAt: true, updatedAt: true },
    take: 50,
  });
  return NextResponse.json({
    sessions: sessions.map((s) => ({
      id: s.id,
      tool: s.tool,
      title: decryptTitle(s.title),
      preview: extractPreview(s.data, s.tool),
      pinned: s.pinned,
      createdAt: s.createdAt,
      updatedAt: s.updatedAt,
    })),
  });
}

export async function PATCH(req: NextRequest) {
  const { id, pinned } = await req.json();
  if (!id || typeof pinned !== "boolean")
    return NextResponse.json({ error: "Missing id or pinned" }, { status: 400 });
  await db.attorneySession.updateMany({ where: { id, userId: LOCAL_USER_ID }, data: { pinned } });
  return NextResponse.json({ ok: true });
}

export async function POST(req: NextRequest) {
  const { tool, title, data, sessionId } = await req.json();
  if (!tool || !title || !data)
    return NextResponse.json({ error: "Missing fields" }, { status: 400 });

  const storedTitle = encryptTitle(title);
  const storedData = encryptData(data);

  if (sessionId) {
    await db.attorneySession.updateMany({
      where: { id: sessionId, userId: LOCAL_USER_ID },
      data: { title: storedTitle, data: storedData, updatedAt: new Date() },
    });
    return NextResponse.json({ ok: true });
  }

  const [session] = await Promise.all([
    db.attorneySession.create({
      data: { userId: LOCAL_USER_ID, tool, title: storedTitle, data: storedData },
    }),
    db.attorneyToolUsage.create({
      data: { userId: LOCAL_USER_ID, tool },
    }),
  ]);
  return NextResponse.json({ session });
}

export async function DELETE(req: NextRequest) {
  const id = req.nextUrl.searchParams.get("id");
  if (!id) return NextResponse.json({ error: "Missing id" }, { status: 400 });
  await db.attorneySession.deleteMany({ where: { id, userId: LOCAL_USER_ID } });
  return NextResponse.json({ ok: true });
}
