# Career Catalyst

An AI-powered career transformation agent that analyses your CV, identifies skill gaps, finds live job matches, and generates personalised interview preparation guides — all in a single command.

Built with **LangGraph.js**, **OpenAI GPT-4o**, **Tavily**, the **GitHub API**, and **LangSmith** for observability.

---

## Table of Contents

- [Overview](#overview)
- [Pipeline](#pipeline)
- [Prerequisites](#prerequisites)
- [Installation](#installation)
- [Configuration](#configuration)
- [Usage](#usage)
- [Output](#output)
- [Pipeline Stages](#pipeline-stages)
- [Observability (LangSmith)](#observability-langsmith)
- [Project Structure](#project-structure)
- [Tech Stack](#tech-stack)
- [Troubleshooting](#troubleshooting)

---

## Overview

Career Catalyst runs a 7-step AI pipeline that takes your CV and a target job role as input and produces:

- A **CV score** (0–100) against live market requirements
- A **skill gap analysis** with classified hard and soft skill gaps
- A **personalised learning roadmap** (when gaps are found) with prioritised topics and real resources
- **3 live job matches** from the past 30 days
- A **30-question interview guide** per job match (20 general + 10 personal deep-dive questions), saved as JSON files in `./output/`

---

## Pipeline

```
┌─────────────────────────────────────────────────────────────┐
│                        INPUT                                 │
│           CV (PDF path or plain text) + Target Role         │
└─────────────────────┬───────────────────────────────────────┘
                      │
              ┌───────▼────────┐
              │  1. pdf_parser │  Extract + normalise CV text
              └───────┬────────┘
                      │
          ┌───────────▼──────────────┐
          │  2. github_extractor     │  Find GitHub URL → fetch top repos + languages
          └───────────┬──────────────┘
                      │
           ┌──────────▼──────────┐
           │  3. market_scout    │  3× Tavily searches → extract market requirements
           └──────────┬──────────┘
                      │
           ┌──────────▼──────────┐
           │  4. cv_enhancer     │  Score CV 0–100 vs market requirements
           └──────────┬──────────┘
                      │
           ┌──────────┴──────────┐
       score < 90            score ≥ 90
           │                     │
  ┌────────▼──────────┐          │
  │ 5. skill_gap_     │          │
  │    analyser       │          │
  │  Gap detection +  │          │
  │  learning roadmap │          │
  └────────┬──────────┘          │
           └──────────┬──────────┘
                      │
           ┌──────────▼──────────┐
           │  6. job_hunter      │  3× Tavily searches (days=30) → 3 live job matches
           └──────────┬──────────┘
                      │
          ┌───────────┼───────────┐
          │           │           │   (parallel fan-out via LangGraph Send API)
  ┌───────▼──┐ ┌──────▼───┐ ┌────▼──────┐
  │ 7a. guide│ │7b. guide │ │7c. guide  │  20 General + 10 Personal questions each
  │  Job  1  │ │  Job  2  │ │  Job  3   │
  └───────┬──┘ └──────┬───┘ └────┬──────┘
          └───────────┴───────────┘
                      │
┌─────────────────────▼───────────────────────────────────────┐
│                       OUTPUT                                 │
│   ./output/<sessionId>/learning_roadmap.md  (if gaps found) │
│   ./output/<sessionId>/<Company>.json       (one per job)   │
└─────────────────────────────────────────────────────────────┘
```

---

## Prerequisites

- **Node.js** v18 or higher
- **npm** v9 or higher
- API keys for:
  - [OpenAI](https://platform.openai.com/api-keys) — uses `gpt-4o` and `gpt-4o-mini`
  - [Tavily](https://app.tavily.com) — web search for market research and job hunting
  - [GitHub](https://github.com/settings/tokens) — optional, but strongly recommended
  - [LangSmith](https://smith.langchain.com) — optional, for tracing and observability

---

## Installation

```bash
# 1. Clone the repository
git clone https://github.com/your-username/career-catalyst.git
cd career-catalyst

# 2. Install dependencies
npm install
```

---

## Configuration

Copy the example env file and fill in your keys:

```bash
cp .env.example .env
```

Edit `.env`:

```env
OPENAI_API_KEY=sk-proj-...                                   # Required — OpenAI API key
TAVILY_API_KEY=tvly-...                                      # Required — Tavily search API key
GITHUB_TOKEN=ghp_...                                         # Optional but strongly recommended

# Optional — LangSmith tracing (see "Observability" section below)
LANGSMITH_TRACING=true
LANGSMITH_ENDPOINT=https://eu.api.smith.langchain.com        # Use https://api.smith.langchain.com for US workspaces
LANGSMITH_API_KEY=lsv2_pt_...
LANGSMITH_PROJECT=career-catalyst
```

### API Key Details

| Variable | Required | Purpose |
|----------|----------|---------|
| `OPENAI_API_KEY` | Yes | Powers all LLM calls (CV scoring, gap analysis, question generation) |
| `TAVILY_API_KEY` | Yes | Web search for market requirements and live job listings |
| `GITHUB_TOKEN` | No | Raises GitHub API rate limit from 60 → 5,000 req/hr. Without it, GitHub profile fetching may fail on the first run. No special scopes required. |
| `LANGSMITH_TRACING` | No | Set to `true` to enable LangSmith tracing of the entire pipeline |
| `LANGSMITH_ENDPOINT` | No | Region-specific API endpoint. Required for EU workspaces (`https://eu.api.smith.langchain.com`) |
| `LANGSMITH_API_KEY` | No | LangSmith API key. Personal Access Tokens (`lsv2_pt_...`) are recommended for local dev |
| `LANGSMITH_PROJECT` | No | Project name under which traces are grouped. Defaults to `default` if unset |

> **Note:** Ensure there are no leading or trailing spaces around your API key values in `.env`. Dotenv does not strip trailing whitespace from values, which will cause silent authentication failures.

---

## Usage

```bash
npx tsx src/main.ts <cv> "<target-role>"
```

### Arguments

| Argument | Description |
|----------|-------------|
| `<cv>` | Path to a PDF file (`.pdf`) **or** plain CV text pasted directly |
| `<target-role>` | The job title you are targeting, e.g. `"Senior Backend Engineer"` |

### Examples

**Using a PDF file:**
```bash
npx tsx src/main.ts ./my-cv.pdf "Senior Backend Engineer"
```

**Using a PDF with an absolute path:**
```bash
npx tsx src/main.ts /Users/you/Documents/cv.pdf "Staff Software Engineer"
```

**Using plain text (paste CV content directly):**
```bash
npx tsx src/main.ts "John Doe — 5 years experience in TypeScript, Node.js..." "Backend Engineer"
```

### Full Example Run

```
$ npx tsx src/main.ts ./cv.pdf "AI engineer"

════════════════════════════════════════════════════════════════
  Career Catalyst
════════════════════════════════════════════════════════════════
  Session : cc-1776092227780
  Output  : /path/to/career-catalyst/output/cc-1776092227780
  Role    : AI engineer
  CV      : ./cv.pdf
════════════════════════════════════════════════════════════════

────────────────────────────────────────────────────────
  STEP 1/7  │  pdf_parser
────────────────────────────────────────────────────────
[pdf_parser] Reading PDF from: ./cv.pdf
[pdf_parser] Extracted 2750 characters from PDF.

────────────────────────────────────────────────────────
  STEP 2/7  │  github_extractor
────────────────────────────────────────────────────────
[github_extractor] Found: https://github.com/FantasyBot → username: FantasyBot
[github_extractor] Profile fetched. Languages: TypeScript, HCL, Python, CSS, JavaScript, HTML
                   Projects: idea-validator, DailyBrief, terra_infrastructure_app, terra_client_app, terra_server_app

────────────────────────────────────────────────────────
  STEP 3/7  │  market_scout
────────────────────────────────────────────────────────
[market_scout] Running 3 Tavily searches for: "AI engineer"
  [1] essential skills and technologies for AI engineer 2026
  [2] AI engineer interview requirements and hiring criteria 2026
  [3] top frameworks tools and libraries AI engineer companies expect 2026
[market_scout] "AI engineer interview requirements and hiring criteria 2026" → 5 results
[market_scout] "essential skills and technologies for AI engineer 2026" → 5 results
[market_scout] "top frameworks tools and libraries AI engineer companies expect 2026" → 5 results
[market_scout] Aggregated 1567 words — sending to LLM for extraction.
[market_scout] Validated 23 market requirements. Top 5: Machine Learning, Data Analysis,
               Prompt Engineering, AI Workflow Automation, AI Agents

────────────────────────────────────────────────────────
  STEP 4/7  │  cv_analyzer
────────────────────────────────────────────────────────
[cv_analyzer] Scoring CV against market requirements...
[cv_analyzer] Score: 40/100
[cv_analyzer] Score 40 < 90 — routing to learning phase.

────────────────────────────────────────────────────────
  STEP 5/7  │  skill_gap_analyser
────────────────────────────────────────────────────────
[skill_gap_analyser] Phase 1 — detecting skill gaps...
[skill_gap_analyser] Found 23 hard gaps, 0 soft gaps.
[skill_gap_analyser] Gaps: Machine Learning, Data Analysis, Prompt Engineering, AI Workflow
                           Automation, AI Agents, TensorFlow, LangChain, LlamaIndex,
                           AWS SageMaker, Hugging Face, Streamlit, AI System Design Patterns,
                           LLM Frameworks, AI Orchestration, Semantic Kernel, AutoGen ...
[skill_gap_analyser] Phase 2 — generating learning roadmap for 23 gaps...
[skill_gap_analyser] Roadmap generated. Length: 2732 chars.
[skill_gap_analyser] Saved → /path/to/output/cc-1776092227780/learning_roadmap.md

────────────────────────────────────────────────────────
  STEP 6/7  │  job_hunter
────────────────────────────────────────────────────────
[job_hunter] Running 3 Tavily searches (days=30) for: "AI engineer"
[job_hunter] ""AI engineer" job opening hiring now 2026" → 5 results
[job_hunter] "AI engineer position available apply site:linkedin.com OR ..." → 5 results
[job_hunter] "AI engineer new job posting apply now 2026" → 5 results
[job_hunter] 15 raw results aggregated — extracting 3 matches via LLM.
[job_hunter] Validated 3 job matches:
  • Senior AI Engineer @ Remote People
  • AI Engineer (Contract) @ 10a Labs
  • AI Engineer @ Agency Within

────────────────────────────────────────────────────────
  STEP 7/7  │  architect_router (parallel fan-out)
────────────────────────────────────────────────────────
[architect_router] Dispatching 3 parallel guide jobs...
[generate_single_guide] Guide validated for Remote People: 20 General + 10 Personal = 30 total
[generate_single_guide] Saved → /path/to/output/cc-1776092227780/Remote_People.json
[generate_single_guide] Guide validated for 10a Labs: 19 General + 10 Personal = 29 total
[generate_single_guide] Saved → /path/to/output/cc-1776092227780/10a_Labs.json
[generate_single_guide] Guide validated for Agency Within: 19 General + 10 Personal = 29 total
[generate_single_guide] Saved → /path/to/output/cc-1776092227780/Agency_Within.json

────────────────────────────────────────────────────────────────
  Pipeline Summary
────────────────────────────────────────────────────────────────
  CV score       : 40/100
  GitHub URL     : https://github.com/FantasyBot
  GitHub profile : fetched
  GitHub langs   : TypeScript, HCL, Python, CSS, JavaScript
  GitHub repos   : idea-validator, DailyBrief, terra_infrastructure_app
  Market reqs    : 23 items
  Skill gaps     : 23 identified
  Roadmap        : /path/to/output/cc-1776092227780/learning_roadmap.md
  Job matches    : 3
    1. Senior AI Engineer @ Remote People
       https://job-boards.eu.greenhouse.io/remotepeople/jobs/4721961101
    2. AI Engineer (Contract) @ 10a Labs
       http://job-boards.greenhouse.io/10alabs/jobs/4136404009
    3. AI Engineer @ Agency Within
       http://job-boards.greenhouse.io/agencywithin/jobs/5056863007
  Interview guides: 3
    • Remote People: 20 General + 10 Personal questions
    • 10a Labs: 19 General + 10 Personal questions
    • Agency Within: 19 General + 10 Personal questions
────────────────────────────────────────────────────────────────
```

---

## Output

### Console Summary

At the end of the run, a summary is printed to stdout covering CV score, GitHub status, market requirements count, skill gaps, learning roadmap, job matches with URLs, and interview guide breakdown per company (see the full example run above).

### Session Folders

Every run gets its own folder under `./output/`, named after the session ID shown in the console header. All files for that run are grouped inside it — nothing is scattered or overwritten across sessions.

```
output/
├── cc-1776092227780/              ← first run  (role: AI Engineer)
│   ├── learning_roadmap.md
│   ├── Remote_People.json
│   ├── 10a_Labs.json
│   └── Agency_Within.json
└── cc-1776094112539/              ← second run (role: Senior Backend Engineer)
    ├── Stripe.json
    ├── Linear.json
    └── Vercel.json
```

The session ID (`cc-<timestamp>`) matches the `Session :` line printed at the top of every run, making it easy to correlate console output with files on disk.

### Learning Roadmap

When the CV score is below 90, a Markdown learning roadmap is saved to the session folder:

```
output/cc-1776092227780/learning_roadmap.md
```

Example content:

```markdown
# Learning Roadmap — AI Engineer

## 1. [Critical] Machine Learning Fundamentals
**Why it matters:** Core ML knowledge is screened at every AI engineering interview stage.

**Resources:**
- [fast.ai Practical Deep Learning](https://course.fast.ai/) — course
- [Hands-On Machine Learning (Géron)](https://www.oreilly.com/library/view/hands-on-machine-learning/9781098125967/) — book

## 2. [Critical] LLM Fundamentals & Prompt Engineering
...
```

### JSON Interview Guides

One JSON file is written per job match inside the session folder:

```
output/cc-1776092227780/
├── Remote_People.json
├── 10a_Labs.json
└── Agency_Within.json
```

Each file has the following structure:

```json
{
  "company": "Stripe",
  "spec": "Stripe conducts 4–5 interview rounds: recruiter screen, technical phone screen, take-home or live coding, system design, and a values/culture interview...",
  "questionBank": [
    {
      "type": "General",
      "category": "System Design",
      "question": "Design a payment processing system that handles 10,000 transactions per second with exactly-once delivery guarantees.",
      "modelAnswer": "I would start by decomposing the problem into ingestion, processing, and settlement layers...",
      "relevantSkills": ["Distributed Systems", "Idempotency", "Event Sourcing", "Database Transactions"]
    },
    {
      "type": "Personal",
      "category": "Personal Deep-Dive",
      "question": "In your career-catalyst project on GitHub, you used LangGraph for workflow orchestration — what trade-offs did you consider versus a simpler queue-based approach?",
      "modelAnswer": "The key trade-off was between development velocity and operational complexity...",
      "relevantSkills": ["System Design", "Workflow Orchestration", "Engineering Judgement"]
    }
  ]
}
```

### Question Types

| Type | Count | Description |
|------|-------|-------------|
| `General` | 20 | Industry-standard questions for the role |
| `Personal` | 10 | Questions grilled specifically on your CV and GitHub projects |

### General Question Distribution

| Category | Count | Focus |
|----------|-------|-------|
| System Design | 6 | Architecture, scalability, trade-offs |
| Tech Stack | 7 | Language/framework internals |
| Behavioural | 4 | STAR-format ownership, conflict, failure scenarios |
| Role Specific | 3 | Company domain and product-specific questions |

---

## Pipeline Stages

### Step 1 — `pdf_parser`

Converts the input into clean, normalised plain text.

- Detects whether input is a PDF file path or pre-extracted text
- If PDF: uses `pdf-parse` with a custom page renderer that extracts both visible text **and** hyperlink annotations (so GitHub URLs embedded as invisible PDF links are captured)
- Normalises line endings and collapses excessive blank lines
- Validates that at least 100 characters were extracted

### Step 2 — `github_extractor`

Finds and fetches the candidate's GitHub profile from the CV.

- Uses regex to extract a `github.com/<username>` URL — no LLM needed
- Fetches the top 5 public repos (sorted by last push) via the GitHub REST API
- Ranks programming languages by total bytes across all repos
- Uses `gpt-4o-mini` to produce a 2–4 sentence recruiter-friendly profile summary
- Gracefully handles missing profiles, rate limits (HTTP 403/429), and private accounts (HTTP 404)
- Sets two separate state flags: `githubUrlFound` (URL present in CV) and `hasGithub` (profile successfully fetched)

### Step 3 — `market_scout`

Researches what the market currently requires for the target role.

- Runs 3 parallel Tavily web searches:
  1. Core skills and technologies
  2. Interview requirements and hiring criteria
  3. Top frameworks and tools companies expect
- Aggregates up to 4 result snippets per query
- Uses `gpt-4o` to extract a deduplicated, ranked list of 10–50 market requirements

### Step 4 — `cv_enhancer`

Scores the candidate's CV against market requirements.

- Compares CV text + GitHub profile against the market requirements list
- Uses `gpt-4o` to produce a strict 0–100 score
- Score drives conditional routing:
  - **< 90** → skill gap analysis + learning roadmap (Step 5)
  - **≥ 90** → skip directly to job hunting (Step 6)

### Step 5 — `skill_gap_analyser` *(conditional — only when score < 90)*

Identifies missing skills and builds a learning plan.

**Phase 1 — Gap Detection:**
- Compares market requirements against CV
- Classifies each gap as **Hard** (technical: frameworks, tools) or **Soft** (behavioural: communication, leadership)
- Avoids false positives — skills clearly evidenced in the CV are not flagged

**Phase 2 — Roadmap Generation:**
- Selects 3–5 highest-impact gaps
- For each, assigns a priority (Critical / High / Medium) and recommends 1–3 real resources (official docs, courses, books)
- Output is clean Markdown, actionable within 4–12 weeks
- Saves roadmap directly to `output/<sessionId>/learning_roadmap.md`

### Step 6 — `job_hunter`

Finds 3 live, matching job openings.

- Runs 3 parallel Tavily searches with a **30-day server-side filter**:
  1. Direct role + hiring signal
  2. Role + major job board domains (LinkedIn, Greenhouse, Lever)
  3. Role + "apply" intent
- Uses `gpt-4o` to extract exactly 3 real job matches — URLs must come from search results, never fabricated

### Step 7 — `interview_architect` *(parallel fan-out)*

Generates a 30-question interview guide per job match, running all 3 in parallel.

For each job match, two LLM calls run concurrently:

- **Tier 1 (General Bank):** 20 questions covering System Design, Tech Stack, Behavioural, and Role Specific categories, plus a hiring spec describing the company's known interview process
- **Tier 2 (Personal Deep-Dive):** 10 questions anchored to specific projects, repos, metrics, and achievements from the candidate's actual CV and GitHub

Each question includes a model answer and a list of relevant skills being assessed.

**Reliability:** All LLM calls use an automatic retry system with exponential backoff (up to 3 attempts) and a `gpt-4o-mini` raw-JSON fallback if structured output parsing fails.

---

## Observability (LangSmith)

Career Catalyst integrates with [LangSmith](https://smith.langchain.com) for end-to-end pipeline tracing. Every node, LLM call, Tavily search, and GitHub API request appears as a span under a single root run, with inputs, outputs, latency, and token counts.

### Enabling Tracing

1. Create a LangSmith account at [smith.langchain.com](https://smith.langchain.com)
2. Go to **Settings → API Keys → Create API Key → Personal Access Token**
3. Note the region shown at the top of the LangSmith UI (US or EU)
4. Add the following to `.env`:

```env
LANGSMITH_TRACING=true
LANGSMITH_ENDPOINT=https://eu.api.smith.langchain.com   # US: https://api.smith.langchain.com
LANGSMITH_API_KEY=lsv2_pt_...
LANGSMITH_PROJECT=career-catalyst
```

5. Run the pipeline — traces appear under **Projects → career-catalyst** in the LangSmith UI

### What Gets Traced

| Layer | Instrumentation |
|-------|----------------|
| Graph execution | Auto-traced by LangGraph — one root run per `graph.invoke` |
| LLM calls (`ChatOpenAI`) | Auto-traced — prompts, completions, tokens, latency |
| Tavily searches | Manually wrapped with `traceable` (`src/utils/tavily.ts`) |
| GitHub API calls | Manually wrapped with `traceable` (`src/nodes/github_extractor.ts`) |

Each run is tagged with `cli` and `career-catalyst`, and carries metadata `{ sessionId, targetRole }` for filtering in the UI.

### Disabling Tracing

Simply omit `LANGSMITH_TRACING` (or set it to `false`) in `.env`. All `traceable` wrappers become zero-cost pass-throughs when tracing is disabled.

### Privacy Note

When tracing is enabled, the CV text and all generated outputs (market requirements, skill gaps, interview questions) are uploaded to LangSmith as trace inputs and outputs. Disable tracing or self-host LangSmith if this is a concern.

---

## Project Structure

```
career-catalyst/
├── src/
│   ├── main.ts                    # CLI entry point, env validation, pipeline summary
│   ├── state.ts                   # LangGraph state definition + Zod schemas
│   ├── graph.ts                   # Graph assembly, edges, conditional routing
│   ├── nodes/
│   │   ├── pdf_parser.ts          # Step 1 — PDF extraction and text normalisation
│   │   ├── github_extractor.ts    # Step 2 — GitHub profile fetch and summarisation
│   │   ├── market_scout.ts        # Step 3 — Market requirements via Tavily
│   │   ├── cv_enhancer.ts         # Step 4 — CV scoring (0–100)
│   │   ├── skill_gap_analyser.ts  # Step 5 — Gap detection + learning roadmap
│   │   ├── job_hunter.ts          # Step 6 — Live job search via Tavily
│   │   └── interview_architect.ts # Step 7 — Parallel interview guide generation
│   └── utils/
│       ├── retry.ts               # Shared LLM retry + fallback utility
│       └── tavily.ts              # Shared traceable Tavily search client
├── output/                        # Per-session output folders (auto-created)
├── .env                           # Your API keys (not committed)
├── .env.example                   # Template for .env
├── package.json
└── tsconfig.json
```

---

## Tech Stack

| Technology | Version | Role |
|------------|---------|------|
| [LangGraph.js](https://github.com/langchain-ai/langgraphjs) | 0.2.74 | Stateful graph orchestration, conditional routing, parallel fan-out |
| [LangChain.js](https://github.com/langchain-ai/langchainjs) | 0.3.x | LLM abstractions, structured output |
| [OpenAI GPT-4o](https://platform.openai.com) | latest | Primary model for all LLM calls |
| [OpenAI GPT-4o-mini](https://platform.openai.com) | latest | Fallback model for parse failures |
| [Tavily](https://tavily.com) | REST API | Real-time web search (market research + job hunting) |
| [Octokit](https://github.com/octokit/rest.js) | 21.x | GitHub REST API client |
| [Zod](https://zod.dev) | 3.x | Runtime schema validation for all LLM outputs |
| [pdf-parse](https://www.npmjs.com/package/pdf-parse) | 1.1.1 | PDF text extraction with hyperlink annotation support |
| [LangSmith](https://smith.langchain.com) | 0.5.x | Optional observability — pipeline tracing, LLM introspection, cost tracking |
| [TypeScript](https://www.typescriptlang.org) | 5.5 | Strict typing across the entire codebase |
| [tsx](https://github.com/privatenumber/tsx) | 4.x | TypeScript execution without a build step |

---

## Troubleshooting

### `ERROR: Environment variable OPENAI_API_KEY is not set`

Your `.env` file is missing or not being loaded. Ensure `.env` exists in the project root and contains the required keys with no extra spaces:

```env
OPENAI_API_KEY=sk-proj-your-key-here
TAVILY_API_KEY=tvly-your-key-here
```

---

### `Tavily API error 401` or all market/job searches returning empty

Most commonly caused by trailing whitespace in the `TAVILY_API_KEY` value. Open `.env` and ensure the value has no spaces before or after:

```env
TAVILY_API_KEY=tvly-abc123   ← no trailing spaces
```

---

### `[github_extractor] Rate limit hit (HTTP 403)`

You're hitting the unauthenticated GitHub rate limit (60 req/hr). Add a GitHub token to `.env`:

```env
GITHUB_TOKEN=ghp_your_token_here
```

Generate one at [github.com/settings/tokens](https://github.com/settings/tokens). No special scopes are required — the default read-only public access is sufficient.

---

### `[github_extractor] No GitHub URL found in CV`

Career Catalyst looks for a `github.com/<username>` URL in the CV text. If your GitHub URL is embedded as a clickable hyperlink in a PDF (not visible as text), ensure you are passing a `.pdf` file path — the PDF parser extracts hyperlink annotations automatically. Plain text input will not capture invisible links.

---

### `pdf-parse returned empty text`

The PDF may be image-based (scanned) rather than containing selectable text. Career Catalyst does not support OCR. Use a CV exported directly from a text editor or word processor.

---

### Interview guide generation is slow

Step 7 runs 3 parallel guide workers, each making 2 concurrent LLM calls — a total of 6 GPT-4o calls at once. Latency is dominated by the slowest call. Each guide typically completes in 15–40 seconds depending on OpenAI load.

---

### `generate_single_guide: activeJobMatch is missing from Send payload`

This should not occur in normal operation. If it does, it indicates a LangGraph version incompatibility. Ensure you are running the pinned version:

```bash
npm install
```

---

### `Failed to send multipart request. Received status [403]: Forbidden` (LangSmith)

Your `LANGSMITH_ENDPOINT` does not match the region of your LangSmith workspace. EU-region accounts must explicitly set:

```env
LANGSMITH_ENDPOINT=https://eu.api.smith.langchain.com
```

The default is the US endpoint (`https://api.smith.langchain.com`). Sending an EU-scoped key to the US endpoint (or vice-versa) always returns 403.

---

### LangSmith traces not appearing in the UI

Check in order:

1. `LANGSMITH_TRACING=true` is set in `.env` (lowercase `true`, no quotes)
2. `LANGSMITH_API_KEY` is set to a valid key from the correct workspace
3. `LANGSMITH_ENDPOINT` matches your workspace region (US or EU)
4. The project name in `LANGSMITH_PROJECT` matches — or check the `default` project if unset
5. Wait ~10 seconds after the run completes — trace batches are flushed asynchronously (the CLI already awaits this before exit)

---

### Output files not appearing

A session folder `output/<sessionId>/` is created automatically before the graph runs. All files for that session are written inside it. Ensure you have write permissions in the project root. The full output path is printed in the console header (`Output  :`) at the start of every run.
