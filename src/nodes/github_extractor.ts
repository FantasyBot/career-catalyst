/**
 * Node: github_extractor
 *
 * Finds a GitHub profile URL in the CV text (which already includes any
 * hyperlink annotation URLs appended by pdf_parser), extracts the username,
 * fetches the top 5 repos via Octokit, and produces a GithubProfile summary.
 *
 * URL extraction is pure regex — no LLM needed. pdf_parser guarantees that
 * every URL in the document (visible text + hyperlink annotations) is present
 * as plain text by the time this node runs.
 *
 * Output slice: { githubUrl, githubUsername, hasGithub, githubProfile }
 */

import { Octokit } from "@octokit/rest";
import { ChatOpenAI } from "@langchain/openai";
import { HumanMessage, SystemMessage } from "@langchain/core/messages";
import { z } from "zod";
import {
  GithubProfileSchema,
  type GithubProfile,
  type GraphStateType,
} from "../state.js";

// ─── Schema ───────────────────────────────────────────────────────────────────

const ProfileSummarySchema = z.object({ githubProfile: GithubProfileSchema });

const llm = new ChatOpenAI({ model: "gpt-4o-mini", temperature: 0.2 });
const profileSummariser = llm.withStructuredOutput(ProfileSummarySchema, {
  name: "profile_summary",
});

// ─── URL extraction (regex only) ──────────────────────────────────────────────

// Matches github.com/<username> with or without scheme/www prefix.
// The capture group is self-terminating: GitHub usernames are [A-Za-z0-9-] only,
// so it stops naturally at any non-username char (/, space, period, comma, etc.).
// No trailing-character assertion needed — avoids false negatives when URLs appear
// at end of a PDF annotation line with no trailing whitespace or slash.
const GITHUB_PROFILE_REGEX =
  /(?:https?:\/\/)?(?:www\.)?github\.com\/([A-Za-z0-9](?:[A-Za-z0-9-]{0,37}[A-Za-z0-9])?)/;

function extractFromText(
  text: string,
): { url: string; username: string } | null {
  const match = text.match(GITHUB_PROFILE_REGEX);
  if (!match) return null;
  return { url: `https://github.com/${match[1]}`, username: match[1] };
}

// ─── GitHub profile fetch ─────────────────────────────────────────────────────

function rankLanguages(maps: Record<string, number>[]): string[] {
  const totals: Record<string, number> = {};
  for (const map of maps) {
    for (const [lang, bytes] of Object.entries(map)) {
      totals[lang] = (totals[lang] ?? 0) + bytes;
    }
  }
  return Object.entries(totals)
    .sort(([, a], [, b]) => b - a)
    .slice(0, 8)
    .map(([lang]) => lang);
}

async function fetchGithubProfile(username: string): Promise<GithubProfile> {
  const octokit = new Octokit({ auth: process.env.GITHUB_TOKEN });

  const { data: repos } = await octokit.rest.repos.listForUser({
    username,
    sort: "pushed",
    direction: "desc",
    per_page: 5,
    type: "owner",
  });

  if (repos.length === 0) throw new Error(`No public repos for: ${username}`);

  const languageMaps = await Promise.all(
    repos.map(async (repo) => {
      try {
        const { data } = await octokit.rest.repos.listLanguages({
          owner: username,
          repo: repo.name,
        });
        return data as Record<string, number>;
      } catch {
        return {} as Record<string, number>;
      }
    }),
  );

  const context = [
    `GitHub username: ${username}`,
    `Top languages (by bytes): ${rankLanguages(languageMaps).join(", ")}`,
    "",
    "Top repositories:",
    ...repos.map((r) =>
      [
        `• ${r.name} (⭐ ${r.stargazers_count ?? 0})`,
        r.description ? `  ${r.description}` : "",
        r.topics?.length ? `  Topics: ${r.topics.join(", ")}` : "",
        r.language ? `  Language: ${r.language}` : "",
      ]
        .filter(Boolean)
        .join("\n"),
    ),
  ].join("\n");

  const { githubProfile } = await profileSummariser.invoke([
    new SystemMessage(
      "You are a technical recruiter summarising a candidate's GitHub presence. " +
        "Be factual and concise. Reference actual project names and languages. " +
        "2-4 sentences a hiring manager can read in 10 seconds.",
    ),
    new HumanMessage(
      `Produce a structured profile from this data:\n\n${context}`,
    ),
  ]);

  return GithubProfileSchema.parse(githubProfile);
}

// ─── Node ─────────────────────────────────────────────────────────────────────

export async function githubExtractorNode(
  state: GraphStateType,
): Promise<Partial<GraphStateType>> {
  console.log("\n" + "─".repeat(56));
  console.log("  STEP 2/7  │  github_extractor");
  console.log("─".repeat(56));

  if (!state.originalCv) {
    throw new Error(
      "github_extractor: state.originalCv is empty. Run pdf_parser first.",
    );
  }

  // ── Extract URL from text ─────────────────────────────────────────────────
  const extracted = extractFromText(state.originalCv);

  if (!extracted) {
    console.log("[github_extractor] No GitHub URL found in CV — skipping.");
    return {
      githubUrl: null,
      githubUsername: null,
      githubUrlFound: false,
      hasGithub: false,
      githubProfile: null,
    };
  }

  console.log(
    `[github_extractor] Found: ${extracted.url} → username: ${extracted.username}`,
  );

  // ── Fetch profile ─────────────────────────────────────────────────────────
  try {
    const githubProfile = await fetchGithubProfile(extracted.username);
    console.log(
      `[github_extractor] Profile fetched. ` +
        `Languages: ${githubProfile.languages.join(", ")} | ` +
        `Projects: ${githubProfile.topProjects.join(", ")}`,
    );
    return {
      githubUrl: extracted.url,
      githubUsername: extracted.username,
      githubUrlFound: true,
      hasGithub: true,
      githubProfile,
    };
  } catch (err: unknown) {
    const status = (err as { status?: number }).status;
    const message = (err as Error).message ?? String(err);

    if (status === 403 || status === 429) {
      console.warn(
        `[github_extractor] Rate limit hit (HTTP ${status}) — skipping profile. Set GITHUB_TOKEN.`,
      );
    } else if (status === 404) {
      console.warn(
        `[github_extractor] Profile not found or private: ${extracted.username}`,
      );
    } else {
      console.warn(`[github_extractor] Fetch failed — ${message}`);
    }

    return {
      githubUrl: extracted.url,
      githubUsername: extracted.username,
      githubUrlFound: true,  // URL was found — fetch just failed
      hasGithub: false,
      githubProfile: null,
    };
  }
}
