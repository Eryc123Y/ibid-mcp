/**
 * In-process limiter for the CLI. The Worker's SourceLimiter is a Durable Object; the CLI is one
 * process, so it reuses the same pure reservation queue and per-source intervals locally.
 */

import { INITIAL_STATE, penalize, reserve } from "../../src/limiter/schedule";
import {
  sourceInterval,
  type LimitedSource,
} from "../../src/limiter/intervals";

const NO_LIMIT_MS = 24 * 60 * 60 * 1000;

export interface LocalLimiter {
  readonly acquire: () => Promise<void>;
  readonly penalize: (ms: number) => Promise<void>;
}

/** Spaces calls at least `intervalMs` apart and honours penalties from 429 responses. */
export function intervalLimiter(
  intervalMs: number,
  sleep: (ms: number) => Promise<void>,
  now: () => number = Date.now,
): LocalLimiter {
  let state = INITIAL_STATE;
  return {
    async acquire() {
      const next = reserve(state, now(), intervalMs, NO_LIMIT_MS);
      state = next.state;
      if (next.result.ok && next.result.waitMs > 0)
        await sleep(next.result.waitMs);
    },
    async penalize(ms: number) {
      state = penalize(state, now(), ms);
    },
  };
}

export function localLimiter(
  source: LimitedSource,
  sleep: (ms: number) => Promise<void>,
  now: () => number = Date.now,
): LocalLimiter {
  return intervalLimiter(sourceInterval(source, true), sleep, now);
}
