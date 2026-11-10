import type { Paper } from "../core/types";
import { normalizeDoi, titleKey } from "../core/normalize";
import { requestJson } from "../http/json";
export class MissingCoreKeyError extends Error {
  constructor() {
    super("CORE_API_KEY not configured");
  }
}
interface RawWork {
  id: number;
  title?: string;
  doi?: string;
  yearPublished?: number;
  authors?: Array<{ name?: string }>;
  downloadUrl?: string;
  sourceFulltextUrls?: string[];
  abstract?: string;
  fullText?: string;
}
interface Deps {
  apiKey?: string;
  acquire: () => Promise<void>;
  penalize: (ms: number) => Promise<void>;
  onResponse?: (r: Response) => Promise<void>;
  fetchImpl?: typeof fetch;
}
export interface OaBlock {
  source: "core";
  url: string;
  snippet?: string;
  snippet_kind: "full_text" | "abstract" | "none";
}
function safeLink(url: string | undefined): string | undefined {
  return url && /^https?:\/\//i.test(url) ? url : undefined;
}
function oa(work: RawWork): OaBlock | null {
  const url =
    safeLink(work.downloadUrl) ||
    work.sourceFulltextUrls?.map(safeLink).find(Boolean);
  if (!url) return null;
  const source = work.fullText || work.abstract;
  return {
    source: "core",
    url,
    snippet: source?.replace(/\s+/g, " ").trim().slice(0, 300),
    snippet_kind: work.fullText
      ? "full_text"
      : work.abstract
        ? "abstract"
        : "none",
  };
}
export function createCoreClient(deps: Deps) {
  async function works(query: string, limit: number, offset: number) {
    if (!deps.apiKey) throw new MissingCoreKeyError();
    const qs = new URLSearchParams({
      q: query,
      limit: String(limit),
      offset: String(offset),
    });
    // No cache for fullText-bearing responses; only the bounded snippet leaves this function.
    return requestJson<{ results?: RawWork[]; totalHits?: number }>({
      service: "core",
      url: `https://api.core.ac.uk/v3/search/works?${qs}`,
      init: {
        headers: {
          authorization: `Bearer ${deps.apiKey}`,
          accept: "application/json",
        },
      },
      retry: {
        retries: 1,
        baseDelayMs: 1000,
        beforeAttempt: deps.acquire,
        onThrottled: deps.penalize,
        fetchImpl: deps.fetchImpl,
      },
      onResponse: deps.onResponse,
    });
  }
  return {
    async search(
      query: string,
      limit: number,
      offset: number,
    ): Promise<{ papers: Paper[]; total: number }> {
      const result = await works(query, limit, offset);
      return {
        total: result.totalHits ?? 0,
        papers: (result.results ?? []).flatMap((w) => {
          const open = oa(w);
          return open
            ? [
                {
                  source: "core" as const,
                  id: `CORE:${w.id}`,
                  title: w.title || "(untitled)",
                  doi: normalizeDoi(w.doi),
                  year: w.yearPublished,
                  authors: (w.authors ?? []).map((a) => ({
                    name: a.name ?? "?",
                  })),
                  abstract: w.abstract,
                  pdfUrl: open.url,
                  url: `https://core.ac.uk/works/${w.id}`,
                },
              ]
            : [];
        }),
      };
    },
    async lookup(paper: Pick<Paper, "doi" | "title">): Promise<OaBlock | null> {
      const quoted = (s: string) => s.replace(/["\\]/g, " ");
      const result = await works(
        paper.doi
          ? `doi:"${quoted(paper.doi)}"`
          : `title:"${quoted(paper.title)}"`,
        5,
        0,
      );
      const match = (result.results ?? []).find((w) =>
        paper.doi
          ? normalizeDoi(w.doi) === normalizeDoi(paper.doi)
          : titleKey(w.title ?? "") === titleKey(paper.title),
      );
      return match ? oa(match) : null;
    },
  };
}
export type CoreClient = ReturnType<typeof createCoreClient>;
