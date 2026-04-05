/**
 * graph.ts — Career Catalyst LangGraph assembly
 *
 * Full pipeline (all nodes implemented):
 *   pdf_parser          → link_extractor → (cond) → github_auditor | market_scout
 *   github_auditor      → market_scout
 *   market_scout        → cv_enhancer
 *   cv_enhancer         → (cond) → skill_gap_analyser | job_hunter
 *   skill_gap_analyser  → job_hunter
 *   job_hunter          → interview_architect
 *   interview_architect → report_generator
 *   report_generator    → END
 */

import { StateGraph, END } from "@langchain/langgraph";
import { MemorySaver } from "@langchain/langgraph";
import { GraphState, type GraphStateType } from "./state.js";
import { pdfParserNode } from "./nodes/pdf_parser.js";
import { linkExtractorNode } from "./nodes/link_extractor.js";
import { githubAuditorNode } from "./nodes/github_auditor.js";
import { marketScoutNode } from "./nodes/market_scout.js";
import { cvEnhancerNode } from "./nodes/cv_enhancer.js";
import { skillGapAnalyserNode } from "./nodes/skill_gap_analyser.js";
import { jobHunterNode } from "./nodes/job_hunter.js";
import { interviewArchitectNode } from "./nodes/interview_architect.js";
import { reportGeneratorNode } from "./nodes/report_generator.js";

// ─── Conditional routers ───────────────────────────────────────────────────────

/**
 * After link_extractor:
 *   hasGithub=true  → github_auditor
 *   hasGithub=false → market_scout  (skip GitHub entirely)
 *
 * github_auditor can also set hasGithub=false on API errors; downstream nodes
 * must always treat githubProfile as nullable.
 */
function routeAfterLinkExtractor(state: GraphStateType): string {
  return state.hasGithub ? "github_auditor" : "market_scout";
}

/**
 * After cv_enhancer:
 *   cvScore < 90 → skill_gap_analyser  (CV has gaps; identify them + build roadmap)
 *   cvScore >= 90 → job_hunter         (CV already meets bar; skip gap analysis)
 */
function routeAfterCvEnhancer(state: GraphStateType): string {
  return state.cvScore < 90 ? "skill_gap_analyser" : "job_hunter";
}

// ─── Graph construction ────────────────────────────────────────────────────────

export function buildGraph() {
  const checkpointer = new MemorySaver();

  const workflow = new StateGraph(GraphState)
    // ── Step 1: Parse the CV ────────────────────────────────────────────────
    .addNode("pdf_parser", pdfParserNode)

    // ── Step 2: Extract GitHub link ─────────────────────────────────────────
    .addNode("link_extractor", linkExtractorNode)

    // ── Step 3: Audit GitHub (only reached when hasGithub === true) ─────────
    .addNode("github_auditor", githubAuditorNode)

    // ── Step 4: Market research (3 dynamic Tavily queries) ──────────────────
    .addNode("market_scout", marketScoutNode)

    // ── Step 5: Score + rewrite CV (Critic → Rewriter when score < 90) ──────
    .addNode("cv_enhancer", cvEnhancerNode)

    // ── Step 6: Detect skill gaps + build learning roadmap ──────────────────
    .addNode("skill_gap_analyser", skillGapAnalyserNode)

    // ── Step 7: Find 3 live job matches (Tavily, days=30) ───────────────────
    .addNode("job_hunter", jobHunterNode)

    // ── Step 8: Build 30-question interview guides per job match ────────────
    .addNode("interview_architect", interviewArchitectNode)

    // ── Step 9: Render improved CV to PDF, encode as Base64 ─────────────────
    .addNode("report_generator", reportGeneratorNode)

    // ── Edges ────────────────────────────────────────────────────────────────
    .addEdge("__start__", "pdf_parser")
    .addEdge("pdf_parser", "link_extractor")

    // [Conditional 1] GitHub present → audit; absent → skip to market research
    .addConditionalEdges("link_extractor", routeAfterLinkExtractor, {
      github_auditor: "github_auditor",
      market_scout: "market_scout",
    })

    // Both GitHub paths converge at market_scout
    .addEdge("github_auditor", "market_scout")
    .addEdge("market_scout", "cv_enhancer")

    // [Conditional 2] CV score < 90 → gap analysis + roadmap; >= 90 → skip ahead
    .addConditionalEdges("cv_enhancer", routeAfterCvEnhancer, {
      skill_gap_analyser: "skill_gap_analyser",
      job_hunter: "job_hunter",
    })

    // Both CV paths converge at job_hunter, then flow to delivery phase
    .addEdge("skill_gap_analyser", "job_hunter")
    .addEdge("job_hunter", "interview_architect")
    .addEdge("interview_architect", "report_generator")
    .addEdge("report_generator", END);

  return workflow.compile({ checkpointer });
}

export const graph = buildGraph();
