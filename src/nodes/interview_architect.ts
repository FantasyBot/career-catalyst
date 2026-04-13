/**
 * Node & Router: interview_architect (Step 7)
 *
 * For each of the 3 jobMatches, produces one InterviewGuide containing:
 *
 * Tier 1 — General Bank (20 questions, type: "General")
 * Tier 2 — Personal Deep-Dive (10 questions, type: "Personal")
 *
 * Processing: parallel fan-out via LangGraph Send API.
 * architectRouterNode dispatches one generateSingleGuideNode worker per match.
 * Each worker makes 2 LLM calls (general+spec, then personal) concurrently across matches.
 *
 * Output slice: { interviewGuides } (merged by state reducer)
 */

import { ChatOpenAI } from "@langchain/openai";
import { HumanMessage, SystemMessage } from "@langchain/core/messages";
import { Send } from "@langchain/langgraph";
import { z } from "zod";
import fs from "fs";
import path from "path";
import {
  InterviewQuestionSchema,
  InterviewGuideSchema,
  type InterviewGuide,
  type JobMatch,
  type GithubProfile,
  type GraphStateType,
} from "../state.js";
import { invokeWithRetryAndFallback } from "../utils/retry.js";

// ─── Per-call schemas ─────────────────────────────────────────────────────────

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
    .min(15)
    .max(25)
    .describe(
      "Exactly 20 General questions. Distribution: " +
        "6 System Design · 7 Tech Stack · 4 Behavioural · 3 Role Specific. " +
        "All type='General'.",
    ),
});

const PersonalBankOutputSchema = z.object({
  questions: z
    .array(InterviewQuestionSchema)
    .min(5)
    .max(15)
    .describe(
      "Exactly 10 Personal Deep-Dive questions. All type='Personal', " +
        "category='Personal Deep-Dive'. Each question must reference a specific " +
        "project name, library, metric, or achievement from the candidate's actual history.",
    ),
});

// ─── Model ────────────────────────────────────────────────────────────────────

const llm = new ChatOpenAI({
  model: "gpt-4o",
  temperature: 0.4,
  maxTokens: 8192,
});

const generalLlm = llm.withStructuredOutput(GeneralBankOutputSchema, {
  name: "general_bank_output",
});
const personalLlm = llm.withStructuredOutput(PersonalBankOutputSchema, {
  name: "personal_bank_output",
});

// ─── Type-safe Send API payload ───────────────────────────────────────────────

/**
 * Explicit contract for the payload forwarded from architectRouterNode to each
 * generateSingleGuideNode worker via the LangGraph Send API.
 *
 * The Send API does NOT automatically inherit parent graph state — every field
 * the worker needs must be listed here. TypeScript enforces completeness at the
 * call site in architectRouterNode, preventing silent undefined errors downstream.
 */
interface GuideWorkerPayload {
  activeJobMatch: JobMatch;
  candidateContext: string;
  marketRequirements: string[];
  githubProfile: GithubProfile | null;
  originalCv: string;
  sessionId: string;
}

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

  const cvSnippet = (state.originalCv ?? "").slice(0, 3500);
  sections.push("", "── CV (truncated to 3500 chars) ──", cvSnippet);

  return sections.join("\n");
}

// ─── Tier 1: General bank + hiring spec ───────────────────────────────────────

async function generateGeneralBank(
  state: GraphStateType,
  match: JobMatch,
): Promise<z.infer<typeof GeneralBankOutputSchema>> {
  if (!state.marketRequirements) {
    throw new Error(
      "generateGeneralBank: marketRequirements is missing from state. " +
        "Ensure it is forwarded in the Send payload from architectRouterNode.",
    );
  }

  const messages: Array<SystemMessage | HumanMessage> = [
    new SystemMessage(
      "You are a Principal Engineer and technical interview coach with 15 years of " +
        "experience conducting and preparing candidates for interviews at top tech companies.\n\n" +
        "Generate exactly 20 interview questions (type='General') for the given role and company.\n\n" +
        "Required distribution:\n" +
        "  • 6 × System Design   — architecture, scalability, trade-offs, data modelling\n" +
        "  • 7 × Tech Stack      — specific language/framework internals\n" +
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

  return invokeWithRetryAndFallback(
    () => generalLlm.invoke(messages),
    (value) => GeneralBankOutputSchema.parse(value),
    messages,
    JSON.stringify(
      {
        spec: "string",
        questions: [
          {
            type: "General",
            question: "string",
            modelAnswer: "string",
            category:
              "System Design | Tech Stack | Behavioural | Role Specific",
            relevantSkills: ["string"],
          },
        ],
      },
      null,
      2,
    ) + "\n(questions must contain exactly 20 items)",
    { label: `Tier 1 — ${match.company}` },
  );
}

// ─── Tier 2: Personal deep-dive questions ─────────────────────────────────────

async function generatePersonalBank(
  state: GraphStateType,
  match: JobMatch,
): Promise<z.infer<typeof PersonalBankOutputSchema>> {
  const candidateContext =
    state.candidateContext || buildCandidateContext(state);

  const githubAnchors =
    state.githubProfile && state.githubProfile.topProjects.length > 0
      ? state.githubProfile.topProjects
          .slice(0, 5)
          .map((p) => `• GitHub repo: "${p}"`)
          .join("\n")
      : "• (no GitHub repos available — anchor questions to CV achievements only)";

  const messages: Array<SystemMessage | HumanMessage> = [
    new SystemMessage(
      "You are a technical lead at a top-tier company who has just finished reading " +
        "this candidate's CV and GitHub profile in detail. You are conducting a " +
        "rigorous technical interview — not a generic one.\n\n" +
        "Generate exactly 10 Personal Deep-Dive questions (type='Personal', " +
        "category='Personal Deep-Dive').\n\n" +
        "Every single question MUST reference something real from the candidate's history:\n" +
        "  • GitHub: name the specific repo, the specific library/pattern/architecture choice\n" +
        "  • CV: name the specific achievement, metric, or project\n\n" +
        "The questions must feel like a technical lead who has actually read the code is asking them.\n\n" +
        "modelAnswer: coach the candidate on how to answer well.\n" +
        "relevantSkills: 2-4 skills being evaluated.\n\n" +
        "Available anchors for your questions:\n" +
        githubAnchors,
    ),
    new HumanMessage(
      `## Target Company\n${buildJobContext(match)}\n\n` +
        `## Candidate Profile\n${candidateContext}`,
    ),
  ];

  return invokeWithRetryAndFallback(
    () => personalLlm.invoke(messages),
    (value) => PersonalBankOutputSchema.parse(value),
    messages,
    JSON.stringify(
      {
        questions: [
          {
            type: "Personal",
            question: "string",
            modelAnswer: "string",
            category: "Personal Deep-Dive",
            relevantSkills: ["string"],
          },
        ],
      },
      null,
      2,
    ) + "\n(questions must contain exactly 10 items)",
    { label: `Tier 2 — ${match.company}` },
  );
}

// ─── LangGraph Fan-Out Logic ──────────────────────────────────────────────────

/**
 * 1. The Router Edge
 * This is used as a conditional edge to fan-out to parallel workers.
 *
 * IMPORTANT: The Send API payload becomes the worker's ENTIRE state.
 * Parent graph state is NOT automatically inherited by worker nodes.
 * Every field the worker needs must be explicitly listed in GuideWorkerPayload
 * above — TypeScript will error here if any required field is missing.
 */
export function architectRouterNode(state: GraphStateType): Send[] {
  if (!state.jobMatches || state.jobMatches.length === 0) {
    throw new Error(
      "architect_router: jobMatches is empty. Run job_hunter first.",
    );
  }

  const candidateContext = buildCandidateContext(state);

  console.log("\n" + "─".repeat(56));
  console.log("  STEP 7/7  │  architect_router (parallel fan-out)");
  console.log("─".repeat(56));
  console.log(
    `[architect_router] Dispatching ${state.jobMatches.length} parallel guide jobs...`,
  );

  return state.jobMatches.map((match) => {
    // Typed intermediate — TypeScript enforces all required fields are present.
    const payload: GuideWorkerPayload = {
      activeJobMatch: match,
      candidateContext,
      marketRequirements: state.marketRequirements,
      githubProfile: state.githubProfile,
      originalCv: state.originalCv,
      sessionId: state.sessionId,
    };
    return new Send("generate_single_guide", payload);
  });
}

/**
 * 2. The Worker Node
 * This node processes a single job match triggered by the router.
 */
export async function generateSingleGuideNode(
  state: GraphStateType,
): Promise<Partial<GraphStateType>> {
  try {
    const match = state.activeJobMatch;
    if (!match) {
      throw new Error(
        "generate_single_guide: activeJobMatch is missing from Send payload.",
      );
    }

    console.log(
      `\n[generate_single_guide] Building guide for ${match.title} @ ${match.company}`,
    );

    const [generalResult, personalResult] = await Promise.all([
      generateGeneralBank(state, match),
      generatePersonalBank(state, match),
    ]);

    const guide: InterviewGuide = InterviewGuideSchema.parse({
      company: match.company,
      spec: generalResult.spec,
      questionBank: [...generalResult.questions, ...personalResult.questions],
    });

    const generalCount = guide.questionBank.filter(
      (q) => q.type === "General",
    ).length;
    const personalCount = guide.questionBank.filter(
      (q) => q.type === "Personal",
    ).length;

    console.log(
      `[generate_single_guide] Guide validated for ${match.company}: ` +
        `${generalCount} General + ${personalCount} Personal = ${guide.questionBank.length} total`,
    );

    const sessionDir = path.resolve("output", state.sessionId);
    const safeCompany = guide.company.replace(/[^A-Za-z0-9_-]/g, "_");

    // Guard against filename collisions if two jobs share the same company name.
    // Appends _2, _3, etc. rather than silently overwriting an existing file.
    let filename = path.join(sessionDir, `${safeCompany}.json`);
    let suffix = 2;
    while (fs.existsSync(filename)) {
      filename = path.join(sessionDir, `${safeCompany}_${suffix}.json`);
      suffix++;
    }

    fs.writeFileSync(filename, JSON.stringify(guide, null, 2));
    console.log(`[generate_single_guide] Saved → ${filename}`);

    return { interviewGuides: [guide] };
  } catch (error) {
    console.error("[generate_single_guide] Error:", error);
    throw error;
  }
}
