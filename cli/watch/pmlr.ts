/**
 * PMLR: the official volume index (https://proceedings.mlr.press/proceedings.yaml, one entry per
 * volume with "Proceedings of <series> <year>") and each volume's citeproc export
 * (assets/bib/citeproc.yaml), which carries titles, authors, abstracts, links and the volume's
 * publication date. Papers are dated by that publication date.
 */

import { plainText } from "../../src/sources/crossref";
import { inWindow, lastDay, years, type WatchContext } from "./context";
import { dayOrNull, isNonArticleTitle, type FeedLine } from "./line";
import type { Venue } from "./watchlist";

const SITE = "https://proceedings.mlr.press";
const INDEX = `${SITE}/proceedings.yaml`;
const VOLUME_URL = /^https:\/\/proceedings\.mlr\.press\/([vr]?\d+)$/;

export interface PmlrVolume {
  readonly volume: string;
  readonly citeproc: string;
  readonly series: string;
  readonly year: number;
}

export interface PmlrPaper {
  readonly title: string;
  readonly abstract: string | null;
  readonly authors: readonly string[];
  readonly url: string;
  readonly pdf: string | null;
  readonly published: string | null;
}

/** A YAML scalar as the PMLR templates write it: plain, 'single' or "double" quoted. */
function scalar(raw: string): string {
  const text = raw.trim();
  if (text.length >= 2 && text.startsWith("'") && text.endsWith("'"))
    return text.slice(1, -1).replace(/''/g, "'");
  if (text.length >= 2 && text.startsWith('"') && text.endsWith('"')) {
    try {
      return JSON.parse(text) as string;
    } catch {
      return text.slice(1, -1);
    }
  }
  return text;
}

/** Whether a single-quoted scalar is still open at the end of `text`. */
function openQuote(text: string): boolean {
  const t = text.trim();
  if (!t.startsWith("'")) return false;
  const body = t.slice(1).replace(/''/g, "");
  return !body.endsWith("'");
}

export function pmlrVolumes(yaml: string): PmlrVolume[] {
  return yaml.split(/\n(?=- volume:)/).flatMap((block): PmlrVolume[] => {
    const field = (key: string) =>
      scalar(new RegExp(`^\\s*-?\\s*${key}:(.*)$`, "m").exec(block)?.[1] ?? "");
    const url = VOLUME_URL.exec(field("url"));
    const title = /^Proceedings of (.+) (\d{4})$/.exec(
      plainText(field("description")) ?? "",
    );
    if (!url || !title) return [];
    return [
      {
        volume: field("volume"),
        citeproc: `${SITE}/${url[1]}/assets/bib/citeproc.yaml`,
        series: title[1]!,
        year: Number(title[2]),
      },
    ];
  });
}

interface Entry {
  readonly fields: Map<string, string>;
  readonly authors: string[];
  readonly dateParts: number[];
}

/** Reads one entry's lines: two-space keys, an author list and issued date-parts. */
function entry(lines: readonly string[]): Entry {
  const fields = new Map<string, string>();
  const authors: string[] = [];
  const dateParts: number[] = [];
  let block = "";
  let person = new Map<string, string>();
  const flush = () => {
    const name = [
      person.get("given"),
      person.get("prefix"),
      person.get("family"),
    ]
      .filter(Boolean)
      .join(" ");
    if (name) authors.push(name);
    person = new Map();
  };
  for (let i = 0; i < lines.length; i += 1) {
    const top = /^(?:- | {2})([A-Za-z-]+):(.*)$/.exec(lines[i]!);
    if (top) {
      if (block === "author") flush();
      block = top[1]!;
      let value = top[2]!;
      while (openQuote(value) && i + 1 < lines.length)
        value += ` ${lines[(i += 1)]!.trim()}`;
      fields.set(block, scalar(value));
      continue;
    }
    const item = /^ {2}- ([a-z]+):(.*)$|^ {4}([a-z]+):(.*)$/.exec(lines[i]!);
    if (block === "author" && item) {
      if (item[1]) flush();
      person.set(item[1] ?? item[3]!, scalar(item[2] ?? item[4]!));
    }
    const part = /^ {6}- (\d+)\s*$/.exec(lines[i]!);
    if (block === "issued" && part) dateParts.push(Number(part[1]));
  }
  if (block === "author") flush();
  return { fields, authors, dateParts };
}

function issuedDay(parts: readonly number[]): string | null {
  if (parts.length < 3) return null;
  const [y, m, d] = parts.map((n) => String(n).padStart(2, "0"));
  return dayOrNull(`${y}-${m}-${d}`);
}

const https = (url: string | undefined) =>
  url && /^https:\/\/[^\s]+$/.test(url) ? url : null;

export function citeprocPapers(yaml: string): PmlrPaper[] {
  return yaml
    .split(/\n(?=- title:)/)
    .map((chunk) => entry(chunk.split("\n").filter((l) => l.trim())))
    .flatMap((e): PmlrPaper[] => {
      const title = plainText(e.fields.get("title"));
      const url = https(e.fields.get("URL"));
      if (!title || !url?.startsWith(`${SITE}/`)) return [];
      return [
        {
          title,
          abstract: plainText(e.fields.get("abstract")),
          authors: e.authors,
          url,
          pdf: https(e.fields.get("PDF")),
          published:
            dayOrNull(e.fields.get("published")) ?? issuedDay(e.dateParts),
        },
      ];
    });
}

function line(venue: Venue, p: PmlrPaper, published: string): FeedLine {
  return {
    source: "pmlr",
    title: p.title,
    authors: p.authors,
    venue: venue.name,
    published,
    doi: null,
    arxiv_id: null,
    openreview_id: null,
    abstract: p.abstract,
    oa_url: p.pdf,
    url: p.url,
  };
}

/** The series' volumes from the year before --since to the year after the window. */
export async function pmlrLines(
  ctx: WatchContext,
  venue: Venue,
  series: string,
): Promise<FeedLine[]> {
  const index = await ctx.memo("pmlr-index", async () =>
    pmlrVolumes(await ctx.http.text(INDEX, { service: "PMLR" })),
  );
  const wanted = new Set(years(ctx.window, lastDay(ctx), 1, 1));
  const volumes = index.filter(
    (v) =>
      v.series.toLowerCase() === series.toLowerCase() && wanted.has(v.year),
  );
  const lines: FeedLine[] = [];
  for (const volume of volumes) {
    const papers = citeprocPapers(
      await ctx.http.text(volume.citeproc, { service: "PMLR" }),
    );
    for (const p of papers)
      if (
        p.published &&
        inWindow(p.published, ctx.window) &&
        !isNonArticleTitle(p.title)
      )
        lines.push(line(venue, p, p.published));
  }
  return lines;
}
