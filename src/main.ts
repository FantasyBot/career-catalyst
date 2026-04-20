/**
 * Career Catalyst — entry point
 *
 * Usage:
 *   npx tsx src/main.ts <cv> <target-role>
 *
 * <cv> can be either:
 *   • An absolute or relative path to a .pdf file
 *   • A plain-text string containing the CV content
 *
 * Environment variables (all required unless noted):
 *   OPENAI_API_KEY      — OpenAI API key
 *   TAVILY_API_KEY      — Tavily search API key
 *   GITHUB_TOKEN        — (optional) raises GitHub API rate limit from 60 → 5000 req/hr
 *
 * Output (one folder per session):
 *   ./output/<sessionId>/learning_roadmap.md  — skill gap learning plan (when cvScore < 90)
 *   ./output/<sessionId>/<Company>.json       — interview guide per job match
 *   Prints a structured summary of every pipeline stage to stdout
 */

import "dotenv/config";

import fs from "node:fs/promises";
import path from "node:path";
import { awaitAllCallbacks } from "@langchain/core/callbacks/promises";
import { graph } from "./graph.js";
import type { GraphStateType } from "./state.js";

// ─── Env validation ────────────────────────────────────────────────────────────

function requireEnv(name: string): string {
  const val = process.env[name];
  if (!val) {
    console.error(`\n  ERROR: Environment variable ${name} is not set.\n`);
    process.exit(1);
  }
  return val;
}

requireEnv("OPENAI_API_KEY");
requireEnv("TAVILY_API_KEY");

if (!process.env.GITHUB_TOKEN) {
  console.warn(
    "  WARN: GITHUB_TOKEN not set — GitHub API rate limit is 60 req/hr. " +
      "Set it to raise the limit to 5000 req/hr.\n",
  );
}

const tracingEnabled =
  process.env.LANGSMITH_TRACING === "true" ||
  process.env.LANGCHAIN_TRACING_V2 === "true";
const tracingKey = process.env.LANGSMITH_API_KEY ?? process.env.LANGCHAIN_API_KEY;
if (tracingEnabled && !tracingKey) {
  console.warn(
    "  WARN: LangSmith tracing is enabled but no API key is set — tracing will fail.\n",
  );
}

// ─── CLI args ──────────────────────────────────────────────────────────────────

const [, , cvInput, targetRole] = process.argv;

if (!cvInput || !targetRole) {
  console.error("Usage: npx tsx src/main.ts <cv-path-or-text> <target-role>\n");
  process.exit(1);
}

// ─── Run ──────────────────────────────────────────────────────────────────────

const threadId = `cc-${Date.now()}`;
const sessionDir = path.resolve("output", threadId);

// Create the session folder before the graph starts so parallel workers
// can write into it without racing to create it themselves.
await fs.mkdir(sessionDir, { recursive: true });
console.log("\n" + "═".repeat(64));
console.log("  Career Catalyst");
console.log("═".repeat(64));
console.log(`  Session : ${threadId}`);
console.log(`  Output  : ${sessionDir}`);
console.log(`  Role    : ${targetRole}`);
console.log(
  `  CV      : ${cvInput.length > 60 ? cvInput.slice(0, 57) + "..." : cvInput}`,
);
console.log("═".repeat(64) + "\n");

const initialState: Partial<GraphStateType> = {
  sessionId: threadId,
  originalCv: cvInput,
  targetRole,
};

let result: GraphStateType;

try {
  result = await graph.invoke(initialState, {
    configurable: { thread_id: threadId },
    runName: `career-catalyst / ${targetRole}`,
    metadata: { sessionId: threadId, targetRole },
    tags: ["cli", "career-catalyst"],
  });
} catch (err) {
  console.error("\n  FATAL: graph execution failed.");
  console.error((err as Error).message);
  await awaitAllCallbacks();
  process.exit(1);
}

// ─── Summary ──────────────────────────────────────────────────────────────────

console.log("\n" + "─".repeat(64));
console.log("  Pipeline Summary");
console.log("─".repeat(64));

console.log(`  CV score       : ${result.cvScore}/100`);
console.log(
  `  GitHub URL     : ${result.githubUrlFound ? result.githubUrl : "not found"}`,
);
console.log(
  `  GitHub profile : ${result.hasGithub ? "fetched" : result.githubUrlFound ? "fetch failed" : "not found"}`,
);

if (result.githubProfile) {
  console.log(
    `  GitHub langs   : ${result.githubProfile.languages.slice(0, 5).join(", ")}`,
  );
  console.log(
    `  GitHub repos   : ${result.githubProfile.topProjects.slice(0, 3).join(", ")}`,
  );
}

console.log(`  Market reqs    : ${result.marketRequirements.length} items`);
console.log(`  Skill gaps     : ${result.skillGaps.length} identified`);
if (result.learningRoadmap) {
  console.log(
    `  Roadmap        : ${path.join(sessionDir, "learning_roadmap.md")}`,
  );
} else {
  console.log(`  Roadmap        : none (CV score >= 90, no gaps found)`);
}
console.log(`  Job matches    : ${result.jobMatches.length}`);

if (result.jobMatches.length > 0) {
  result.jobMatches.forEach((m, i) => {
    console.log(`    ${i + 1}. ${m.title} @ ${m.company}`);
    console.log(`       ${m.url}`);
  });
}

console.log(`  Interview guides: ${result.interviewGuides.length}`);
if (result.interviewGuides.length > 0) {
  result.interviewGuides.forEach((g) => {
    const general = g.questionBank.filter((q) => q.type === "General").length;
    const personal = g.questionBank.filter((q) => q.type === "Personal").length;
    console.log(
      `    • ${g.company}: ${general} General + ${personal} Personal questions`,
    );
  });
}

console.log("─".repeat(64) + "\n");

// Flush any pending LangSmith traces before the process exits.
await awaitAllCallbacks();
