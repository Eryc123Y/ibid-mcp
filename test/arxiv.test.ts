import { readFileSync } from "node:fs";
import { beforeEach, expect, it, vi } from "vitest";
import { createArxivClient } from "../src/sources/arxiv";
import { SourceLimiter } from "../src/limiter/source-limiter";
import { memoryState } from "./helpers/storage";
import type { AppEnv } from "../src/env";
import { clearMemoryCache } from "../src/http/cache";
const xml = readFileSync("test/fixtures/arxiv.xml", "utf8");
beforeEach(() => clearMemoryCache());
it("parses Atom namespaces, entities, authors, versionless ids and DOI", async () => {
  const fetchImpl = vi.fn(async (_url: RequestInfo | URL) => new Response(xml));
  const c = createArxivClient({ fetchImpl });
  const r = await c.search({
    query: "graph networks",
    category: "cs.AI",
    recent: true,
    limit: 10,
    offset: 0,
  });
  expect(r.papers[0]).toMatchObject({
    source: "arxiv",
    title: "Example & synthetic preprint",
    arxiv: "2401.00001",
    doi: "10.1234/synthetic",
    year: 2024,
    authors: [{ name: "Alex Example" }, { name: "Sam Example" }],
  });
  const url = new URL(String(fetchImpl.mock.calls[0]![0]));
  expect(url.searchParams.get("sortBy")).toBe("submittedDate");
  expect(url.searchParams.get("search_query")).toContain("cat:cs.AI");
});
it("supports category-only listings and rejects malformed feeds and API errors", async () => {
  const fetchImpl = vi.fn(
    async () => new Response('<feed xmlns="http://www.w3.org/2005/Atom"/>'),
  );
  const c = createArxivClient({ fetchImpl });
  expect(
    (await c.search({ query: "", category: "cs.CV", limit: 10, offset: 0 }))
      .papers,
  ).toEqual([]);
  clearMemoryCache();
  fetchImpl.mockResolvedValueOnce(new Response("<html>not Atom</html>"));
  await expect(
    c.search({ query: "", category: "cs.CV", limit: 10, offset: 0 }),
  ).rejects.toThrow("feed");
  clearMemoryCache();
  fetchImpl.mockResolvedValueOnce(
    new Response(
      "<feed><entry><id>http://arxiv.org/api/errors#bad_query</id><summary>Bad query</summary></entry></feed>",
    ),
  );
  await expect(
    c.search({ query: "bad", limit: 10, offset: 0 }),
  ).rejects.toThrow();
});
it("serializes arXiv fetches through the durable object, spacing starts by at least three seconds", async () => {
  vi.useFakeTimers();
  vi.setSystemTime(0);
  const starts: number[] = [];
  vi.stubGlobal(
    "fetch",
    vi.fn(async () => {
      starts.push(Date.now());
      await new Promise((r) => setTimeout(r, 4000));
      return new Response(xml);
    }),
  );
  const store = new SourceLimiter(memoryState().state, {} as AppEnv);
  const pending = Promise.all([
    store.arxivFetch("https://export.arxiv.org/api/query?search_query=all:one"),
    store.arxivFetch("https://export.arxiv.org/api/query?search_query=all:two"),
  ]);
  await vi.runAllTimersAsync();
  await pending;
  expect(starts).toEqual([0, 4000]);
  await expect(store.arxivFetch("https://untrusted.example")).rejects.toThrow(
    "arXiv",
  );
});
