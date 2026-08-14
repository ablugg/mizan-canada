import { NextRequest, NextResponse } from "next/server";
import { chatWithSystem } from "@/lib/llm";
import { parseDocumentBuffer } from "@/lib/parse-document";
import { CLAUSE_CATEGORIES } from "@/types";

const IMPORT_SYSTEM_PROMPT = `You are a legal document analyst. Extract all distinct legal clause positions from the provided document or text.

For each clause, identify:
- name: A concise clause name (e.g. "Limitation of Liability", "Governing Law", "Confidentiality Obligations")
- category: Must be exactly one of: ${CLAUSE_CATEGORIES.map((c) => `"${c}"`).join(", ")}
- standardPosition: The firm's standard position or the clause language, summarised in 1-4 sentences
- notes: Any caveats, conditions, or usage notes -- null if none

Return ONLY a valid JSON array, no markdown, no explanation. Example format:
[{"name":"Limitation of Liability","category":"Liability & Indemnity","standardPosition":"Liability capped at fees paid in the preceding 12 months. Consequential damages excluded.","notes":"Review cap amount for high-value engagements"}]`;

export async function POST(req: NextRequest) {
  const formData = await req.formData();
  const file = formData.get("file") as File | null;
  const pastedText = formData.get("text") as string | null;

  if (!file && !pastedText?.trim())
    return NextResponse.json({ error: "Provide a file or pasted text" }, { status: 400 });

  let documentText = "";
  if (file) {
    const buffer = Buffer.from(await file.arrayBuffer());
    try {
      documentText = await parseDocumentBuffer(buffer, file.name, file.type);
    } catch {
      return NextResponse.json({ error: "Could not extract text from document" }, { status: 400 });
    }
  } else {
    documentText = pastedText!.trim();
  }

  const raw = await chatWithSystem(
    IMPORT_SYSTEM_PROMPT,
    `Extract all clauses from the following:\n\n${documentText.slice(0, 30000)}`
  );

  const match = raw.match(/\[[\s\S]*\]/);
  if (!match)
    return NextResponse.json({ error: "Could not extract clauses from the document" }, { status: 500 });

  try {
    const extracted = JSON.parse(match[0]);
    const clauses = extracted
      .filter(
        (c: unknown) =>
          c &&
          typeof c === "object" &&
          (c as Record<string, unknown>).name &&
          (c as Record<string, unknown>).standardPosition
      )
      .map((c: Record<string, unknown>) => ({
        name: String(c.name).trim(),
        category: CLAUSE_CATEGORIES.includes(c.category as never) ? c.category : "Other",
        standardPosition: String(c.standardPosition).trim(),
        notes: c.notes ? String(c.notes).trim() : "",
      }));
    return NextResponse.json({ clauses });
  } catch {
    return NextResponse.json({ error: "Invalid response from extraction model" }, { status: 500 });
  }
}
