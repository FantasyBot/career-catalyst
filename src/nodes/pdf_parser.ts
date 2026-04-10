/**
 * Node: pdf_parser
 *
 * Responsibility: Convert the raw input in `state.originalCv` into plain text.
 *
 * Behaviour:
 *   - If originalCv looks like a file-system path ending in ".pdf", the node
 *     reads the file and runs it through pdf-parse.
 *   - If originalCv already contains plain text (the user pre-extracted it),
 *     the node passes it through unchanged so the graph can be seeded either way.
 *
 * Output slice: { originalCv }
 */

import fs from "node:fs/promises";
import path from "node:path";
import pdfParse from "pdf-parse/lib/pdf-parse.js";
import { z } from "zod";
import type { GraphStateType } from "../state.js";

// ─── Output schema ─────────────────────────────────────────────────────────────

const PdfParserOutputSchema = z.object({
  originalCv: z
    .string()
    .min(100, "Parsed CV text is suspiciously short — check the source PDF"),
});

type PdfParserOutput = z.infer<typeof PdfParserOutputSchema>;

// ─── Helpers ───────────────────────────────────────────────────────────────────

function looksLikeFilePath(value: string): boolean {
  const trimmed = value.trim();
  return (
    trimmed.endsWith(".pdf") &&
    (trimmed.startsWith("/") ||
      trimmed.startsWith("./") ||
      trimmed.startsWith("../") ||
      /^[A-Za-z]:[/\\]/.test(trimmed)) // Windows absolute path
  );
}

/**
 * Custom page renderer passed to pdf-parse.
 *
 * Extracts both visible text AND hyperlink annotations from each page.
 * This handles CVs where links like "GitHub" are clickable but the URL
 * is stored only as a PDF annotation — invisible in the raw text stream.
 * Extracted URLs are appended to the page text so link_extractor can find them.
 */
async function renderPageWithLinks(pageData: {
  getTextContent: (
    opts: object,
  ) => Promise<{ items: Array<{ str: string; transform: number[] }> }>;
  getAnnotations: () => Promise<
    Array<{ annotationType: number; url?: string }>
  >;
}): Promise<string> {
  const textContent = await pageData.getTextContent({
    normalizeWhitespace: false,
    disableCombineTextItems: false,
  });

  let lastY: number | undefined;
  let text = "";
  for (const item of textContent.items) {
    if (lastY === item.transform[5] || !lastY) {
      text += item.str;
    } else {
      text += "\n" + item.str;
    }
    lastY = item.transform[5];
  }

  // annotationType === 2 is a Link annotation in the PDF spec
  const annotations = await pageData.getAnnotations();
  const urls = annotations
    .filter((ann) => ann.annotationType === 2 && ann.url)
    .map((ann) => ann.url as string);

  if (urls.length > 0) {
    text += "\n" + urls.join("\n");
  }

  return text;
}

async function parsePdf(filePath: string): Promise<string> {
  const absolutePath = path.resolve(filePath.trim());
  const buffer = await fs.readFile(absolutePath);
  const result = await pdfParse(buffer, { pagerender: renderPageWithLinks });
  const text = result.text.trim();
  if (!text) {
    throw new Error(`pdf-parse returned empty text for: ${absolutePath}`);
  }
  return text;
}

function normaliseWhitespace(text: string): string {
  return text
    .replace(/\r\n/g, "\n") // normalise line endings
    .replace(/\n{3,}/g, "\n\n") // collapse excessive blank lines
    .trim();
}

// ─── Node ─────────────────────────────────────────────────────────────────────

export async function pdfParserNode(
  state: GraphStateType,
): Promise<Partial<GraphStateType>> {
  console.log("\n" + "─".repeat(56));
  console.log("  STEP 1/7  │  pdf_parser");
  console.log("─".repeat(56));

  const { originalCv } = state;

  if (!originalCv) {
    throw new Error(
      "pdf_parser: state.originalCv is empty. " +
        "Seed the graph with a PDF file path or pre-extracted CV text.",
    );
  }

  let rawText: string;

  if (looksLikeFilePath(originalCv)) {
    console.log(`[pdf_parser] Reading PDF from: ${originalCv}`);
    rawText = await parsePdf(originalCv);
    console.log(
      `[pdf_parser] Extracted ${rawText.length} characters from PDF.`,
    );
  } else {
    // Already plain text — pass through
    console.log(
      `[pdf_parser] originalCv is plain text (${originalCv.length} chars) — skipping PDF parse.`,
    );
    rawText = originalCv;
  }

  const cleanedText = normaliseWhitespace(rawText);

  // Validate output shape with Zod
  const output: PdfParserOutput = PdfParserOutputSchema.parse({
    originalCv: cleanedText,
  });

  return output;
}
