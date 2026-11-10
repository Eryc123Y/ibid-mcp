import { createMcpHandler } from "agents/mcp/server";
import { beforeEach, expect, it, vi } from "vitest";
import { buildServer } from "../src/tools/server";
import { workerEnv } from "./helpers/worker-env";
import { mockFetch, json, isS2, isOA } from "./helpers/mock-fetch";
import { clearMemoryCache } from "../src/http/cache";
import venues from "./fixtures/venues.json";
import reviews from "./fixtures/openreview.json";
const { env, ctx, kv } = workerEnv();
beforeEach(() => clearMemoryCache());
async function call(name: string, args: unknown) {
  const response = await createMcpHandler(() => buildServer(env), {
    route: "/mcp",
  })(
    new Request("https://worker.example/mcp", {
      method: "POST",
      headers: {
        host: "worker.example",
        accept: "application/json, text/event-stream",
        "content-type": "application/json",
      },
      body: JSON.stringify({
        jsonrpc: "2.0",
        id: 1,
        method: "tools/call",
        params: { name, arguments: args },
      }),
    }),
    env,
    ctx,
  );
  const body = await response.text();
  const data = body.startsWith("{")
    ? body
    : body
        .split("\n")
        .find((l) => l.startsWith("data:"))!
        .slice(5);
  const result = JSON.parse(data).result as {
    content: Array<{ text: string }>;
    isError?: boolean;
  };
  return { result, data: JSON.parse(result.content[0]!.text) };
}
function fixtures() {
  const paper = {
    paperId: "test",
    corpusId: 1,
    title: "A shared synthetic paper",
    year: 2024,
    abstract: "Evidence",
    externalIds: { DOI: "10.1234/test" },
    authors: [
      { name: "Alex Example", authorId: "11" },
      { name: "Sam Example", authorId: "22" },
      { name: "Robin Example", authorId: "33" },
    ],
  };
  return mockFetch([
    {
      match: isS2("/paper/search"),
      respond: () => json({ data: [paper], total: 1 }),
    },
    { match: isS2("/paper/batch"), respond: () => json([paper]) },
    {
      match: isS2("/paper/CorpusId%3A1/citations"),
      respond: () => json({ data: [{ citingPaper: paper }], next: 10 }),
    },
    {
      match: isS2("/author/search"),
      respond: (u) =>
        json({
          data: [
            {
              authorId: u.searchParams.get("query")?.startsWith("Sam")
                ? "22"
                : u.searchParams.get("query")?.startsWith("Robin")
                  ? "33"
                  : "11",
              name: u.searchParams.get("query"),
              affiliations: ["Example University"],
              externalIds: { ORCID: "0000-0000-0000-0001" },
              papers: [paper],
            },
          ],
        }),
    },
    { match: isOA("/works"), respond: () => json({ results: [] }) },
    { match: isOA("/authors"), respond: () => json({ results: [] }) },
    {
      match: (u) => u.hostname === "api2.openreview.net",
      respond: () => json(reviews),
    },
  ]);
}
it.each([
  ["search", { query: "synthetic" }],
  ["get_paper", { ids: "10.1234/test" }],
  ["paper_links", { id: "CorpusId:1", direction: "citations" }],
  ["get_author", { name_or_id: "Alex Example", include_papers: true }],
  ["coauthorship", { author_a: "Alex Example", author_b: "Sam Example" }],
  ["reviews", { query: "syntheticForum" }],
  ["venue", { query: "SSW" }],
])(
  "executes the %s tool over the real MCP transport with provenance",
  async (name, args) => {
    kv.set("litscout:venues", JSON.stringify(venues));
    vi.stubGlobal("fetch", fixtures().fetch);
    const { result, data } = await call(name as string, args);
    expect(result.isError).not.toBe(true);
    expect(data.sources_used.length).toBeGreaterThan(0);
    expect(data.sources_skipped).toEqual(expect.any(Array));
    if (name === "get_author")
      expect(data.result).toContain("0000-0000-0000-0001");
  },
);
it("finds papers shared by three authors", async () => {
  vi.stubGlobal("fetch", fixtures().fetch);
  const { result, data } = await call("coauthorship", {
    authors: ["Alex Example", "Sam Example", "Robin Example"],
  });
  expect(result.isError).not.toBe(true);
  expect(data.result).toContain("A shared synthetic paper");
});
it("reports missing venue data and failed reviews without false success", async () => {
  kv.delete("litscout:venues");
  const v = await call("venue", { query: "SSW" });
  expect(v.data.sources_skipped[0].source).toBe("venue_table");
  vi.stubGlobal(
    "fetch",
    async () => new Response("upstream secret response", { status: 403 }),
  );
  const r = await call("reviews", { query: "syntheticForum" });
  expect(r.result.isError).toBe(true);
  expect(r.data.sources_skipped[0]).toEqual({
    source: "openreview",
    reason: "HTTP 403",
  });
  expect(JSON.stringify(r)).not.toContain("upstream secret response");
});
