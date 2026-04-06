/**
 * Node: cv_enhancer  (Step 5 — "CV Expert")
 *
 * Two-phase pipeline:
 *
 *   Phase 1 — Critic
 *     Compares originalCv + githubProfile against marketRequirements.
 *     Produces a cvScore (0-100), a critique, and a list of GitHub-discovered
 *     strengths that were absent or weak in the original CV.
 *
 *   Phase 2 — Rewriter  (only when cvScore < 90)
 *     Uses the critic's notes to produce an improved CV in Markdown.
 *     GitHub strengths are woven in naturally — not bolted on.
 *     When cvScore >= 90 the original text is passed through unchanged.
 *
 * Output slice: { improvedCv, cvScore }
 */

import { ChatAnthropic } from "@langchain/anthropic";
import { HumanMessage, SystemMessage } from "@langchain/core/messages";
import { z } from "zod";
import type { GraphStateType } from "../state.js";

// ─── Schemas ───────────────────────────────────────────────────────────────────

const CriticOutputSchema = z.object({
  cvScore: z
    .number()
    .int()
    .min(0)
    .max(100)
    .describe(
      "ATS + quality score: 0 = unfit, 100 = perfect. " +
        "Deduct points for missing market requirements, weak language, poor structure.",
    ),
  critiqueNotes: z
    .string()
    .describe(
      "Detailed critique: what is strong, what is weak, which market requirements " +
        "are missing, how well the CV demonstrates impact vs. just listing duties.",
    ),
  githubStrengthsToHighlight: z
    .array(z.string())
    .describe(
      "Specific GitHub-evidenced strengths (project names, languages, patterns) " +
        "that are absent or under-represented in the original CV and should be added.",
    ),
});

const RewriterOutputSchema = z.object({
  improvedCv: z
    .string()
    .min(300)
    .describe(
      "Full CV rewritten in Markdown. Must include: summary, skills, experience, " +
        "projects. GitHub strengths must be woven in naturally — not appended as a list.",
    ),
});

// ─── Models ───────────────────────────────────────────────────────────────────

// Sonnet for both passes — critic reasoning and rewrite quality both matter
const llm = new ChatAnthropic({ model: "claude-sonnet-4-6", temperature: 0.1 });
const critic = llm.withStructuredOutput(CriticOutputSchema, {
  name: "cv_critic",
});
const rewriter = llm.withStructuredOutput(RewriterOutputSchema, {
  name: "cv_rewriter",
});

// ─── Phase 1: Critic ───────────────────────────────────────────────────────────

async function runCritic(state: GraphStateType) {
  const githubContext = state.githubProfile
    ? [
        `GitHub languages: ${state.githubProfile.languages.join(", ")}`,
        `Top projects: ${state.githubProfile.topProjects.join(", ")}`,
        `GitHub summary: ${state.githubProfile.summary}`,
      ].join("\n")
    : "No GitHub profile available.";

  const messages = [
    new SystemMessage(
      "You are a brutally honest senior technical recruiter and CV coach. " +
        "Your job is to score a CV strictly against market requirements for the target role. " +
        "Score generously only when evidence is concrete and measurable. " +
        "Identify every GitHub-evidenced strength that the CV fails to showcase.",
    ),
    new HumanMessage(
      `## Target Role\n${state.targetRole}\n\n` +
        `## Market Requirements\n${state.marketRequirements.map((r) => `- ${r}`).join("\n")}\n\n` +
        `## GitHub Profile\n${githubContext}\n\n` +
        `## Original CV\n${state.originalCv}`,
    ),
  ];

  return critic.invoke(messages);
}

// ─── Phase 2: Rewriter ─────────────────────────────────────────────────────────

async function runRewriter(
  state: GraphStateType,
  critiqueNotes: string,
  githubStrengths: string[],
) {
  const strengthBlock =
    githubStrengths.length > 0
      ? `GitHub-evidenced strengths to incorporate:\n${githubStrengths.map((s) => `• ${s}`).join("\n")}`
      : "No additional GitHub strengths to incorporate.";

  const messages = [
    new SystemMessage(
      "You are an expert CV writer specialising in tech roles. " +
        "Rewrite the candidate's CV in clean Markdown. Rules:\n" +
        "1. Preserve every factual claim from the original — never invent experience.\n" +
        "2. Strengthen language: replace duty-lists with impact statements (numbers, outcomes).\n" +
        "3. Weave GitHub-evidenced strengths into the relevant experience/projects sections " +
        "   naturally — do not create a separate 'GitHub' section.\n" +
        "4. Ensure all required market skills appear where genuinely supported by evidence.\n" +
        "5. Structure: Summary → Core Skills → Experience → Projects → Education.\n" +
        "6. Output only the CV Markdown — no preamble, no commentary.",
    ),
    new HumanMessage(
      `## Target Role\n${state.targetRole}\n\n` +
        `## Market Requirements\n${state.marketRequirements.map((r) => `- ${r}`).join("\n")}\n\n` +
        `## Critic Notes\n${critiqueNotes}\n\n` +
        `## ${strengthBlock}\n\n` +
        `## Original CV\n${state.originalCv}`,
    ),
  ];

  return rewriter.invoke(messages);
}

// ─── Node ─────────────────────────────────────────────────────────────────────

export async function cvEnhancerNode(
  state: GraphStateType,
): Promise<Partial<GraphStateType>> {
  if (!state.originalCv) {
    throw new Error(
      "cv_enhancer: state.originalCv is empty. Run pdf_parser first.",
    );
  }
  if (state.marketRequirements.length === 0) {
    throw new Error(
      "cv_enhancer: marketRequirements is empty. Run market_scout first.",
    );
  }

  // ── Phase 1: Score and critique ────────────────────────────────────────────
  console.log("[cv_enhancer] Phase 1 — running critic...");
  const critique = await runCritic(state);
  const { cvScore, critiqueNotes, githubStrengthsToHighlight } =
    CriticOutputSchema.parse(critique);

  console.log(
    `[cv_enhancer] CV score: ${cvScore}/100 | ` +
      `GitHub strengths to add: ${githubStrengthsToHighlight.length}`,
  );

  if (cvScore >= 90) {
    console.log(
      `[cv_enhancer] Score ${cvScore} >= 90 — CV meets bar, skipping rewrite.`,
    );
    return { cvScore, improvedCv: state.originalCv };
  }

  // ── Phase 2: Rewrite ───────────────────────────────────────────────────────
  console.log(
    `[cv_enhancer] Score ${cvScore} < 90 — rewriting CV with ${githubStrengthsToHighlight.length} GitHub strengths...`,
  );
  const rewrite = await runRewriter(
    state,
    critiqueNotes,
    githubStrengthsToHighlight,
  );
  const { improvedCv } = RewriterOutputSchema.parse(rewrite);

  console.log(
    `[cv_enhancer] Rewrite complete. Length: ${improvedCv.length} chars.`,
  );

  return { cvScore, improvedCv };
}
