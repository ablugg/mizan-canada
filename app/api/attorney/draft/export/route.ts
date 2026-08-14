import { NextRequest, NextResponse } from "next/server";
import {
  Document, Packer, Paragraph, TextRun, HeadingLevel,
  AlignmentType, ImageRun,
} from "docx";

interface LogoData {
  data: string; // base64
  width: number;
  height: number;
  mimeType?: string;
}

function buildLogoRun(logo: LogoData): Paragraph {
  const MAX_W = 180;
  const MAX_H = 80;
  const scale = Math.min(1, MAX_W / logo.width, MAX_H / logo.height);
  const w = Math.round(logo.width * scale);
  const h = Math.round(logo.height * scale);
  return new Paragraph({
    children: [
      new ImageRun({
        data: Buffer.from(logo.data, "base64"),
        transformation: { width: w, height: h },
        type: logo.mimeType?.includes("png") ? "png" : "jpg",
      }),
    ],
    spacing: { after: 280 },
  });
}

function parseContentToDocx(content: string, title: string, logo?: LogoData, docLang: "en" | "fr" = "en"): Document {
  const bodyFont = "Georgia";
  const alignment = AlignmentType.JUSTIFIED;
  const bidi = undefined;

  const children: Paragraph[] = [];

  // Logo (if provided)
  if (logo) children.push(buildLogoRun(logo));

  // Title paragraph
  children.push(
    new Paragraph({
      text: title,
      heading: HeadingLevel.TITLE,
      alignment: AlignmentType.CENTER,
      spacing: { before: 0, after: 240 },
      bidirectional: bidi,
    })
  );

  // Collapse the LLM output: normalise runs of blank lines to a single blank,
  // trim trailing/leading whitespace from the whole block.
  const normalised = content
    .replace(/\r\n/g, "\n")
    .replace(/\n{3,}/g, "\n\n") // max one blank line between paragraphs
    .trim();

  const lines = normalised.split("\n");
  let prevWasBlank = false;

  for (const line of lines) {
    const trimmed = line.trim();

    if (!trimmed) {
      // Only emit one blank paragraph per gap, and keep it tiny
      if (!prevWasBlank) {
        children.push(new Paragraph({ text: "", spacing: { before: 0, after: 60 } }));
        prevWasBlank = true;
      }
      continue;
    }

    prevWasBlank = false;

    {
      // ALL-CAPS line = section heading
      if (trimmed === trimmed.toUpperCase() && trimmed.length > 3 && trimmed.length < 80 && !/^\d/.test(trimmed)) {
        children.push(new Paragraph({
          heading: HeadingLevel.HEADING_1,
          text: trimmed,
          spacing: { before: 240, after: 100 },
        }));
      // Numbered clause heading e.g. "1. Definitions"
      } else if (/^\d+\.\s+[A-Z]/.test(trimmed) && trimmed.length < 80) {
        children.push(new Paragraph({
          heading: HeadingLevel.HEADING_2,
          text: trimmed,
          spacing: { before: 160, after: 80 },
        }));
      // Sub-clause e.g. "1.1 ..."
      } else if (/^\d+\.\d+/.test(trimmed)) {
        children.push(new Paragraph({
          children: [new TextRun({ text: trimmed, size: 22, font: bodyFont })],
          indent: { left: 480 },
          spacing: { before: 0, after: 80 },
          alignment,
        }));
      } else {
        children.push(new Paragraph({
          children: [new TextRun({ text: trimmed, size: 22, font: bodyFont })],
          spacing: { before: 0, after: 80 },
          alignment,
        }));
      }
    }
  }

  return new Document({
    styles: {
      default: {
        document: {
          run: { font: bodyFont, size: 22, color: "000000" },
          // 240 = single-spaced; 276 ≈ 115% gives comfortable but tight reading
          paragraph: { spacing: { line: 276, lineRule: "auto" } },
        },
      },
    },
    sections: [
      {
        properties: {
          page: { margin: { top: 1440, right: 1260, bottom: 1440, left: 1440 } },
        },
        children,
      },
    ],
  });
}

export async function POST(req: NextRequest) {
  const { content, title, docType, docLang, logo } = await req.json();
  if (!content) return NextResponse.json({ error: "No content provided" }, { status: 400 });

  const documentTitle = title || docType || "Legal Document";
  const lang: "en" | "fr" = docLang === "fr" ? "fr" : "en";
  const doc = parseContentToDocx(content, documentTitle, logo ?? undefined, lang);
  const buffer = await Packer.toBuffer(doc);

  const filename = `${documentTitle.replace(/[^a-zA-Z0-9]/g, "_")}_Mizan.docx`;

  return new Response(new Uint8Array(buffer), {
    headers: {
      "Content-Type": "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
      "Content-Disposition": `attachment; filename="${filename}"`,
    },
  });
}
