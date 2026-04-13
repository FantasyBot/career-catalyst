/**
 * Node: skill_gap_analyser  (Step 5 — "Gap Detector")
 *
 * Only reached when cvScore < 90 (enforced by the conditional edge in graph.ts).
 *
 * Two-phase pipeline:
 *
 *   Phase 1 — Gap Detection
 *     Compares marketRequirements against Cv
 *     Classifies each missing item as a "Hard" skill (technical) or
 *     "Soft" skill (behavioural/process). Merges both into skillGaps[].
 *
 *   Phase 2 — Roadmap Generation  (only when gaps were found)
 *     Produces a Markdown learning roadmap with 3-5 prioritised topics,
 *     each with concrete resources (official docs, courses, books).
 *     When no gaps remain, learningRoadmap is set to null.
 *
 * Output slice: { skillGaps, learningRoadmap }
 */

import { ChatOpenAI } from "@langchain/openai";
import { HumanMessage, SystemMessage } from "@langchain/core/messages";
import { z } from "zod";
import type { GraphStateType } from "../state.js";

// ─── Schemas ───────────────────────────────────────────────────────────────────

const GapDetectorOutputSchema = z.object({
  hardSkillGaps: z
    .array(z.string())
    .describe(
      "Technical skills, tools, or frameworks from marketRequirements that are " +
        "absent or insufficiently demonstrated in the CV. E.g. 'Kubernetes', 'GraphQL'.",
    ),
  softSkillGaps: z
    .array(z.string())
    .describe(
      "Behavioural, process, or leadership competencies from marketRequirements " +
        "that are absent. E.g. 'Agile / Scrum', 'Stakeholder Communication'.",
    ),
  gapReasoning: z
    .string()
    .describe(
      "Brief explanation of why each category of gaps was identified — " +
        "reference specific sections of the CV.",
    ),
});

const ResourceSchema = z.object({
  name: z.string().describe("Resource title, e.g. 'Official Kubernetes Docs'"),
  url: z
    .string()
    .describe(
      "Canonical URL for the resource — use the real home page, not a search URL",
    ),
  type: z.enum(["docs", "course", "book", "tutorial", "practice"]),
});

const RoadmapTopicSchema = z.object({
  topic: z.string().describe("Skill or competency to learn"),
  priority: z.enum(["Critical", "High", "Medium"]),
  rationale: z
    .string()
    .describe("One sentence: why this gap matters for the target role"),
  resources: z.array(ResourceSchema).min(1).max(3),
});

const RoadmapOutputSchema = z.object({
  learningRoadmap: z
    .string()
    .describe(
      "Complete Markdown learning roadmap. Must contain 3-5 topics, each with " +
        "priority, rationale, and concrete resources with real URLs.",
    ),
});

// ─── Models ───────────────────────────────────────────────────────────────────

const llm = new ChatOpenAI({ model: "gpt-4o", temperature: 0.2 });
const gapDetector = llm.withStructuredOutput(GapDetectorOutputSchema, {
  name: "gap_detector",
});
const roadmapBuilder = llm.withStructuredOutput(RoadmapOutputSchema, {
  name: "roadmap_builder",
});

// ─── Helpers ───────────────────────────────────────────────────────────────────

/**
 * Render structured topic data into a clean Markdown roadmap string.
 * This is injected into the roadmap-builder prompt so the LLM can produce
 * the prose framing while we validate the structured data separately.
 */
function buildRoadmapPromptContext(
  gaps: { hard: string[]; soft: string[] },
  targetRole: string,
): string {
  const allGaps = [
    ...gaps.hard.map((g) => `[Hard] ${g}`),
    ...gaps.soft.map((g) => `[Soft] ${g}`),
  ];
  return (
    `Target role: ${targetRole}\n\n` +
    `Identified gaps:\n${allGaps.map((g) => `• ${g}`).join("\n")}`
  );
}

// ─── Phase 1: Gap Detection ────────────────────────────────────────────────────

async function detectGaps(state: GraphStateType) {
  const cvText = state.originalCv;

  const messages = [
    new SystemMessage(
      "You are a technical hiring manager doing a gap analysis. " +
        "Your task: given the market requirements and a candidate's CV, identify " +
        "ONLY skills that are genuinely absent or too weak to pass screening. " +
        "Do not flag skills that are clearly present even if not explicitly listed " +
        "(e.g. if the CV shows 5 years of React work, don't flag 'JavaScript'). " +
        "Be precise — false positives waste the candidate's time.",
    ),
    new HumanMessage(
      `## Target Role\n${state.targetRole}\n\n` +
        `## Market Requirements\n${state.marketRequirements.map((r) => `- ${r}`).join("\n")}\n\n` +
        `## Candidate CV\n${cvText}`,
    ),
  ];

  return gapDetector.invoke(messages);
}

// ─── Phase 2: Roadmap Generation ──────────────────────────────────────────────

async function generateRoadmap(
  state: GraphStateType,
  gaps: { hard: string[]; soft: string[] },
): Promise<string> {
  const context = buildRoadmapPromptContext(gaps, state.targetRole);

  const messages = [
    new SystemMessage(
      "You are a senior engineering mentor creating a personalised learning roadmap. " +
        "Rules:\n" +
        "1. Select 3-5 of the most impactful gaps — prioritise by hiring frequency.\n" +
        "2. For each topic, assign a priority (Critical / High / Medium).\n" +
        "3. Recommend 1-3 specific resources per topic: prefer official docs, " +
        "   well-known courses (Coursera, Udemy, Frontend Masters), or authoritative books.\n" +
        "4. Include real, canonical URLs — do not fabricate links.\n" +
        "5. Format as clean Markdown with headers for each topic.\n" +
        "6. Keep the whole roadmap actionable and achievable in 4-12 weeks.\n\n" +
        "Output format example:\n" +
        "# Learning Roadmap — <Role>\n\n" +
        "## 1. [Critical] Kubernetes\n" +
        "**Why it matters:** ...\n\n" +
        "**Resources:**\n" +
        "- [Official Kubernetes Docs](https://kubernetes.io/docs/) — docs\n" +
        "- [KodeKloud CKA Course](https://kodekloud.com/courses/cka/) — course\n",
    ),
    new HumanMessage(context),
  ];

  const result = await roadmapBuilder.invoke(messages);
  return RoadmapOutputSchema.parse(result).learningRoadmap;
}

// ─── Node ─────────────────────────────────────────────────────────────────────

export async function skillGapAnalyserNode(
  state: GraphStateType,
): Promise<Partial<GraphStateType>> {
  console.log("\n" + "─".repeat(56));
  console.log("  STEP 5/7  │  skill_gap_analyser");
  console.log("─".repeat(56));

  if (state.marketRequirements.length === 0) {
    throw new Error(
      "skill_gap_analyser: marketRequirements is empty. Run market_scout first.",
    );
  }

  const cvText = state.originalCv;
  if (!cvText) {
    throw new Error(
      "skill_gap_analyser: no CV text available. Run pdf_parser first.",
    );
  }

  // ── Phase 1: Detect gaps ───────────────────────────────────────────────────
  console.log("[skill_gap_analyser] Phase 1 — detecting skill gaps...");
  const rawGaps = await detectGaps(state);
  const { hardSkillGaps, softSkillGaps, gapReasoning } =
    GapDetectorOutputSchema.parse(rawGaps);

  const skillGaps = [...hardSkillGaps, ...softSkillGaps];

  console.log(
    `[skill_gap_analyser] Found ${hardSkillGaps.length} hard gaps, ` +
      `${softSkillGaps.length} soft gaps.`,
  );
  if (skillGaps.length > 0) {
    console.log(`[skill_gap_analyser] Gaps: ${skillGaps.join(", ")}`);
  }
  console.log(`[skill_gap_analyser] Reasoning: ${gapReasoning}`);

  if (skillGaps.length === 0) {
    console.log(
      "[skill_gap_analyser] No gaps found — skipping roadmap generation.",
    );
    return { skillGaps: [], learningRoadmap: null };
  }

  // ── Phase 2: Generate roadmap ──────────────────────────────────────────────
  console.log(
    `[skill_gap_analyser] Phase 2 — generating learning roadmap for ${skillGaps.length} gaps...`,
  );
  const learningRoadmap = await generateRoadmap(state, {
    hard: hardSkillGaps,
    soft: softSkillGaps,
  });

  console.log(
    `[skill_gap_analyser] Roadmap generated. Length: ${learningRoadmap.length} chars.`,
  );

  return { skillGaps, learningRoadmap };
}
