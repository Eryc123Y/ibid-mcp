/** Journals: Crossref finds the DOIs registered in the window, OpenAlex enriches them. */

import {
  authorNames,
  createdDay,
  itemDoi,
  plainText,
  publishedDay,
  type CrossrefItem,
} from "../../src/sources/crossref";
import { inWindow, reason, type WatchContext } from "./context";
import { enrichDois, type Enrichment } from "./enrich";
import { doiUrl, isNonArticleTitle, type FeedLine } from "./line";
import { allows, skipLine, type Venue } from "./watchlist";

/** Crossref types that are research papers; issues, components, peer reviews and the rest are not. */
export const ARTICLE_TYPES = new Set([
  "journal-article",
  "proceedings-article",
]);

export interface Outcome {
  readonly lines: FeedLine[];
  readonly attempted: number;
  readonly failed: number;
  readonly skipped: number;
}

export interface Found {
  readonly venue: string;
  readonly item: CrossrefItem;
  readonly doi: string;
  readonly title: string;
}

export function keep(
  item: CrossrefItem,
): { doi: string; title: string } | null {
  const doi = itemDoi(item);
  const title = plainText(item.title?.[0]);
  if (!doi || !title || !ARTICLE_TYPES.has(item.type ?? "")) return null;
  return isNonArticleTitle(title) ? null : { doi, title };
}

export function crossrefLine(found: Found, e: Partial<Enrichment>): FeedLine {
  return {
    source: "crossref",
    title: found.title,
    authors: authorNames(found.item),
    venue: found.venue,
    published: publishedDay(found.item)!,
    doi: found.doi,
    arxiv_id: e.arxivId ?? null,
    openreview_id: null,
    abstract: e.abstract ?? plainText(found.item.abstract),
    oa_url: e.oaUrl ?? null,
    url: doiUrl(found.doi),
  };
}

export async function journalLines(
  ctx: WatchContext,
  venues: readonly Venue[],
): Promise<Outcome> {
  const found: Found[] = [];
  const seen = new Set<string>();
  let attempted = 0;
  let failed = 0;
  let skipped = 0;
  for (const venue of venues) {
    if (!venue.issn.length || !allows(venue, "crossref")) {
      ctx.warn(skipLine(venue, "no ISSN, or its sources exclude Crossref"));
      continue;
    }
    attempted += 1;
    try {
      const items = await ctx.crossref.worksByIssn(venue.issn, ctx.window);
      for (const item of items) {
        const kept = keep(item);
        if (!kept || !inWindow(createdDay(item), ctx.window)) {
          skipped += 1;
          continue;
        }
        if (seen.has(kept.doi) || !publishedDay(item)) continue;
        seen.add(kept.doi);
        found.push({ venue: venue.name, item, ...kept });
      }
    } catch (error) {
      failed += 1;
      ctx.warn(`${venue.name}: Crossref failed (${reason(error)})`);
    }
  }
  const extra = await enrichDois(
    ctx,
    found.map((f) => f.doi),
  );
  return {
    lines: found.map((f) => crossrefLine(f, extra.get(f.doi) ?? {})),
    attempted,
    failed,
    skipped,
  };
}
