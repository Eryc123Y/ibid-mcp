import { beforeEach, expect, it } from "vitest";
import { createS2Client } from "../src/sources/s2";
import { createOpenAlexClient } from "../src/sources/openalex";
import { getPapers, paperLinks } from "../src/tools/papers";
import {
  getAuthor,
  coauthorship,
  coauthorshipGroup,
} from "../src/tools/authors";
import { clearMemoryCache } from "../src/http/cache";
import { mockFetch, json, isS2, isOA, type Route } from "./helpers/mock-fetch";
import type { ToolContext } from "../src/tools/context";
import { RateLimitedError } from "../src/limiter/source-limiter";
beforeEach(() => clearMemoryCache());
function context(routes: Route[], limited = false): ToolContext {
  const { fetch } = mockFetch(routes);
  return {
    s2: createS2Client({
      fetchImpl: fetch,
      acquire: async () => {
        if (limited) throw new RateLimitedError(12000);
      },
      penalize: async () => {},
    }),
    oa: createOpenAlexClient({ fetchImpl: fetch }),
    notices: [],
  };
}
const work = {
  id: "https://openalex.org/W1",
  doi: "https://doi.org/10.1234/test",
  display_name: "An example titled paper",
  publication_year: 2024,
  abstract_inverted_index: { Abstract: [0] },
};
it("resolves OpenAlex ids to S2, fills missing abstracts and preserves batch misses", async () => {
  const c = context([
    { match: isOA("/works"), respond: () => json({ results: [work] }) },
    {
      match: isS2("/paper/batch"),
      respond: () =>
        json([
          {
            paperId: "s",
            title: work.display_name,
            year: 2024,
            externalIds: { DOI: "10.1234/test" },
          },
          null,
        ]),
    },
  ]);
  const result = await getPapers(c, ["W1", "CorpusId:999"], true);
  expect(result.papers[0]).toMatchObject({ abstract: "Abstract", s2Id: "s" });
  expect(result.not_found).toEqual(["CorpusId:999"]);
});
it.each(["W1", "10.1234/test", "2401.00001"])(
  "fills identifier %s from OpenAlex when S2 is unavailable",
  async (id) => {
    const w =
      id === "2401.00001"
        ? { ...work, doi: "https://doi.org/10.48550/arxiv.2401.00001" }
        : work;
    const c = context(
      [{ match: isOA("/works"), respond: () => json({ results: [w] }) }],
      true,
    );
    expect((await getPapers(c, [id], false)).papers).toHaveLength(1);
  },
);
it("handles titles missed by S2, unmatched titles and source outages", async () => {
  const routes = [
    { match: isS2("/paper/search"), respond: () => json({ data: [] }) },
    { match: isOA("/works"), respond: () => json({ results: [work] }) },
  ];
  expect(
    (await getPapers(context(routes), [work.display_name], false)).papers,
  ).toHaveLength(1);
  expect(
    (await getPapers(context(routes), ["Unrelated title"], false)).not_found,
  ).toEqual(["Unrelated title"]);
  expect(
    (await getPapers(context(routes, true), [work.display_name], false)).papers,
  ).toHaveLength(1);
});
it("pages fallback citations and references, and handles missing or unsupported ids", async () => {
  const c = context(
    [
      {
        match: isOA("/works/W1"),
        respond: () => json({ referenced_works: ["https://openalex.org/W2"] }),
      },
      { match: isOA("/works"), respond: () => json({ results: [work] }) },
    ],
    true,
  );
  expect(
    await paperLinks(c, {
      id: "W1",
      direction: "references",
      offset: 0,
      limit: 10,
    }),
  ).toContain("References of");
  expect(
    await paperLinks(c, {
      id: "10.1234/test",
      direction: "citations",
      offset: 10,
      limit: 10,
    }),
  ).toContain("Papers citing");
  expect(
    await paperLinks(c, {
      id: "W1",
      direction: "references",
      offset: 10,
      limit: 10,
    }),
  ).toContain("No references");
  await expect(
    paperLinks(c, {
      id: "CorpusId:1",
      direction: "references",
      offset: 0,
      limit: 10,
    }),
  ).rejects.toThrow("fallback needs");
  await expect(
    paperLinks(c, {
      id: "W1",
      direction: "recommendations",
      offset: 0,
      limit: 10,
    }),
  ).rejects.toThrow("Recommendations require");
  const empty = context(
    [{ match: isOA("/works"), respond: () => json({ results: [] }) }],
    true,
  );
  expect(
    await paperLinks(empty, {
      id: "10.1234/missing",
      direction: "citations",
      offset: 0,
      limit: 10,
    }),
  ).toContain("No citations");
});
it("supports a DOI-less OpenAlex work for links without an S2 address", async () => {
  const c = context([
    {
      match: isOA("/works"),
      respond: () => json({ results: [{ ...work, doi: null }] }),
    },
  ]);
  expect(
    await paperLinks(c, {
      id: "W1",
      direction: "citations",
      offset: 0,
      limit: 10,
    }),
  ).toContain("OpenAlex");
});
it.each(["123", "A1", "0000-0002-1825-0097"])(
  "resolves explicit author %s and returns ORCID/affiliation evidence",
  async (id) => {
    const c = context([
      {
        match: isS2("/author/batch"),
        respond: () =>
          json([{ authorId: "123", name: "Alex Example", papers: [] }]),
      },
      { match: isS2("/author/search"), respond: () => json({ data: [] }) },
      {
        match: isOA("/authors"),
        respond: () =>
          json({
            results: [
              {
                id: "https://openalex.org/A1",
                display_name: "Alex Example",
                orcid: "https://orcid.org/0000-0002-1825-0097",
                last_known_institutions: [
                  { display_name: "Example University" },
                ],
              },
            ],
          }),
      },
      { match: isOA("/works"), respond: () => json({ results: [] }) },
    ]);
    const result = await getAuthor(c, {
      name_or_id: id,
      affiliation_hint: "Example University",
      include_papers: true,
      sort: "cited",
      limit: 10,
    });
    expect(result).toContain("Alex Example");
    expect(result).toContain("Papers: none loaded");
  },
);
it("reports absent authors for profiles, pairs and groups", async () => {
  const c = context([
    { match: () => true, respond: () => json({ data: [], results: [] }) },
  ]);
  expect(
    await getAuthor(c, {
      name_or_id: "Absent Example",
      include_papers: false,
      sort: "recent",
      limit: 10,
    }),
  ).toContain("No author found");
  expect(
    await coauthorship(c, {
      author_a: "A99",
      author_b: "Missing Person",
      limit: 10,
    }),
  ).toContain("not found");
  expect(
    await coauthorshipGroup(c, ["A99", "Missing Person", "Other Person"], 10),
  ).toContain("not found");
});
