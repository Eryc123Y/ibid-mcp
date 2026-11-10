import { beforeEach, expect, it, vi } from "vitest";
import { cached, clearMemoryCache } from "../src/http/cache";
import { requestJson, HttpError } from "../src/http/json";
import { fetchWithRetry, retryAfterMs } from "../src/http/fetch-retry";
beforeEach(() => clearMemoryCache());
it("never caches invalid JSON or upstream error bodies", async () => {
  const fetchImpl = vi
    .fn()
    .mockResolvedValueOnce(new Response("not json"))
    .mockResolvedValueOnce(Response.json({ ok: true }));
  const request = {
    url: "https://example.test",
    service: "test",
    init: {},
    cacheKey: "malformed",
    retry: { retries: 0, baseDelayMs: 1, fetchImpl },
  };
  await expect(requestJson(request)).rejects.toBeInstanceOf(HttpError);
  expect(await requestJson(request)).toEqual({ ok: true });
  expect(fetchImpl).toHaveBeenCalledTimes(2);
});
it("uses Cache API hits, handles unavailable cache, expires entries and bounds the memory cache", async () => {
  const match = vi.fn(async () => new Response("edge cached"));
  const put = vi.fn();
  vi.stubGlobal("caches", { open: async () => ({ match, put }) });
  const load = vi.fn(async () => ({ body: "loaded", cacheable: true }));
  expect(await cached("key", 1, load)).toBe("edge cached");
  expect(load).not.toHaveBeenCalled();
  vi.stubGlobal("caches", {
    open: async () => {
      throw new Error("unavailable");
    },
  });
  clearMemoryCache();
  vi.useFakeTimers();
  await cached("expires", 1, load);
  vi.advanceTimersByTime(1001);
  await cached("expires", 1, load);
  expect(load).toHaveBeenCalledTimes(2);
  for (let i = 0; i < 301; i++) await cached(String(i), 10, load);
  await cached("0", 10, load);
  expect(load).toHaveBeenCalledTimes(304);
});
it("writes only cacheable responses and ignores cache-write failures", async () => {
  const put = vi.fn(async () => {
    throw new Error("unavailable");
  });
  vi.stubGlobal("caches", {
    open: async () => ({ match: async () => undefined, put }),
  });
  await cached("ok", 10, async () => ({ body: "ok", cacheable: true }));
  expect(put).toHaveBeenCalledTimes(1);
  const load = vi.fn(async () => ({ body: "no-store", cacheable: false }));
  await cached("no", 10, load);
  await cached("no", 10, load);
  expect(load).toHaveBeenCalledTimes(2);
});
it("handles network retries, non-Error throws, dates and the final failure", async () => {
  const fetchImpl = vi
    .fn()
    .mockRejectedValueOnce(new Error("network"))
    .mockResolvedValueOnce(new Response("ok"));
  expect(
    (
      await fetchWithRetry(
        "https://example.test",
        {},
        { retries: 1, baseDelayMs: 1, fetchImpl, sleep: async () => {} },
      )
    ).status,
  ).toBe(200);
  await expect(
    fetchWithRetry(
      "https://example.test",
      {},
      {
        retries: 0,
        baseDelayMs: 1,
        fetchImpl: async () => {
          throw "network";
        },
      },
    ),
  ).rejects.toThrow("fetch failed");
  vi.useFakeTimers();
  vi.setSystemTime(0);
  expect(retryAfterMs("Thu, 01 Jan 1970 00:00:05 GMT")).toBe(5000);
  expect(retryAfterMs("bad-date")).toBeUndefined();
  expect(retryAfterMs("-1")).toBe(0);
});
