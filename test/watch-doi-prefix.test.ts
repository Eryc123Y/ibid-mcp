import { beforeEach, expect, it } from "vitest";
import { clearMemoryCache } from "../src/http/cache";
import { matchesPrefix } from "../cli/watch/doi-prefix";
import { json } from "./helpers/mock-fetch";
import { fixture, harness, host } from "./helpers/watch-harness";

beforeEach(() => clearMemoryCache());

const ITP = {
  name: "ITP",
  kind: "conference",
  group: "Logic",
  doi_prefix: "10.4230/LIPIcs.ITP",
};
const ARGS = [
  "--since",
  "2026-07-01",
  "--venues",
  "list.json",
  "--kinds",
  "conference",
];

it("asks DataCite for the prefix's DOIs created in the window and enriches them through OpenAlex", async () => {
  const h = harness(
    [
      ITP,
      { name: "ICALP", kind: "conference", doi_prefix: "10.4230/LIPIcs.ICALP" },
    ],
    [
      {
        match: host("doi.org"),
        respond: (url) => {
          expect(url.pathname).toBe("/ra/10.4230");
          return json(JSON.parse(fixture("doi-ra-10.4230.json")));
        },
      },
      {
        match: host("api.datacite.org"),
        respond: (url) => {
          const query = url.searchParams.get("query")!;
          expect(url.searchParams.get("page[cursor]")).toBe("1");
          expect(url.searchParams.get("fields[dois]")).toContain(
            "descriptions",
          );
          return json(
            query.startsWith("id:10.4230/lipics.itp*")
              ? JSON.parse(fixture("datacite-itp.json"))
              : { data: [], meta: { total: 0 } },
          );
        },
      },
      {
        match: host("api.openalex.org"),
        respond: () =>
          json({
            results: [
              {
                doi: "https://doi.org/10.4230/lipics.itp.2026.36",
                open_access: { oa_url: "https://drops.dagstuhl.de/x.pdf" },
                abstract_inverted_index: { From: [0], OpenAlex: [1] },
              },
            ],
          }),
      },
    ],
    { OPENALEX_API_KEY: "k" },
  );
  expect(await h.run([...ARGS, "--until", "2026-11-11"])).toBe(0);
  const datacite = h.calls.filter((c) => c.url.hostname === "api.datacite.org");
  expect(datacite.map((c) => c.url.searchParams.get("query"))).toEqual([
    "id:10.4230/lipics.itp* AND created:[2026-07-01 TO 2026-11-12}",
    "id:10.4230/lipics.icalp* AND created:[2026-07-01 TO 2026-11-12}",
  ]);
  // one registration-agency lookup for the shared prefix
  expect(h.calls.filter((c) => c.url.hostname === "doi.org")).toHaveLength(1);
  const lines = h.lines();
  expect(lines.map((l) => l.doi)).toEqual([
    "10.4230/lipics.itp.2026.2",
    "10.4230/lipics.itp.2026.36",
  ]);
  expect(lines[0]).toEqual({
    source: "datacite",
    title:
      "Developing a Quantum Crypto Theorem Prover from Scratch (Invited Talk)",
    authors: ["Dominique Unruh"],
    venue: "ITP",
    published: "2026-07-16",
    doi: "10.4230/lipics.itp.2026.2",
    arxiv_id: null,
    openreview_id: null,
    abstract:
      "Synthetic abstract for paper 2: the recorded text is not committed.",
    oa_url: null,
    url: "https://doi.org/10.4230/lipics.itp.2026.2",
  });
  expect(lines[1]).toMatchObject({
    authors: [
      "Jonas Bodingbauer",
      "Márton Hajdu",
      "Laura Kovács",
      "Axel Polaczek",
      "Michael Rawson",
    ],
    abstract:
      "Synthetic abstract for paper 3: the recorded text is not committed.",
    oa_url: "https://drops.dagstuhl.de/x.pdf",
  });
  expect(h.stderr()).toMatch(/DataCite 2, doi\.org 1/);
});

it("pages Crossref by registrant prefix for Crossref DOIs and keeps only DOIs under the series prefix", async () => {
  const item = (doi: string) => ({
    DOI: doi,
    title: [`Paper ${doi}`],
    author: [{ given: "Kurt", family: "Gödel" }],
    created: { "date-time": "2026-07-02T00:00:00Z" },
    published: { "date-parts": [[2026, 7, 2]] },
    type: "proceedings-article",
  });
  const h = harness(
    [{ name: "Series", kind: "journal", doi_prefix: "10.1234/ABC" }],
    [
      {
        match: host("doi.org"),
        respond: () => json([{ DOI: "10.1234", RA: "Crossref" }]),
      },
      {
        match: host("api.crossref.org"),
        respond: (url) => {
          expect(url.searchParams.get("filter")).toBe(
            "prefix:10.1234,from-created-date:2026-07-01",
          );
          return json({
            message: {
              items: [
                item("10.1234/abc.1"),
                item("10.1234/abcd.2"),
                item("10.1234/xyz.3"),
              ],
            },
          });
        },
      },
    ],
  );
  expect(await h.run(["--since", "2026-07-01", "--venues", "list.json"])).toBe(
    0,
  );
  expect(h.lines()).toEqual([
    expect.objectContaining({
      source: "crossref",
      doi: "10.1234/abc.1",
      authors: ["Kurt Gödel"],
    }),
  ]);
});

it("skips a registration agency it cannot read, and rejects malformed prefixes before any request", async () => {
  const h = harness(
    [
      { name: "Odd", kind: "journal", doi_prefix: "10.5555/X" },
      { name: "Bad", kind: "journal", doi_prefix: "10.4230/x y*" },
    ],
    [
      {
        match: host("doi.org"),
        respond: () => json([{ DOI: "10.5555", RA: "mEDRA" }]),
      },
    ],
  );
  expect(await h.run(["--since", "2026-07-01", "--venues", "list.json"])).toBe(
    0,
  );
  const stderr = h.stderr();
  expect(stderr).toContain(
    "Odd: DOI prefix registered with mEDRA, which watch does not read; skipped",
  );
  expect(stderr).toContain("Bad: doi_prefix is not a DOI prefix; ignored");
  expect(h.calls).toHaveLength(1);
});

it("matches DOI prefixes only at a boundary", () => {
  expect(matchesPrefix("10.4230/lipics.itp.2026.1", "10.4230/LIPIcs.ITP")).toBe(
    true,
  );
  expect(matchesPrefix("10.4230/lipics.itp", "10.4230/LIPIcs.ITP")).toBe(true);
  expect(matchesPrefix("10.4230/lipics.itpx.1", "10.4230/LIPIcs.ITP")).toBe(
    false,
  );
  expect(matchesPrefix("10.4230/lipics.itp-2", "10.4230/LIPIcs.ITP")).toBe(
    true,
  );
});

it("warns when Crossref's page cap cuts a registrant's listing short", async () => {
  const items = Array.from({ length: 200 }, (_, i) => ({
    DOI: `10.1234/other.${i}`,
    title: [`Other ${i}`],
    created: { "date-time": "2026-07-02T00:00:00Z" },
    published: { "date-parts": [[2026, 7, 2]] },
    type: "journal-article",
  }));
  const h = harness(
    [{ name: "Big", kind: "journal", doi_prefix: "10.1234/ABC" }],
    [
      {
        match: host("doi.org"),
        respond: () => json([{ DOI: "10.1234", RA: "Crossref" }]),
      },
      {
        match: host("api.crossref.org"),
        respond: () => json({ message: { items, "next-cursor": "more" } }),
      },
    ],
  );
  expect(await h.run(["--since", "2026-07-01", "--venues", "list.json"])).toBe(
    0,
  );
  expect(
    h.calls.filter((c) => c.url.hostname === "api.crossref.org"),
  ).toHaveLength(50);
  expect(h.stderr()).toContain(
    "Big: Crossref listed at least 10000 works under 10.1234 in the window; some of the series may be missing",
  );
});
