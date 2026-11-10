import { beforeEach, expect, it, vi } from "vitest";
import { createS2Client, mapS2Paper } from "../src/sources/s2";
import {
  createOpenAlexClient,
  mapWork,
  abstractFromInvertedIndex,
  budgetNotice,
  recordBudget,
  shortId,
} from "../src/sources/openalex";
import { clearMemoryCache } from "../src/http/cache";
import { json, mockFetch } from "./helpers/mock-fetch";
beforeEach(() => clearMemoryCache());
it("maps sparse and null upstream paper records without inventing metadata", () => {
  for (const raw of [
    {},
    { paperId: null, externalIds: null, authors: null, openAccessPdf: null },
    {
      authors: [{}],
      externalIds: { DOI: 3, ArXiv: 7 },
      openAccessPdf: { url: null },
    },
  ])
    expect(mapS2Paper(raw)).toMatchObject({
      source: "s2",
      title: "(untitled)",
    });
  expect(
    mapS2Paper({
      paperId: "id",
      externalIds: { ArXiv: "2401.00001", DOI: "10.1234/UPPER" },
      openAccessPdf: { url: "https://oa.example/p.pdf" },
    }),
  ).toMatchObject({
    arxiv: "2401.00001",
    doi: "10.1234/upper",
    pdfUrl: "https://oa.example/p.pdf",
  });
  for (const raw of [
    {},
    { authorships: [{}], open_access: {}, primary_location: {} },
    {
      authorships: [{ author: { display_name: null } }],
      primary_location: { source: {} },
    },
  ])
    expect(mapWork(raw)).toMatchObject({
      source: "openalex",
      title: "(untitled)",
    });
  expect(mapWork({ doi: "10.48550/arxiv.2401.00001" }).arxiv).toBe(
    "2401.00001",
  );
  expect(shortId(null)).toBe("");
  expect(abstractFromInvertedIndex({})).toBeUndefined();
  expect(abstractFromInvertedIndex({ world: [1], Hello: [0] })).toBe(
    "Hello world",
  );
});
it("handles S2 empty batches, sparse authors, paper links, errors and optional filters", async () => {
  const fetchImpl = vi.fn(
    async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = new URL(String(input));
      if (url.pathname.endsWith("/paper/batch")) return json([null, {}]);
      if (url.pathname.endsWith("/author/batch"))
        return json([
          null,
          {},
          {
            authorId: "1",
            name: null,
            aliases: null,
            affiliations: null,
            externalIds: null,
            papers: null,
          },
        ]);
      if (url.pathname.endsWith("/author/search")) return json({ data: [{}] });
      if (url.pathname.endsWith("/citations"))
        return json({
          data: [{}, { citingPaper: { title: "Citing paper" } }],
          next: 2,
        });
      if (url.pathname.endsWith("/references"))
        return new Response("", { status: 404 });
      if (init?.method === "POST") return json([]);
      return json({});
    },
  );
  const c = createS2Client({
    apiKey: "synthetic",
    fetchImpl,
    acquire: async () => {},
    penalize: async () => {},
  });
  expect(await c.paperBatch([], false)).toEqual([]);
  expect(await c.authorBatch([], false)).toEqual([]);
  expect(await c.paperBatch(["x"], false)).toHaveLength(2);
  expect(await c.authorBatch(["1"], false)).toHaveLength(1);
  expect(await c.searchAuthors("Alex-Example", 10, false)).toHaveLength(1);
  expect((await c.links("id", "citations", 10, 0)).papers).toHaveLength(1);
  expect((await c.links("id", "references", 10, 0)).papers).toEqual([]);
  expect(
    (await c.searchPapers("query", { yearFrom: 2024, limit: 10, offset: 0 }))
      .total,
  ).toBe(0);
  await c.searchPapers("query", {
    yearTo: 2024,
    venue: "Venue",
    limit: 10,
    offset: 0,
  });
  expect(
    new Headers(fetchImpl.mock.calls[0]?.[1]?.headers).get("x-api-key"),
  ).toBe("synthetic");
  clearMemoryCache();
  fetchImpl.mockResolvedValueOnce(new Response("", { status: 403 }));
  await expect(c.links("id", "references", 10, 0)).rejects.toThrow("403");
});
it("handles OpenAlex explicit ids, filters, authors, citations, references and groups without contact defaults", async () => {
  const mock = mockFetch([
    {
      match: () => true,
      respond: (u) =>
        u.pathname.startsWith("/authors")
          ? json({
              results: [
                {
                  id: "https://openalex.org/A1",
                  orcid: "https://orcid.org/0000",
                  affiliations: [{ institution: { display_name: "Example" } }],
                  display_name_alternatives: ["A. Example"],
                },
                {},
              ],
            })
          : u.pathname === "/works/W1"
            ? json({ referenced_works: ["https://openalex.org/W2"] })
            : json({ results: [], meta: { count: 0 } }),
    },
  ]);
  const c = createOpenAlexClient({
    apiKey: "synthetic",
    fetchImpl: mock.fetch,
  });
  expect(await c.authorsByIds("orcid", [])).toEqual([]);
  expect(await c.authorsByIds("orcid", ["0000"])).toHaveLength(2);
  expect(await c.referencedWorkIds("W1")).toEqual(["W2"]);
  await c.citingWorks("W1", 10, 2);
  await c.worksByAuthors(["A1"], 10, "cited");
  await c.sharedWorksMany([["A1"], ["A2"], ["A3"]], 10);
  await c.worksByIds(
    [
      { attr: "doi", value: "10.1234/a|b" },
      { attr: "ids.openalex", value: "W1" },
    ],
    false,
  );
  await c.searchWorks("query", {
    yearFrom: 2023,
    yearTo: 2024,
    limit: 10,
    page: 1,
  });
  expect(mock.calls.every((call) => !call.url.searchParams.has("mailto"))).toBe(
    true,
  );
  expect(
    mock.calls.every(
      (call) => call.url.searchParams.get("api_key") === "synthetic",
    ),
  ).toBe(true);
  expect(
    mock.calls
      .find((call) => call.url.searchParams.get("search") === "query")
      ?.url.searchParams.get("filter"),
  ).toContain("2024-12-31");
});
it("warns exactly at 20 percent, ignores malformed budgets, and accepts explicit opt-in contact only", async () => {
  recordBudget(
    new Headers({ "x-ratelimit-limit": "100", "x-ratelimit-remaining": "20" }),
  );
  expect(budgetNotice()).toBeDefined();
  recordBudget(
    new Headers({ "x-ratelimit-limit": "100", "x-ratelimit-remaining": "21" }),
  );
  expect(budgetNotice()).toBeUndefined();
  recordBudget(new Headers({ "x-ratelimit-limit": "invalid" }));
  expect(budgetNotice()).toBeUndefined();
  const fetchImpl = vi.fn(async () => json({}));
  const c = createOpenAlexClient({ fetchImpl, mailto: "explicit-opt-in" });
  await c.searchAuthors("name", 1);
  expect(String(vi.mocked(fetchImpl).mock.calls[0])).toBeDefined();
});
