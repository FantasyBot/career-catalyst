/**
 * Node: report_generator  (Step 8 — "PDF Generator")
 *
 * Converts the `improvedCv` Markdown string into a professionally styled PDF
 * using jsPDF, then stores the result as a Base64 string in `finalPdfBase64`.
 *
 * Typography:
 *   H1  → Helvetica-Bold  16pt  (name / top-level section)
 *   H2  → Helvetica-Bold  14pt  (sub-section)
 *   H3  → Helvetica-BoldOblique 12pt
 *   Body→ Helvetica       12pt
 *   Bullet → Helvetica    12pt  indented 8mm, • prefix
 *   HR  → 0.3pt rule across content width
 *
 * Inline **bold** markers are stripped — jsPDF cannot mix font weights within
 * a single text call without heavy character-level measurement.
 *
 * Output slice: { finalPdfBase64 }
 */

import { jsPDF } from "jspdf";
import { z } from "zod";
import type { GraphStateType } from "../state.js";

// ─── Output schema ─────────────────────────────────────────────────────────────

const ReportGeneratorOutputSchema = z.object({
  finalPdfBase64: z
    .string()
    .min(100)
    .describe("Base64-encoded PDF — raw bytes only, no data-URI prefix"),
});

// ─── Markdown line types ───────────────────────────────────────────────────────

type MdLine =
  | { kind: "h1"; text: string }
  | { kind: "h2"; text: string }
  | { kind: "h3"; text: string }
  | { kind: "bullet"; text: string }
  | { kind: "hr" }
  | { kind: "blank" }
  | { kind: "body"; text: string };

// ─── Markdown parser ───────────────────────────────────────────────────────────

/** Strip inline bold/italic markers so they don't appear as literal asterisks. */
function stripInlineMarkers(text: string): string {
  return text
    .replace(/\*\*\*(.+?)\*\*\*/g, "$1") // ***bold+italic***
    .replace(/\*\*(.+?)\*\*/g, "$1") // **bold**
    .replace(/__(.+?)__/g, "$1") // __bold__
    .replace(/\*(.+?)\*/g, "$1") // *italic*
    .replace(/_(.+?)_/g, "$1") // _italic_
    .replace(/`(.+?)`/g, "$1") // `code`
    .trim();
}

function parseMarkdown(md: string): MdLine[] {
  const lines = md.split(/\r?\n/);
  const parsed: MdLine[] = [];

  for (const raw of lines) {
    const line = raw.trimEnd(); // preserve leading whitespace detection

    if (/^---+$/.test(line.trim())) {
      parsed.push({ kind: "hr" });
    } else if (line.startsWith("### ")) {
      parsed.push({ kind: "h3", text: stripInlineMarkers(line.slice(4)) });
    } else if (line.startsWith("## ")) {
      parsed.push({ kind: "h2", text: stripInlineMarkers(line.slice(3)) });
    } else if (line.startsWith("# ")) {
      parsed.push({ kind: "h1", text: stripInlineMarkers(line.slice(2)) });
    } else if (/^[-*•]\s/.test(line.trim())) {
      // Bullet: strip the list marker, preserve any indentation level
      const text = line.trim().replace(/^[-*•]\s+/, "");
      parsed.push({ kind: "bullet", text: stripInlineMarkers(text) });
    } else if (line.trim() === "") {
      parsed.push({ kind: "blank" });
    } else {
      parsed.push({ kind: "body", text: stripInlineMarkers(line.trim()) });
    }
  }

  return parsed;
}

// ─── PDF renderer ─────────────────────────────────────────────────────────────

// A4 dimensions in mm
const PAGE_W = 210;
const PAGE_H = 297;
const MARGIN = 20; // left, right, top, bottom
const CONTENT_W = PAGE_W - MARGIN * 2; // 170mm

// Vertical spacing (mm) consumed after each line type
const LINE_HEIGHT: Record<MdLine["kind"], number> = {
  h1: 10,
  h2: 9,
  h3: 8,
  bullet: 7,
  hr: 6,
  blank: 4,
  body: 7,
};

function renderPdf(lines: MdLine[]): jsPDF {
  const doc = new jsPDF({ unit: "mm", format: "a4", orientation: "portrait" });

  let y = MARGIN;

  const ensureSpace = (needed: number) => {
    if (y + needed > PAGE_H - MARGIN) {
      doc.addPage();
      y = MARGIN;
    }
  };

  const writeWrapped = (
    text: string,
    x: number,
    maxW: number,
    lineH: number,
  ) => {
    const segments = doc.splitTextToSize(text, maxW) as string[];
    for (const seg of segments) {
      ensureSpace(lineH);
      doc.text(seg, x, y);
      y += lineH;
    }
  };

  for (const line of lines) {
    switch (line.kind) {
      case "h1": {
        ensureSpace(LINE_HEIGHT.h1 + 2);
        doc.setFont("helvetica", "bold");
        doc.setFontSize(16);
        const segs = doc.splitTextToSize(line.text, CONTENT_W) as string[];
        for (const seg of segs) {
          ensureSpace(LINE_HEIGHT.h1);
          doc.text(seg, MARGIN, y);
          y += LINE_HEIGHT.h1;
        }
        break;
      }

      case "h2": {
        ensureSpace(LINE_HEIGHT.h2 + 2);
        doc.setFont("helvetica", "bold");
        doc.setFontSize(14);
        const segs = doc.splitTextToSize(line.text, CONTENT_W) as string[];
        for (const seg of segs) {
          ensureSpace(LINE_HEIGHT.h2);
          doc.text(seg, MARGIN, y);
          y += LINE_HEIGHT.h2;
        }
        // Underline: draw a 0.3pt rule under the heading
        doc.setLineWidth(0.3);
        doc.line(MARGIN, y - 2, MARGIN + CONTENT_W, y - 2);
        y += 1; // small gap after rule
        break;
      }

      case "h3": {
        doc.setFont("helvetica", "bolditalic");
        doc.setFontSize(12);
        writeWrapped(line.text, MARGIN, CONTENT_W, LINE_HEIGHT.h3);
        break;
      }

      case "bullet": {
        doc.setFont("helvetica", "normal");
        doc.setFontSize(12);
        const bulletChar = "\u2022"; // •
        const indent = 8; // mm
        const bulletX = MARGIN + indent;
        const textW = CONTENT_W - indent - 2;

        ensureSpace(LINE_HEIGHT.bullet);
        doc.text(bulletChar, MARGIN + 2, y);

        const segs = doc.splitTextToSize(line.text, textW) as string[];
        for (let i = 0; i < segs.length; i++) {
          ensureSpace(LINE_HEIGHT.bullet);
          doc.text(segs[i], bulletX, y);
          if (i < segs.length - 1) y += LINE_HEIGHT.bullet;
        }
        y += LINE_HEIGHT.bullet;
        break;
      }

      case "hr": {
        ensureSpace(LINE_HEIGHT.hr);
        doc.setLineWidth(0.3);
        doc.setDrawColor(180); // light grey
        doc.line(MARGIN, y, MARGIN + CONTENT_W, y);
        doc.setDrawColor(0); // reset to black
        y += LINE_HEIGHT.hr;
        break;
      }

      case "blank": {
        y += LINE_HEIGHT.blank;
        break;
      }

      case "body": {
        doc.setFont("helvetica", "normal");
        doc.setFontSize(12);
        writeWrapped(line.text, MARGIN, CONTENT_W, LINE_HEIGHT.body);
        break;
      }
    }
  }

  return doc;
}

// ─── Node ─────────────────────────────────────────────────────────────────────

export async function reportGeneratorNode(
  state: GraphStateType,
): Promise<Partial<GraphStateType>> {
  const cvText = state.improvedCv ?? state.originalCv;

  if (!cvText) {
    throw new Error(
      "report_generator: no CV text available in state. " +
        "Run pdf_parser and cv_enhancer first.",
    );
  }

  console.log(
    `[report_generator] Parsing Markdown CV (${cvText.length} chars)...`,
  );

  const mdLines = parseMarkdown(cvText);
  console.log(
    `[report_generator] Parsed ${mdLines.length} lines — rendering PDF.`,
  );

  const doc = renderPdf(mdLines);

  // ── Serialise to Base64 ───────────────────────────────────────────────────
  // output('arraybuffer') returns an ArrayBuffer; Buffer handles the conversion.
  const arrayBuffer = doc.output("arraybuffer");
  const finalPdfBase64 = Buffer.from(arrayBuffer).toString("base64");

  // ── Zod validation ────────────────────────────────────────────────────────
  ReportGeneratorOutputSchema.parse({ finalPdfBase64 });

  const sizeKb = Math.round((finalPdfBase64.length * 3) / 4 / 1024);
  console.log(
    `[report_generator] PDF generated. ` +
      `Pages: ${doc.getNumberOfPages()} | ` +
      `Size: ~${sizeKb} KB`,
  );

  return { finalPdfBase64 };
}
