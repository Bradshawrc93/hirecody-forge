// Thin Firecrawl v2 client. Powers the Forge's web_search step and
// hardens web_fetch against anti-bot 403s by routing through Firecrawl's
// headless scrape when an API key is configured.

const FIRECRAWL_BASE_URL = "https://api.firecrawl.dev/v2";

export function firecrawlApiKey(): string | null {
  return (
    process.env.FIRECRAWL_API ||
    process.env.FIRECRAWL_API_KEY ||
    null
  );
}

export function hasFirecrawl(): boolean {
  return !!firecrawlApiKey();
}

export interface FirecrawlSearchResult {
  title?: string;
  url: string;
  description?: string;
  markdown?: string;
}

async function firecrawlFetch<T>(
  path: string,
  body: Record<string, unknown>,
  timeoutMs: number
): Promise<T> {
  const key = firecrawlApiKey();
  if (!key) throw new Error("FIRECRAWL_API key not configured");
  const res = await fetch(`${FIRECRAWL_BASE_URL}${path}`, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      authorization: `Bearer ${key}`,
    },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(timeoutMs),
  });
  if (!res.ok) {
    const errText = await res.text().catch(() => "");
    throw new Error(
      `firecrawl ${path} → HTTP ${res.status}${errText ? `: ${errText.slice(0, 300)}` : ""}`
    );
  }
  return (await res.json()) as T;
}

export async function firecrawlSearch(
  query: string,
  limit = 5
): Promise<FirecrawlSearchResult[]> {
  type Resp = {
    success?: boolean;
    data?: {
      web?: Array<{ title?: string; url: string; description?: string; markdown?: string }>;
    } | Array<{ title?: string; url: string; description?: string; markdown?: string }>;
  };
  const json = await firecrawlFetch<Resp>(
    "/search",
    {
      query,
      limit: Math.max(1, Math.min(limit, 10)),
      scrapeOptions: { formats: ["markdown"], onlyMainContent: true },
    },
    // Search + per-result scrape can run long for broad queries; 45s was
    // tight enough that prospect-discovery agents timed out. Give it room.
    90000
  );
  const raw = Array.isArray(json.data)
    ? json.data
    : json.data?.web ?? [];
  return raw.map((r) => ({
    title: r.title,
    url: r.url,
    description: r.description,
    markdown: r.markdown,
  }));
}

export async function firecrawlScrape(url: string): Promise<string> {
  type Resp = {
    success?: boolean;
    data?: { markdown?: string; content?: string };
  };
  const json = await firecrawlFetch<Resp>(
    "/scrape",
    { url, formats: ["markdown"], onlyMainContent: true },
    30000
  );
  return json.data?.markdown ?? json.data?.content ?? "";
}
