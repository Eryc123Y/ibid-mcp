/**
 * `litscout watch`: the feed command for LitScout Daily. JSON Lines on stdout and nothing else;
 * progress and warnings on stderr. Exit 0 when anything could be fetched, 2 for bad arguments
 * or an unreadable venue file, 1 when every source request failed.
 */

import { createCrossrefClient } from "../../src/sources/crossref";
import { createOpenAlexClient } from "../../src/sources/openalex";
import { parseArgs, USAGE } from "./args";
import { conferenceLines } from "./conferences";
import type { WatchContext } from "./context";
import { createHttp } from "./http";
import { journalLines, type Outcome } from "./journals";
import type { FeedLine } from "./line";
import { localLimiter } from "./limiter";
import { openreviewReady } from "./openreview";
import { route } from "./route";
import { readRouted } from "./sources";
import { parseWatchList, WatchError, type Venue } from "./watchlist";

export interface WatchDeps {
  readonly fetch: typeof fetch;
  readonly env: Readonly<Record<string, string | undefined>>;
  readonly readFile: (file: string) => Promise<string>;
  /** Where watch keeps its JMLR ledger; without it JMLR venues are skipped. */
  readonly writeFile?: (file: string, text: string) => Promise<void>;
  readonly stdout: (text: string) => void;
  readonly stderr: (text: string) => void;
  readonly sleep?: (ms: number) => Promise<void>;
  readonly now?: () => Date;
}

const wait = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));
const EMPTY: Outcome = { lines: [], attempted: 0, failed: 0, skipped: 0 };

/** Request counts on the summary line; the first two always appear, the rest when used. */
const HOSTS: ReadonlyArray<readonly [string, string]> = [
  ["api.crossref.org", "Crossref"],
  ["api.openalex.org", "OpenAlex"],
  ["api.github.com", "GitHub"],
  ["raw.githubusercontent.com", "ACL Anthology data"],
  ["proceedings.mlr.press", "PMLR"],
  ["api.datacite.org", "DataCite"],
  ["doi.org", "doi.org"],
  ["www.jmlr.org", "JMLR"],
  ["api2.openreview.net", "OpenReview"],
];

/** fetch that counts requests per API host, so the run can report what it spent. */
function counting(impl: typeof fetch, counts: Map<string, number>) {
  return ((input: RequestInfo | URL, init?: RequestInit) => {
    const url = new URL(
      typeof input === "string" || input instanceof URL ? input : input.url,
    );
    counts.set(url.hostname, (counts.get(url.hostname) ?? 0) + 1);
    return impl(input, init);
  }) as typeof fetch;
}

function context(
  deps: WatchDeps,
  window: WatchContext["window"],
  counts: Map<string, number>,
): WatchContext {
  const sleep = deps.sleep ?? wait;
  const fetchImpl = counting(deps.fetch, counts);
  const apiKey = deps.env.OPENALEX_API_KEY?.trim() || undefined;
  const mailto = deps.env.UNPAYWALL_EMAIL?.trim() || undefined;
  const crossrefLimit = localLimiter("crossref", sleep);
  const openalexLimit = localLimiter("openalex", sleep);
  const memos = new Map<string, Promise<unknown>>();
  return {
    window,
    today: (deps.now?.() ?? new Date()).toISOString().slice(0, 10),
    crossref: createCrossrefClient({
      mailto,
      fetchImpl,
      sleep,
      acquire: crossrefLimit.acquire,
      penalize: crossrefLimit.penalize,
    }),
    openalex: createOpenAlexClient({
      apiKey,
      fetchImpl,
      sleep,
      acquire: openalexLimit.acquire,
      penalize: openalexLimit.penalize,
    }),
    openalexKeyed: Boolean(apiKey),
    warn: (text) => deps.stderr(`litscout watch: ${text}\n`),
    http: createHttp(fetchImpl, sleep),
    env: deps.env,
    files: { read: deps.readFile, write: deps.writeFile },
    fetch: fetchImpl,
    sleep,
    memo: <T>(key: string, load: () => Promise<T>) => {
      if (!memos.has(key)) memos.set(key, load());
      return memos.get(key) as Promise<T>;
    },
  };
}

async function venues(
  deps: WatchDeps,
  file: string,
  warn: (t: string) => void,
) {
  let text: string;
  try {
    text = await deps.readFile(file);
  } catch {
    throw new WatchError("the venue file cannot be read");
  }
  return parseWatchList(text, warn);
}

function summary(lines: readonly FeedLine[], counts: Map<string, number>) {
  const abstracts = lines.filter((l) => l.abstract).length;
  const oa = lines.filter((l) => l.oa_url).length;
  const arxiv = lines.filter((l) => l.arxiv_id).length;
  const requests = HOSTS.filter(([host], i) => i < 2 || counts.get(host))
    .map(([host, label]) => `${label} ${counts.get(host) ?? 0}`)
    .join(", ");
  return `${lines.length} papers (${abstracts} with abstracts, ${oa} with open-access links, ${arxiv} with arXiv IDs); requests: ${requests}`;
}

/** Venues the dedicated sources read, one outcome each; the rest go to the original paths. */
async function routed(ctx: WatchContext, selected: readonly Venue[]) {
  const ready = openreviewReady(ctx.env);
  const legacy: Venue[] = [];
  const outcomes: Outcome[] = [];
  for (const venue of selected) {
    const r = route(venue, ready);
    if (r.kind === "legacy") {
      if (r.note) ctx.warn(`${venue.name}: ${r.note}`);
      legacy.push(venue);
    } else if (r.kind === "skip") {
      ctx.warn(`${venue.name}: ${r.reason}; skipped`);
    } else {
      outcomes.push(await readRouted(ctx, venue, r));
    }
  }
  return { legacy, outcomes };
}

async function watch(
  argv: readonly string[],
  deps: WatchDeps,
): Promise<number> {
  const args = parseArgs(argv);
  const counts = new Map<string, number>();
  const ctx = context(deps, { since: args.since, until: args.until }, counts);
  const list = await venues(deps, args.venues, ctx.warn);
  const { legacy, outcomes } = await routed(
    ctx,
    list.filter((v) => args.kinds.includes(v.kind)),
  );
  const of = (kind: Venue["kind"]) => legacy.filter((v) => v.kind === kind);
  const journals = of("journal").length
    ? await journalLines(ctx, of("journal"))
    : EMPTY;
  const conferences = of("conference").length
    ? await conferenceLines(ctx, of("conference"))
    : EMPTY;
  const all = [journals, conferences, ...outcomes];
  const lines = all.flatMap((o) => o.lines);
  lines.forEach((line) => deps.stdout(`${JSON.stringify(line)}\n`));
  const attempted = all.reduce((n, o) => n + o.attempted, 0);
  const failed = all.reduce((n, o) => n + o.failed, 0);
  ctx.warn(summary(lines, counts));
  if (!attempted)
    ctx.warn(`no venue of kind ${args.kinds.join(", ")} could be read`);
  if (attempted && failed === attempted) {
    deps.stderr(
      "litscout watch: every source request failed; nothing was fetched\n",
    );
    return 1;
  }
  return 0;
}

export async function runWatch(
  argv: readonly string[],
  deps: WatchDeps,
): Promise<number> {
  if (argv.includes("--help") || argv.includes("-h")) {
    deps.stderr(`${USAGE}\n`);
    return 0;
  }
  try {
    return await watch(argv, deps);
  } catch (error) {
    deps.stderr(
      error instanceof WatchError
        ? `litscout watch: ${error.message}\n`
        : "litscout watch: unexpected failure; nothing was fetched\n",
    );
    return error instanceof WatchError ? 2 : 1;
  }
}
