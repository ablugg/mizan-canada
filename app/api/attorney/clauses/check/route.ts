import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { chatWithSystem, CLAUSE_CHECK_PROMPT, langInstruction } from "@/lib/llm";
import { parseDocumentBuffer } from "@/lib/parse-document";
import { retrieveDocumentContext } from "@/lib/rag";
import { LOCAL_USER_ID } from "@/lib/local-auth";
import type { ClauseEntry } from "@/types";

export async function POST(req: NextRequest) {
  const formData = await req.formData();
  const file = formData.get("file") as File | null;
  const clausesJson = formData.get("clauses") as string | null;
  const language = (formData.get("language") as string) || "en";

  if (!file || !clausesJson)
    return NextResponse.json({ error: "Missing file or clauses" }, { status: 400 });

  const clauses: ClauseEntry[] = JSON.parse(clausesJson);
  if (!clauses.length)
    return NextResponse.json({ error: "No clauses to check" }, { status: 400 });

  const buffer = Buffer.from(await file.arrayBuffer());
  let text = "";
  try {
    text = await parseDocumentBuffer(buffer, file.name, file.type);
  } catch {
    return NextResponse.json({ error: "Could not extract text from document" }, { status: 400 });
  }

  const playbookSummary = clauses
    .map(
      (c) =>
        `**${c.name}** (${c.category})\nStandard position: ${c.standardPosition}${c.notes ? `\nNotes: ${c.notes}` : ""}`
    )
    .join("\n\n");

  const truncated = text.slice(0, 24000);
  const legalContext = await retrieveDocumentContext(truncated).catch(() => "");
  const contextBlock = legalContext
    ? `\n\nRelevant Canadian legal context (use to validate clause compliance with actual law):\n${legalContext}`
    : "";

  const raw = await chatWithSystem(
    CLAUSE_CHECK_PROMPT + contextBlock + langInstruction(language),
    `Playbook:\n\n${playbookSummary}\n\n${"─".repeat(40)}\n\nContract to check:\n\n${truncated}`
  );

  const match = raw.match(/\[[\s\S]*\]/);
  if (!match)
    return NextResponse.json({ error: "Failed to parse check output" }, { status: 500 });

  try {
    const results = JSON.parse(match[0]);
    await db.attorneyToolUsage.create({ data: { userId: LOCAL_USER_ID, tool: "CLAUSE" } });
    return NextResponse.json({ results });
  } catch {
    return NextResponse.json({ error: "Invalid check output" }, { status: 500 });
  }
}
