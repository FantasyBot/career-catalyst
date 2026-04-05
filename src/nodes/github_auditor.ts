/**
 * Node: github_auditor
 *
 * Responsibility: Fetch the user's top 5 GitHub repos via Octokit, aggregate
 * language usage, and produce a structured GithubProfile summary via Claude.
 *
 * Routing guarantee: this node is only reachable when hasGithub === true
 * (enforced by the conditional edge in graph.ts). A runtime guard is included
 * as a belt-and-braces check.
 *
 * Error resilience:
 *   - Rate-limit (HTTP 403 / 429), private/non-existent profile (HTTP 404),
 *     missing GITHUB_TOKEN, or any network failure → logs "GitHub Audit Skipped",
 *     sets githubProfile: null and hasGithub: false, and lets the graph continue.
 *
 * Output slice: { githubProfile, hasGithub }
 */

import { Octokit } from "@octokit/rest";
import { ChatAnthropic } from "@langchain/anthropic";
import { HumanMessage, SystemMessage } from "@langchain/core/messages";
import { z } from "zod";
import { GithubProfileSchema, type GithubProfile, type GraphStateType } from "../state.js";

// ─── Output schema ─────────────────────────────────────────────────────────────

const GithubAuditorOutputSchema = z.object({
  githubProfile: GithubProfileSchema,
});

// ─── LLM ──────────────────────────────────────────────────────────────────────

const llm = new ChatAnthropic({ model: "claude-haiku-4-5-20251001", temperature: 0.2 });
const structuredLlm = llm.withStructuredOutput(GithubAuditorOutputSchema, {
  name: "github_auditor_output",
});

// ─── Helpers ───────────────────────────────────────────────────────────────────

function extractUsername(githubUrl: string): string {
  // Handles: https://github.com/username  OR  github.com/username
  const match = githubUrl.match(/github\.com\/([A-Za-z0-9][A-Za-z0-9-]{0,37}[A-Za-z0-9]?)/);
  if (!match) throw new Error(`Cannot parse username from URL: ${githubUrl}`);
  return match[1];
}

/** Aggregate byte counts per language across repos into a ranked top-N list. */
function rankLanguages(
  repoLanguages: Record<string, number>[]
): string[] {
  const totals: Record<string, number> = {};
  for (const map of repoLanguages) {
    for (const [lang, bytes] of Object.entries(map)) {
      totals[lang] = (totals[lang] ?? 0) + bytes;
    }
  }
  return Object.entries(totals)
    .sort(([, a], [, b]) => b - a)
    .slice(0, 8)
    .map(([lang]) => lang);
}

function buildAuditContext(
  username: string,
  repos: Array<{
    name: string;
    description: string | null;
    stargazers_count: number;
    language: string | null;
    pushed_at: string | null;
    topics: string[];
  }>,
  topLanguages: string[]
): string {
  const repoLines = repos.map((r) =>
    [
      `• ${r.name} (⭐ ${r.stargazers_count})`,
      r.description ? `  ${r.description}` : "",
      r.topics.length ? `  Topics: ${r.topics.join(", ")}` : "",
      r.language ? `  Primary language: ${r.language}` : "",
    ]
      .filter(Boolean)
      .join("\n")
  );

  return [
    `GitHub username: ${username}`,
    `Top languages (by bytes written): ${topLanguages.join(", ")}`,
    "",
    "Top repositories:",
    ...repoLines,
  ].join("\n");
}

// ─── Node ─────────────────────────────────────────────────────────────────────

export async function githubAuditorNode(
  state: GraphStateType
): Promise<Partial<GraphStateType>> {
  // Belt-and-braces guard — routing should prevent this from being reached
  if (!state.hasGithub || !state.githubUrl) {
    console.warn("[github_auditor] Reached with hasGithub=false — skipping.");
    return { githubProfile: null, hasGithub: false };
  }

  const username = extractUsername(state.githubUrl);
  console.log(`[github_auditor] Auditing GitHub profile: ${username}`);

  const octokit = new Octokit({
    auth: process.env.GITHUB_TOKEN, // optional — raises rate limit from 60 to 5000 req/hr
  });

  try {
    // ── Fetch top 5 repos sorted by most recently pushed ───────────────────
    const { data: repos } = await octokit.rest.repos.listForUser({
      username,
      sort: "pushed",
      direction: "desc",
      per_page: 5,
      type: "owner", // exclude forks
    });

    if (repos.length === 0) {
      console.warn(`[github_auditor] ${username} has no public repos — audit skipped.`);
      return { githubProfile: null, hasGithub: false };
    }

    // ── Fetch language breakdown for each repo (parallel) ──────────────────
    const languageMaps = await Promise.all(
      repos.map(async (repo) => {
        try {
          const { data } = await octokit.rest.repos.listLanguages({
            owner: username,
            repo: repo.name,
          });
          return data as Record<string, number>;
        } catch {
          return {} as Record<string, number>; // non-fatal — skip this repo's languages
        }
      })
    );

    const topLanguages = rankLanguages(languageMaps);

    const repoSummaries = repos.map((r) => ({
      name: r.name,
      description: r.description,
      stargazers_count: r.stargazers_count ?? 0,
      language: r.language,
      pushed_at: r.pushed_at ?? null,
      topics: r.topics ?? [],
    }));

    const auditContext = buildAuditContext(username, repoSummaries, topLanguages);
    console.log("[github_auditor] Repo context built — requesting LLM summary.");

    // ── LLM: produce structured GithubProfile ──────────────────────────────
    const messages = [
      new SystemMessage(
        "You are a technical recruiter summarising a candidate's GitHub presence. " +
          "Be factual, specific, and concise. Reference actual project names and languages. " +
          "The summary should be 2-4 sentences that a hiring manager can read in 10 seconds."
      ),
      new HumanMessage(
        `Based on the GitHub data below, produce a structured profile.\n\n${auditContext}`
      ),
    ];

    const { githubProfile } = await structuredLlm.invoke(messages);

    // Validate with Zod (withStructuredOutput already enforces shape, but explicit
    // parse catches any edge cases like empty arrays slipping through)
    const validated: GithubProfile = GithubProfileSchema.parse(githubProfile);

    console.log(
      `[github_auditor] Done. Languages: ${validated.languages.join(", ")} | ` +
        `Projects: ${validated.topProjects.join(", ")}`
    );

    return { githubProfile: validated, hasGithub: true };
  } catch (err: unknown) {
    // ── Graceful degradation ───────────────────────────────────────────────
    const status = (err as { status?: number }).status;
    const message = (err as Error).message ?? String(err);

    if (status === 403 || status === 429) {
      console.warn(
        `[github_auditor] GitHub Audit Skipped — rate limit hit (HTTP ${status}). ` +
          "Set GITHUB_TOKEN to increase quota. Continuing without GitHub data."
      );
    } else if (status === 404) {
      console.warn(
        `[github_auditor] GitHub Audit Skipped — profile not found or private (HTTP 404): ${username}`
      );
    } else {
      console.warn(
        `[github_auditor] GitHub Audit Skipped — unexpected error: ${message}. Continuing.`
      );
    }

    // Signal downstream nodes that GitHub data is unavailable
    return { githubProfile: null, hasGithub: false };
  }
}
