/**
 * JMLR: the journal's own RSS feed (https://www.jmlr.org/jmlr.xml), which lists the current
 * volume with titles, authors, abstracts and links. JMLR registers no DOIs, OpenAlex holds almost
 * none of its recent papers, DBLP answers scripts with a bot challenge, and the feed and BibTeX
 * carry only a year, so no source gives a per-paper date. watch therefore keeps a small ledger of
 * the papers it has seen in the feed and dates each by the day it first appeared there. The first
 * run records the current feed as a baseline and reports nothing.
 */

import { XMLParser, XMLValidator } from "fast-xml-parser";
import { plainText } from "../../src/sources/crossref";
import { inWindow, SkipVenue, type WatchContext } from "./context";
import { DataError } from "./http";
import { dayOrNull, isNonArticleTitle, type FeedLine } from "./line";
import type { Venue } from "./watchlist";

const FEED = "https://www.jmlr.org/jmlr.xml";
const LEDGER_FILE = "watch-jmlr.json";
const BASELINE = "baseline";
const PAPER =
  /^https?:\/\/(?:www\.)?jmlr\.org\/papers\/(v\d+)\/([A-Za-z0-9-]+)\.html$/;
const PDF =
  /^https?:\/\/(?:www\.)?jmlr\.org\/(papers\/volume\d+\/[A-Za-z0-9-]+\/[A-Za-z0-9-]+\.pdf)$/;

export interface JmlrItem {
  readonly id: string;
  readonly title: string;
  readonly authors: readonly string[];
  readonly abstract: string | null;
  readonly url: string;
  readonly pdf: string | null;
}

interface Ledger {
  readonly about: string;
  /** Paper id (e.g. v27/25-1670) to the day watch first saw it, or "baseline". */
  readonly seen: Readonly<Record<string, string>>;
}

const parser = new XMLParser({
  parseTagValue: false,
  isArray: (name) => name === "item",
});

const str = (v: unknown) => (typeof v === "string" ? v.trim() : "");

export function jmlrItems(xml: string): JmlrItem[] {
  if (XMLValidator.validate(xml) !== true) throw new DataError("JMLR");
  const channel = (
    parser.parse(xml) as { rss?: { channel?: { item?: unknown[] } } }
  ).rss?.channel;
  return (channel?.item ?? []).flatMap((raw): JmlrItem[] => {
    const item = (raw ?? {}) as Record<string, unknown>;
    const link = PAPER.exec(str(item.link));
    const title = plainText(str(item.title).replace(/~/g, " "));
    if (!link || !title) return [];
    const pdf = PDF.exec(str(item.pdf));
    return [
      {
        id: `${link[1]}/${link[2]}`,
        title,
        authors: str(item.author)
          .split(/\s*,\s*|\s+and\s+/)
          .map((a) => a.trim())
          .filter(Boolean),
        abstract: plainText(str(item.description)),
        url: `https://jmlr.org/papers/${link[1]}/${link[2]}.html`,
        pdf: pdf ? `https://jmlr.org/${pdf[1]}` : null,
      },
    ];
  });
}

function ledgerPath(ctx: WatchContext): string | null {
  const dir =
    ctx.env.LITSCOUT_STATE_DIR?.trim() ||
    (ctx.env.HOME?.trim() ? `${ctx.env.HOME.trim()}/.config/litscout` : "");
  return dir && ctx.files.write
    ? `${dir.replace(/\/+$/, "")}/${LEDGER_FILE}`
    : null;
}

async function readLedger(
  ctx: WatchContext,
  file: string,
): Promise<Ledger | null> {
  try {
    const data = JSON.parse(
      await ctx.files.read(file),
    ) as Partial<Ledger> | null;
    return data && typeof data.seen === "object" && data.seen
      ? (data as Ledger)
      : null;
  } catch {
    return null;
  }
}

function line(venue: Venue, item: JmlrItem, published: string): FeedLine {
  return {
    source: "jmlr",
    title: item.title,
    authors: item.authors,
    venue: venue.name,
    published,
    doi: null,
    arxiv_id: null,
    openreview_id: null,
    abstract: item.abstract,
    oa_url: item.pdf,
    url: item.url,
  };
}

export async function jmlrLines(
  ctx: WatchContext,
  venue: Venue,
): Promise<FeedLine[]> {
  const file = ledgerPath(ctx);
  if (!file)
    throw new SkipVenue("no state directory (set LITSCOUT_STATE_DIR or HOME)");
  const previous = await readLedger(ctx, file);
  const items = jmlrItems(await ctx.http.text(FEED, { service: "JMLR" }));
  if (!items.length) return [];
  const seen = Object.fromEntries(
    items.map((i) => [
      i.id,
      previous ? (previous.seen[i.id] ?? ctx.today) : BASELINE,
    ]),
  );
  const ledger: Ledger = {
    about:
      "Papers litscout watch has seen in jmlr.org's RSS feed, with the day each first appeared.",
    seen,
  };
  if (JSON.stringify(ledger.seen) !== JSON.stringify(previous?.seen))
    await ctx.files.write!(file, `${JSON.stringify(ledger, null, 2)}\n`);
  if (!previous) {
    ctx.warn(
      `${venue.name}: first run; ${items.length} papers in jmlr.org's feed recorded as seen, new ones are reported from the next run`,
    );
    return [];
  }
  return items.flatMap((item) => {
    const day = dayOrNull(seen[item.id]);
    return day && inWindow(day, ctx.window) && !isNonArticleTitle(item.title)
      ? [line(venue, item, day)]
      : [];
  });
}
