import { beforeEach, expect, it } from "vitest";
import { clearMemoryCache } from "../src/http/cache";
import { citeprocPapers, pmlrVolumes } from "../cli/watch/pmlr";
import { fixture, harness, host, text } from "./helpers/watch-harness";

beforeEach(() => clearMemoryCache());

const COLT = {
  name: "COLT",
  kind: "conference",
  group: "Theory",
  pmlr: "COLT",
};
const ARGS = [
  "--since",
  "2026-06-01",
  "--venues",
  "list.json",
  "--kinds",
  "conference",
];

function pmlr(files: Record<string, string>) {
  return {
    match: host("proceedings.mlr.press"),
    respond: (url: URL) => {
      const body = files[url.pathname];
      return body === undefined ? text("not found", 404) : text(body);
    },
  };
}

it("reads the PMLR volumes of a series published in the window, from the official index and citeproc data", async () => {
  const v336 = fixture("pmlr-v336-citeproc.yaml");
  const h = harness(
    [COLT],
    [
      pmlr({
        "/proceedings.yaml": fixture("pmlr-proceedings.yaml"),
        "/v336/assets/bib/citeproc.yaml": v336,
        "/v291/assets/bib/citeproc.yaml": v336.replaceAll(
          "2026-06-29",
          "2025-06-30",
        ),
      }),
    ],
  );
  expect(await h.run(ARGS)).toBe(0);
  expect(h.lines()).toEqual([
    {
      source: "pmlr",
      title: "How fast can you find a good hypothesis?",
      authors: [
        "Anders Aamand",
        "Maryam Aliakbarpour",
        "Justin Y. Chen",
        "Sandeep Silwal",
      ],
      venue: "COLT",
      published: "2026-06-29",
      doi: null,
      arxiv_id: null,
      openreview_id: null,
      abstract:
        "Synthetic abstract 1 with a {Brace} and an apostrophe: it's fine.",
      oa_url:
        "https://raw.githubusercontent.com/mlresearch/v336/main/assets/aamand26a/aamand26a.pdf",
      url: "https://proceedings.mlr.press/v336/aamand26a.html",
    },
  ]);
  // the preface is not a paper; UAI 2026 and COLT 2018-era volumes are never fetched
  expect(h.calls.map((c) => c.url.pathname)).toEqual([
    "/proceedings.yaml",
    "/v336/assets/bib/citeproc.yaml",
    "/v291/assets/bib/citeproc.yaml",
  ]);
  expect(h.stderr()).toMatch(/1 papers .*PMLR 3/);
});

it("fetches the PMLR index once for several series and fails per venue", async () => {
  const h = harness(
    [COLT, { name: "UAI", kind: "conference", pmlr: "UAI" }],
    [
      pmlr({
        "/proceedings.yaml": fixture("pmlr-proceedings.yaml"),
        "/v336/assets/bib/citeproc.yaml":
          "- title: 'X'\n  published: 2026-06-29\n",
        "/v291/assets/bib/citeproc.yaml": "",
      }),
    ],
  );
  expect(await h.run(ARGS)).toBe(0);
  expect(
    h.calls.filter((c) => c.url.pathname === "/proceedings.yaml"),
  ).toHaveLength(1);
  expect(h.stderr()).toContain("UAI: PMLR failed (HTTP 404)");
});

it("parses the volume index and citeproc YAML, including quoted names and prefixes", () => {
  const index = pmlrVolumes(fixture("pmlr-proceedings.yaml"));
  expect(index.find((v) => v.volume === "336")).toEqual({
    volume: "336",
    citeproc: "https://proceedings.mlr.press/v336/assets/bib/citeproc.yaml",
    series: "COLT",
    year: 2026,
  });
  expect(index.find((v) => v.volume === "r16")?.series).toBe("UAI");
  const yaml = [
    "- title: 'A ''quoted'' title",
    "    over two lines'",
    "  abstract: 'Text'",
    "  URL: https://proceedings.mlr.press/v1/a.html",
    "  PDF: http://insecure.example/a.pdf",
    "  author: ",
    "  - given: Ada",
    "    prefix: van der",
    "    family: Berg",
    "  - given: 'O''Neil'",
    '    family: "Smith"',
    "  issued:",
    "    date-parts: ",
    "      - 2026",
    "      - 3",
    "      - 4",
    "- title: 'No URL'",
  ].join("\n");
  expect(citeprocPapers(yaml)).toEqual([
    {
      title: "A 'quoted' title over two lines",
      abstract: "Text",
      authors: ["Ada van der Berg", "O'Neil Smith"],
      url: "https://proceedings.mlr.press/v1/a.html",
      pdf: null,
      published: "2026-03-04",
    },
  ]);
});
