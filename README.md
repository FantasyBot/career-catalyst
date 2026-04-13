# Career Catalyst

An AI-powered career transformation agent that analyses your CV, identifies skill gaps, finds live job matches, and generates personalised interview preparation guides — all in a single command.

Built with **LangGraph.js**, **OpenAI GPT-4o**, **Tavily**, and the **GitHub API**.

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
│   ./output/<Company>_<timestamp>.json  (one file per job)   │
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
OPENAI_API_KEY=sk-proj-...    # Required — OpenAI API key
TAVILY_API_KEY=tvly-...       # Required — Tavily search API key
GITHUB_TOKEN=ghp_...          # Optional but strongly recommended
```

### API Key Details

| Variable | Required | Purpose |
|----------|----------|---------|
| `OPENAI_API_KEY` | Yes | Powers all LLM calls (CV scoring, gap analysis, question generation) |
| `TAVILY_API_KEY` | Yes | Web search for market requirements and live job listings |
| `GITHUB_TOKEN` | No | Raises GitHub API rate limit from 60 → 5,000 req/hr. Without it, GitHub profile fetching may fail on the first run. No special scopes required. |

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

---

## Output

### Console Summary

At the end of the run, a summary is printed to stdout:

```
────────────────────────────────────────────────────────────────
  Pipeline Summary
────────────────────────────────────────────────────────────────
  CV score       : 72/100
  GitHub URL     : https://github.com/johndoe
  GitHub profile : fetched
  Market reqs    : 34 items
  Skill gaps     : 8 identified
  Has roadmap    : true
  Job matches    : 3
    1. Senior Backend Engineer @ Stripe
       https://stripe.com/jobs/...
    2. Backend Engineer @ Linear
       https://linear.app/jobs/...
    3. Software Engineer @ Vercel
       https://vercel.com/careers/...
  Interview guides: 3
    • Stripe: 20 General + 10 Personal questions
    • Linear: 20 General + 10 Personal questions
    • Vercel: 20 General + 10 Personal questions
────────────────────────────────────────────────────────────────
```

### JSON Interview Guides

One JSON file is written to `./output/` per job match:

```
output/
├── Stripe_2026-04-13T10-30-00-000Z.json
├── Linear_2026-04-13T10-30-01-000Z.json
└── Vercel_2026-04-13T10-30-02-000Z.json
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
│       └── retry.ts               # Shared LLM retry + fallback utility
├── output/                        # Generated interview guides (auto-created)
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

### Output files not appearing

The `./output/` directory is created automatically on the first run. Files are written to `output/<Company>_<timestamp>.json` relative to the directory you run the command from. Ensure you have write permissions in the project root.
