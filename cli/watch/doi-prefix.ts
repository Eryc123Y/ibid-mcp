/**
 * DOI prefixes (`10.4230/LIPIcs.ITP`): the works under a series prefix registered in the window,
 * from the agency that registered them. doi.org's handle API names the agency per registrant;
 * DataCite (LIPIcs and other Dagstuhl series) is searched by DOI wildcard and creation date,
 * Crossref by registrant prefix and creation date. OpenAlex then enriches by DOI.
 */

import { normalizeDoi } from "../../src/core/normalize";
import {
  MAX_PAGES as CROSSREF_PAGES,
  ROWS,
  createdDay,
  plainText,
  publishedDay,
  type CrossrefItem,
} from "../../src/sources/crossref";
import { inWindow, nextDay, SkipVenue, type WatchContext } from "./context";
import { enrichDois } from "./enrich";
import { crossrefLine, keep } from "./journals";
import { dayOrNull, doiUrl, isNonArticleTitle, type FeedLine } from "./line";
import type { Venue } from "./watchlist";

const DATACITE = "https://api.datacite.org/dois";
const FIELDS = "doi,titles,creators,descriptions,dates,created,types,url";
const PAGE_SIZE = 1000;
const MAX_PAGES = 20;
/** DataCite resource types that are papers; volumes, books and datasets are not. */
const PAPER_TYPES = new Set([
  "ConferencePaper",
  "JournalArticle",
  "Text",
  "Preprint",
]);

/** Whether the DOI is the prefix itself or continues it after a non-alphanumeric character. */
export function matchesPrefix(doi: string, prefix: string): boolean {
  const d = doi.toLowerCase();
  const p = prefix.toLowerCase();
  return d === p || (d.startsWith(p) && !/[a-z0-9]/.test(d.charAt(p.length)));
}

async function agency(ctx: WatchContext, registrant: string): Promise<string> {
  return ctx.memo(`doi-ra:${registrant}`, async () => {
    const list = await ctx.http.json<Array<{ RA?: unknown }>>(
      `https://doi.org/ra/${registrant}`,
      { service: "doi.org" },
    );
    const ra = Array.isArray(list) ? list[0]?.RA : undefined;
    return typeof ra === "string" && /^[A-Za-z]{1,20}$/.test(ra)
      ? ra
      : "an unknown agency";
  });
}

interface DataCiteRecord {
  readonly attributes?: {
    readonly doi?: string;
    readonly titles?: ReadonlyArray<{ title?: string }>;
    readonly creators?: ReadonlyArray<{
      name?: string;
      givenName?: string;
      familyName?: string;
      nameType?: string;
    }>;
    readonly descriptions?: ReadonlyArray<{
      description?: string;
      descriptionType?: string;
    }>;
    readonly dates?: ReadonlyArray<{ date?: string; dateType?: string }>;
    readonly created?: string;
    readonly types?: { resourceTypeGeneral?: string };
  };
}

interface DataCitePage {
  readonly data?: DataCiteRecord[];
  readonly links?: { next?: string };
}

function creator(
  c: NonNullable<NonNullable<DataCiteRecord["attributes"]>["creators"]>[number],
) {
  if (c.givenName && c.familyName)
    return `${c.givenName} ${c.familyName}`.trim();
  const name = (c.name ?? "").trim();
  const parts = /^([^,]+),\s*(.+)$/.exec(name);
  return c.nameType === "Personal" && parts ? `${parts[2]} ${parts[1]}` : name;
}

function dataciteLine(
  venue: Venue,
  record: DataCiteRecord,
  prefix: string,
  ctx: WatchContext,
) {
  const a = record.attributes ?? {};
  const doi = normalizeDoi(a.doi);
  const title = plainText(a.titles?.[0]?.title);
  const created = dayOrNull(a.created);
  if (
    !doi ||
    !title ||
    !matchesPrefix(doi, prefix) ||
    !inWindow(created, ctx.window)
  )
    return null;
  if (
    !PAPER_TYPES.has(a.types?.resourceTypeGeneral ?? "") ||
    isNonArticleTitle(title)
  )
    return null;
  const date = (type: string) =>
    dayOrNull(a.dates?.find((d) => d.dateType === type)?.date);
  const line: FeedLine = {
    source: "datacite",
    title,
    authors: (a.creators ?? []).map(creator).filter(Boolean),
    venue: venue.name,
    published: date("Available") ?? date("Issued") ?? created!,
    doi,
    arxiv_id: null,
    openreview_id: null,
    abstract: plainText(
      a.descriptions?.find((d) => d.descriptionType === "Abstract")
        ?.description,
    ),
    oa_url: null,
    url: doiUrl(doi),
  };
  return line;
}

async function datacite(
  ctx: WatchContext,
  venue: Venue,
  prefix: string,
): Promise<FeedLine[]> {
  const { since, until } = ctx.window;
  const params = new URLSearchParams({
    query: `id:${prefix.toLowerCase()}* AND created:[${since} TO ${until ? `${nextDay(until)}}` : "*]"}`,
    "page[size]": String(PAGE_SIZE),
    "page[cursor]": "1",
    "fields[dois]": FIELDS,
    "disable-facets": "true",
  });
  const lines: FeedLine[] = [];
  let url: string | undefined = `${DATACITE}?${params}`;
  for (let n = 0; url && n < MAX_PAGES; n += 1) {
    const page: DataCitePage = await ctx.http.json<DataCitePage>(url, {
      service: "DataCite",
    });
    for (const record of page.data ?? []) {
      const line = dataciteLine(venue, record, prefix, ctx);
      if (line) lines.push(line);
    }
    const next = page.links?.next;
    url =
      (page.data ?? []).length && next?.startsWith(`${DATACITE}?`)
        ? next
        : undefined;
    if (url && n === MAX_PAGES - 1)
      ctx.warn(
        `${venue.name}: DataCite listed more than ${MAX_PAGES * PAGE_SIZE} DOIs; the rest are left out`,
      );
  }
  const extra = await enrichDois(
    ctx,
    lines.map((l) => l.doi!),
  );
  return lines.map((l) => {
    const e = extra.get(l.doi!);
    return e
      ? {
          ...l,
          abstract: l.abstract ?? e.abstract,
          oa_url: e.oaUrl,
          arxiv_id: e.arxivId,
        }
      : l;
  });
}

async function crossref(
  ctx: WatchContext,
  venue: Venue,
  prefix: string,
  registrant: string,
) {
  const items: CrossrefItem[] = await ctx.crossref.worksByPrefix(
    registrant,
    ctx.window,
  );
  if (items.length >= CROSSREF_PAGES * ROWS)
    ctx.warn(
      `${venue.name}: Crossref listed at least ${CROSSREF_PAGES * ROWS} works under ${registrant} in the window; some of the series may be missing`,
    );
  const found = items.flatMap((item) => {
    const kept = keep(item);
    return kept &&
      matchesPrefix(kept.doi, prefix) &&
      inWindow(createdDay(item), ctx.window) &&
      publishedDay(item)
      ? [{ venue: venue.name, item, ...kept }]
      : [];
  });
  const extra = await enrichDois(
    ctx,
    found.map((f) => f.doi),
  );
  return found.map((f) => crossrefLine(f, extra.get(f.doi) ?? {}));
}

export async function doiPrefixLines(
  ctx: WatchContext,
  venue: Venue,
  prefix: string,
): Promise<FeedLine[]> {
  const registrant = prefix.split("/")[0]!;
  const ra = await agency(ctx, registrant);
  if (ra === "DataCite") return datacite(ctx, venue, prefix);
  if (ra === "Crossref") return crossref(ctx, venue, prefix, registrant);
  throw new SkipVenue(
    `DOI prefix registered with ${ra}, which watch does not read`,
  );
}
