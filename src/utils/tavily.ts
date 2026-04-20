import { traceable } from "langsmith/traceable";

export interface TavilyResult {
  title?: string;
  url?: string;
  content?: string;
  score?: number;
}

/**
 * Thin wrapper around the Tavily REST API.
 * Wrapped with `traceable` so each call appears as a child span in LangSmith
 * when LANGCHAIN_TRACING_V2=true. Behaves as a plain async function otherwise.
 */
export const tavilySearch = traceable(
  async (
    query: string,
    maxResults = 5,
    days?: number,
  ): Promise<TavilyResult[]> => {
    const apiKey = process.env.TAVILY_API_KEY;
    if (!apiKey) throw new Error("TAVILY_API_KEY is not set.");

    const body: Record<string, unknown> = {
      api_key: apiKey,
      query,
      max_results: maxResults,
      include_answer: false,
      include_raw_content: false,
    };
    if (days !== undefined) body.days = days;

    const res = await fetch("https://api.tavily.com/search", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });

    if (!res.ok) {
      const text = await res.text();
      throw new Error(`Tavily API error ${res.status}: ${text}`);
    }

    const data = (await res.json()) as { results?: TavilyResult[]; error?: string };
    if (data.error) throw new Error(`Tavily error: ${data.error}`);
    return data.results ?? [];
  },
  { name: "tavily_search", run_type: "tool" },
);
