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
import { journalLines, type Outcome } from "./journals";
import type { FeedLine } from "./line";
import { localLimiter } from "./limiter";
import { parseWatchList, WatchError, type Venue } from "./watchlist";

export interface WatchDeps {
  readonly fetch: typeof fetch;
  readonly env: Readonly<Record<string, string | undefined>>;
  readonly readFile: (file: string) => Promise<string>;
  readonly stdout: (text: string) => void;
  readonly stderr: (text: string) => void;
  readonly sleep?: (ms: number) => Promise<void>;
}

const wait = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));
const EMPTY: Outcome = { lines: [], attempted: 0, failed: 0, skipped: 0 };

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
  return {
    window,
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
  const n = (host: string) => counts.get(host) ?? 0;
  const abstracts = lines.filter((l) => l.abstract).length;
  const oa = lines.filter((l) => l.oa_url).length;
  const arxiv = lines.filter((l) => l.arxiv_id).length;
  return `${lines.length} papers (${abstracts} with abstracts, ${oa} with open-access links, ${arxiv} with arXiv IDs); requests: Crossref ${n("api.crossref.org")}, OpenAlex ${n("api.openalex.org")}`;
}

async function watch(
  argv: readonly string[],
  deps: WatchDeps,
): Promise<number> {
  const args = parseArgs(argv);
  const counts = new Map<string, number>();
  const ctx = context(deps, { since: args.since, until: args.until }, counts);
  const list = await venues(deps, args.venues, ctx.warn);
  const of = (kind: Venue["kind"]) =>
    args.kinds.includes(kind) ? list.filter((v) => v.kind === kind) : [];
  const journals = of("journal").length
    ? await journalLines(ctx, of("journal"))
    : EMPTY;
  const conferences = of("conference").length
    ? await conferenceLines(ctx, of("conference"))
    : EMPTY;
  const lines = [...journals.lines, ...conferences.lines];
  lines.forEach((line) => deps.stdout(`${JSON.stringify(line)}\n`));
  const attempted = journals.attempted + conferences.attempted;
  const failed = journals.failed + conferences.failed;
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
