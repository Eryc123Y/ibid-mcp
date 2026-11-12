/**
 * `litscout abstracts`: fills missing abstracts for LitScout Daily. JSON Lines in on stdin
 * (`{"id", "doi"?, "arxiv"?, "title"?}`, at most 200), exactly one JSON line out per input in
 * input order (`{"id", "abstract", "source"}`), and one summary line on stderr. Exit 0 whenever
 * the run completes, found or not; 2 for bad input or arguments.
 */

import { sourceInterval } from "../../src/limiter/intervals";
import { createArxivClient } from "../../src/sources/arxiv";
import { createCrossrefClient } from "../../src/sources/crossref";
import { createOpenAlexClient } from "../../src/sources/openalex";
import { createS2Client } from "../../src/sources/s2";
import { createHttp } from "../watch/http";
import { intervalLimiter, localLimiter } from "../watch/limiter";
import { InputError, parseInput, type AbstractRequest } from "./input";
import { PUBLISHER_STAGES } from "./publishers";
import { FREE_STAGES } from "./sources";
import {
  SOURCES,
  type AbstractsContext,
  type Pending,
  type SourceName,
  type Stage,
  type StageResult,
} from "./stage";

export interface AbstractsDeps {
  readonly fetch: typeof fetch;
  readonly env: Readonly<Record<string, string | undefined>>;
  readonly readStdin: () => Promise<string>;
  readonly stdout: (text: string) => void;
  readonly stderr: (text: string) => void;
  readonly sleep?: (ms: number) => Promise<void>;
  /** Milliseconds since the epoch; the time budget is measured with it. */
  readonly now?: () => number;
}

export const USAGE =
  'usage: litscout abstracts < items.jsonl  (stdin: up to 200 lines of {"id", "doi"?, "arxiv"?, "title"?}; stdout: one {"id", "abstract", "source"} per line)';

/** Contract order: stop at the first source that has the abstract. */
const STAGES: readonly Stage[] = [...FREE_STAGES, ...PUBLISHER_STAGES];

/**
 * Wall-clock budget for one run. Typical runs take a minute or two; past this, the remaining
 * lookups are skipped and every item is still answered, so a slow or failing source cannot hold
 * the daily pipeline for hours.
 */
export const BUDGET_MS = 15 * 60 * 1000;

/** S2: on a 429, wait (Retry-After up to a minute, else about 5 s) and retry once, then skip. */
const S2_RETRY = { retries: 1, baseDelayMs: 5000, maxDelayMs: 60_000 };

interface Slot {
  readonly request: AbstractRequest;
  readonly arxiv?: string;
  readonly abstract: string | null;
  readonly source: SourceName | null;
}

const wait = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

function context(deps: AbstractsDeps): AbstractsContext {
  const sleep = deps.sleep ?? wait;
  const now = deps.now ?? Date.now;
  const deadline = now() + BUDGET_MS;
  const env = deps.env;
  const s2Key = env.S2_API_KEY?.trim() || undefined;
  const openalexLimit = localLimiter("openalex", sleep);
  const crossrefLimit = localLimiter("crossref", sleep);
  const s2Limit = intervalLimiter(sourceInterval("s2", Boolean(s2Key)), sleep);
  const arxivLimit = intervalLimiter(sourceInterval("arxiv", false), sleep);
  return {
    openalex: createOpenAlexClient({
      apiKey: env.OPENALEX_API_KEY?.trim() || undefined,
      fetchImpl: deps.fetch,
      sleep,
      acquire: openalexLimit.acquire,
      penalize: openalexLimit.penalize,
    }),
    s2: createS2Client({
      apiKey: s2Key,
      fetchImpl: deps.fetch,
      sleep,
      acquire: s2Limit.acquire,
      penalize: s2Limit.penalize,
      retry: S2_RETRY,
    }),
    arxiv: createArxivClient({
      fetchImpl: deps.fetch,
      sleep,
      acquire: arxivLimit.acquire,
    }),
    crossref: createCrossrefClient({
      mailto: env.UNPAYWALL_EMAIL?.trim() || undefined,
      fetchImpl: deps.fetch,
      sleep,
      acquire: crossrefLimit.acquire,
      penalize: crossrefLimit.penalize,
    }),
    http: createHttp(deps.fetch, sleep),
    env,
    expired: () => now() >= deadline,
  };
}

function pendingOf(slots: readonly Slot[]): Pending[] {
  return slots.flatMap((slot, index) =>
    slot.abstract
      ? []
      : [
          {
            index,
            doi: slot.request.doi,
            arxiv: slot.arxiv,
            title: slot.request.title,
          },
        ],
  );
}

/** Runs the stages in order over the items still empty; returns final slots and skipped count. */
async function fill(
  requests: readonly AbstractRequest[],
  ctx: AbstractsContext,
): Promise<{ slots: readonly Slot[]; skipped: number }> {
  let slots: readonly Slot[] = requests.map((request) => ({
    request,
    arxiv: request.arxiv,
    abstract: null,
    source: null,
  }));
  let skipped = 0;
  for (const stage of STAGES) {
    const pending = pendingOf(slots);
    if (!pending.length) break;
    // Stages turn source failures into skipped requests; anything else skips the whole stage.
    const result: StageResult = await stage
      .run(pending, ctx)
      .catch(() => ({ found: new Map(), skipped: pending.length }));
    skipped += result.skipped;
    slots = slots.map((slot, index) => {
      const hit = result.found.get(index);
      if (!hit || slot.abstract) return slot;
      return {
        ...slot,
        arxiv: slot.arxiv ?? hit.arxiv,
        abstract: hit.abstract ?? null,
        source: hit.abstract ? stage.name : null,
      };
    });
  }
  return { slots, skipped };
}

function summary(
  slots: readonly Slot[],
  skipped: number,
  expired: boolean,
): string {
  const counts = SOURCES.map(
    (name) => `${name} ${slots.filter((s) => s.source === name).length}`,
  );
  const filled = slots.filter((s) => s.abstract).length;
  return `litscout abstracts: ${slots.length} items, ${filled} filled (${counts.join(", ")}); ${skipped} skipped request${skipped === 1 ? "" : "s"}${expired ? "; time budget spent" : ""}\n`;
}

export async function runAbstracts(
  argv: readonly string[],
  deps: AbstractsDeps,
): Promise<number> {
  if (argv.includes("--help") || argv.includes("-h")) {
    deps.stderr(`${USAGE}\n`);
    return 0;
  }
  if (argv.length) {
    deps.stderr(`litscout abstracts: takes no arguments; ${USAGE}\n`);
    return 2;
  }
  let requests: AbstractRequest[];
  try {
    requests = parseInput(await deps.readStdin());
  } catch (error) {
    deps.stderr(
      error instanceof InputError
        ? `litscout abstracts: bad input: ${error.message}\n`
        : "litscout abstracts: stdin could not be read\n",
    );
    return 2;
  }
  try {
    const ctx = context(deps);
    const { slots, skipped } = await fill(requests, ctx);
    slots.forEach((slot) =>
      deps.stdout(
        `${JSON.stringify({ id: slot.request.id, abstract: slot.abstract, source: slot.source })}\n`,
      ),
    );
    deps.stderr(summary(slots, skipped, ctx.expired()));
    return 0;
  } catch {
    // Stages turn every source failure into a skipped request, so this is a bug, not an outage.
    deps.stderr(
      "litscout abstracts: unexpected failure; nothing was written\n",
    );
    return 1;
  }
}
