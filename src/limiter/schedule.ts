/**
 * Pure scheduling logic for the global Semantic Scholar limiter: a serialized reservation queue
 * (equivalent to a token bucket with capacity 1). Each caller reserves the next free slot and
 * waits until it, so requests leave at most once per `intervalMs` across every Worker isolate.
 */

export interface LimiterState {
  /** Epoch ms at which the next request may start. */
  readonly nextFreeAt: number;
}

export type Reservation =
  | { readonly ok: true; readonly waitMs: number }
  | { readonly ok: false; readonly retryAfterMs: number };

export const INITIAL_STATE: LimiterState = { nextFreeAt: 0 };

/** 1 req/s with the key, plus a margin for clock skew between us and S2. */
export const KEYED_INTERVAL_MS = 1000;
/** Without a key we share S2's public pool; stay well below it. */
export const KEYLESS_INTERVAL_MS = 3000;
/** Longest a caller may queue before getting a "rate limited" answer instead. */
export const DEFAULT_MAX_WAIT_MS = 10_000;

export function intervalFor(hasKey: boolean): number {
  return hasKey ? KEYED_INTERVAL_MS : KEYLESS_INTERVAL_MS;
}

/**
 * Reserve the next slot. When the wait would exceed `maxWaitMs` the state is unchanged and the
 * caller is told when to retry, so a long queue never grows further.
 */
export function reserve(
  state: LimiterState,
  now: number,
  intervalMs: number,
  maxWaitMs: number,
): { readonly state: LimiterState; readonly result: Reservation } {
  const slot = Math.max(now, state.nextFreeAt);
  const waitMs = slot - now;
  if (waitMs > maxWaitMs) {
    return { state, result: { ok: false, retryAfterMs: waitMs } };
  }
  return {
    state: { nextFreeAt: slot + intervalMs },
    result: { ok: true, waitMs },
  };
}

/** Push the queue back after S2 answered 429, e.g. by its Retry-After. */
export function penalize(
  state: LimiterState,
  now: number,
  delayMs: number,
): LimiterState {
  return { nextFreeAt: Math.max(state.nextFreeAt, now + Math.max(0, delayMs)) };
}
