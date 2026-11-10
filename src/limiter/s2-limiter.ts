/**
 * Global Semantic Scholar rate limiter. One Durable Object instance ("global") serialises
 * reservations for every isolate, so the 1 req/s key limit holds across all MCP clients.
 * The object only hands out slots; callers sleep in their own isolate, so it is never blocked.
 */

import { DurableObject } from "cloudflare:workers";
import type { AppEnv } from "../env";
import {
  DEFAULT_MAX_WAIT_MS,
  INITIAL_STATE,
  intervalFor,
  type LimiterState,
  penalize,
  type Reservation,
  reserve,
} from "./schedule";

export class S2RateLimiter extends DurableObject<AppEnv> {
  private state: LimiterState = INITIAL_STATE;

  async reserve(maxWaitMs: number = DEFAULT_MAX_WAIT_MS): Promise<Reservation> {
    const next = reserve(this.state, Date.now(), intervalFor(Boolean(this.env.S2_API_KEY)), maxWaitMs);
    this.state = next.state;
    return next.result;
  }

  async penalize(delayMs: number): Promise<void> {
    this.state = penalize(this.state, Date.now(), delayMs);
  }
}

export class RateLimitedError extends Error {
  constructor(readonly retryAfterMs: number) {
    super(
      `Semantic Scholar is rate limited (1 request/s shared by all clients; queue ~${Math.ceil(retryAfterMs / 1000)}s). ` +
        `Retry later or batch ids into one call.`,
    );
    this.name = "RateLimitedError";
  }
}

const sleep = (ms: number): Promise<void> => new Promise((resolve) => setTimeout(resolve, ms));

function limiterStub(env: AppEnv): DurableObjectStub<S2RateLimiter> {
  return env.S2_LIMITER.get(env.S2_LIMITER.idFromName("global"));
}

/** Wait for a global S2 slot or throw RateLimitedError when the queue is too long. */
export async function acquireS2Slot(env: AppEnv, maxWaitMs: number = DEFAULT_MAX_WAIT_MS): Promise<void> {
  const result = await limiterStub(env).reserve(maxWaitMs);
  if (!result.ok) throw new RateLimitedError(result.retryAfterMs);
  if (result.waitMs > 0) await sleep(result.waitMs);
}

export async function penalizeS2(env: AppEnv, delayMs: number): Promise<void> {
  await limiterStub(env).penalize(delayMs);
}
