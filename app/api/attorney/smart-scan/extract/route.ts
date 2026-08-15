import { NextRequest, NextResponse } from "next/server";
import { parseDocumentBuffer } from "@/lib/parse-document";

export async function POST(req: NextRequest) {
  const formData = await req.formData();
  const file = formData.get("file") as File | null;

  if (!file) {
    return NextResponse.json({ error: "No file provided" }, { status: 400 });
  }

  try {
    const buffer = Buffer.from(await file.arrayBuffer());
    const text = await parseDocumentBuffer(buffer, file.name, file.type);
    return NextResponse.json({ text });
  } catch {
    return NextResponse.json({ error: "Could not extract text from document" }, { status: 400 });
  }
}
