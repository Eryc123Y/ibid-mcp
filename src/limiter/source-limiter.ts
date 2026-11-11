import { retryAfterMs } from "../http/fetch-retry";
import { DurableObject } from "cloudflare:workers";
import type { AppEnv } from "../env";
import {
  INITIAL_STATE,
  reserve,
  penalize,
  type LimiterState,
  type Reservation,
} from "./schedule";
import { sourceInterval, type LimitedSource } from "./intervals";
export { sourceInterval, type LimitedSource } from "./intervals";
interface Budget {
  remaining: number;
  limit: number;
  warning: boolean;
  observedAt: number;
  resetAt?: number;
}
/** One instance per source, durable across evictions. Burst is conservatively one. */
export class SourceLimiter extends DurableObject<AppEnv> {
  async reserve(
    source: LimitedSource = "s2",
    maxWaitMs = 10_000,
  ): Promise<Reservation> {
    return this.ctx.storage.transaction(async (txn) => {
      const state = (await txn.get<LimiterState>("schedule")) ?? INITIAL_STATE;
      const next = reserve(
        state,
        Date.now(),
        sourceInterval(source, Boolean(this.env.S2_API_KEY)),
        maxWaitMs,
      );
      await txn.put("schedule", next.state);
      return next.result;
    });
  }
  async penalize(delayMs: number): Promise<void> {
    await this.ctx.storage.transaction(async (txn) => {
      const state = (await txn.get<LimiterState>("schedule")) ?? INITIAL_STATE;
      await txn.put("schedule", penalize(state, Date.now(), delayMs));
    });
  }
  async recordHeaders(
    headers: Record<string, string>,
    source: LimitedSource,
  ): Promise<void> {
    const h = new Headers(headers);
    const remaining = Number(h.get("x-ratelimit-remaining"));
    const limit = Number(h.get("x-ratelimit-limit"));
    if (
      !h.has("x-ratelimit-remaining") ||
      !h.has("x-ratelimit-limit") ||
      !Number.isFinite(remaining) ||
      !Number.isFinite(limit) ||
      limit <= 0
    )
      return;
    const reset = Number(h.get("x-ratelimit-reset"));
    const resetAt =
      reset > 0
        ? reset > 1e9
          ? reset * 1000
          : Date.now() + reset * 1000
        : undefined;
    await this.ctx.storage.put("budget", {
      remaining,
      limit,
      warning: remaining <= limit * 0.2,
      observedAt: Date.now(),
      resetAt,
    });
    if (remaining <= 0)
      await this.penalize(
        resetAt
          ? Math.max(0, resetAt - Date.now())
          : source === "openalex"
            ? 60_000
            : 1000,
      );
  }
  /** Keep the entire connection in this object: reservation-only limiting could overlap slow responses. */
  async arxivFetch(url: string): Promise<{
    body: string;
    status: number;
    headers: Record<string, string>;
  }> {
    const parsed = new URL(url);
    if (
      parsed.origin !== "https://export.arxiv.org" ||
      parsed.pathname !== "/api/query"
    )
      throw new Error("Only the arXiv API is allowed");
    return this.ctx.blockConcurrencyWhile(async () => {
      const slot = await this.reserve("arxiv");
      if (!slot.ok) throw new RateLimitedError(slot.retryAfterMs, "arxiv");
      if (slot.waitMs)
        await new Promise((resolve) => setTimeout(resolve, slot.waitMs));
      const response = await fetch(url, { signal: AbortSignal.timeout(12000) });
      const delay = retryAfterMs(response.headers.get("retry-after"));
      if (
        delay !== undefined &&
        (response.status === 429 || response.status >= 500)
      )
        await this.penalize(delay);
      const body = await response.text();
      return {
        body,
        status: response.status,
        headers: Object.fromEntries(response.headers),
      };
    });
  }
  async status(): Promise<Budget | null> {
    return (await this.ctx.storage.get<Budget>("budget")) ?? null;
  }
}
export class RateLimitedError extends Error {
  constructor(
    readonly retryAfterMs: number,
    readonly source: LimitedSource = "s2",
  ) {
    super(
      `${source} queue is full (expected wait ${Math.ceil(retryAfterMs / 1000)}s exceeds 10s); retry later.`,
    );
    this.name = "RateLimitedError";
  }
}
export function limiter(
  env: AppEnv,
  source: LimitedSource,
): DurableObjectStub<SourceLimiter> {
  return env.SOURCE_LIMITER.get(env.SOURCE_LIMITER.idFromName(source));
}
export async function acquireSource(
  env: AppEnv,
  source: LimitedSource,
): Promise<void> {
  const slot = await limiter(env, source).reserve(source);
  if (!slot.ok) throw new RateLimitedError(slot.retryAfterMs, source);
  if (slot.waitMs)
    await new Promise((resolve) => setTimeout(resolve, slot.waitMs));
}
export function sourceDeps(env: AppEnv, source: LimitedSource) {
  return {
    acquire: () => acquireSource(env, source),
    penalize: (ms: number) => limiter(env, source).penalize(ms),
    onResponse: async (r: Response) =>
      limiter(env, source).recordHeaders(Object.fromEntries(r.headers), source),
  };
}
