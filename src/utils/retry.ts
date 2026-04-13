/**
 * Shared LLM invocation retry utility.
 *
 * Provides structured-output retry with exponential backoff and a raw JSON
 * fallback for when the LLM returns content that fails schema parsing.
 *
 * Usage:
 *   import { invokeWithRetryAndFallback } from "../utils/retry.js";
 */

import { ChatOpenAI } from "@langchain/openai";
import { HumanMessage, SystemMessage } from "@langchain/core/messages";

export interface RetryConfig {
  /** Maximum number of structured-output attempts before falling back. Default: 3 */
  maxAttempts?: number;
  /** Base delay in ms for exponential backoff. Default: 300 */
  baseDelayMs?: number;
  /** Label used in warning messages to identify the call site. */
  label: string;
}

const fallbackLlm = new ChatOpenAI({
  model: "gpt-4o-mini",
  temperature: 0,
  maxTokens: 8192,
});

export function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * Try to pull a JSON object out of raw LLM text.
 * Strategy order:
 *   1. Fenced ```json ... ``` block
 *   2. First { … last } substring
 *   3. Returns null if neither strategy yields anything
 */
export function extractJsonObject(text: string): string | null {
  const fenced = text.match(/```json\s*([\s\S]*?)\s*```/i);
  if (fenced?.[1]) return fenced[1].trim();

  const firstBrace = text.indexOf("{");
  const lastBrace = text.lastIndexOf("}");
  if (firstBrace >= 0 && lastBrace > firstBrace) {
    return text.slice(firstBrace, lastBrace + 1).trim();
  }

  return null;
}

/**
 * Invoke an LLM with structured output, retrying on parse failures.
 *
 * Flow:
 *   1. Attempt structured invocation up to `maxAttempts` times with backoff.
 *   2. On exhaustion, fall back to `gpt-4o-mini` in raw-text mode with an
 *      explicit JSON instruction appended to the message list.
 *   3. Extract and parse the JSON object from the fallback response.
 *   4. Throw a descriptive error if everything fails.
 *
 * @param invokeStructured  Zero-arg function that calls the structured LLM.
 * @param parseWithSchema   Validates/transforms the raw output into type T.
 * @param messages          Original message list (used for fallback context).
 * @param fallbackFormatHint  JSON skeleton shown to the fallback model.
 * @param config            Retry behaviour and label for log messages.
 */
export async function invokeWithRetryAndFallback<T>(
  invokeStructured: () => Promise<unknown>,
  parseWithSchema: (value: unknown) => T,
  messages: Array<SystemMessage | HumanMessage>,
  fallbackFormatHint: string,
  config: RetryConfig,
): Promise<T> {
  const maxAttempts = config.maxAttempts ?? 3;
  const baseDelayMs = config.baseDelayMs ?? 300;
  const { label } = config;

  let lastError: unknown = null;

  // ─── 1. Structured attempts with exponential backoff ───────────────────────
  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    try {
      const result = await invokeStructured();
      return parseWithSchema(result);
    } catch (err) {
      lastError = err;
      console.warn(
        `[retry] ${label} structured parse failed ` +
          `(attempt ${attempt}/${maxAttempts}): ${(err as Error).message}`,
      );
      if (attempt < maxAttempts) {
        await sleep(baseDelayMs * attempt);
      }
    }
  }

  // ─── 2. Fallback to raw JSON mode ──────────────────────────────────────────
  console.warn(
    `[retry] ${label} switching to raw JSON fallback after ${maxAttempts} failed attempts.`,
  );

  const fallbackMessages = [
    ...messages,
    new HumanMessage(
      "Your previous response could not be parsed.\n\n" +
        "Return ONLY one valid JSON object.\n" +
        "Do NOT include explanations, markdown, or text outside JSON.\n\n" +
        `Expected format:\n${fallbackFormatHint}`,
    ),
  ];

  const raw = await fallbackLlm.invoke(fallbackMessages);
  const rawText =
    typeof raw.content === "string" ? raw.content : JSON.stringify(raw.content);

  const jsonText = extractJsonObject(rawText);

  if (!jsonText) {
    throw new Error(
      `[retry] ${label} fallback failed: no JSON object found.\n` +
        `Last structured error: ${(lastError as Error)?.message ?? "unknown"}\n` +
        `Raw output:\n${rawText.slice(0, 500)}...`,
    );
  }

  // ─── 3. Final parse attempt ────────────────────────────────────────────────
  try {
    const parsed = JSON.parse(jsonText);
    return parseWithSchema(parsed);
  } catch (err) {
    throw new Error(
      `[retry] ${label} fallback JSON parse failed: ${(err as Error).message}\n` +
        `Last structured error: ${(lastError as Error)?.message ?? "unknown"}\n` +
        `Extracted JSON:\n${jsonText.slice(0, 500)}...`,
    );
  }
}
