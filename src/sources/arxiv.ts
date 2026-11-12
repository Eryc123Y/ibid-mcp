import { XMLParser, XMLValidator } from "fast-xml-parser";
import type { Paper } from "../core/types";
import { cached } from "../http/cache";
import { fetchWithRetry } from "../http/fetch-retry";
import { HttpError } from "../http/json";
interface ArxivArgs {
  query: string;
  category?: string;
  recent?: boolean;
  limit: number;
  offset: number;
  year_from?: number;
  year_to?: number;
}
interface Entry {
  id?: string;
  title?: string;
  summary?: string;
  published?: string;
  doi?: string;
  author?: Array<{ name?: string }>;
  link?: Array<{ "@_href"?: string; "@_title"?: string }>;
}
const parser = new XMLParser({
  ignoreAttributes: false,
  removeNSPrefix: true,
  parseTagValue: false,
  isArray: (_name, path) =>
    ["feed.entry", "feed.entry.author", "feed.entry.link"].includes(
      String(path),
    ),
});
const text = (value?: string): string =>
  (value ?? "").replace(/\s+/g, " ").trim();
export function parseArxiv(xml: string): { papers: Paper[]; total: number } {
  if (XMLValidator.validate(xml) !== true)
    throw new Error("Invalid arXiv feed");
  const data = parser.parse(xml) as {
    feed?: { entry?: Entry[]; totalResults?: string };
  };
  if (data.feed === undefined) throw new Error("Invalid arXiv feed");
  const entries = data.feed.entry ?? [];
  if (entries.some((e) => e.id?.includes("/api/errors")))
    throw new Error("arXiv query rejected");
  return {
    total: Number(data.feed.totalResults ?? entries.length),
    papers: entries
      .filter((e) => e.id && e.title)
      .map((e) => {
        const id = e.id!.split("/abs/")[1]?.replace(/v\d+$/, "") ?? "";
        return {
          source: "arxiv",
          id: `ARXIV:${id}`,
          arxiv: id,
          title: text(e.title),
          abstract: text(e.summary) || undefined,
          year: e.published ? Number(e.published.slice(0, 4)) : undefined,
          published: e.published,
          doi: e.doi?.toLowerCase(),
          authors: (e.author ?? []).map((a) => ({ name: text(a.name) })),
          url: `https://arxiv.org/abs/${id}`,
          pdfUrl: e.link?.find((l) => l["@_title"] === "pdf")?.["@_href"],
        };
      }),
  };
}
export interface ArxivDeps {
  readonly fetchImpl: typeof fetch;
  /** Waits for a slot; arXiv asks for one request every three seconds. */
  readonly acquire?: () => Promise<void>;
  readonly sleep?: (ms: number) => Promise<void>;
}

/** Letters, digits and spaces only: safe inside an arXiv quoted phrase. */
function phrase(text: string): string {
  return text
    .replace(/[^\p{L}\p{N}\s]/gu, " ")
    .replace(/\s+/g, " ")
    .trim();
}

export function createArxivClient(deps: ArxivDeps) {
  const query = async (qs: URLSearchParams) => {
    const url = `https://export.arxiv.org/api/query?${qs}`;
    const body = await cached(`GET ${url}`, 600, async () => {
      const res = await fetchWithRetry(
        url,
        {},
        {
          retries: 1,
          baseDelayMs: 3000,
          fetchImpl: deps.fetchImpl,
          sleep: deps.sleep,
          beforeAttempt: deps.acquire,
        },
      );
      if (!res.ok) throw new HttpError(res.status, "arxiv", "Request failed");
      const body = await res.text();
      parseArxiv(body);
      return { body, cacheable: true };
    });
    return parseArxiv(body);
  };
  return {
    search(args: ArxivArgs) {
      const terms = [];
      if (args.query.trim())
        terms.push(`all:"${args.query.replace(/["\\]/g, " ")}"`);
      if (args.category) {
        if (!/^[a-z][a-z0-9.-]*$/i.test(args.category))
          throw new Error("Invalid arXiv category");
        terms.push(`cat:${args.category}`);
      }
      if (args.year_from || args.year_to)
        terms.push(
          `submittedDate:[${args.year_from ?? 1991}01010000 TO ${args.year_to ?? 2100}12312359]`,
        );
      return query(
        new URLSearchParams({
          search_query: terms.join(" AND "),
          start: String(args.offset),
          max_results: String(args.limit),
          sortBy: args.recent || args.category ? "submittedDate" : "relevance",
          sortOrder: "descending",
        }),
      );
    },
    /** Papers by arXiv id (without version), one request. */
    async byIds(ids: readonly string[]): Promise<Paper[]> {
      if (ids.length === 0) return [];
      const result = await query(
        new URLSearchParams({
          id_list: ids.join(","),
          max_results: String(ids.length),
        }),
      );
      return result.papers;
    },
    /** Candidates for an exact-title match (`ti:"..."`); the caller compares titles. */
    async byTitle(title: string, limit: number): Promise<Paper[]> {
      const words = phrase(title);
      if (!words) return [];
      const result = await query(
        new URLSearchParams({
          search_query: `ti:"${words}"`,
          start: "0",
          max_results: String(limit),
        }),
      );
      return result.papers;
    },
  };
}
export type ArxivClient = ReturnType<typeof createArxivClient>;
