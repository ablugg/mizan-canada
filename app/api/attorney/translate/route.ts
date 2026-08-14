import { NextRequest, NextResponse } from "next/server";
import { chatWithSystem, TRANSLATE_PROMPT } from "@/lib/llm";
import { parseDocumentBuffer } from "@/lib/parse-document";

export async function POST(req: NextRequest) {
  const contentType = req.headers.get("content-type") ?? "";
  let text = "";
  let direction = "auto";
  let mode = "";

  if (contentType.includes("multipart/form-data")) {
    const formData = await req.formData();
    const file = formData.get("file") as File | null;
    if (!file) return NextResponse.json({ error: "Missing file" }, { status: 400 });
    direction = (formData.get("direction") as string) ?? "auto";
    mode = (formData.get("mode") as string) ?? "";

    const buffer = Buffer.from(await file.arrayBuffer());
    try {
      text = await parseDocumentBuffer(buffer, file.name, file.type);
    } catch {
      return NextResponse.json({ error: "Could not extract text from document" }, { status: 400 });
    }
  } else {
    const body = await req.json();
    text = body.text ?? "";
    direction = body.direction ?? "auto";
    mode = body.mode ?? "";
    if (!text?.trim()) return NextResponse.json({ error: "No text provided" }, { status: 400 });
  }

  const directionInstruction =
    direction === "fr-en"
      ? "Translate from French to English."
      : direction === "en-fr"
      ? "Translate from English to French."
      : "Detect the language and translate to the other (French to English or English to French).";

  const modeInstruction = mode ? `Terminology domain: ${mode}.` : "";

  const raw = await chatWithSystem(
    TRANSLATE_PROMPT,
    `${directionInstruction} ${modeInstruction}\n\nText to translate:\n\n${text.slice(0, 20000)}`
  );

  const match = raw.match(/\{[\s\S]*\}/);
  if (!match)
    return NextResponse.json({ error: "Failed to parse translation output" }, { status: 500 });

  try {
    const result = JSON.parse(match[0]);
    return NextResponse.json({ result });
  } catch {
    return NextResponse.json({ error: "Invalid translation output" }, { status: 500 });
  }
}
