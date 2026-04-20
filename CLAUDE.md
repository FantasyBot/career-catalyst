# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Commands

```bash
npm run start          # Run the pipeline: tsx src/main.ts <cv-path-or-text> "<target-role>"
npm run dev            # Alias for start
npm run build          # Type-check and compile to dist/ (no executable artifacts)
```

No test suite exists — validation is manual via CLI with real API calls and a real CV file.

## Environment Variables

Copy `.env.example` to `.env` and fill in:
- `OPENAI_API_KEY` — required
- `TAVILY_API_KEY` — required
- `GITHUB_TOKEN` — optional; raises GitHub rate limit from 60 → 5000 req/hr

## Architecture

Career Catalyst is a LangGraph.js stateful pipeline. The graph definition lives in `src/graph.ts`, shared state types and Zod schemas in `src/state.ts`, and the 7 node implementations in `src/nodes/`.

### Pipeline Stages

1. **pdf_parser** — Extracts CV text from a PDF path or raw string. Uses a custom `pdf-parse` page renderer that appends PDF link annotation URLs as plain text, ensuring downstream regex-based GitHub URL detection always works.
2. **github_extractor** — Regex-finds a GitHub URL in the CV text, fetches the top 5 repos via Octokit, and summarizes the profile with `gpt-4o-mini`.
3. **market_scout** — Fires 3 parallel Tavily searches; aggregates snippets; uses `gpt-4o` structured output to extract 10–50 deduplicated market requirements.
4. **cv_enhancer** — Scores the CV 0–100 against market requirements using `gpt-4o`.
5. **skill_gap_analyser** *(conditional — only runs if CV score < 90)* — Detects skill gaps and writes a Markdown learning roadmap to `output/<sessionId>/learning_roadmap.md`.
6. **job_hunter** — Runs 3 parallel Tavily searches with a 30-day recency filter to find 3 live job matches.
7. **interview_architect** *(parallel fan-out)* — Uses LangGraph's `Send` API to dispatch one worker per job match concurrently. Each worker generates a 20–30 question bank and writes JSON to `output/<sessionId>/<Company>.json`.

### Key Patterns

**Conditional routing** after `cv_enhancer`: score < 90 goes to `skill_gap_analyser`, otherwise straight to `job_hunter`. Defined via `routeAfterCvEnhancer` in `graph.ts`.

**Parallel fan-out** in `interview_architect`: `architectRouterNode` returns an array of `Send` objects (one per job match). The `interviewGuides` state field uses an accumulating reducer `(prev, next) => [...prev, ...next]` so parallel worker results merge instead of overwriting. All other fields use replace semantics.

**`Send` API payload is explicit** — the `GuideWorkerPayload` interface in `interview_architect.ts` must list every field passed to workers; they do not inherit parent state.

**LLM retry + fallback** (`src/utils/retry.ts`): All LLM calls go through `invokeWithRetryAndFallback`. It retries structured output up to 3 times with 300ms exponential backoff, then falls back to `gpt-4o-mini` in raw JSON mode, extracting JSON from fenced blocks or `{ … }` substrings and validating with Zod.

**TypeScript module imports** must use `.js` extensions (e.g., `import { foo } from "./state.js"`). The project uses `"moduleResolution": "NodeNext"` and ES modules.

**Session IDs** (`cc-<timestamp>`) are created in `main.ts` and passed through state. The output folder is created upfront before parallel workers run to avoid race conditions.

**No dedicated logger** — all progress uses prefixed `console.log` calls like `[pdf_parser]`, `[market_scout]`, etc.
