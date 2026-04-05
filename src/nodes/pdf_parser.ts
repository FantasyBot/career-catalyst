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
import pdfParse from "pdf-parse";
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

async function parsePdf(filePath: string): Promise<string> {
  const absolutePath = path.resolve(filePath.trim());
  const buffer = await fs.readFile(absolutePath);
  const result = await pdfParse(buffer);
  const text = result.text.trim();
  if (!text) {
    throw new Error(`pdf-parse returned empty text for: ${absolutePath}`);
  }
  return text;
}

function normaliseWhitespace(text: string): string {
  return text
    .replace(/\r\n/g, "\n")   // normalise line endings
    .replace(/\n{3,}/g, "\n\n") // collapse excessive blank lines
    .trim();
}

// ─── Node ─────────────────────────────────────────────────────────────────────

export async function pdfParserNode(
  state: GraphStateType
): Promise<Partial<GraphStateType>> {
  const { originalCv } = state;

  if (!originalCv) {
    throw new Error(
      "pdf_parser: state.originalCv is empty. " +
        "Seed the graph with a PDF file path or pre-extracted CV text."
    );
  }

  let rawText: string;

  if (looksLikeFilePath(originalCv)) {
    console.log(`[pdf_parser] Reading PDF from: ${originalCv}`);
    rawText = await parsePdf(originalCv);
    console.log(`[pdf_parser] Extracted ${rawText.length} characters from PDF.`);
  } else {
    // Already plain text — pass through
    console.log(
      `[pdf_parser] originalCv is plain text (${originalCv.length} chars) — skipping PDF parse.`
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
