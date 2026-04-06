/**
 * Node: job_hunter  (Step 7 — "Job Matcher")
 *
 * Searches for 3 real, active job openings matching the user's targetRole
 * and improved CV. Uses the Tavily REST API directly so the `days: 30` filter
 * is applied server-side — the LangChain wrapper does not expose this param.
 *
 * Pipeline:
 *   buildQueries → Tavily searches (parallel, days=30) →
 *   aggregate raw results → LLM extraction → Zod validation → jobMatches
 *
 * Output slice: { jobMatches }
 */

import { ChatOpenAI } from "@langchain/openai";
import { HumanMessage, SystemMessage } from "@langchain/core/messages";
import { z } from "zod";
import {
  JobMatchSchema,
  type JobMatch,
  type GraphStateType,
} from "../state.js";

// ─── Schemas ───────────────────────────────────────────────────────────────────

// Wrap in an object so withStructuredOutput has a named root
const JobHunterOutputSchema = z.object({
  jobMatches: z
    .array(JobMatchSchema)
    .length(3)
    .describe(
      "Exactly 3 real, distinct job openings. Each must have a real URL pointing " +
        "to an actual posting — no fabricated links.",
    ),
});

// ─── Tavily direct API ────────────────────────────────────────────────────────

interface TavilyRawResult {
  title?: string;
  url?: string;
  content?: string;
  score?: number;
}

interface TavilyResponse {
  results?: TavilyRawResult[];
  error?: string;
}

async function tavilySearch(
  query: string,
  days: number = 30,
  maxResults: number = 5,
): Promise<TavilyRawResult[]> {
  const apiKey = process.env.TAVILY_API_KEY;
  if (!apiKey) throw new Error("TAVILY_API_KEY is not set.");

  const res = await fetch("https://api.tavily.com/search", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      api_key: apiKey,
      query,
      max_results: maxResults,
      days, // filter to last N days — server-side
      include_answer: false,
      include_raw_content: false,
    }),
  });

  if (!res.ok) {
    const text = await res.text();
    throw new Error(`Tavily API error ${res.status}: ${text}`);
  }

  const data = (await res.json()) as TavilyResponse;

  if (data.error) throw new Error(`Tavily error: ${data.error}`);

  return data.results ?? [];
}

// ─── Query builder ─────────────────────────────────────────────────────────────

/**
 * Three complementary queries to maximise hit rate:
 *  1. Direct role + hiring signal
 *  2. Role + job board domains (Tavily ranks these highly)
 *  3. Role + "apply" intent — surfaces application pages not just listings
 */
function buildQueries(targetRole: string): string[] {
  const year = new Date().getFullYear();
  return [
    `"${targetRole}" job opening hiring now ${year}`,
    `${targetRole} position available apply site:linkedin.com OR site:greenhouse.io OR site:lever.co`,
    `${targetRole} new job posting apply now ${year}`,
  ];
}

// ─── Result formatter ──────────────────────────────────────────────────────────

function formatResultsForLlm(
  queryResults: Array<{ query: string; results: TavilyRawResult[] }>,
): string {
  return queryResults
    .map(({ query, results }) => {
      if (results.length === 0) return `### Query: "${query}"\n(no results)\n`;
      const lines = results.map(
        (r, i) =>
          `[${i + 1}] Title: ${r.title ?? "N/A"}\n    URL: ${r.url ?? "N/A"}\n    Snippet: ${(r.content ?? "").slice(0, 300)}`,
      );
      return `### Query: "${query}"\n${lines.join("\n\n")}`;
    })
    .join("\n\n");
}

// ─── LLM ──────────────────────────────────────────────────────────────────────

const llm = new ChatOpenAI({ model: "gpt-4o", temperature: 0 });
const structuredLlm = llm.withStructuredOutput(JobHunterOutputSchema, {
  name: "job_hunter_output",
});

async function extractJobMatches(
  rawContext: string,
  targetRole: string,
  cvSkills: string,
): Promise<JobMatch[]> {
  const messages = [
    new SystemMessage(
      "You are a specialist technical recruiter. From the search results provided, " +
        "select exactly 3 real, distinct job openings that best match the candidate. " +
        "Rules:\n" +
        "1. Every URL must come directly from the search results — never fabricate URLs.\n" +
        "2. Prefer postings from recognised job boards or company career pages.\n" +
        "3. Each description must be one concise paragraph summarising the role, " +
        "   required skills, and why it matches the candidate's profile.\n" +
        "4. If fewer than 3 distinct postings are available, select the best available " +
        "   and note 'Limited results available' in the description.\n" +
        "5. Deduplicate — do not return the same posting twice.",
    ),
    new HumanMessage(
      `## Target Role\n${targetRole}\n\n` +
        `## Candidate's Key Skills\n${cvSkills}\n\n` +
        `## Search Results (last 30 days)\n\n${rawContext}`,
    ),
  ];

  const result = await structuredLlm.invoke(messages);
  return JobHunterOutputSchema.parse(result).jobMatches;
}

// ─── Node ─────────────────────────────────────────────────────────────────────

export async function jobHunterNode(
  state: GraphStateType,
): Promise<Partial<GraphStateType>> {
  const { targetRole, improvedCv, originalCv, marketRequirements } = state;

  if (!targetRole) {
    throw new Error("job_hunter: state.targetRole is empty.");
  }

  const cvText = improvedCv ?? originalCv;
  // Summarise the candidate's skills for the LLM prompt (first 800 chars is enough)
  const cvSkillsSummary =
    marketRequirements.length > 0
      ? marketRequirements.slice(0, 15).join(", ")
      : cvText.slice(0, 800);

  const queries = buildQueries(targetRole);
  console.log(
    `[job_hunter] Running ${queries.length} Tavily searches (days=30) for: "${targetRole}"`,
  );

  // ── Parallel searches ──────────────────────────────────────────────────────
  const queryResults = await Promise.all(
    queries.map(async (query) => {
      try {
        const results = await tavilySearch(query, 30, 5);
        console.log(`[job_hunter] "${query}" → ${results.length} results`);
        return { query, results };
      } catch (err) {
        console.warn(
          `[job_hunter] Search failed for "${query}": ${(err as Error).message}`,
        );
        return { query, results: [] as TavilyRawResult[] };
      }
    }),
  );

  const totalResults = queryResults.reduce((n, r) => n + r.results.length, 0);
  if (totalResults === 0) {
    throw new Error(
      "job_hunter: all Tavily searches returned empty results. " +
        "Check TAVILY_API_KEY and network connectivity.",
    );
  }

  const rawContext = formatResultsForLlm(queryResults);
  console.log(
    `[job_hunter] ${totalResults} raw results aggregated — extracting 3 matches via LLM.`,
  );

  // ── LLM extraction + Zod validation ───────────────────────────────────────
  const jobMatches = await extractJobMatches(
    rawContext,
    targetRole,
    cvSkillsSummary,
  );

  console.log(
    `[job_hunter] Validated ${jobMatches.length} job matches:\n` +
      jobMatches.map((m) => `  • ${m.title} @ ${m.company}`).join("\n"),
  );

  return { jobMatches };
}
