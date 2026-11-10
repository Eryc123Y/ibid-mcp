import { describe, expect, it, vi } from "vitest";
import { RateLimitedError, S2RateLimiter } from "../src/limiter/s2-limiter";
import {
  INITIAL_STATE,
  intervalFor,
  KEYED_INTERVAL_MS,
  KEYLESS_INTERVAL_MS,
  penalize,
  reserve,
} from "../src/limiter/schedule";

describe("reserve (pure schedule)", () => {
  it("lets the first request go immediately and spaces the next ones by the interval", () => {
    const now = 1_000_000;
    const a = reserve(INITIAL_STATE, now, 1000, 10_000);
    const b = reserve(a.state, now, 1000, 10_000);
    const c = reserve(b.state, now + 200, 1000, 10_000);
    expect(a.result).toEqual({ ok: true, waitMs: 0 });
    expect(b.result).toEqual({ ok: true, waitMs: 1000 });
    expect(c.result).toEqual({ ok: true, waitMs: 1800 });
    expect(c.state.nextFreeAt).toBe(now + 3000);
  });

  it("does not bank unused time (burst of 1)", () => {
    const first = reserve(INITIAL_STATE, 0, 1000, 10_000);
    const muchLater = reserve(first.state, 60_000, 1000, 10_000);
    const next = reserve(muchLater.state, 60_000, 1000, 10_000);
    expect(muchLater.result).toEqual({ ok: true, waitMs: 0 });
    expect(next.result).toEqual({ ok: true, waitMs: 1000 });
  });

  it("refuses when the queue exceeds maxWait and leaves the state unchanged", () => {
    let state = INITIAL_STATE;
    for (let i = 0; i < 11; i += 1) state = reserve(state, 0, 1000, 10_000).state;
    const refused = reserve(state, 0, 1000, 10_000);
    expect(refused.result).toEqual({ ok: false, retryAfterMs: 11_000 });
    expect(refused.state).toBe(state);
  });

  it("penalize pushes the queue back but never forward", () => {
    const s = { nextFreeAt: 5000 };
    expect(penalize(s, 1000, 10_000)).toEqual({ nextFreeAt: 11_000 });
    expect(penalize(s, 1000, 1000)).toEqual({ nextFreeAt: 5000 });
  });

  it("uses a slower interval without an API key", () => {
    expect(intervalFor(true)).toBe(KEYED_INTERVAL_MS);
    expect(intervalFor(false)).toBe(KEYLESS_INTERVAL_MS);
    expect(KEYED_INTERVAL_MS).toBeGreaterThanOrEqual(1000);
    expect(KEYLESS_INTERVAL_MS).toBeGreaterThan(KEYED_INTERVAL_MS);
  });
});

describe("S2RateLimiter durable object", () => {
  const make = (key?: string) => new S2RateLimiter({} as never, { S2_API_KEY: key } as never);

  it("serialises concurrent callers into increasing waits", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(0);
    const limiter = make("k");
    const results = await Promise.all([limiter.reserve(), limiter.reserve(), limiter.reserve()]);
    expect(results.map((r) => (r.ok ? r.waitMs : -1))).toEqual([0, KEYED_INTERVAL_MS, 2 * KEYED_INTERVAL_MS]);
    vi.useRealTimers();
  });

  it("answers rate-limited instead of queueing past the max wait", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(0);
    const limiter = make(undefined); // keyless: 3 s spacing
    const results = [];
    for (let i = 0; i < 6; i += 1) results.push(await limiter.reserve(10_000));
    expect(results.filter((r) => r.ok)).toHaveLength(4); // waits 0, 3, 6, 9 s
    expect(results[4]).toEqual({ ok: false, retryAfterMs: 12_000 });
    vi.useRealTimers();
  });

  it("applies 429 penalties to later reservations", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(0);
    const limiter = make("k");
    await limiter.penalize(5000);
    expect(await limiter.reserve()).toEqual({ ok: true, waitMs: 5000 });
    vi.useRealTimers();
  });

  it("RateLimitedError tells the agent what happened", () => {
    expect(new RateLimitedError(12_000).message).toMatch(/1 request\/s shared by all clients; queue ~12s/);
  });
});
