/**
 * Node: link_extractor
 *
 * Responsibility: Extract a GitHub profile URL from the parsed CV text and
 * set routing flags for the conditional edge that follows.
 *
 * Strategy (two-pass):
 *   1. Fast regex scan — covers the most common GitHub URL formats instantly.
 *   2. If regex finds nothing, fall back to a small Claude call with
 *      structuredOutput so the model can reason about obfuscated or
 *      prose-embedded URLs (e.g. "github.com/johndoe" without a scheme).
 *
 * Output slice: { githubUrl, hasGithub }
 */

import { ChatAnthropic } from "@langchain/anthropic";
import { HumanMessage, SystemMessage } from "@langchain/core/messages";
import { z } from "zod";
import type { GraphStateType } from "../state.js";

// ─── Output schema ─────────────────────────────────────────────────────────────

const LinkExtractorOutputSchema = z.object({
  githubUrl: z
    .string()
    .url()
    .nullable()
    .describe(
      "The GitHub profile URL found in the CV, fully qualified with https://. " +
        "Must point to a user profile, not a repo. Return null if absent."
    ),
  hasGithub: z
    .boolean()
    .describe("True when a valid GitHub profile URL was found."),
  reasoning: z
    .string()
    .describe("One sentence: where you found the URL or why you concluded none exists."),
});

type LinkExtractorOutput = z.infer<typeof LinkExtractorOutputSchema>;

// ─── Regex pass ────────────────────────────────────────────────────────────────

// Matches patterns like:
//   https://github.com/username
//   http://github.com/username
//   github.com/username          ← no scheme
// Does NOT match repo paths (github.com/user/repo) — profile only (1 segment).
const GITHUB_PROFILE_REGEX =
  /(?:https?:\/\/)?github\.com\/([A-Za-z0-9](?:[A-Za-z0-9-]{0,37}[A-Za-z0-9])?)(?:\/\s|\/?\s|$)/;

function regexExtract(text: string): string | null {
  const match = text.match(GITHUB_PROFILE_REGEX);
  if (!match) return null;
  const username = match[1];
  return `https://github.com/${username}`;
}

// ─── LLM pass (fallback) ───────────────────────────────────────────────────────

const llm = new ChatAnthropic({
  model: "claude-haiku-4-5-20251001", // fast & cheap for extraction tasks
  temperature: 0,
});

const structuredLlm = llm.withStructuredOutput(LinkExtractorOutputSchema, {
  name: "link_extractor_output",
});

async function llmExtract(cvText: string): Promise<LinkExtractorOutput> {
  const snippet = cvText.slice(0, 4_000); // first 4k chars is enough for contact details
  const messages = [
    new SystemMessage(
      "You are an expert at parsing CVs and resumes. " +
        "Your only job is to find a GitHub *profile* URL belonging to the CV owner. " +
        "A profile URL looks like github.com/<username> (one path segment). " +
        "Do not confuse repo links (github.com/user/repo) with profile links. " +
        "If you find a URL without a scheme, prepend https://. " +
        "Return null for githubUrl if no GitHub profile is present."
    ),
    new HumanMessage(
      `Extract the GitHub profile URL from the following CV text:\n\n${snippet}`
    ),
  ];

  return structuredLlm.invoke(messages);
}

// ─── Node ─────────────────────────────────────────────────────────────────────

export async function linkExtractorNode(
  state: GraphStateType
): Promise<Partial<GraphStateType>> {
  const { originalCv } = state;

  if (!originalCv) {
    throw new Error("link_extractor: state.originalCv is empty. Run pdf_parser first.");
  }

  // Pass 1 — fast regex
  const regexResult = regexExtract(originalCv);

  if (regexResult) {
    console.log(`[link_extractor] Regex found GitHub URL: ${regexResult}`);
    return {
      githubUrl: regexResult,
      hasGithub: true,
    };
  }

  // Pass 2 — LLM fallback
  console.log("[link_extractor] Regex found nothing — falling back to LLM extraction.");
  const llmResult = await llmExtract(originalCv);

  console.log(`[link_extractor] LLM reasoning: ${llmResult.reasoning}`);
  console.log(`[link_extractor] GitHub URL: ${llmResult.githubUrl ?? "none"}`);

  return {
    githubUrl: llmResult.githubUrl,
    hasGithub: llmResult.hasGithub,
  };
}
