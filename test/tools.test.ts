import { beforeEach, describe, expect, it } from "vitest";
import { clearMemoryCache } from "../src/http/cache";
import { RateLimitedError } from "../src/limiter/source-limiter";
import { createOpenAlexClient } from "../src/sources/openalex";
import { createS2Client } from "../src/sources/s2";
import { coauthorship } from "../src/tools/authors";
import type { ToolContext } from "../src/tools/context";
import { getPapers, searchPapers } from "../src/tools/papers";
import {
  isOA,
  isS2,
  json,
  type MockFetch,
  mockFetch,
  type Route,
} from "./helpers/mock-fetch";

function context(mock: MockFetch, s2Limited = false): ToolContext {
  return {
    s2: createS2Client({
      acquire: async () => {
        if (s2Limited) throw new RateLimitedError(12_000);
      },
      penalize: async () => {},
      fetchImpl: mock.fetch,
    }),
    oa: createOpenAlexClient({ fetchImpl: mock.fetch }),
    notices: [],
  };
}

const s2Author = (
  id: string,
  name: string,
  papers: unknown[],
  affiliations: string[] = [],
) => ({
  authorId: id,
  name,
  affiliations,
  papers,
});
const s2Paper = (
  corpusId: number,
  title: string,
  authors: Array<[string, string]>,
  doi?: string,
) => ({
  paperId: `p${corpusId}`,
  corpusId,
  title,
  year: 2023,
  externalIds: doi ? { DOI: doi } : {},
  authors: authors.map(([authorId, name]) => ({ authorId, name })),
});
const oaWork = (
  id: string,
  title: string,
  authorIds: Array<[string, string]>,
  doi?: string,
) => ({
  id: `https://openalex.org/${id}`,
  doi: doi ? `https://doi.org/${doi}` : null,
  display_name: title,
  publication_year: 2023,
  authorships: authorIds.map(([aid, name]) => ({
    author: { id: `https://openalex.org/${aid}`, display_name: name },
  })),
});
const oaAuthor = (id: string, name: string, inst: string) => ({
  id: `https://openalex.org/${id}`,
  display_name: name,
  last_known_institutions: [{ display_name: inst }],
});

const shared = s2Paper(
  1,
  "Shared work on graph testing",
  [
    ["11", "Jane Doe"],
    ["22", "Bob Smith"],
  ],
  "10.1234/shared",
);

function coauthorRoutes(sharedOa: unknown[]): Route[] {
  return [
    {
      match: (u) =>
        isS2("/author/search")(u) && u.searchParams.get("query") === "Jane Doe",
      respond: () =>
        json({
          data: [
            s2Author(
              "11",
              "Jane Doe",
              [
                shared,
                s2Paper(2, "Solo paper on tree search", [["11", "Jane Doe"]]),
              ],
              ["Monash University"],
            ),
          ],
        }),
    },
    {
      match: (u) =>
        isS2("/author/search")(u) &&
        u.searchParams.get("query") === "Bob Smith",
      respond: () => json({ data: [s2Author("22", "Bob Smith", [shared])] }),
    },
    {
      match: isOA(
        "/authors",
        (u) => u.searchParams.get("search") === "Jane Doe",
      ),
      respond: () =>
        json({ results: [oaAuthor("A1", "Jane Doe", "Monash University")] }),
    },
    {
      match: isOA(
        "/authors",
        (u) => u.searchParams.get("search") === "Bob Smith",
      ),
      respond: () => json({ results: [oaAuthor("A2", "Bob Smith", "NTU")] }),
    },
    {
      match: isOA(
        "/works",
        (u) => u.searchParams.get("filter") === "author.id:A1,author.id:A2",
      ),
      respond: () =>
        json({ results: sharedOa }, 200, {
          "x-ratelimit-limit": "1000",
          "x-ratelimit-remaining": "50",
        }),
    },
    {
      match: isOA(
        "/works",
        (u) =>
          (u.searchParams.get("filter") ?? "").startsWith("author.id:") &&
          !u.searchParams.get("filter")?.includes(","),
      ),
      respond: () =>
        json({
          results: [
            oaWork(
              "W10",
              "Shared Work on Graph Testing",
              [
                ["A1", "Jane Doe"],
                ["A2", "Bob Smith"],
              ],
              "10.1234/SHARED",
            ),
          ],
        }),
    },
  ];
}

beforeEach(() => clearMemoryCache());

describe("coauthorship", () => {
  it("deduplicates shared papers across S2 and OpenAlex by DOI", async () => {
    const mock = mockFetch(
      coauthorRoutes([
        oaWork(
          "W10",
          "Shared Work on Graph Testing",
          [
            ["A1", "Jane Doe"],
            ["A2", "Bob Smith"],
          ],
          "10.1234/SHARED",
        ),
        oaWork(
          "W12",
          "Another joint paper on fuzzing",
          [
            ["A1", "Jane Doe"],
            ["A2", "Bob Smith"],
          ],
          "10.1234/other",
        ),
      ]),
    );
    const ctx = context(mock);
    const text = await coauthorship(ctx, {
      author_a: "Jane Doe",
      author_b: "Bob Smith",
      limit: 10,
    });
    expect(text).toMatch(/Shared papers: 2 \(S2 1, OpenAlex 2/);
    expect(text).toMatch(/\[CorpusId:1\] Shared work on graph testing/);
    expect(text).toMatch(/\[W12\] Another joint paper on fuzzing/);
    expect(text).toMatch(/A: Jane Doe — S2 \[11\], OpenAlex \[A1\]/);
    // The S2 and OpenAlex records of Jane were merged via the shared DOI + coauthor.
    expect(text).toMatch(/merge confidence: (high|medium)/);
  });

  it("reports zero shared papers when neither source has any", async () => {
    const solo = (id: string, name: string, n: number) =>
      s2Paper(n, `Solo paper number ${n} by ${name}`, [[id, name]]);
    const routes = coauthorRoutes([]).map((r, i) =>
      i === 0
        ? {
            ...r,
            respond: () =>
              json({
                data: [s2Author("11", "Jane Doe", [solo("11", "Jane Doe", 2)])],
              }),
          }
        : i === 1
          ? {
              ...r,
              respond: () =>
                json({
                  data: [
                    s2Author("22", "Bob Smith", [solo("22", "Bob Smith", 3)]),
                  ],
                }),
            }
          : r,
    );
    const text = await coauthorship(context(mockFetch(routes)), {
      author_a: "Jane Doe",
      author_b: "Bob Smith",
      limit: 10,
    });
    expect(text).toMatch(/Shared papers: 0 \(S2 0, OpenAlex 0/);
  });

  it("surfaces the OpenAlex low-budget warning via notices", async () => {
    const { budgetNotice } = await import("../src/sources/openalex");
    await coauthorship(context(mockFetch(coauthorRoutes([]))), {
      author_a: "Jane Doe",
      author_b: "Bob Smith",
      limit: 10,
    });
    expect(budgetNotice()?.text).toMatch(
      /OpenAlex daily budget low \(50\/1000/,
    );
  });
});

describe("S2 rate-limit fallback", () => {
  it("get_paper falls back to OpenAlex and says so", async () => {
    const mock = mockFetch([
      {
        match: isOA(
          "/works",
          (u) => u.searchParams.get("filter") === "doi:10.1234/shared",
        ),
        respond: () =>
          json({
            results: [
              {
                ...oaWork(
                  "W10",
                  "Shared Work on Graph Testing",
                  [["A1", "Jane Doe"]],
                  "10.1234/shared",
                ),
                abstract_inverted_index: { Hello: [0], world: [1] },
              },
            ],
          }),
      },
    ]);
    const ctx = context(mock, true);
    const text = await getPapers(ctx, ["10.1234/shared"], false);
    expect(text.papers[0]).toMatchObject({
      id: "W10",
      title: "Shared Work on Graph Testing",
    });
    expect(text.papers[0]?.abstract).toBe("Hello world");
    expect(ctx.notices[0]?.text).toMatch(
      /queue is full .*fell back to OpenAlex/,
    );
    expect(mock.calls.every((c) => c.url.hostname === "api.openalex.org")).toBe(
      true,
    );
  });

  it("search_papers uses S2 when available and pages with offset", async () => {
    const mock = mockFetch([
      {
        match: isS2("/paper/search"),
        respond: () =>
          json({
            total: 25,
            data: [
              s2Paper(
                5,
                "Mutation testing at scale",
                [["1", "A B"]],
                "10.5555/m",
              ),
            ],
          }),
      },
    ]);
    const text = await searchPapers(context(mock), {
      query: "mutation testing",
      limit: 1,
      offset: 0,
    });
    expect(text.papers).toHaveLength(1);
    expect(text.next_offset).toBe(1);
    expect(mock.calls[0]?.url.searchParams.get("fields")).toContain(
      "externalIds",
    );
  });

  it("batches several ids into a single S2 request", async () => {
    const mock = mockFetch([
      {
        match: (u, init) => isS2("/paper/batch")(u) && init?.method === "POST",
        respond: (_u, init) => {
          const ids = (JSON.parse(String(init?.body)) as { ids: string[] }).ids;
          return json(
            ids.map((_, i) => ({
              ...s2Paper(i + 1, `Paper number ${i + 1} title`, []),
              abstract: "x",
            })),
          );
        },
      },
    ]);
    await getPapers(
      context(mock),
      ["10.1000/a", "2106.15928", "CorpusId:7"],
      false,
    );
    const s2Calls = mock.calls.filter(
      (c) => c.url.hostname === "api.semanticscholar.org",
    );
    expect(s2Calls).toHaveLength(1);
    expect(JSON.parse(String(s2Calls[0]?.init?.body))).toEqual({
      ids: ["DOI:10.1000/a", "ARXIV:2106.15928", "CorpusId:7"],
    });
  });
});
