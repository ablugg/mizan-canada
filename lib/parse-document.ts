import { Buffer } from "buffer";

/**
 * Extract plain text from an uploaded document buffer.
 * Tries pdf-parse first for PDFs (more reliable), falls back to pdf2json.
 * Throws if no text could be extracted.
 */
export async function parseDocumentBuffer(
  buffer: Buffer,
  fileName: string,
  mimeType: string
): Promise<string> {
  const isPdf = mimeType === "application/pdf" || fileName.endsWith(".pdf");
  const isWord = mimeType.includes("word") || /\.docx?$/.test(fileName);

  if (isPdf) {
    // Primary: pdf-parse v2
    try {
      const { PDFParse } = await import("pdf-parse");
      const parser = new PDFParse({ data: buffer });
      const result = await parser.getText();
      if (result.text?.trim()) return result.text;
    } catch {
      // fall through to pdf2json
    }

    // Fallback: pdf2json (handles some PDFs pdf-parse can't)
    try {
      const PDFParser = (await import("pdf2json")).default;
      const text = await new Promise<string>((resolve, reject) => {
        const parser = new PDFParser();
        parser.on("pdfParser_dataReady", (data) => {
          try {
            const pages = data.Pages ?? [];
            const t = pages
              .flatMap((p: { Texts: Array<{ R: Array<{ T: string }> }> }) =>
                p.Texts.map((tx) => {
                  const raw = tx.R?.[0]?.T ?? "";
                  try {
                    return decodeURIComponent(raw);
                  } catch {
                    return raw;
                  }
                })
              )
              .join(" ");
            resolve(t);
          } catch (err) {
            reject(err);
          }
        });
        parser.on("pdfParser_dataError", (errData) => {
          reject(new Error(String((errData as { parserError?: unknown }).parserError ?? errData)));
        });
        parser.parseBuffer(buffer);
      });
      if (text?.trim()) return text;
    } catch {
      // both parsers failed
    }

    throw new Error("Could not extract text from PDF");
  }

  if (isWord) {
    const mammoth = await import("mammoth");
    const result = await mammoth.extractRawText({ buffer });
    if (result.value?.trim()) return result.value;
    throw new Error("Could not extract text from document");
  }

  // Plain text / other
  const text = new TextDecoder().decode(buffer);
  if (!text.trim()) throw new Error("Could not extract text from document");
  return text;
}
