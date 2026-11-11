/**
 * OpenReview: accepted papers of a venue (notes whose `content.venueid` is the venue id), dated
 * by their publication time. The API answers anonymous scripts with a browser challenge, so this
 * runs only with OPENREVIEW_TOKEN, or OPENREVIEW_USERNAME and OPENREVIEW_PASSWORD for a login.
 */

import {
  createOpenReviewClient,
  openReviewLogin,
  type OpenReviewClient,
  type OpenReviewNote,
} from "../../src/sources/openreview";
import {
  inWindow,
  SourceFailure,
  type WatchContext,
  type Window,
} from "./context";
import { localLimiter } from "./limiter";
import { isNonArticleTitle, type FeedLine } from "./line";
import type { Venue } from "./watchlist";

const PAGE = 1000;
const MAX_PAGES = 10;
const SITE = "https://openreview.net";

type Env = Readonly<Record<string, string | undefined>>;

export function openreviewReady(env: Env): boolean {
  return Boolean(
    env.OPENREVIEW_TOKEN?.trim() ||
    (env.OPENREVIEW_USERNAME?.trim() && env.OPENREVIEW_PASSWORD),
  );
}

/** The venue ids to ask for: `{year}` runs from the year before --since to the year after the window. */
export function venueIds(id: string, window: Window, today: string): string[] {
  if (!id.includes("{year}")) return [id];
  const first = Number(window.since.slice(0, 4)) - 1;
  const last = Number((window.until ?? today).slice(0, 4)) + 1;
  return Array.from({ length: last - first + 1 }, (_, i) =>
    id.replaceAll("{year}", String(first + i)),
  );
}

function client(ctx: WatchContext): Promise<OpenReviewClient> {
  return ctx.memo("openreview-client", async () => {
    const limit = localLimiter("openreview", ctx.sleep);
    const deps = {
      fetchImpl: ctx.fetch,
      sleep: ctx.sleep,
      acquire: limit.acquire,
      penalize: limit.penalize,
    };
    let token = ctx.env.OPENREVIEW_TOKEN?.trim();
    if (!token) {
      try {
        token = await openReviewLogin(
          ctx.env.OPENREVIEW_USERNAME?.trim() ?? "",
          ctx.env.OPENREVIEW_PASSWORD ?? "",
          deps,
        );
      } catch (error) {
        throw new SourceFailure("OpenReview login", error);
      }
    }
    return createOpenReviewClient({ ...deps, token });
  });
}

function field(note: OpenReviewNote, key: string): unknown {
  const raw = note.content?.[key];
  return raw && typeof raw === "object" && "value" in raw ? raw.value : raw;
}

const textField = (note: OpenReviewNote, key: string) => {
  const v = field(note, key);
  return typeof v === "string" && v.trim()
    ? v.replace(/\s+/g, " ").trim()
    : null;
};

/** Largest time a JavaScript Date can hold, in ms. */
const MAX_TIME = 8.64e15;

function noteDay(note: OpenReviewNote): string | null {
  const ms = note.pdate ?? note.odate;
  return typeof ms === "number" &&
    Number.isFinite(ms) &&
    Math.abs(ms) <= MAX_TIME
    ? new Date(ms).toISOString().slice(0, 10)
    : null;
}

function line(
  venue: Venue,
  note: OpenReviewNote,
  published: string,
): FeedLine | null {
  const title = textField(note, "title");
  const id = note.forum || note.id;
  if (!title || !/^[\w-]+$/.test(id) || isNonArticleTitle(title)) return null;
  const authors = field(note, "authors");
  return {
    source: "openreview",
    title,
    authors: Array.isArray(authors)
      ? authors
          .filter(
            (a): a is string => typeof a === "string" && Boolean(a.trim()),
          )
          .map((a) => a.trim())
      : [],
    venue: venue.name,
    published,
    doi: null,
    arxiv_id: null,
    openreview_id: id,
    abstract: textField(note, "abstract"),
    oa_url: field(note, "pdf") ? `${SITE}/pdf?id=${id}` : null,
    url: `${SITE}/forum?id=${id}`,
  };
}

/** Accepted notes of one venue id, paging until a page is short or (sorted) older than --since. */
async function accepted(
  ctx: WatchContext,
  api: OpenReviewClient,
  venueid: string,
) {
  const notes: OpenReviewNote[] = [];
  for (let n = 0; ; n += 1) {
    if (n === MAX_PAGES) {
      ctx.warn(
        `${venueid}: more than ${MAX_PAGES * PAGE} accepted notes; the rest are left out`,
      );
      break;
    }
    const page = (await api.venueNotes(venueid, n * PAGE, PAGE)).notes ?? [];
    notes.push(...page);
    const days = page.map(noteDay).filter((d): d is string => d !== null);
    const sorted = days.every((d, i) => i === 0 || d <= days[i - 1]!);
    if (
      page.length < PAGE ||
      (sorted && days.length && days.at(-1)! < ctx.window.since)
    )
      break;
  }
  return notes;
}

export async function openreviewLines(
  ctx: WatchContext,
  venue: Venue,
  ids: readonly string[],
): Promise<FeedLine[]> {
  const api = await client(ctx);
  const lines: FeedLine[] = [];
  const seen = new Set<string>();
  for (const venueid of ids.flatMap((id) =>
    venueIds(id, ctx.window, ctx.today),
  )) {
    for (const note of await accepted(ctx, api, venueid)) {
      const day = noteDay(note);
      const kept =
        day && inWindow(day, ctx.window) ? line(venue, note, day) : null;
      if (kept && !seen.has(kept.openreview_id!)) {
        seen.add(kept.openreview_id!);
        lines.push(kept);
      }
    }
  }
  return lines;
}
