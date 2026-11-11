import { parsePaperId } from "../core/ids";
function normalizeArxiv(query: string): string | undefined {
  try {
    const id = parsePaperId(query);
    return id.kind === "arxiv" ? id.value : undefined;
  } catch {
    return undefined;
  }
}
import { titleKey } from "../core/normalize";
import { HttpError, requestJson } from "../http/json";
export interface OpenReviewNote {
  id: string;
  forum?: string;
  invitations?: string[];
  content?: Record<string, unknown>;
  /** Publication, online and creation times (ms since the epoch). */
  pdate?: number | null;
  odate?: number | null;
  cdate?: number | null;
}
interface Deps {
  acquire: () => Promise<void>;
  penalize: (ms: number) => Promise<void>;
  onResponse?: (r: Response) => Promise<void>;
  fetchImpl?: typeof fetch;
  sleep?: (ms: number) => Promise<void>;
  /** API token; sent as a bearer token, never cached or logged. */
  token?: string;
}
const API = "https://api2.openreview.net";
/** A token for the API from an account login (POST /login). */
export async function openReviewLogin(
  username: string,
  password: string,
  deps: Pick<Deps, "fetchImpl" | "sleep" | "acquire" | "penalize">,
): Promise<string> {
  const body = await requestJson<{ token?: unknown }>({
    service: "openreview",
    url: `${API}/login`,
    init: {
      method: "POST",
      headers: {
        accept: "application/json",
        "content-type": "application/json",
      },
      body: JSON.stringify({ id: username, password }),
    },
    retry: {
      retries: 1,
      baseDelayMs: 1000,
      beforeAttempt: deps.acquire,
      onThrottled: deps.penalize,
      fetchImpl: deps.fetchImpl,
      sleep: deps.sleep,
    },
  });
  if (typeof body.token !== "string" || !body.token)
    throw new HttpError(502, "openreview", "login returned no token");
  return body.token;
}
function value(
  content: Record<string, unknown> | undefined,
  key: string,
): unknown {
  const field = content?.[key];
  return field && typeof field === "object" && "value" in field
    ? field.value
    : field;
}
function text(note: OpenReviewNote, key: string): string {
  const v = value(note.content, key);
  return typeof v === "string" ? v : "";
}
function rating(note: OpenReviewNote): number | undefined {
  const raw =
    value(note.content, "rating") ??
    value(note.content, "recommendation") ??
    value(note.content, "overall");
  const parsed =
    typeof raw === "number"
      ? raw
      : typeof raw === "string"
        ? Number(raw.match(/^\s*(-?\d+(?:\.\d+)?)/)?.[1] ?? NaN)
        : NaN;
  return Number.isFinite(parsed) ? parsed : undefined;
}
export function summarizeReviews(
  notes: OpenReviewNote[],
  forum: string,
  full: boolean,
  truncated = false,
) {
  const submission = notes.find((n) => n.id === forum);
  const reviews = notes
    .filter((n) =>
      n.invitations?.some((i) => /\/-\/(?:Official_Review|Review)$/i.test(i)),
    )
    .map((n) => {
      const summary =
        text(n, "summary") || text(n, "paper_summary") || text(n, "review");
      return {
        id: n.id,
        rating: rating(n),
        summary: (
          summary.replace(/\s+/g, " ").match(/^.*?[.!?](?:\s|$)/)?.[0] ??
          summary
        )
          .trim()
          .slice(0, 200),
        ...(full
          ? {
              text: Object.fromEntries(
                Object.keys(n.content ?? {}).map((key) => [
                  key,
                  value(n.content, key),
                ]),
              ),
            }
          : {}),
      };
    });
  const ratings = reviews.flatMap((r) =>
    r.rating === undefined ? [] : [r.rating],
  );
  const mean = ratings.reduce((a, b) => a + b, 0) / ratings.length;
  const stats = ratings.length
    ? {
        count: ratings.length,
        mean,
        stddev: Math.sqrt(
          ratings.reduce((sum, r) => sum + (r - mean) ** 2, 0) / ratings.length,
        ),
        min: Math.min(...ratings),
        max: Math.max(...ratings),
      }
    : null;
  const decision = notes.find((n) =>
    n.invitations?.some((i) => /\/-\/Decision$/i.test(i)),
  );
  return {
    forum,
    title: submission ? text(submission, "title") : undefined,
    venue: submission
      ? text(submission, "venue") || text(submission, "venueid")
      : undefined,
    decision: decision ? text(decision, "decision") : null,
    ratings: stats,
    reviews,
    truncated,
    notice: reviews.length
      ? "Only publicly accessible official reviews are included."
      : "No public official reviews found.",
  };
}
export function createOpenReviewClient(deps: Deps) {
  async function get(path: string, params: Record<string, string>) {
    const qs = new URLSearchParams(params);
    qs.sort();
    const url = `${API}${path}?${qs}`;
    return requestJson<{ notes?: OpenReviewNote[]; count?: number }>({
      service: "openreview",
      url,
      init: { headers: { accept: "application/json" } },
      cacheKey: `GET ${url}`,
      ttlSeconds: 600,
      retry: {
        retries: 1,
        baseDelayMs: 1000,
        beforeAttempt: deps.acquire,
        onThrottled: deps.penalize,
        fetchImpl: deps.fetchImpl,
      },
      onResponse: deps.onResponse,
    });
  }
  return {
    /** One page of a venue's notes with `content.venueid` = venueid (accepted papers), newest first. */
    async venueNotes(venueid: string, offset: number, limit: number) {
      const qs = new URLSearchParams({
        "content.venueid": venueid,
        sort: "pdate:desc",
        limit: String(limit),
        offset: String(offset),
      });
      return requestJson<{ notes?: OpenReviewNote[]; count?: number }>({
        service: "openreview",
        url: `${API}/notes?${qs}`,
        init: {
          headers: {
            accept: "application/json",
            ...(deps.token ? { authorization: `Bearer ${deps.token}` } : {}),
          },
        },
        retry: {
          retries: 2,
          baseDelayMs: 1000,
          beforeAttempt: deps.acquire,
          onThrottled: deps.penalize,
          fetchImpl: deps.fetchImpl,
          sleep: deps.sleep,
        },
        onResponse: deps.onResponse,
      });
    },
    async reviews(query: string, full = false) {
      const arxiv = normalizeArxiv(query);
      const forumUrl = query.startsWith("https://openreview.net/")
        ? new URL(query).searchParams.get("id")
        : null;
      let forum =
        forumUrl ||
        (!arxiv && /^[a-zA-Z0-9_-]{8,40}$/.test(query) ? query : undefined);
      if (!forum) {
        const result = await get("/notes/search", {
          term: arxiv || query,
          content: "all",
          source: "forum",
          limit: "20",
        });
        const matches = (result.notes ?? []).filter((n) =>
          arxiv
            ? [text(n, "arxiv_id"), text(n, "arxiv"), text(n, "url")].some(
                (s) => normalizeArxiv(s) === arxiv,
              )
            : titleKey(text(n, "title")) === titleKey(query),
        );
        const forums = [...new Set(matches.map((n) => n.forum || n.id))];
        if (forums.length !== 1)
          return {
            forum: null,
            ratings: null,
            reviews: [],
            notice: forums.length
              ? "Multiple matching forums; use a forum ID."
              : "No matching public forum found.",
            candidates: forums,
          };
        forum = forums[0]!;
      }
      const notes: OpenReviewNote[] = [];
      let truncated = false;
      for (let offset = 0; offset < 1000; offset += 100) {
        const page = await get("/notes", {
          forum,
          limit: "100",
          offset: String(offset),
        });
        const items = page.notes ?? [];
        notes.push(...items);
        if (
          items.length < 100 ||
          (page.count !== undefined && notes.length >= page.count)
        )
          break;
        if (offset === 900) truncated = true;
      }
      return summarizeReviews(notes, forum, full, truncated);
    },
  };
}
export type OpenReviewClient = ReturnType<typeof createOpenReviewClient>;
