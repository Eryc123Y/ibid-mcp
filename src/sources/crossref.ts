/**
 * Crossref client, used by the `watch` feed: journal works by ISSN and DOI registration date.
 * Crossref has no daily quota; requests carry a polite `mailto` only when one is configured,
 * go through the caller's limiter, and page with Crossref's deep-paging cursor.
 */

import { normalizeDoi } from "../core/normalize";
import { requestJson } from "../http/json";

const BASE = "https://api.crossref.org/works";
export const ROWS = 200;
export const MAX_PAGES = 50;
const SELECT =
  "DOI,title,author,created,published,issued,type,abstract,container-title";

export interface CrossrefDeps {
  readonly mailto?: string;
  readonly fetchImpl?: typeof fetch;
  readonly sleep?: (ms: number) => Promise<void>;
  readonly acquire?: () => Promise<void>;
  readonly penalize?: (ms: number) => Promise<void>;
}

interface DateField {
  readonly "date-parts"?: ReadonlyArray<ReadonlyArray<number | null>> | null;
  readonly "date-time"?: string | null;
}

export interface CrossrefItem {
  readonly DOI?: string;
  readonly title?: readonly string[] | null;
  readonly author?: ReadonlyArray<{
    given?: string | null;
    family?: string | null;
    name?: string | null;
  }> | null;
  readonly created?: DateField | null;
  readonly published?: DateField | null;
  readonly issued?: DateField | null;
  readonly type?: string | null;
  readonly abstract?: string | null;
  readonly "container-title"?: readonly string[] | null;
}

interface Page {
  readonly message?: {
    readonly items?: CrossrefItem[];
    readonly "next-cursor"?: string;
  };
}

/** A Crossref date as YYYY-MM-DD, but only when it has year, month and day. */
export function fullDate(field: DateField | null | undefined): string | null {
  const parts = field?.["date-parts"]?.[0];
  if (!parts || parts.length < 3 || parts.some((p) => !p)) return null;
  const [y, m, d] = parts as [number, number, number];
  const date = new Date(Date.UTC(y, m - 1, d));
  const text = `${String(y).padStart(4, "0")}-${String(m).padStart(2, "0")}-${String(d).padStart(2, "0")}`;
  return date.toISOString().slice(0, 10) === text ? text : null;
}

/** The day Crossref first listed the DOI. */
export function createdDay(item: CrossrefItem): string | null {
  const stamp = item.created?.["date-time"];
  return stamp && /^\d{4}-\d{2}-\d{2}/.test(stamp)
    ? stamp.slice(0, 10)
    : fullDate(item.created);
}

/** Publication date when Crossref has a day; else the day the DOI was listed (IEEE gives a year only). */
export function publishedDay(item: CrossrefItem): string | null {
  return fullDate(item.published) ?? fullDate(item.issued) ?? createdDay(item);
}

const ENTITIES: Record<string, string> = {
  amp: "&",
  lt: "<",
  gt: ">",
  quot: '"',
  apos: "'",
  nbsp: " ",
};

/** Plain text from Crossref's JATS markup. */
export function plainText(markup: string | null | undefined): string | null {
  const text = (markup ?? "")
    .replace(/<jats:title>\s*Abstract\s*<\/jats:title>/gi, " ")
    .replace(/<[^>]+>/g, " ")
    .replace(/&(#\d+|#x[0-9a-f]+|[a-z]+);/gi, (whole, code: string) => {
      if (code.startsWith("#x"))
        return String.fromCodePoint(parseInt(code.slice(2), 16));
      if (code.startsWith("#"))
        return String.fromCodePoint(Number(code.slice(1)));
      return ENTITIES[code.toLowerCase()] ?? whole;
    })
    .replace(/\s+/g, " ")
    .trim();
  return text || null;
}

export function authorNames(item: CrossrefItem): string[] {
  return (item.author ?? [])
    .map((a) =>
      (a.name ?? [a.given, a.family].filter(Boolean).join(" ")).trim(),
    )
    .filter(Boolean);
}

export function itemDoi(item: CrossrefItem): string | undefined {
  return normalizeDoi(item.DOI);
}

export interface CreatedWindow {
  readonly since: string;
  readonly until?: string;
}

export function createCrossrefClient(deps: CrossrefDeps) {
  const page = (params: URLSearchParams) =>
    requestJson<Page>({
      service: "Crossref",
      url: `${BASE}?${params.toString()}`,
      init: {
        headers: {
          accept: "application/json",
          "user-agent": deps.mailto
            ? `litscout-watch/0.1 (https://github.com/Eryc123Y/litscout-mcp; mailto:${deps.mailto})`
            : "litscout-watch/0.1 (https://github.com/Eryc123Y/litscout-mcp)",
        },
      },
      retry: {
        retries: 3,
        baseDelayMs: 1000,
        fetchImpl: deps.fetchImpl,
        sleep: deps.sleep,
        beforeAttempt: deps.acquire,
        onThrottled: deps.penalize,
      },
    });

  /** Every work matching the filter, all pages up to the cap. */
  async function works(filter: string): Promise<CrossrefItem[]> {
    const items: CrossrefItem[] = [];
    let cursor: string | undefined = "*";
    for (let n = 0; cursor && n < MAX_PAGES; n += 1) {
      const params = new URLSearchParams({
        filter,
        select: SELECT,
        rows: String(ROWS),
        cursor,
      });
      if (deps.mailto) params.set("mailto", deps.mailto);
      const body = await page(params);
      const batch = body.message?.items ?? [];
      items.push(...batch);
      cursor =
        batch.length === ROWS ? body.message?.["next-cursor"] : undefined;
    }
    return items;
  }

  const created = (window: CreatedWindow) => [
    `from-created-date:${window.since}`,
    ...(window.until ? [`until-created-date:${window.until}`] : []),
  ];

  return {
    /** Every work with one of the ISSNs whose DOI was registered in the window, all pages. */
    worksByIssn(
      issns: readonly string[],
      window: CreatedWindow,
    ): Promise<CrossrefItem[]> {
      return works(
        [
          ...issns.map((issn) => `issn:${issn.replace(/[,]/g, "")}`),
          ...created(window),
        ].join(","),
      );
    },
    /** Every work under a registrant prefix (e.g. 10.1145) registered in the window. */
    worksByPrefix(
      registrant: string,
      window: CreatedWindow,
    ): Promise<CrossrefItem[]> {
      return works(
        [`prefix:${registrant.replace(/[,]/g, "")}`, ...created(window)].join(
          ",",
        ),
      );
    },
  };
}

export type CrossrefClient = ReturnType<typeof createCrossrefClient>;
