/**
 * Node: market_scout
 *
 * Responsibility: Run targeted Tavily web searches based on `targetRole`,
 * then distil the raw results into a clean, Zod-validated list of market
 * requirements (skills, tools, frameworks) saved to `marketRequirements`.
 *
 * Query strategy — three complementary angles to maximise coverage:
 *   1. Core skills   : "essential skills and technologies for <role> 2026"
 *   2. Hiring bar    : "<role> interview requirements and hiring criteria 2026"
 *   3. Tooling       : "top frameworks tools <role> companies expect 2026"
 *
 * Pipeline:
 *   buildQueries → Tavily searches (parallel) → aggregate snippets →
 *   LLM extraction (structuredOutput) → Zod validation → marketRequirements
 *
 * Output slice: { marketRequirements }
 */

import { ChatOpenAI } from "@langchain/openai";
import { HumanMessage, SystemMessage } from "@langchain/core/messages";
import { z } from "zod";
import type { GraphStateType } from "../state.js";
import { tavilySearch, type TavilyResult } from "../utils/tavily.js";

// ─── Output schema ─────────────────────────────────────────────────────────────

const MarketScoutOutputSchema = z.object({
  marketRequirements: z
    .array(
      z
        .string()
        .trim()
        .min(1)
        .max(80)
        .describe(
          "A single skill, tool, technology, or competency — concise label only",
        ),
    )
    .min(10)
    .max(50)
    .describe(
      "Deduplicated, ranked list of skills/tools the market expects for this role",
    ),
});

// ─── LLM ──────────────────────────────────────────────────────────────────────

const llm = new ChatOpenAI({ model: "gpt-4o", temperature: 0 });
const structuredLlm = llm.withStructuredOutput(MarketScoutOutputSchema, {
  name: "market_scout_output",
});

// ─── Helpers ───────────────────────────────────────────────────────────────────

/**
 * Build three dynamic Tavily search queries from the target role.
 * Each query targets a different dimension of market requirements.
 */
function buildQueries(targetRole: string): string[] {
  const year = new Date().getFullYear();
  return [
    `essential skills and technologies for ${targetRole} ${year}`,
    `${targetRole} interview requirements and hiring criteria ${year}`,
    `top frameworks tools and libraries ${targetRole} companies expect ${year}`,
  ];
}

/** Concatenate all result snippets into a single context block for the LLM. */
function aggregateSnippets(
  queryResults: Array<{ query: string; results: TavilyResult[] }>,
): string {
  const sections = queryResults.map(({ query, results }) => {
    const snippets = results
      .map((r) => r.content?.trim())
      // `c` can be `undefined` (from optional chaining); exclude it before using `c.length`.
      .filter((c): c is string => c !== undefined && c.length > 20)
      .slice(0, 4) // max 4 snippets per query to stay within token budget
      .join("\n---\n");

    return `### Query: "${query}"\n${snippets || "(no results)"}`;
  });

  return sections.join("\n\n");
}

// ─── Node ─────────────────────────────────────────────────────────────────────

export async function marketScoutNode(
  state: GraphStateType,
): Promise<Partial<GraphStateType>> {
  console.log("\n" + "─".repeat(56));
  console.log("  STEP 3/7  │  market_scout");
  console.log("─".repeat(56));

  const { targetRole } = state;

  if (!targetRole) {
    throw new Error(
      "market_scout: state.targetRole is empty. Set it before invoking the graph.",
    );
  }

  const queries = buildQueries(targetRole);
  console.log(
    `[market_scout] Running ${queries.length} Tavily searches for: "${targetRole}"`,
  );
  queries.forEach((q, i) => console.log(`  [${i + 1}] ${q}`));

  // ── Tavily searches (parallel) ─────────────────────────────────────────────
  const searchResults = await Promise.all(
    queries.map(async (query) => {
      try {
        const results = await tavilySearch(query, 5);
        console.log(`[market_scout] "${query}" → ${results.length} results`);
        return { query, results };
      } catch (err) {
        console.warn(
          `[market_scout] Search failed for query "${query}": ${(err as Error).message}. ` +
            "Continuing with remaining queries.",
        );
        return { query, results: [] as TavilyResult[] };
      }
    }),
  );

  const hasAnyResults = searchResults.some((r) => r.results.length > 0);
  if (!hasAnyResults) {
    throw new Error(
      "market_scout: all Tavily searches returned empty results. " +
        "Check TAVILY_API_KEY and network connectivity.",
    );
  }

  const aggregated = aggregateSnippets(searchResults);
  const snippetWordCount = aggregated.split(/\s+/).length;
  console.log(
    `[market_scout] Aggregated ${snippetWordCount} words — sending to LLM for extraction.`,
  );

  // ── LLM: extract structured requirements ──────────────────────────────────
  const messages = [
    new SystemMessage(
      "You are an expert technical recruiter analysing job market data. " +
        "Extract a comprehensive, deduplicated list of skills, technologies, tools, " +
        "frameworks, and competencies that are required or highly valued for the role. " +
        "Each item must be a concise label (e.g. 'TypeScript', 'System Design', " +
        "'REST API Design', 'AWS Lambda'). Do not include generic phrases like " +
        "'communication skills' unless they appear repeatedly as a hard requirement. " +
        "Rank from most to least frequently mentioned.",
    ),
    new HumanMessage(
      `Target role: ${targetRole}\n\n` +
        `Market research results:\n\n${aggregated}\n\n` +
        "Extract all distinct market requirements for this role.",
    ),
  ];

  const raw = await structuredLlm.invoke(messages);

  // ── Zod validation ────────────────────────────────────────────────────────
  const { marketRequirements } = MarketScoutOutputSchema.parse(raw);

  console.log(
    `[market_scout] Validated ${marketRequirements.length} market requirements. ` +
      `Top 5: ${marketRequirements.slice(0, 5).join(", ")}`,
  );

  return { marketRequirements };
}
