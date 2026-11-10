import { describe, expect, it, vi } from "vitest";
import {
  backoffMs,
  fetchWithRetry,
  retryAfterMs,
} from "../src/http/fetch-retry";
import { RateLimitedError } from "../src/limiter/source-limiter";

const noSleep = async () => {};

describe("fetchWithRetry", () => {
  it("retries 429 and 5xx, acquiring a slot before every attempt", async () => {
    const statuses = [429, 503, 200];
    const fetchImpl = vi.fn(
      async () => new Response("x", { status: statuses.shift() ?? 200 }),
    );
    const beforeAttempt = vi.fn(async () => {});
    const onThrottled = vi.fn(async () => {});
    const res = await fetchWithRetry(
      "https://x",
      {},
      {
        retries: 2,
        baseDelayMs: 10,
        beforeAttempt,
        onThrottled,
        fetchImpl,
        sleep: noSleep,
      },
    );
    expect(res.status).toBe(200);
    expect(fetchImpl).toHaveBeenCalledTimes(3);
    expect(beforeAttempt).toHaveBeenCalledTimes(3);
    expect(onThrottled).toHaveBeenCalledTimes(1);
  });

  it("returns the last error response once retries are exhausted", async () => {
    const fetchImpl = vi.fn(async () => new Response("busy", { status: 429 }));
    const res = await fetchWithRetry(
      "https://x",
      {},
      { retries: 1, baseDelayMs: 10, fetchImpl, sleep: noSleep },
    );
    expect(res.status).toBe(429);
    expect(fetchImpl).toHaveBeenCalledTimes(2);
  });

  it("does not retry client errors", async () => {
    const fetchImpl = vi.fn(async () => new Response("nope", { status: 404 }));
    const res = await fetchWithRetry(
      "https://x",
      {},
      { retries: 3, baseDelayMs: 10, fetchImpl, sleep: noSleep },
    );
    expect(res.status).toBe(404);
    expect(fetchImpl).toHaveBeenCalledTimes(1);
  });

  it("honours Retry-After (capped) when sleeping", async () => {
    const statuses = [429, 200];
    const fetchImpl = vi.fn(
      async () =>
        new Response("", {
          status: statuses.shift() ?? 200,
          headers: { "retry-after": "3" },
        }),
    );
    const sleep = vi.fn(async () => {});
    await fetchWithRetry(
      "https://x",
      {},
      { retries: 1, baseDelayMs: 10, fetchImpl, sleep },
    );
    expect(sleep).toHaveBeenCalledWith(3000);
  });

  it("propagates RateLimitedError from the limiter without retrying", async () => {
    const fetchImpl = vi.fn(async () => new Response(""));
    const beforeAttempt = async () => {
      throw new RateLimitedError(15_000);
    };
    await expect(
      fetchWithRetry(
        "https://x",
        {},
        {
          retries: 3,
          baseDelayMs: 10,
          beforeAttempt,
          fetchImpl,
          sleep: noSleep,
        },
      ),
    ).rejects.toBeInstanceOf(RateLimitedError);
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it("parses Retry-After and computes capped exponential backoff", () => {
    expect(retryAfterMs("2")).toBe(2000);
    expect(retryAfterMs(null)).toBeUndefined();
    expect(backoffMs(0, 1000, 8000)).toBe(1000);
    expect(backoffMs(5, 1000, 8000)).toBe(8000);
  });
});

it("does not retry before a long Retry-After, and propagates the full penalty", async () => {
  const onThrottled = vi.fn(async () => {});
  const fetchImpl = vi.fn(
    async () =>
      new Response("busy", { status: 429, headers: { "retry-after": "60" } }),
  );
  const response = await fetchWithRetry(
    "https://x",
    {},
    { retries: 2, baseDelayMs: 10, fetchImpl, onThrottled, sleep: noSleep },
  );
  expect(response.status).toBe(429);
  expect(fetchImpl).toHaveBeenCalledTimes(1);
  expect(onThrottled).toHaveBeenCalledWith(60000);
});

it("penalizes the source even when the final attempt is throttled", async () => {
  const onThrottled = vi.fn(async () => {});
  await fetchWithRetry(
    "https://x",
    {},
    {
      retries: 0,
      baseDelayMs: 1,
      onThrottled,
      fetchImpl: async () =>
        new Response("", { status: 429, headers: { "retry-after": "20" } }),
    },
  );
  expect(onThrottled).toHaveBeenCalledWith(20000);
});
