/**
 * Conferences: OpenAlex works of the venue published since a year before `since` and first
 * listed by OpenAlex (created_date) in the window. Proceedings arrive in yearly batches, so a
 * run can return hundreds of papers; the pipeline caps what it publishes.
 */

import { normalizeDoi } from "../../src/core/normalize";
import { reason, inWindow, type WatchContext } from "./context";
import { enrichment, type OpenAlexWork } from "./enrich";
import { dayOrNull, doiUrl, isNonArticleTitle, type FeedLine } from "./line";
import type { Outcome } from "./journals";
import { allows, skipLine, type Venue } from "./watchlist";

export const PER_PAGE = 200;
export const MAX_PAGES = 50;
const SELECT =
  "id,doi,display_name,publication_date,created_date,type,authorships,abstract_inverted_index,open_access,locations";
/** OpenAlex work types that are not papers. */
export const SKIPPED_TYPES = new Set([
  "paratext",
  "erratum",
  "editorial",
  "retraction",
  "peer-review",
  "supplementary-materials",
]);

interface ConferenceWork extends OpenAlexWork {
  readonly display_name?: string | null;
  readonly publication_date?: string | null;
  readonly created_date?: string | null;
  readonly type?: string | null;
  readonly authorships?: ReadonlyArray<{
    author?: { display_name?: string | null } | null;
  }> | null;
}

export function yearBefore(day: string): string {
  const date = new Date(`${day}T00:00:00Z`);
  date.setUTCFullYear(date.getUTCFullYear() - 1);
  return date.toISOString().slice(0, 10);
}

export function conferenceLine(
  work: ConferenceWork,
  venue: string,
): FeedLine | null {
  const title = (work.display_name ?? "")
    .replace(/<[^>]+>/g, " ")
    .replace(/\s+/g, " ")
    .trim();
  const published = dayOrNull(work.publication_date);
  if (!title || !published || isNonArticleTitle(title)) return null;
  if (SKIPPED_TYPES.has(work.type ?? "")) return null;
  const doi = normalizeDoi(work.doi) ?? null;
  const url = doi ? doiUrl(doi) : work.id;
  if (!url || !/^https?:\/\//.test(url)) return null;
  const extra = enrichment(work);
  return {
    source: "openalex",
    title,
    authors: (work.authorships ?? [])
      .map((a) => a.author?.display_name?.trim() ?? "")
      .filter(Boolean),
    venue,
    published,
    doi,
    arxiv_id: extra.arxivId,
    openreview_id: null,
    abstract: extra.abstract,
    oa_url: extra.oaUrl,
    url,
  };
}

async function venueWorks(
  ctx: WatchContext,
  source: string,
): Promise<ConferenceWork[]> {
  const filter = `primary_location.source.id:${source.replace(/[,|]/g, "")},from_publication_date:${yearBefore(ctx.window.since)}`;
  const works: ConferenceWork[] = [];
  let cursor: string | undefined = "*";
  for (let n = 0; cursor && n < MAX_PAGES; n += 1) {
    const page: { results: ConferenceWork[]; nextCursor?: string } =
      await ctx.openalex.worksPage<ConferenceWork>({
        filter,
        select: SELECT,
        perPage: PER_PAGE,
        cursor,
      });
    works.push(...page.results);
    cursor = page.results.length === PER_PAGE ? page.nextCursor : undefined;
  }
  return works;
}

export async function conferenceLines(
  ctx: WatchContext,
  venues: readonly Venue[],
): Promise<Outcome> {
  const lines: FeedLine[] = [];
  const seen = new Set<string>();
  let attempted = 0;
  let failed = 0;
  let skipped = 0;
  for (const venue of venues) {
    if (!venue.openalexSource || !allows(venue, "openalex")) {
      ctx.warn(
        skipLine(venue, "no OpenAlex source, or its sources exclude OpenAlex"),
      );
      continue;
    }
    attempted += 1;
    try {
      for (const work of await venueWorks(ctx, venue.openalexSource)) {
        const kept = inWindow(dayOrNull(work.created_date), ctx.window)
          ? conferenceLine(work, venue.name)
          : null;
        const key = kept?.doi ?? kept?.url;
        if (!kept || !key) {
          skipped += 1;
        } else if (!seen.has(key)) {
          seen.add(key);
          lines.push(kept);
        }
      }
    } catch (error) {
      failed += 1;
      ctx.warn(`${venue.name}: OpenAlex failed (${reason(error)})`);
    }
  }
  return { lines, attempted, failed, skipped };
}
