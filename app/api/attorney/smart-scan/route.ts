import { NextRequest, NextResponse } from "next/server";
import { chatStream, langInstruction } from "@/lib/llm";
import { retrieveContext } from "@/lib/rag";

const SMART_SCAN_PROMPT = `You are Mizan, an expert legal analyst for Canadian law. A lawyer has highlighted a passage from a legal document and is asking you to explain it.

You will receive:
1. The highlighted text
2. Surrounding context from the document (so you can understand the clause in its broader setting)
3. An optional specific question or analysis mode

How to respond:
- Explain what the highlighted text means in plain, precise language
- Identify any legal implications, risks, or obligations it creates
- Reference relevant Canadian statutes, case law, or legal principles where applicable
- Flag any ambiguity, enforceability concerns, or missing protections
- Keep your response concise but thorough — 2-4 paragraphs is ideal
- If the text references specific legal concepts, define them
- Never fabricate citations or section numbers`;

export async function POST(req: NextRequest) {
  const { highlight, context, mode, language, followUp, history } = await req.json();

  if (!highlight || typeof highlight !== "string") {
    return NextResponse.json({ error: "No highlighted text provided" }, { status: 400 });
  }

  const modeInstructions: Record<string, string> = {
    explain: "Explain this passage clearly. What does it mean and what are its implications?",
    risks: "Focus on identifying risks, liabilities, and potential issues with this passage.",
    obligations: "Identify all obligations, duties, and requirements created by this passage. Who must do what, and by when?",
    simplify: "Rewrite this passage in plain English that a non-lawyer could understand, while preserving the legal meaning.",
  };

  const instruction = modeInstructions[mode] || modeInstructions.explain;

  // For follow-ups, retrieve context based on the follow-up question
  const ragQuery = followUp || highlight;
  const legalContext = await retrieveContext(ragQuery, 3).catch(() => "");
  const legalBlock = legalContext
    ? `\n\n**Relevant Canadian legal context:**\n${legalContext}`
    : "";

  const initialContent = [
    `${instruction}`,
    `\n\n**Highlighted text:**\n"${highlight}"`,
    context ? `\n\n**Surrounding context from the document:**\n${context}` : "",
    legalBlock,
  ].join("");

  const systemPrompt = SMART_SCAN_PROMPT + langInstruction(language || "en");

  // Build message history: initial analysis + prior exchanges + follow-up
  const messages: { role: "user" | "assistant"; content: string }[] = [
    { role: "user", content: initialContent },
  ];

  if (history && Array.isArray(history)) {
    for (const msg of history) {
      messages.push({ role: msg.role, content: msg.content });
    }
  }

  if (followUp) {
    messages.push({ role: "user", content: followUp });
  }

  const stream = chatStream(
    messages,
    undefined,
    systemPrompt
  );

  const readableStream = new ReadableStream({
    async start(controller) {
      try {
        for await (const text of stream) {
          controller.enqueue(new TextEncoder().encode(text));
        }
        controller.close();
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        controller.enqueue(new TextEncoder().encode(`\n\n[Error: ${msg}]`));
        controller.close();
      }
    },
  });

  return new Response(readableStream, {
    headers: { "Content-Type": "text/plain; charset=utf-8" },
  });
}
