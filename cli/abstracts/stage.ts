/** Shared shapes for the per-source stages of `litscout abstracts`. */

import { HttpError } from "../../src/http/json";
import type { ArxivClient } from "../../src/sources/arxiv";
import type { CrossrefClient } from "../../src/sources/crossref";
import type { OpenAlexClient } from "../../src/sources/openalex";
import type { S2Client } from "../../src/sources/s2";
import type { Http } from "../watch/http";

/** The `source` values of the output contract, in the order they are tried. */
export const SOURCES = [
  "openalex",
  "s2",
  "arxiv",
  "crossref",
  "europepmc",
  "ieee",
  "springer",
  "elsevier",
] as const;
export type SourceName = (typeof SOURCES)[number];

/** An item that still has no abstract when a stage runs. */
export interface Pending {
  /** Position in the input; results are keyed by it. */
  readonly index: number;
  readonly doi?: string;
  /** From the input, or revealed by an earlier stage (OpenAlex, S2). */
  readonly arxiv?: string;
  readonly title?: string;
}

/** What a stage learnt about one item: a clean abstract, an arXiv id, or both. */
export interface Found {
  readonly abstract?: string;
  readonly arxiv?: string;
}

export interface StageResult {
  readonly found: ReadonlyMap<number, Found>;
  /** Requests that failed (timeout, 429, 5xx, unreadable data); "not found" is not a failure. */
  readonly skipped: number;
}

export interface AbstractsContext {
  readonly openalex: OpenAlexClient;
  readonly s2: S2Client;
  readonly arxiv: ArxivClient;
  readonly crossref: CrossrefClient;
  readonly http: Http;
  readonly env: Readonly<Record<string, string | undefined>>;
  /** True once the run's time budget is spent; stages then stop making requests. */
  readonly expired: () => boolean;
}

export interface Stage {
  readonly name: SourceName;
  readonly run: (
    pending: readonly Pending[],
    ctx: AbstractsContext,
  ) => Promise<StageResult>;
}

export const NOTHING: StageResult = { found: new Map(), skipped: 0 };
/** Per-attempt timeout for the JSON APIs read through `Http`. */
export const TIMEOUT_MS = 20_000;

const FAILED = Symbol("failed");

/** Runs one request: its value, null when the source has no such record, FAILED otherwise. */
export async function attempt<T>(
  load: () => Promise<T>,
): Promise<T | null | typeof FAILED> {
  try {
    return await load();
  } catch (error) {
    return error instanceof HttpError && error.status === 404 ? null : FAILED;
  }
}

export function failed(value: unknown): value is typeof FAILED {
  return value === FAILED;
}

/** Drops empty fields; null when nothing is left. */
export function found(
  abstract: string | null | undefined,
  arxiv?: string | null,
): Found | null {
  if (!abstract && !arxiv) return null;
  return {
    ...(abstract ? { abstract } : {}),
    ...(arxiv ? { arxiv } : {}),
  };
}

/** After this many failures in a row a source is treated as down for the rest of the run. */
export const BREAKER = 3;

/** Items with the same DOI (or, without one, the same title) share one request. */
function itemKey(item: Pending): string {
  if (item.doi) return `doi:${item.doi}`;
  return item.title ? `title:${item.title.toLowerCase()}` : `#${item.index}`;
}

/**
 * One request per distinct item, in order; a failure skips that item only. Once BREAKER requests
 * fail in a row, or the time budget is spent, the remaining items are skipped without a request
 * and counted as skipped.
 */
export async function perItem(
  items: readonly Pending[],
  lookup: (item: Pending) => Promise<Found | null>,
  ctx: Pick<AbstractsContext, "expired">,
): Promise<StageResult> {
  const results = new Map<number, Found>();
  const memo = new Map<string, Found | null | typeof FAILED>();
  let skipped = 0;
  let streak = 0;
  for (const item of items) {
    const key = itemKey(item);
    if (!memo.has(key)) {
      if (streak >= BREAKER || ctx.expired()) {
        skipped += 1;
        continue;
      }
      const outcome = await attempt(() => lookup(item));
      streak = failed(outcome) ? streak + 1 : 0;
      if (failed(outcome)) skipped += 1;
      memo.set(key, outcome);
    }
    const outcome = memo.get(key);
    if (outcome && !failed(outcome)) results.set(item.index, outcome);
  }
  return { found: results, skipped };
}

export function withDoi(
  pending: readonly Pending[],
  prefix = "",
): Array<Pending & { readonly doi: string }> {
  return pending.filter((p): p is Pending & { readonly doi: string } =>
    Boolean(p.doi?.startsWith(prefix)),
  );
}
