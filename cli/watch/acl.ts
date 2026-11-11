/**
 * ACL Anthology: the official XML metadata in the acl-org/acl-anthology repository, one file per
 * year and venue (`data/xml/2026.acl.xml`). A paper is new when it is in the file at the last
 * commit of the window but not at the last commit before --since, so each paper is reported once
 * even though journal volumes (TACL, CL) grow all year. GitHub's commit API says whether a file
 * changed at all, so quiet days download nothing.
 */

import { XMLParser, XMLValidator } from "fast-xml-parser";
import { normalizeDoi } from "../../src/core/normalize";
import { plainText } from "../../src/sources/crossref";
import { HttpError } from "../../src/http/json";
import {
  inWindow,
  lastDay,
  nextDay,
  years,
  type WatchContext,
} from "./context";
import { enrichDois } from "./enrich";
import { DataError } from "./http";
import { dayOrNull, isNonArticleTitle, type FeedLine } from "./line";
import type { AclVenue, Venue } from "./watchlist";

const REPO = "acl-org/acl-anthology";
const COMMITS = `https://api.github.com/repos/${REPO}/commits`;
const RAW = `https://raw.githubusercontent.com/${REPO}`;
const SITE = "https://aclanthology.org";
/** Main-conference volumes; demos, findings, SRW, tutorials, industry and shared tasks are not. */
const MAIN_VOLUMES = new Set(["long", "short", "main", "1"]);
const JOURNALS = new Set<AclVenue>(["tacl", "cl"]);

export function isMainVolume(venue: AclVenue, volume: string): boolean {
  return JOURNALS.has(venue) || MAIN_VOLUMES.has(volume);
}

export interface AnthologyPaper {
  readonly id: string;
  readonly title: string;
  readonly authors: readonly string[];
  readonly abstract: string | null;
  readonly doi: string | null;
  readonly hasPdf: boolean;
  readonly ingestDate: string | null;
}

type Node = Record<string, unknown>;
const parser = new XMLParser({
  ignoreAttributes: false,
  attributeNamePrefix: "@_",
  parseTagValue: false,
  stopNodes: ["*.title", "*.abstract", "*.first", "*.last"],
  isArray: (name) => ["volume", "paper", "author"].includes(name),
});

/** Plain text from Anthology markup: TeX math stays as $...$, inline tags go. */
function markup(raw: unknown): string | null {
  if (typeof raw !== "string") return null;
  return plainText(
    raw
      .replace(
        /<tex-math>([\s\S]*?)<\/tex-math>/g,
        (_, tex: string) => `$${tex}$`,
      )
      .replace(/<[^>]+>/g, ""),
  );
}

const nodes = (value: unknown): Node[] =>
  Array.isArray(value)
    ? (value.filter((v) => v && typeof v === "object") as Node[])
    : [];

function paper(
  collection: string,
  volume: Node,
  raw: Node,
): AnthologyPaper | null {
  const [vol, num] = [volume["@_id"], raw["@_id"]];
  if (typeof vol !== "string" || typeof num !== "string") return null;
  const id = `${collection}-${vol}.${num}`;
  const title = markup(raw.title);
  if (!title || !/^[\w.-]+$/.test(id)) return null;
  return {
    id,
    title,
    authors: nodes(raw.author)
      .map((a) => [markup(a.first), markup(a.last)].filter(Boolean).join(" "))
      .filter(Boolean),
    abstract: markup(raw.abstract),
    doi:
      normalizeDoi(typeof raw.doi === "string" ? raw.doi : undefined) ?? null,
    hasPdf: "pdf" in raw || "url" in raw,
    ingestDate: dayOrNull(String(volume["@_ingest-date"] ?? "")),
  };
}

/** The papers of the venue's main volumes in one Anthology XML file. */
export function anthologyPapers(
  xml: string,
  venue: AclVenue,
): AnthologyPaper[] {
  if (XMLValidator.validate(xml) !== true) throw new DataError("ACL Anthology");
  const collection = (parser.parse(xml) as { collection?: Node }).collection;
  if (!collection || typeof collection !== "object") return [];
  const id = String(collection["@_id"] ?? "");
  return nodes(collection.volume)
    .filter((volume) => isMainVolume(venue, String(volume["@_id"])))
    .flatMap((volume) => nodes(volume.paper).map((p) => paper(id, volume, p)))
    .filter((p): p is AnthologyPaper => p !== null);
}

interface Commit {
  readonly sha?: string;
  readonly commit?: { committer?: { date?: string } };
}

function githubHeaders(ctx: WatchContext): Record<string, string> {
  const token = ctx.env.GITHUB_TOKEN?.trim();
  return {
    accept: "application/vnd.github+json",
    "x-github-api-version": "2022-11-28",
    ...(token ? { authorization: `Bearer ${token}` } : {}),
  };
}

async function lastCommit(
  ctx: WatchContext,
  file: string,
  range: Record<string, string>,
): Promise<{ sha: string; day: string } | null> {
  const params = new URLSearchParams({
    path: `data/xml/${file}`,
    per_page: "1",
    ...range,
  });
  const list = await ctx.http
    .json<Commit[]>(`${COMMITS}?${params}`, {
      service: "GitHub",
      headers: githubHeaders(ctx),
    })
    .catch(async (error: unknown) => {
      if (error instanceof HttpError && [403, 429].includes(error.status))
        await ctx.memo("github-refused", async () =>
          ctx.warn(
            `GitHub refused a commit lookup (HTTP ${error.status}); without GITHUB_TOKEN it allows 60 an hour`,
          ),
        );
      throw error;
    });
  const first = Array.isArray(list) ? list[0] : undefined;
  const sha = first?.sha ?? "";
  const day = dayOrNull(first?.commit?.committer?.date);
  if (!first) return null;
  if (!/^[0-9a-f]{7,40}$/.test(sha) || !day) throw new DataError("GitHub");
  return { sha, day };
}

const download = (ctx: WatchContext, sha: string, file: string) =>
  ctx.http.text(`${RAW}/${sha}/data/xml/${file}`, { service: "ACL Anthology" });

function line(venue: Venue, p: AnthologyPaper, published: string): FeedLine {
  const url = `${SITE}/${p.id}/`;
  return {
    source: "acl-anthology",
    title: p.title,
    authors: p.authors,
    venue: venue.name,
    published,
    doi: p.doi,
    arxiv_id: null,
    openreview_id: null,
    abstract: p.abstract,
    oa_url: p.hasPdf ? `${SITE}/${p.id}.pdf` : url,
    url,
  };
}

/** New papers in one year's file, or none when no commit touched it in the window. */
async function fileLines(
  ctx: WatchContext,
  venue: Venue,
  id: AclVenue,
  file: string,
): Promise<FeedLine[]> {
  const { since, until } = ctx.window;
  const after = await lastCommit(ctx, file, {
    since: `${since}T00:00:00Z`,
    ...(until ? { until: `${nextDay(until)}T00:00:00Z` } : {}),
  });
  if (!after) return [];
  const before = await lastCommit(ctx, file, { until: `${since}T00:00:00Z` });
  const known = new Set(
    before
      ? anthologyPapers(await download(ctx, before.sha, file), id).map(
          (p) => p.id,
        )
      : [],
  );
  return anthologyPapers(await download(ctx, after.sha, file), id)
    .filter((p) => !known.has(p.id) && !isNonArticleTitle(p.title))
    .map((p) =>
      line(
        venue,
        p,
        inWindow(p.ingestDate, ctx.window) ? p.ingestDate! : after.day,
      ),
    );
}

/** arXiv IDs (and a missing abstract) from OpenAlex by DOI, only when a key is set. */
async function withArxiv(
  ctx: WatchContext,
  lines: FeedLine[],
): Promise<FeedLine[]> {
  const dois = lines.flatMap((l) => (l.doi ? [l.doi] : []));
  if (!ctx.openalexKeyed || !dois.length) return lines;
  const found = await enrichDois(ctx, dois);
  return lines.map((l) => {
    const e = l.doi ? found.get(l.doi) : undefined;
    return e
      ? { ...l, arxiv_id: e.arxivId, abstract: l.abstract ?? e.abstract }
      : l;
  });
}

/**
 * Proceedings of year Y can be ingested in Y+1 (CL 2025 arrived in March 2026), so the files of
 * the year before --since are checked too.
 */
export async function aclLines(
  ctx: WatchContext,
  venue: Venue,
  id: AclVenue,
): Promise<FeedLine[]> {
  const lines: FeedLine[] = [];
  for (const year of years(ctx.window, lastDay(ctx), 1, 0))
    lines.push(...(await fileLines(ctx, venue, id, `${year}.${id}.xml`)));
  return withArxiv(ctx, lines);
}
