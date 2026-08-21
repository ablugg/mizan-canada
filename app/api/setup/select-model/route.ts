import { NextResponse } from "next/server";
import fs from "fs";
import path from "path";

const ALLOWED_MODELS = ["qwen2.5:3b", "qwen2.5:7b"];

export async function GET() {
  try {
    const configPath = path.join(process.cwd(), "data", "model-config.json");
    const raw = fs.readFileSync(configPath, "utf-8");
    const config = JSON.parse(raw) as { model?: string };
    return NextResponse.json({ model: config.model ?? "qwen2.5:7b" });
  } catch {
    return NextResponse.json({ model: "qwen2.5:7b" });
  }
}

export async function POST(req: Request) {
  try {
    const body = (await req.json()) as { model?: string };
    const model = body.model;

    if (!model || !ALLOWED_MODELS.includes(model)) {
      return NextResponse.json({ ok: false, error: "Invalid model" }, { status: 400 });
    }

    const dataDir = path.join(process.cwd(), "data");
    if (!fs.existsSync(dataDir)) fs.mkdirSync(dataDir, { recursive: true });

    const configPath = path.join(dataDir, "model-config.json");
    fs.writeFileSync(configPath, JSON.stringify({ model }, null, 2));

    return NextResponse.json({ ok: true, model });
  } catch (err) {
    return NextResponse.json({ ok: false, error: String(err) }, { status: 500 });
  }
}
