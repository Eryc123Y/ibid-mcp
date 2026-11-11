import { beforeEach, expect, it } from "vitest";
import { clearMemoryCache } from "../src/http/cache";
import { jmlrItems } from "../cli/watch/jmlr";
import { fixture, harness, host, text } from "./helpers/watch-harness";

beforeEach(() => clearMemoryCache());

const JMLR = {
  name: "JMLR",
  kind: "journal",
  group: "ML",
  issn: ["1532-4435"],
  jmlr: true,
};
const ARGS = ["--since", "2026-11-10", "--venues", "list.json"];
const LEDGER = "/state/watch-jmlr.json";
const ENV = { LITSCOUT_STATE_DIR: "/state" };
const feed = {
  match: host("www.jmlr.org"),
  respond: () => text(fixture("jmlr.xml")),
};

const ledger = (seen: Record<string, string>) =>
  JSON.stringify({ about: "x", seen });

it("records a baseline on the first run and emits no JMLR papers", async () => {
  const h = harness([JMLR], [feed], ENV);
  expect(await h.run(ARGS)).toBe(0);
  expect(h.lines()).toEqual([]);
  const saved = JSON.parse(h.files.get(LEDGER)!) as {
    seen: Record<string, string>;
  };
  expect(Object.keys(saved.seen)).toEqual([
    "v27/25-1670",
    "v27/24-0652",
    "v27/26-1057",
    "v27/26-0847",
  ]);
  expect(Object.values(saved.seen).every((d) => d === "baseline")).toBe(true);
  expect(h.stderr()).toContain(
    "JMLR: first run; 4 papers in jmlr.org's feed recorded as seen, new ones are reported from the next run",
  );
  // the most precise source wins: JMLR's own feed, not Crossref by ISSN
  expect(h.calls.map((c) => c.url.hostname)).toEqual(["www.jmlr.org"]);
});

it("emits papers first seen in the window, dated by the day they were first seen, and prunes the ledger", async () => {
  const h = harness([JMLR], [feed], ENV, {
    [LEDGER]: ledger({
      "v27/26-1057": "2026-11-11",
      "v27/26-0847": "baseline",
      "v26/old-1": "2026-01-01",
    }),
  });
  expect(await h.run(ARGS)).toBe(0);
  const lines = h.lines();
  expect(lines.map((l) => [l.url, l.published])).toEqual([
    ["https://jmlr.org/papers/v27/25-1670.html", "2026-11-12"],
    ["https://jmlr.org/papers/v27/24-0652.html", "2026-11-12"],
    ["https://jmlr.org/papers/v27/26-1057.html", "2026-11-11"],
  ]);
  expect(lines[1]).toEqual({
    source: "jmlr",
    title:
      "Sample-Efficient Regret-Minimizing Double Oracle in Two-Player Zero-Sum Extensive-Form Games",
    authors: [
      "Xiaohang Tang",
      "Chiyuan Wang",
      "Chengdong Ma",
      "Ilija Bogunovic",
      "Stephen McAleer",
      "Yaodong Yang",
    ],
    venue: "JMLR",
    published: "2026-11-12",
    doi: null,
    arxiv_id: null,
    openreview_id: null,
    abstract: "Synthetic abstract 1 with $x^2$ and bold text.",
    oa_url: "https://jmlr.org/papers/volume27/24-0652/24-0652.pdf",
    url: "https://jmlr.org/papers/v27/24-0652.html",
  });
  const saved = JSON.parse(h.files.get(LEDGER)!) as {
    seen: Record<string, string>;
  };
  expect(saved.seen).toEqual({
    "v27/25-1670": "2026-11-12",
    "v27/24-0652": "2026-11-12",
    "v27/26-1057": "2026-11-11",
    "v27/26-0847": "baseline",
  });
});

it("keeps the ledger when the feed fails or is empty, and needs a state directory", async () => {
  const seen = ledger({ "v27/25-1670": "2026-11-01" });
  const broken = harness(
    [JMLR],
    [{ match: host("www.jmlr.org"), respond: () => text("", 503) }],
    ENV,
    {
      [LEDGER]: seen,
    },
  );
  expect(await broken.run(ARGS)).toBe(1);
  expect(broken.files.get(LEDGER)).toBe(seen);
  expect(broken.stderr()).toContain("JMLR: JMLR failed (HTTP 503)");

  const empty = harness(
    [JMLR],
    [
      {
        match: host("www.jmlr.org"),
        respond: () => text("<rss><channel/></rss>"),
      },
    ],
    ENV,
    {
      [LEDGER]: seen,
    },
  );
  expect(await empty.run(ARGS)).toBe(0);
  expect(empty.files.get(LEDGER)).toBe(seen);

  const nowhere = harness([JMLR], [feed], {});
  expect(await nowhere.run(ARGS)).toBe(0);
  expect(nowhere.stderr()).toContain(
    "JMLR: no state directory (set LITSCOUT_STATE_DIR or HOME); skipped",
  );
  expect(nowhere.calls).toEqual([]);
});

it("treats an unreadable ledger as a first run", async () => {
  const h = harness(
    [JMLR],
    [feed],
    { HOME: "/home/r" },
    { "/home/r/.config/litscout/watch-jmlr.json": "{oops" },
  );
  expect(await h.run(ARGS)).toBe(0);
  expect(h.lines()).toEqual([]);
  expect(h.files.get("/home/r/.config/litscout/watch-jmlr.json")).toContain(
    "baseline",
  );
});

it("parses the RSS feed", () => {
  const items = jmlrItems(fixture("jmlr.xml"));
  expect(items).toHaveLength(4);
  expect(items[0]).toEqual({
    id: "v27/25-1670",
    title:
      "Semidefinite programming relaxations and debiasing for MAXCUT-based clustering",
    authors: ["Shuheng Zhou"],
    abstract: "Synthetic abstract 0 with $x^2$ and bold text.",
    url: "https://jmlr.org/papers/v27/25-1670.html",
    pdf: "https://jmlr.org/papers/volume27/25-1670/25-1670.pdf",
  });
  expect(
    jmlrItems(
      "<rss><channel><item><title>x</title><link>https://evil.example/a</link></item></channel></rss>",
    ),
  ).toEqual([]);
  expect(
    jmlrItems(
      "<rss><channel><item><title>Explainable~Clustering</title><link>https://www.jmlr.org/papers/v27/1-1.html</link><pdf>ftp://x/y.pdf</pdf></item></channel></rss>",
    ),
  ).toEqual([
    {
      id: "v27/1-1",
      title: "Explainable Clustering",
      authors: [],
      abstract: null,
      url: "https://jmlr.org/papers/v27/1-1.html",
      pdf: null,
    },
  ]);
});
