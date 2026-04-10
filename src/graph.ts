/**
 * graph.ts — Career Catalyst LangGraph assembly
 *
 * Full pipeline (all nodes implemented):
 * pdf_parser          → github_extractor → market_scout
 * market_scout        → cv_enhancer
 * cv_enhancer         → (cond) → skill_gap_analyser | job_hunter
 * skill_gap_analyser  → job_hunter
 * job_hunter          → (fan-out via Send API) → generate_single_guide
 * generate_single_guide → END
 */

import { StateGraph, END } from "@langchain/langgraph";
import { MemorySaver } from "@langchain/langgraph";
import { GraphState, type GraphStateType } from "./state.js";
import { pdfParserNode } from "./nodes/pdf_parser.js";
import { githubExtractorNode } from "./nodes/github_extractor.js";
import { marketScoutNode } from "./nodes/market_scout.js";
import { cvEnhancerNode } from "./nodes/cv_enhancer.js";
import { skillGapAnalyserNode } from "./nodes/skill_gap_analyser.js";
import { jobHunterNode } from "./nodes/job_hunter.js";
import {
  architectRouterNode,
  generateSingleGuideNode,
} from "./nodes/interview_architect.js";

// ─── Conditional router ────────────────────────────────────────────────────────

/**
 * After cv_enhancer:
 * cvScore < 90 → skill_gap_analyser  (gaps found; identify them + build roadmap)
 * cvScore >= 90 → job_hunter         (CV meets bar; skip gap analysis)
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

    // ── Step 2: Extract GitHub link + fetch profile (single node) ───────────
    .addNode("github_extractor", githubExtractorNode)

    // ── Step 3: Market research (3 dynamic Tavily queries) ──────────────────
    .addNode("market_scout", marketScoutNode)

    // ── Step 4: Score + rewrite CV (Critic → Rewriter when score < 90) ──────
    .addNode("cv_enhancer", cvEnhancerNode)

    // ── Step 5: Detect skill gaps + build learning roadmap ──────────────────
    .addNode("skill_gap_analyser", skillGapAnalyserNode)

    // ── Step 6: Find 3 live job matches (Tavily, days=30) ───────────────────
    .addNode("job_hunter", jobHunterNode)

    // ── Step 7: Build one 30-question guide per job match (parallel worker) ─
    .addNode("generate_single_guide", generateSingleGuideNode)

    // ── Edges ────────────────────────────────────────────────────────────────
    .addEdge("__start__", "pdf_parser")
    .addEdge("pdf_parser", "github_extractor")
    .addEdge("github_extractor", "market_scout")
    .addEdge("market_scout", "cv_enhancer")

    // [Conditional] CV score < 90 → gap analysis + roadmap; >= 90 → skip ahead
    .addConditionalEdges("cv_enhancer", routeAfterCvEnhancer, {
      skill_gap_analyser: "skill_gap_analyser",
      job_hunter: "job_hunter",
    })

    // Both CV paths converge at job_hunter
    .addEdge("skill_gap_analyser", "job_hunter")

    // [Conditional Fan-Out] job_hunter routes directly to parallel workers!
    // We pass our architectRouterNode function here, which returns the Send[] array.
    .addConditionalEdges("job_hunter", architectRouterNode)

    // Each parallel worker node just goes to END when it finishes.
    .addEdge("generate_single_guide", END);

  return workflow.compile({ checkpointer });
}

export const graph = buildGraph();
