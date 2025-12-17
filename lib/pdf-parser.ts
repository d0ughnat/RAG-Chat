import { extractText, getDocumentProxy } from "unpdf";

export interface ParsedPage {
  pageNumber: number;
  text: string;
}

export interface ParsedPDF {
  documentName: string;
  totalPages: number;
  pages: ParsedPage[];
  fullText: string;
}

/**
 * Parse a PDF buffer and extract text content page by page
 */
export async function parsePDF(
  buffer: Buffer,
  documentName: string
): Promise<ParsedPDF> {
  // Convert Buffer to Uint8Array
  const uint8Array = new Uint8Array(buffer);

  // Get the PDF document proxy
  const pdf = await getDocumentProxy(uint8Array);
  const numPages = pdf.numPages;
  const pages: ParsedPage[] = [];

  // Extract text from each page
  for (let pageNum = 1; pageNum <= numPages; pageNum++) {
    const page = await pdf.getPage(pageNum);
    const textContent = await page.getTextContent();

    // Extract text items and join them
    const pageText = textContent.items
      .filter((item): item is { str: string; dir: string; transform: number[]; width: number; height: number; hasEOL: boolean; fontName: string } => "str" in item)
      .map((item) => item.str)
      .join(" ");

    if (pageText.trim()) {
      pages.push({
        pageNumber: pageNum,
        text: pageText.trim(),
      });
    }
  }

  // Combine all pages for full text
  const fullText = pages.map((p) => p.text).join("\n\n");

  return {
    documentName,
    totalPages: numPages,
    pages,
    fullText,
  };
}

/**
 * Alternative: Extract all text at once (simpler but no page info)
 */
export async function parsePDFSimple(
  buffer: Buffer,
  documentName: string
): Promise<ParsedPDF> {
  const uint8Array = new Uint8Array(buffer);
  const { text, totalPages } = await extractText(uint8Array);
  const fullText = Array.isArray(text) ? text.join("\n\n") : text;

  return {
    documentName,
    totalPages,
    pages: [{ pageNumber: 1, text: fullText }],
    fullText,
  };
}

/**
 * Clean and normalize extracted text
 */
export function cleanText(text: string): string {
  return (
    text
      // Replace multiple whitespace with single space
      .replace(/\s+/g, " ")
      // Remove control characters except newlines
      .replace(/[\x00-\x09\x0B\x0C\x0E-\x1F\x7F]/g, "")
      // Normalize quotes
      .replace(/[""]/g, '"')
      .replace(/['']/g, "'")
      // Trim
      .trim()
  );
}
