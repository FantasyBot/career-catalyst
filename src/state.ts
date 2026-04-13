import { Annotation } from "@langchain/langgraph";
import { z } from "zod";

// ─── Zod Schemas (re-usable across nodes) ────────────────────────────────────

export const GithubProfileSchema = z.object({
  languages: z.array(z.string()).describe("Top programming languages used"),
  topProjects: z.array(z.string()).describe("Names of the most notable repos"),
  summary: z
    .string()
    .describe("Short narrative of the developer's GitHub presence"),
});

export const JobMatchSchema = z.object({
  title: z.string(),
  company: z.string(),
  url: z.string().url(),
  description: z.string().describe("One-paragraph role summary"),
});

export const InterviewQuestionSchema = z.object({
  /** "General" = industry/role standard; "Personal" = grilling on the candidate's own work */
  type: z.enum(["General", "Personal"]),

  question: z
    .string()
    .describe("The interview question as it would be asked aloud"),

  modelAnswer: z
    .string()
    .describe(
      "A strong model answer. General questions reference industry best practices. " +
        "Personal questions reference specific projects, code decisions, or CV achievements.",
    ),

  category: z.enum([
    "System Design",
    "Tech Stack",
    "Behavioural",
    "Role Specific",
    "Personal Deep-Dive",
  ]),

  relevantSkills: z
    .array(z.string())
    .min(1)
    .max(5)
    .describe("Skills or competencies this question is evaluating"),
});

export const InterviewGuideSchema = z.object({
  company: z.string(),

  spec: z
    .string()
    .describe(
      "Hiring spec for this company: typical interview stages, panel makeup, " +
        "known culture signals, and what they weight most heavily.",
    ),

  /** Exactly 30 questions: 20 General (industry/role) + 10 Personal (CV/GitHub grilling) */
  questionBank: z.array(InterviewQuestionSchema).min(20).max(40),
});

// ─── Inferred Types ────────────────────────────────────────────────────────────

export type GithubProfile = z.infer<typeof GithubProfileSchema>;
export type JobMatch = z.infer<typeof JobMatchSchema>;
export type InterviewQuestion = z.infer<typeof InterviewQuestionSchema>;
export type InterviewGuide = z.infer<typeof InterviewGuideSchema>;

// ─── Graph State ──────────────────────────────────────────────────────────────
//
// Uses Annotation.Root (functional LangGraph style).
// All array fields use a replace reducer — nodes own their full output slice.
// Nullable fields default to null; primitives default to empty/zero values.

export const GraphState = Annotation.Root({
  /** Raw text of the CV (populated by pdf_parser). Seed with a file path to a PDF
   *  or with pre-extracted plain text; the pdf_parser node handles both. */
  originalCv: Annotation<string>({
    reducer: (_prev, next) => next,
    default: () => "",
  }),

  /** The job role the user is targeting, e.g. "Senior Backend Engineer". */
  targetRole: Annotation<string>({
    reducer: (_prev, next) => next,
    default: () => "",
  }),

  /** GitHub profile URL extracted from the CV, or null if absent. */
  githubUrl: Annotation<string | null>({
    reducer: (_prev, next) => next,
    default: () => null,
  }),

  /** GitHub username parsed from githubUrl — set by github_extractor, used by downstream nodes. */
  githubUsername: Annotation<string | null>({
    reducer: (_prev, next) => next,
    default: () => null,
  }),

  /** True when a GitHub URL was found in the CV text. Set by github_extractor
   *  regardless of whether the profile fetch succeeded. */
  githubUrlFound: Annotation<boolean>({
    reducer: (_prev, next) => next,
    default: () => false,
  }),

  /** True when the GitHub profile was successfully fetched and parsed.
   *  False when the URL was found but the API call failed (rate limit, 404, etc.). */
  hasGithub: Annotation<boolean>({
    reducer: (_prev, next) => next,
    default: () => false,
  }),

  /** Structured summary of the user's GitHub activity (set by github_extractor). */
  githubProfile: Annotation<GithubProfile | null>({
    reducer: (_prev, next) => next,
    default: () => null,
  }),

  /** Key skills/technologies required by the market for targetRole. */
  marketRequirements: Annotation<string[]>({
    reducer: (_prev, next) => next,
    default: () => [],
  }),

  /** ATS / quality score for the CV (0–100). */
  cvScore: Annotation<number>({
    reducer: (_prev, next) => next,
    default: () => 0,
  }),

  /** Skills the user is missing relative to marketRequirements. */
  skillGaps: Annotation<string[]>({
    reducer: (_prev, next) => next,
    default: () => [],
  }),

  /** Structured learning plan as markdown (set by roadmap_builder). */
  learningRoadmap: Annotation<string | null>({
    reducer: (_prev, next) => next,
    default: () => null,
  }),

  /** Top 3 live job matches found by job_hunter. */
  jobMatches: Annotation<JobMatch[]>({
    reducer: (_prev, next) => next,
    default: () => [],
  }),

  /** One interview guide per job match (set by interview_architect). */
  interviewGuides: Annotation<InterviewGuide[]>({
    reducer: (_prev, next) => next,
    default: () => [],
  }),

  /** * Pre-computed summary of the candidate's CV and GitHub
   * used to pass context to parallel worker nodes.
   */
  candidateContext: Annotation<string>({
    reducer: (_prev, next) => next,
    default: () => "",
  }),

  /** * Current job match being processed by a worker node.
   */
  activeJobMatch: Annotation<JobMatch | null>({
    reducer: (_prev, next) => next,
    default: () => null,
  }),
});

export type GraphStateType = typeof GraphState.State;
