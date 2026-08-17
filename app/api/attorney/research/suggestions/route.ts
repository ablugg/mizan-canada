import { NextRequest, NextResponse } from "next/server";
import { chatWithSystemLight, langInstruction } from "@/lib/llm";

export async function POST(req: NextRequest) {
  const { userQuestion, assistantResponse, language } = await req.json();
  if (!userQuestion || !assistantResponse) return NextResponse.json({ suggestions: [] });

  const lang = language || "en";

  try {
    const raw = await chatWithSystemLight(
      "You are a legal research assistant. Given a legal question and its answer, produce exactly 3 concise follow-up questions an attorney might ask next. Return ONLY a JSON array of 3 strings, no other text." + langInstruction(lang),
      `Question: ${userQuestion}\n\nAnswer summary: ${assistantResponse.slice(0, 800)}\n\nReturn 3 follow-up questions as a JSON array.`
    );
    const match = raw.trim().match(/\[[\s\S]*\]/);
    const suggestions: string[] = match ? JSON.parse(match[0]) : [];
    return NextResponse.json({ suggestions: suggestions.slice(0, 3) });
  } catch {
    return NextResponse.json({ suggestions: [] });
  }
}
