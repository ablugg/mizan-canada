import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { chatWithSystem, DEADLINE_PROMPT, langInstruction } from "@/lib/llm";
import { parseDocumentBuffer } from "@/lib/parse-document";
import { retrieveDocumentContext } from "@/lib/rag";
import { LOCAL_USER_ID } from "@/lib/local-auth";

export async function POST(req: NextRequest) {
  const formData = await req.formData();
  const file = formData.get("file") as File | null;
  const language = (formData.get("language") as string) || "en";
  if (!file) return NextResponse.json({ error: "Missing file" }, { status: 400 });

  const buffer = Buffer.from(await file.arrayBuffer());
  let text = "";
  try {
    text = await parseDocumentBuffer(buffer, file.name, file.type);
  } catch {
    return NextResponse.json({ error: "Could not extract text from document" }, { status: 400 });
  }

  const truncated = text.slice(0, 28000);
  const legalContext = await retrieveDocumentContext(truncated).catch(() => "");
  const contextBlock = legalContext
    ? `\n\nRelevant Canadian legal context (reference statutory limitation periods and deadlines where applicable):\n${legalContext}`
    : "";

  const raw = await chatWithSystem(
    DEADLINE_PROMPT + contextBlock + langInstruction(language),
    `Extract all deadlines and obligations from this contract:\n\n${truncated}`
  );

  const match = raw.match(/\[[\s\S]*\]/);
  if (!match) return NextResponse.json({ error: "Failed to parse output" }, { status: 500 });

  try {
    const entries = JSON.parse(match[0]);
    await db.attorneyToolUsage.create({ data: { userId: LOCAL_USER_ID, tool: "DEADLINE" } });
    return NextResponse.json({ entries });
  } catch {
    return NextResponse.json({ error: "Invalid output format" }, { status: 500 });
  }
}
