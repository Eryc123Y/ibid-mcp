/**
 * Semantic Scholar Graph API v1 client. Every network call goes through the global limiter
 * (1 req/s shared by all clients) and the short response cache. Prefer the batch methods.
 */

import type { AuthorRecord, Paper } from "../core/types";
import { HttpError, requestJson } from "../http/json";

const BASE = "https://api.semanticscholar.org/graph/v1";
const TTL_SECONDS = 600;

const PAPER_FIELDS =
  "corpusId,externalIds,title,year,venue,authors,citationCount,openAccessPdf";
const LINK_FIELDS =
  "corpusId,externalIds,title,year,venue,authors,citationCount";
const AUTHOR_FIELDS =
  "name,affiliations,paperCount,citationCount,hIndex,externalIds";
const AUTHOR_PAPER_FIELDS = [
  "corpusId",
  "externalIds",
  "title",
  "year",
  "venue",
  "authors",
  "citationCount",
]
  .map((f) => `papers.${f}`)
  .join(",");

export interface S2Deps {
  readonly apiKey?: string;
  /** Wait for a global slot; throws RateLimitedError when the queue is too long. */
  readonly acquire: () => Promise<void>;
  readonly penalize: (delayMs: number) => Promise<void>;
  readonly fetchImpl?: typeof fetch;
  readonly sleep?: (ms: number) => Promise<void>;
  readonly onResponse?: (response: Response) => Promise<void>;
}

interface RawAuthor {
  readonly authorId?: string | null;
  readonly name?: string | null;
  readonly aliases?: string[] | null;
  readonly affiliations?: string[] | null;
  readonly paperCount?: number | null;
  readonly citationCount?: number | null;
  readonly hIndex?: number | null;
  readonly externalIds?: { ORCID?: string } | null;
  readonly papers?: RawPaper[] | null;
}

export interface RawPaper {
  readonly paperId?: string | null;
  readonly corpusId?: number | null;
  readonly externalIds?: Record<string, string | number> | null;
  readonly title?: string | null;
  readonly abstract?: string | null;
  readonly year?: number | null;
  readonly venue?: string | null;
  readonly authors?: Array<{
    authorId?: string | null;
    name?: string | null;
  }> | null;
  readonly citationCount?: number | null;
  readonly openAccessPdf?: { url?: string | null } | null;
}

export function mapS2Paper(raw: RawPaper): Paper {
  const ext = raw.externalIds ?? {};
  const doi = typeof ext.DOI === "string" ? ext.DOI.toLowerCase() : undefined;
  const arxiv = typeof ext.ArXiv === "string" ? ext.ArXiv : undefined;
  const id = raw.corpusId
    ? `CorpusId:${raw.corpusId}`
    : (raw.paperId ?? "unknown");
  return {
    source: "s2",
    id,
    s2Id: raw.paperId ?? undefined,
    title: raw.title ?? "(untitled)",
    year: raw.year ?? undefined,
    venue: raw.venue || undefined,
    authors: (raw.authors ?? []).map((a) => ({
      name: a.name ?? "?",
      id: a.authorId ?? undefined,
    })),
    citationCount: raw.citationCount ?? undefined,
    doi,
    arxiv,
    url: raw.paperId
      ? `https://www.semanticscholar.org/paper/${raw.paperId}`
      : undefined,
    pdfUrl: raw.openAccessPdf?.url || undefined,
    abstract: raw.abstract ?? undefined,
  };
}

function mapS2Author(raw: RawAuthor): AuthorRecord {
  return {
    source: "s2",
    id: raw.authorId ?? "",
    name: raw.name ?? "?",
    aliases: raw.aliases ?? [],
    affiliations: raw.affiliations ?? [],
    paperCount: raw.paperCount ?? undefined,
    citationCount: raw.citationCount ?? undefined,
    hIndex: raw.hIndex ?? undefined,
    orcid: raw.externalIds?.ORCID ?? undefined,
    papers: (raw.papers ?? []).map(mapS2Paper),
  };
}

export function createS2Client(deps: S2Deps) {
  const headers: Record<string, string> = { accept: "application/json" };
  if (deps.apiKey) headers["x-api-key"] = deps.apiKey;
  const retry = {
    retries: 2,
    baseDelayMs: 1000,
    beforeAttempt: deps.acquire,
    onThrottled: deps.penalize,
    fetchImpl: deps.fetchImpl,
    sleep: deps.sleep,
  };

  const get = <T>(
    path: string,
    params: Record<string, string | number | undefined>,
  ): Promise<T> => {
    const qs = new URLSearchParams();
    Object.entries(params).forEach(
      ([k, v]) => v !== undefined && v !== "" && qs.set(k, String(v)),
    );
    qs.sort();
    const url = `${BASE}${path}?${qs.toString()}`;
    return requestJson<T>({
      service: "Semantic Scholar",
      url,
      init: { headers },
      cacheKey: `GET ${url}`,
      ttlSeconds: TTL_SECONDS,
      retry,
      onResponse: deps.onResponse,
    });
  };

  const post = <T>(
    path: string,
    fields: string,
    ids: readonly string[],
  ): Promise<T> => {
    const url = `${BASE}${path}?fields=${encodeURIComponent(fields)}`;
    const body = JSON.stringify({ ids });
    return requestJson<T>({
      service: "Semantic Scholar",
      url,
      init: {
        method: "POST",
        headers: { ...headers, "content-type": "application/json" },
        body,
      },
      cacheKey: `POST ${url} ${body}`,
      ttlSeconds: TTL_SECONDS,
      retry,
      onResponse: deps.onResponse,
    });
  };

  return {
    async recommendations(
      id: string,
      limit: number,
      offset: number,
    ): Promise<{ papers: Paper[]; next?: number }> {
      if (offset + limit > 500)
        throw new Error("Recommendations support the first 500 results.");
      const url = `https://api.semanticscholar.org/recommendations/v1/papers/for/${encodeURIComponent(id)}?limit=${Math.min(500, offset + limit + 1)}&fields=${encodeURIComponent(PAPER_FIELDS)}`;
      const result = await requestJson<{ recommendedPapers?: RawPaper[] }>({
        service: "Semantic Scholar",
        url,
        init: { headers },
        cacheKey: `GET ${url}`,
        retry,
      });
      const papers = result.recommendedPapers ?? [];
      return {
        papers: papers.slice(offset, offset + limit).map(mapS2Paper),
        next: papers.length > offset + limit ? offset + limit : undefined,
      };
    },
    async searchPapers(
      query: string,
      opts: {
        yearFrom?: number;
        yearTo?: number;
        venue?: string;
        limit: number;
        offset: number;
      },
    ): Promise<{ total: number; papers: Paper[] }> {
      const year =
        opts.yearFrom || opts.yearTo
          ? `${opts.yearFrom ?? ""}-${opts.yearTo ?? ""}`
          : undefined;
      const res = await get<{ total?: number; data?: RawPaper[] }>(
        "/paper/search",
        {
          query: query.replace(/-/g, " "),
          fields: `${PAPER_FIELDS},abstract`,
          year,
          venue: opts.venue,
          limit: opts.limit,
          offset: opts.offset,
        },
      );
      return {
        total: res.total ?? 0,
        papers: (res.data ?? []).map(mapS2Paper),
      };
    },

    /** Up to 500 ids in one request; result is aligned with `ids` (null = not found). */
    async paperBatch(
      ids: readonly string[],
      withAbstract: boolean,
    ): Promise<Array<Paper | null>> {
      if (ids.length === 0) return [];
      const fields = withAbstract ? `${PAPER_FIELDS},abstract` : PAPER_FIELDS;
      const res = await post<Array<RawPaper | null>>(
        "/paper/batch",
        fields,
        ids.slice(0, 500),
      );
      return res.map((p) => (p ? mapS2Paper(p) : null));
    },

    async links(
      id: string,
      direction: "citations" | "references",
      limit: number,
      offset: number,
    ): Promise<{ papers: Paper[]; next?: number }> {
      const key = direction === "citations" ? "citingPaper" : "citedPaper";
      try {
        const res = await get<{
          next?: number;
          data?: Array<Record<string, RawPaper | undefined>>;
        }>(`/paper/${encodeURIComponent(id)}/${direction}`, {
          fields: LINK_FIELDS,
          limit,
          offset,
        });
        const papers = (res.data ?? [])
          .map((row) => row[key])
          .filter((p): p is RawPaper => Boolean(p?.title));
        return { papers: papers.map(mapS2Paper), next: res.next };
      } catch (error) {
        if (error instanceof HttpError && error.status === 404)
          return { papers: [] };
        throw error;
      }
    },

    async searchAuthors(
      name: string,
      limit: number,
      withPapers: boolean,
    ): Promise<AuthorRecord[]> {
      const fields = withPapers
        ? `${AUTHOR_FIELDS},${AUTHOR_PAPER_FIELDS}`
        : AUTHOR_FIELDS;
      const res = await get<{ data?: RawAuthor[] }>("/author/search", {
        query: name.replace(/-/g, " "),
        fields,
        limit,
      });
      return (res.data ?? []).map(mapS2Author);
    },

    async authorBatch(
      ids: readonly string[],
      withPapers: boolean,
    ): Promise<AuthorRecord[]> {
      if (ids.length === 0) return [];
      const fields = withPapers
        ? `${AUTHOR_FIELDS},${AUTHOR_PAPER_FIELDS}`
        : AUTHOR_FIELDS;
      const res = await post<Array<RawAuthor | null>>(
        "/author/batch",
        fields,
        ids.slice(0, 1000),
      );
      return res
        .filter((a): a is RawAuthor => Boolean(a?.authorId))
        .map(mapS2Author);
    },
  };
}

export type S2Client = ReturnType<typeof createS2Client>;
