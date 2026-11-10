/**
 * OpenAlex client, used internally only: fallback when S2 is rate limited or misses a record,
 * second source for author merging, and missing abstracts. OpenAlex has a daily credit budget
 * (keyless 1000/day shared per IP, 10x with OPENALEX_API_KEY), so every request uses `select=`,
 * a small `per_page`, and OR-batched filters (up to 100 values).
 */

import { normalizeDoi } from "../core/normalize";
import type { AuthorRecord, Notice, Paper } from "../core/types";
import { requestJson } from "../http/json";

const BASE = "https://api.openalex.org";
const TTL_SECONDS = 900;
export const OR_BATCH_MAX = 100;

const WORK_SELECT = "id,doi,display_name,publication_year,primary_location,authorships,cited_by_count,open_access";
const AUTHOR_SELECT =
  "id,display_name,display_name_alternatives,orcid,works_count,cited_by_count,summary_stats,last_known_institutions,affiliations";

export interface OpenAlexDeps {
  readonly apiKey?: string;
  readonly mailto?: string;
  readonly fetchImpl?: typeof fetch;
  readonly acquire?: () => Promise<void>;
  readonly penalize?: (ms:number) => Promise<void>;
  readonly onResponse?: (response:Response) => Promise<void>;
}

interface RawWork {
  readonly id?: string;
  readonly doi?: string | null;
  readonly display_name?: string | null;
  readonly publication_year?: number | null;
  readonly primary_location?: { source?: { display_name?: string | null } | null } | null;
  readonly authorships?: Array<{ author?: { id?: string | null; display_name?: string | null } | null }> | null;
  readonly cited_by_count?: number | null;
  readonly open_access?: { oa_url?: string | null } | null;
  readonly abstract_inverted_index?: Record<string, number[]> | null;
  readonly referenced_works?: string[] | null;
}

interface RawAuthor {
  readonly id?: string;
  readonly display_name?: string | null;
  readonly display_name_alternatives?: string[] | null;
  readonly orcid?: string | null;
  readonly works_count?: number | null;
  readonly cited_by_count?: number | null;
  readonly summary_stats?: { h_index?: number | null } | null;
  readonly last_known_institutions?: Array<{ display_name?: string | null }> | null;
  readonly affiliations?: Array<{ institution?: { display_name?: string | null } | null }> | null;
}

interface ListResponse<T> {
  readonly meta?: { count?: number };
  readonly results?: T[];
}

/** Budget seen on the most recent live response (per isolate). */
let lastBudget: { remaining: number; limit: number } | undefined;

export function shortId(url: string | null | undefined): string {
  return (url ?? "").replace(/^https?:\/\/(?:api\.)?openalex\.org\/(?:works\/|authors\/)?/i, "").toUpperCase();
}

/** Rebuild plain text from OpenAlex's abstract_inverted_index. */
export function abstractFromInvertedIndex(index: Record<string, number[]> | null | undefined): string | undefined {
  if (!index) return undefined;
  const words: string[] = [];
  Object.entries(index).forEach(([word, positions]) => positions.forEach((p) => (words[p] = word)));
  const text = words.filter((w) => w !== undefined).join(" ").trim();
  return text.length > 0 ? text : undefined;
}

export function mapWork(raw: RawWork): Paper {
  const doi = normalizeDoi(raw.doi);
  const arxiv = doi?.match(/^10\.48550\/arxiv\.(.+)$/)?.[1];
  const id = shortId(raw.id);
  return {
    source: "openalex",
    id,
    openalexId: id,
    title: raw.display_name ?? "(untitled)",
    year: raw.publication_year ?? undefined,
    venue: raw.primary_location?.source?.display_name ?? undefined,
    authors: (raw.authorships ?? []).map((a) => ({ name: a.author?.display_name ?? "?", id: shortId(a.author?.id) || undefined })),
    citationCount: raw.cited_by_count ?? undefined,
    doi,
    arxiv,
    url: raw.id ?? undefined,
    pdfUrl: raw.open_access?.oa_url ?? undefined,
    abstract: abstractFromInvertedIndex(raw.abstract_inverted_index),
  };
}

function mapAuthor(raw: RawAuthor): AuthorRecord {
  const institutions = [
    ...(raw.last_known_institutions ?? []).map((i) => i.display_name),
    ...(raw.affiliations ?? []).map((a) => a.institution?.display_name),
  ].filter((n): n is string => Boolean(n));
  return {
    source: "openalex",
    id: shortId(raw.id),
    name: raw.display_name ?? "?",
    aliases: raw.display_name_alternatives ?? [],
    affiliations: Array.from(new Set(institutions)).slice(0, 6),
    paperCount: raw.works_count ?? undefined,
    citationCount: raw.cited_by_count ?? undefined,
    hIndex: raw.summary_stats?.h_index ?? undefined,
    orcid: raw.orcid ? raw.orcid.replace(/^https?:\/\/orcid\.org\//, "") : undefined,
    papers: [],
  };
}

/** Warn when at or under 20% of the daily budget is left. */
export function budgetNotice(): Notice | undefined {
  if (!lastBudget || lastBudget.limit <= 0) return undefined;
  if (lastBudget.remaining > lastBudget.limit * 0.2) return undefined;
  return {
    level: "warn",
    text: `OpenAlex daily budget low (${lastBudget.remaining}/${lastBudget.limit} credits left); fallbacks may fail until reset.`,
  };
}

export function recordBudget(headers: Headers): void {
  const remaining = Number(headers.get("x-ratelimit-remaining"));
  const limit = Number(headers.get("x-ratelimit-limit"));
  if (Number.isFinite(remaining) && Number.isFinite(limit) && headers.has("x-ratelimit-limit")) {
    lastBudget = { remaining, limit };
  }
}

/** Escape a value for an OpenAlex filter (commas and pipes are syntax). */
function filterValue(v: string): string {
  return v.replace(/[,|]/g, " ");
}

export function createOpenAlexClient(deps: OpenAlexDeps) {
  const get = <T>(path: string, params: Record<string, string | number | undefined>): Promise<T> => {
    const qs = new URLSearchParams();
    Object.entries(params).forEach(([k, v]) => v !== undefined && v !== "" && qs.set(k, String(v)));
    if (deps.mailto) qs.set("mailto", deps.mailto);
    const publicUrl = `${BASE}${path}?${qs.toString()}`;
    if (deps.apiKey) qs.set("api_key", deps.apiKey);
    return requestJson<T>({
      service: "OpenAlex",
      url: `${BASE}${path}?${qs.toString()}`,
      init: { headers: { accept: "application/json" } },
      cacheKey: `GET ${publicUrl}`, // never includes api_key
      ttlSeconds: TTL_SECONDS,
      retry: { retries: 1, baseDelayMs: 1000, fetchImpl: deps.fetchImpl, beforeAttempt:deps.acquire, onThrottled:deps.penalize },
      onResponse: async (r) => {recordBudget(r.headers);await deps.onResponse?.(r);},
    });
  };

  const works = async (filter: string, perPage: number, extra: Record<string, string | undefined> = {}) => {
    const res = await get<ListResponse<RawWork>>("/works", { filter, per_page: perPage, select: WORK_SELECT, ...extra });
    return { count: res.meta?.count ?? 0, papers: (res.results ?? []).map(mapWork) };
  };

  return {
    async searchWorks(query: string, opts: { yearFrom?: number; yearTo?: number; limit: number; page: number }) {
      const filters = [
        opts.yearFrom ? `from_publication_date:${opts.yearFrom}-01-01` : undefined,
        opts.yearTo ? `to_publication_date:${opts.yearTo}-12-31` : undefined,
      ].filter(Boolean);
      const res = await get<ListResponse<RawWork>>("/works", {
        search: query,
        filter: filters.length > 0 ? filters.join(",") : undefined,
        per_page: opts.limit,
        page: opts.page,
        select: `${WORK_SELECT},abstract_inverted_index`,
      });
      return { count: res.meta?.count ?? 0, papers: (res.results ?? []).map(mapWork) };
    },

    /** Look up works by DOI / W-id / PMID in OR-batched requests. */
    async worksByIds(
      ids: ReadonlyArray<{ attr: "doi" | "ids.openalex" | "ids.pmid" | "ids.pmcid"; value: string }>,
      withAbstract: boolean,
    ): Promise<Paper[]> {
      const select = withAbstract ? `${WORK_SELECT},abstract_inverted_index` : WORK_SELECT;
      const byAttr = new Map<string, string[]>();
      ids.forEach(({ attr, value }) => byAttr.set(attr, [...(byAttr.get(attr) ?? []), filterValue(value)]));
      const out: Paper[] = [];
      for (const [attr, values] of byAttr) {
        for (let i = 0; i < values.length; i += OR_BATCH_MAX) {
          const chunk = values.slice(i, i + OR_BATCH_MAX);
          const res = await get<ListResponse<RawWork>>("/works", {
            filter: `${attr}:${chunk.join("|")}`,
            per_page: chunk.length,
            select,
          });
          out.push(...(res.results ?? []).map(mapWork));
        }
      }
      return out;
    },

    citingWorks(workId: string, limit: number, page: number) {
      return works(`cites:${workId}`, limit, { page: String(page), sort: "cited_by_count:desc" });
    },

    async referencedWorkIds(workId: string): Promise<string[]> {
      const res = await get<RawWork>(`/works/${workId}`, { select: "id,referenced_works" });
      return (res.referenced_works ?? []).map(shortId);
    },

    async searchAuthors(name: string, limit: number): Promise<AuthorRecord[]> {
      const res = await get<ListResponse<RawAuthor>>("/authors", { search: name, per_page: limit, select: AUTHOR_SELECT });
      return (res.results ?? []).map(mapAuthor);
    },

    async authorsByIds(attr: "ids.openalex" | "orcid", values: readonly string[]): Promise<AuthorRecord[]> {
      if (values.length === 0) return [];
      const res = await get<ListResponse<RawAuthor>>("/authors", {
        filter: `${attr}:${values.slice(0, OR_BATCH_MAX).map(filterValue).join("|")}`,
        per_page: Math.min(values.length, OR_BATCH_MAX),
        select: AUTHOR_SELECT,
      });
      return (res.results ?? []).map(mapAuthor);
    },

    /** Works by any of the given authors (one OR-batched request). */
    worksByAuthors(authorIds: readonly string[], limit: number, sort: "recent" | "cited") {
      return works(`author.id:${authorIds.slice(0, OR_BATCH_MAX).join("|")}`, limit, {
        sort: sort === "recent" ? "publication_date:desc" : "cited_by_count:desc",
      });
    },

    /** Works with at least one author from each group (filters joined by "," are ANDed). */
    sharedWorks(groupA: readonly string[], groupB: readonly string[], limit: number) {
      return works(`author.id:${groupA.slice(0, OR_BATCH_MAX).join("|")},author.id:${groupB.slice(0, OR_BATCH_MAX).join("|")}`, limit, {
        sort: "publication_date:desc",
      });
    },
  };
}

export type OpenAlexClient = ReturnType<typeof createOpenAlexClient>;
