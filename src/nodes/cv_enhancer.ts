/**
 * Node: cv_analyzer  (Step 4 — "CV Scorer")
 *
 * Scores the candidate's CV against market requirements and their GitHub profile.
 * Produces a cvScore (0–100) and a detailed critique.
 *
 * The score drives routing in graph.ts:
 *   cvScore >= 90 → job_hunter   (strong match — proceed to job hunting)
 *   cvScore <  90 → skill_gap_analyser (gaps found — go to learning phase)
 *
 * No CV rewriting is performed. The original CV is preserved as-is.
 *
 * Output slice: { cvScore }
 */

import { ChatOpenAI } from "@langchain/openai";
import { HumanMessage, SystemMessage } from "@langchain/core/messages";
import { z } from "zod";
import type { GraphStateType } from "../state.js";

// ─── Schema ────────────────────────────────────────────────────────────────────

const CriticOutputSchema = z.object({
  cvScore: z
    .number()
    .int()
    .min(0)
    .max(100)
    .describe(
      "ATS + skills match score: 0 = completely unfit, 100 = perfect match. " +
        "Deduct heavily for missing market requirements. " +
        "Score generously only when skills are concrete and evidenced.",
    ),
  critiqueNotes: z
    .string()
    .describe(
      "Detailed analysis: which market requirements are covered, which are missing, " +
        "how well the GitHub profile supports the role, overall readiness verdict.",
    ),
});

// ─── Model ─────────────────────────────────────────────────────────────────────

const llm = new ChatOpenAI({ model: "gpt-4o", temperature: 0.1 });
const critic = llm.withStructuredOutput(CriticOutputSchema, {
  name: "cv_critic",
});

// ─── Scorer ────────────────────────────────────────────────────────────────────

async function scoreCV(state: GraphStateType) {
  const githubContext = state.githubProfile
    ? [
        `GitHub languages: ${state.githubProfile.languages.join(", ")}`,
        `Top projects: ${state.githubProfile.topProjects.join(", ")}`,
        `GitHub summary: ${state.githubProfile.summary}`,
      ].join("\n")
    : "No GitHub profile available.";

  const messages = [
    new SystemMessage(
      "You are a senior technical recruiter performing a readiness assessment. " +
        "Score the candidate's CV and GitHub profile against the market requirements " +
        "for the target role. Be strict — only award high scores when skills are " +
        "clearly evidenced. Your score determines whether the candidate is ready " +
        "to apply (≥ 90) or needs a learning phase (< 90).",
    ),
    new HumanMessage(
      `## Target Role\n${state.targetRole}\n\n` +
        `## Market Requirements\n${state.marketRequirements.map((r) => `- ${r}`).join("\n")}\n\n` +
        `## GitHub Profile\n${githubContext}\n\n` +
        `## CV\n${state.originalCv}`,
    ),
  ];

  return critic.invoke(messages);
}

// ─── Node ─────────────────────────────────────────────────────────────────────

export async function cvEnhancerNode(
  state: GraphStateType,
): Promise<Partial<GraphStateType>> {
  console.log("\n" + "─".repeat(56));
  console.log("  STEP 4/7  │  cv_analyzer");
  console.log("─".repeat(56));

  if (!state.originalCv) {
    throw new Error(
      "cv_analyzer: state.originalCv is empty. Run pdf_parser first.",
    );
  }
  if (state.marketRequirements.length === 0) {
    throw new Error(
      "cv_analyzer: marketRequirements is empty. Run market_scout first.",
    );
  }

  console.log("[cv_analyzer] Scoring CV against market requirements...");
  const result = CriticOutputSchema.parse(await scoreCV(state));

  console.log(`[cv_analyzer] Score: ${result.cvScore}/100`);
  console.log(`[cv_analyzer] Assessment: ${result.critiqueNotes}`);

  if (result.cvScore >= 90) {
    console.log(
      `[cv_analyzer] Score ${result.cvScore} >= 90 — strong match, proceeding to job hunting.`,
    );
  } else {
    console.log(
      `[cv_analyzer] Score ${result.cvScore} < 90 — routing to learning phase.`,
    );
  }

  return { cvScore: result.cvScore };
}
