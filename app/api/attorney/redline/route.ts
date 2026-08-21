import { NextRequest, NextResponse } from "next/server";
import { chatWithSystem, REDLINE_PROMPT, langInstruction } from "@/lib/llm";
import { parseDocumentBuffer } from "@/lib/parse-document";
import { retrieveDocumentContext } from "@/lib/rag";

export async function POST(req: NextRequest) {
  const formData = await req.formData();
  const file = formData.get("file") as File | null;
  const reviewType = (formData.get("reviewType") as string) || "general risk assessment";
  const clientPosition = (formData.get("clientPosition") as string) || "neutral";
  const language = (formData.get("language") as string) || "en";

  if (!file) return NextResponse.json({ error: "No file provided" }, { status: 400 });

  const buffer = Buffer.from(await file.arrayBuffer());
  let text = "";
  try {
    text = await parseDocumentBuffer(buffer, file.name, file.type);
  } catch {
    return NextResponse.json({ error: "Could not extract text from document" }, { status: 400 });
  }

  const truncated = text.slice(0, 28_000);
  const contextInstruction = `\n\nReview type: ${reviewType}.\nClient position: ${clientPosition} (optimize suggestions to favor this party where applicable).`;

  const legalContext = await retrieveDocumentContext(truncated).catch(() => "");
  const contextBlock = legalContext
    ? `\n\nRelevant Canadian legal context (use to ground your suggestions in actual law):\n${legalContext}`
    : "";

  const raw = await chatWithSystem(
    REDLINE_PROMPT + contextInstruction + contextBlock + langInstruction(language),
    `Please redline this document:\n\n${truncated}`
  );

  const match = raw.match(/\{[\s\S]*\}/);
  if (!match)
    return NextResponse.json({ error: "Failed to parse redline output" }, { status: 500 });

  try {
    const result = JSON.parse(match[0]);
    return NextResponse.json({ result, originalText: truncated, filename: file.name });
  } catch {
    return NextResponse.json({ error: "Invalid redline output format" }, { status: 500 });
  }
}
