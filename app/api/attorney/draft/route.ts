import { NextRequest, NextResponse } from "next/server";
import { chatWithSystem, ATTORNEY_SYSTEM_PROMPT } from "@/lib/llm";
import { retrieveContext } from "@/lib/rag";
import type { DraftType } from "@/types";

function buildDraftPrompt(docType: string, fields: Record<string, string>, docLang: "en" | "fr"): string {
  const fieldList = Object.entries(fields)
    .filter(([, v]) => v?.trim())
    .map(([k, v]) => `- ${k}: ${v}`)
    .join("\n");

  const langInstruction =
    docLang === "fr"
      ? `IMPORTANT: Write the entire document in French. Use formal French legal language consistent with Canadian legal practice (particularly Quebec civil law terminology where applicable). All headings, clauses, recitals, and signature blocks must be in French.`
      : `Write the document in English using formal legal language consistent with Canadian legal practice.`;

  return `Draft a complete, professionally formatted ${docType} under Canadian law using the following details:

${fieldList}

${langInstruction}

Requirements:
- Write a complete, execution-ready legal document
- Include all standard clauses for this document type
- Number all clauses and sub-clauses
- Include recitals/whereas clauses where appropriate
- Add signature blocks with appropriate formality
- Note any clauses that may need customization with [CUSTOMIZE: reason]
- The document should be ready for lawyer review and client signature`;
}

export async function POST(req: NextRequest) {
  const { docType, fields, docLang } = (await req.json()) as {
    docType: DraftType;
    fields: Record<string, string>;
    docLang: "en" | "fr";
  };

  if (!docType || !fields)
    return NextResponse.json({ error: "Missing document type or fields" }, { status: 400 });

  const lang: "en" | "fr" = docLang === "fr" ? "fr" : "en";
  const userPrompt = buildDraftPrompt(docType, fields, lang);

  // Retrieve legal context relevant to the document type and fields
  const ragQuery = `${docType} ${Object.values(fields).join(" ")}`.slice(0, 500);
  const legalContext = await retrieveContext(ragQuery, 3).catch(() => "");
  const systemWithContext = legalContext
    ? `${ATTORNEY_SYSTEM_PROMPT}\n\nRelevant Canadian legal context (use to ensure compliance with actual law):\n${legalContext}`
    : ATTORNEY_SYSTEM_PROMPT;

  const content = await chatWithSystem(systemWithContext, userPrompt);

  if (!content.trim())
    return NextResponse.json({ error: "Draft generation returned empty content" }, { status: 500 });

  return NextResponse.json({ content });
}
