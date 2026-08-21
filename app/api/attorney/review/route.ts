import { NextRequest, NextResponse } from "next/server";
import { chatWithSystem, DOCUMENT_REVIEW_PROMPT, langInstruction } from "@/lib/llm";
import { parseDocumentBuffer } from "@/lib/parse-document";
import { retrieveDocumentContext } from "@/lib/rag";

export async function POST(req: NextRequest) {
  const formData = await req.formData();
  const file = formData.get("file") as File | null;
  const reviewFocus = (formData.get("reviewFocus") as string) || "general";
  const language = (formData.get("language") as string) || "en";

  if (!file) return NextResponse.json({ error: "No file provided" }, { status: 400 });

  const buffer = Buffer.from(await file.arrayBuffer());
  let text = "";
  try {
    text = await parseDocumentBuffer(buffer, file.name, file.type);
  } catch {
    return NextResponse.json({ error: "Could not extract text from document" }, { status: 400 });
  }

  const truncated = text.slice(0, 30_000);
  const focusInstruction =
    reviewFocus !== "general"
      ? `\n\nReview focus: ${reviewFocus}. Pay particular attention to issues related to this focus area.`
      : "";

  const legalContext = await retrieveDocumentContext(truncated).catch(() => "");
  const contextBlock = legalContext
    ? `\n\nRelevant Canadian legal context (use to ground your analysis):\n${legalContext}`
    : "";

  const raw = await chatWithSystem(
    DOCUMENT_REVIEW_PROMPT + focusInstruction + contextBlock + langInstruction(language),
    `Please review this document:\n\n${truncated}`
  );

  const match = raw.match(/\{[\s\S]*\}/);
  if (!match)
    return NextResponse.json({ error: "Failed to parse review output" }, { status: 500 });

  try {
    const result = JSON.parse(match[0]);
    return NextResponse.json({ result, filename: file.name });
  } catch {
    return NextResponse.json({ error: "Invalid review output format" }, { status: 500 });
  }
}
