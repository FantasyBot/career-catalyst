/**
 * Node: interview_architect  (Step 9)
 *
 * For each of the 3 jobMatches, produces one InterviewGuide containing:
 *
 *   Tier 1 — General Bank (20 questions, type: "General")
 *     Breakdown: 6 System Design · 7 Tech Stack · 4 Behavioural · 3 Role Specific
 *     Model answers reference industry best practices and the company's known stack.
 *     Also produces the hiring spec (interview stages, culture, panel structure).
 *
 *   Tier 2 — Personal Deep-Dive (10 questions, type: "Personal")
 *     Every question is anchored to a real artefact in the candidate's history:
 *       - GitHub: specific repo, library choice, architecture decision
 *       - CV: named achievement, promoted metric, specific project outcome
 *     Model answers coach the candidate to connect their past to this company's context.
 *
 * Each question has: type · question · modelAnswer · category · relevantSkills[]
 * Total per guide: exactly 30 questions (enforced by InterviewGuideSchema.length(30)).
 *
 * Processing: sequential across 3 matches to avoid rate-limit bursts.
 * 2 LLM calls per match (6 total): general+spec, then personal.
 *
 * Output slice: { interviewGuides }
 */

import { ChatOpenAI } from "@langchain/openai";
import { HumanMessage, SystemMessage } from "@langchain/core/messages";
import { z } from "zod";
import {
  InterviewQuestionSchema,
  InterviewGuideSchema,
  type InterviewGuide,
  type JobMatch,
  type GraphStateType,
} from "../state.js";

// ─── Per-call schemas ─────────────────────────────────────────────────────────
//
// We split generation into two focused calls per job match so each prompt
// stays within a clear scope — the LLM produces tighter, more specific output.

const GeneralBankOutputSchema = z.object({
  spec: z
    .string()
    .min(80)
    .describe(
      "Hiring spec for this specific company: known interview stages (phone screen, " +
        "take-home, system design, culture/values), panel makeup, what they weight most, " +
        "and any publicly known culture signals (e.g. Amazon LPs, Google's googliness).",
    ),
  questions: z
    .array(InterviewQuestionSchema)
    .length(20)
    .describe(
      "Exactly 20 General questions. Distribution: " +
        "6 System Design · 7 Tech Stack · 4 Behavioural · 3 Role Specific. " +
        "All type='General'.",
    ),
});

const PersonalBankOutputSchema = z.object({
  questions: z
    .array(InterviewQuestionSchema)
    .length(10)
    .describe(
      "Exactly 10 Personal Deep-Dive questions. All type='Personal', " +
        "category='Personal Deep-Dive'. Each question must reference a specific " +
        "project name, library, metric, or achievement from the candidate's actual history.",
    ),
});

// ─── Model ────────────────────────────────────────────────────────────────────

const llm = new ChatOpenAI({
  model: "gpt-4o",
  temperature: 0.4, // slight creativity for question variety; answers stay precise
  maxTokens: 8192, // generous — 30 full Q+A pairs need room
});

const generalLlm = llm.withStructuredOutput(GeneralBankOutputSchema, {
  name: "general_bank_output",
});
const personalLlm = llm.withStructuredOutput(PersonalBankOutputSchema, {
  name: "personal_bank_output",
});

// ─── Context builders ─────────────────────────────────────────────────────────

function buildJobContext(match: JobMatch): string {
  return [
    `Company : ${match.company}`,
    `Role    : ${match.title}`,
    `Posting : ${match.url}`,
    `Summary : ${match.description}`,
  ].join("\n");
}

function buildCandidateContext(state: GraphStateType): string {
  const sections: string[] = [];

  if (state.githubProfile) {
    sections.push(
      "── GitHub Profile ──",
      `Languages  : ${state.githubProfile.languages.join(", ")}`,
      `Top Repos  : ${state.githubProfile.topProjects.join(", ")}`,
      `Summary    : ${state.githubProfile.summary}`,
    );
  } else {
    sections.push("── GitHub Profile ──", "(not available)");
  }

  const cvSnippet = (state.improvedCv ?? state.originalCv ?? "").slice(
    0,
    3_500,
  );
  sections.push("", "── CV (truncated to 3500 chars) ──", cvSnippet);

  return sections.join("\n");
}

// ─── Tier 1: General bank + hiring spec ───────────────────────────────────────

async function generateGeneralBank(
  state: GraphStateType,
  match: JobMatch,
): Promise<z.infer<typeof GeneralBankOutputSchema>> {
  const messages = [
    new SystemMessage(
      "You are a Principal Engineer and technical interview coach with 15 years of " +
        "experience conducting and preparing candidates for interviews at top tech companies.\n\n" +
        "Generate exactly 20 interview questions (type='General') for the given role and company.\n\n" +
        "Required distribution:\n" +
        "  • 6 × System Design   — architecture, scalability, trade-offs, data modelling\n" +
        "  • 7 × Tech Stack      — specific language/framework internals, e.g. 'Explain the " +
        "    Event Loop in Node.js', 'How does React reconciliation work?'\n" +
        "  • 4 × Behavioural     — STAR-format scenarios testing ownership, conflict, failure\n" +
        "  • 3 × Role Specific   — questions unique to this company's domain/product\n\n" +
        "For every question:\n" +
        "  - modelAnswer must be 3-6 sentences: a strong answer a senior candidate would give\n" +
        "  - relevantSkills must list 2-4 specific skills being assessed\n" +
        "  - category must match the distribution above\n" +
        "  - type must be 'General'\n\n" +
        "Also produce a hiring spec covering: known interview stages at this company, " +
        "panel structure, culture signals, and what the company weights most heavily.",
    ),
    new HumanMessage(
      `## Target Role & Company\n${buildJobContext(match)}\n\n` +
        `## Market Requirements for this Role\n` +
        state.marketRequirements.map((r) => `- ${r}`).join("\n"),
    ),
  ];

  return generalLlm.invoke(messages);
}

// ─── Tier 2: Personal deep-dive questions ─────────────────────────────────────

async function generatePersonalBank(
  state: GraphStateType,
  match: JobMatch,
): Promise<z.infer<typeof PersonalBankOutputSchema>> {
  const candidateContext = buildCandidateContext(state);

  // Build an explicit list of "anchors" for the LLM to reference.
  // This forces specificity and prevents generic personal questions.
  const githubAnchors =
    state.githubProfile && state.githubProfile.topProjects.length > 0
      ? state.githubProfile.topProjects
          .slice(0, 5)
          .map((p) => `• GitHub repo: "${p}"`)
          .join("\n")
      : "• (no GitHub repos available — anchor questions to CV achievements only)";

  const messages = [
    new SystemMessage(
      "You are a technical lead at a top-tier company who has just finished reading " +
        "this candidate's CV and GitHub profile in detail. You are conducting a " +
        "rigorous technical interview — not a generic one.\n\n" +
        "Generate exactly 10 Personal Deep-Dive questions (type='Personal', " +
        "category='Personal Deep-Dive').\n\n" +
        "Every single question MUST reference something real from the candidate's history:\n" +
        "  • GitHub: name the specific repo, the specific library/pattern/architecture choice\n" +
        "    e.g. 'In your [repo] project, I see you used [LibraryX] — why that over [AltY]?'\n" +
        "  • CV: name the specific achievement, metric, or project\n" +
        "    e.g. 'You reduced latency by 40% at [Company] — how would you apply that approach\n" +
        "    to [specific problem] we have at [Target Company]?'\n\n" +
        "The questions must feel like a technical lead who has actually read the code is asking them.\n\n" +
        "modelAnswer: coach the candidate on how to answer well — what specifics to mention, " +
        "how to connect their past experience to this company's context.\n" +
        "relevantSkills: 2-4 skills being evaluated.\n\n" +
        "Available anchors for your questions:\n" +
        githubAnchors,
    ),
    new HumanMessage(
      `## Target Company\n${buildJobContext(match)}\n\n` +
        `## Candidate Profile\n${candidateContext}`,
    ),
  ];

  return personalLlm.invoke(messages);
}

// ─── Node ─────────────────────────────────────────────────────────────────────

export async function interviewArchitectNode(
  state: GraphStateType,
): Promise<Partial<GraphStateType>> {
  if (state.jobMatches.length === 0) {
    throw new Error(
      "interview_architect: jobMatches is empty. Run job_hunter first.",
    );
  }

  const interviewGuides: InterviewGuide[] = [];

  // Process matches sequentially — 2 LLM calls each, 6 total.
  // Sequential avoids rate-limit bursts on large structured outputs.
  for (const [i, match] of state.jobMatches.entries()) {
    console.log(
      `\n[interview_architect] ── Match ${i + 1}/${state.jobMatches.length}: ` +
        `${match.title} @ ${match.company}`,
    );

    // ── Tier 1: General bank (20 Qs) + hiring spec ──────────────────────────
    console.log(
      `[interview_architect]   Tier 1 — generating 20 General questions + hiring spec...`,
    );
    const generalResult = GeneralBankOutputSchema.parse(
      await generateGeneralBank(state, match),
    );
    console.log(
      `[interview_architect]   Tier 1 done. ` +
        `Spec length: ${generalResult.spec.length} chars. ` +
        `Questions: ${generalResult.questions.length}`,
    );

    // ── Tier 2: Personal deep-dive (10 Qs) ──────────────────────────────────
    console.log(
      `[interview_architect]   Tier 2 — generating 10 Personal deep-dive questions...`,
    );
    const personalResult = PersonalBankOutputSchema.parse(
      await generatePersonalBank(state, match),
    );
    console.log(
      `[interview_architect]   Tier 2 done. Questions: ${personalResult.questions.length}`,
    );

    // ── Assemble + validate the full guide ───────────────────────────────────
    const guide: InterviewGuide = InterviewGuideSchema.parse({
      company: match.company,
      spec: generalResult.spec,
      questionBank: [...generalResult.questions, ...personalResult.questions],
    });

    // Sanity checks — belt-and-braces beyond Zod
    const generalCount = guide.questionBank.filter(
      (q) => q.type === "General",
    ).length;
    const personalCount = guide.questionBank.filter(
      (q) => q.type === "Personal",
    ).length;
    console.log(
      `[interview_architect]   Guide validated: ` +
        `${generalCount} General + ${personalCount} Personal = ${guide.questionBank.length} total`,
    );

    interviewGuides.push(guide);
  }

  console.log(
    `\n[interview_architect] Complete. ${interviewGuides.length} guides built for: ` +
      interviewGuides.map((g) => g.company).join(", "),
  );

  return { interviewGuides };
}
