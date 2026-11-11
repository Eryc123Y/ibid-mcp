import { build } from "esbuild";
import { beforeEach, expect, it } from "vitest";
import { clearMemoryCache } from "../src/http/cache";
import {
  createCrossrefClient,
  fullDate,
  plainText,
  publishedDay,
  ROWS,
} from "../src/sources/crossref";
import { runWatch, type WatchDeps } from "../cli/watch/run";
import { parseArgs } from "../cli/watch/args";
import { isNonArticleTitle } from "../cli/watch/line";
import { localLimiter } from "../cli/watch/limiter";
import { yearBefore } from "../cli/watch/conferences";
import { json, mockFetch, type Route } from "./helpers/mock-fetch";

beforeEach(() => clearMemoryCache());

const KEY = "synthetic-openalex-key";
const FEED_FIELDS = [
  "source",
  "title",
  "authors",
  "venue",
  "published",
  "doi",
  "arxiv_id",
  "openreview_id",
  "abstract",
  "oa_url",
  "url",
].sort();

const WATCHLIST = {
  about: "test list",
  version: 3,
  venues: [
    {
      name: "IEEE TPAMI",
      kind: "journal",
      group: "Journals",
      issn: ["0162-8828", "1939-3539"],
      openalex_source: "S199944782",
      colour: "unknown field, ignored",
    },
    {
      name: "TMLR-only",
      kind: "journal",
      group: "J",
      openreview_venues: ["TMLR"],
    },
    {
      name: "CVPR",
      kind: "conference",
      group: "C",
      openalex_source: "S4210176548",
    },
    {
      name: "ICLR",
      kind: "conference",
      group: "C",
      openreview_venues: ["ICLR.cc/2026/Conference"],
    },
    { name: "ECCV", kind: "conference", group: "C" },
  ],
};

function item(n: number, extra: Record<string, unknown> = {}) {
  return {
    DOI: `10.1109/TPAMI.2026.${n}`,
    title: [`Paper <i>${n}</i>`],
    author: [{ given: "Ada", family: "Lovelace" }, { name: "Vision Group" }],
    created: {
      "date-parts": [[2026, 11, 10]],
      "date-time": "2026-11-10T08:00:00Z",
    },
    published: { "date-parts": [[2026, 11, 9]] },
    type: "journal-article",
    ...extra,
  };
}

const isCrossref = (url: URL) => url.hostname === "api.crossref.org";
const isOpenAlex = (url: URL) => url.hostname === "api.openalex.org";

function crossrefRoute(pages: unknown[][]): Route {
  return {
    match: isCrossref,
    respond: (url) => {
      const cursor = url.searchParams.get("cursor") ?? "*";
      const index = cursor === "*" ? 0 : Number(cursor.slice(1));
      return json({
        message: { items: pages[index] ?? [], "next-cursor": `c${index + 1}` },
      });
    },
  };
}

function setup(
  routes: Route[],
  env: WatchDeps["env"] = { OPENALEX_API_KEY: KEY },
) {
  const mock = mockFetch(routes);
  const out: string[] = [];
  const err: string[] = [];
  const deps: WatchDeps = {
    fetch: mock.fetch,
    env,
    readFile: async (file) => {
      if (file === "list.json") return JSON.stringify(WATCHLIST);
      if (file === "bad.json") return "{not json";
      if (file === "empty.json") return JSON.stringify({ about: "x" });
      throw new Error("ENOENT /secret/path");
    },
    stdout: (text) => out.push(text),
    stderr: (text) => err.push(text),
    sleep: async () => {},
  };
  const lines = () =>
    out
      .join("")
      .split("\n")
      .filter(Boolean)
      .map((l) => JSON.parse(l) as Record<string, unknown>);
  return { deps, mock, out, err, lines };
}

const ARGS = ["--since", "2026-11-10", "--venues", "list.json"];

it("pages Crossref with a cursor, filters by ISSN and created date, and emits contract lines only on stdout", async () => {
  const full = Array.from({ length: ROWS }, (_, i) => item(i));
  const { deps, mock, out, err, lines } = setup([
    crossrefRoute([full, [item(9001)]]),
    { match: isOpenAlex, respond: () => json({ results: [] }) },
  ]);
  expect(await runWatch(ARGS, deps)).toBe(0);
  const crossref = mock.calls.filter((c) => isCrossref(c.url));
  expect(crossref).toHaveLength(2);
  expect(crossref[0]!.url.searchParams.get("filter")).toBe(
    "issn:0162-8828,issn:1939-3539,from-created-date:2026-11-10",
  );
  expect(crossref[1]!.url.searchParams.get("cursor")).toBe("c1");
  expect(crossref[0]!.url.searchParams.has("mailto")).toBe(false);
  // stdout purity: every chunk is one JSON line with exactly the contract's fields
  expect(out.every((chunk) => /^\{.*\}\n$/.test(chunk))).toBe(true);
  const all = lines();
  expect(all).toHaveLength(ROWS + 1);
  all.forEach((l) => expect(Object.keys(l).sort()).toEqual(FEED_FIELDS));
  expect(all[0]).toEqual({
    source: "crossref",
    title: "Paper 0",
    authors: ["Ada Lovelace", "Vision Group"],
    venue: "IEEE TPAMI",
    published: "2026-11-09",
    doi: "10.1109/tpami.2026.0",
    arxiv_id: null,
    openreview_id: null,
    abstract: null,
    oa_url: null,
    url: "https://doi.org/10.1109/tpami.2026.0",
  });
  // OpenAlex enrichment in batches of 50 DOIs, select= only, key never on stderr
  const openalex = mock.calls.filter((c) => isOpenAlex(c.url));
  expect(openalex).toHaveLength(Math.ceil((ROWS + 1) / 50));
  expect(openalex[0]!.url.searchParams.get("per_page")).toBe("50");
  expect(openalex[0]!.url.searchParams.get("select")).toBe(
    "doi,abstract_inverted_index,open_access,locations",
  );
  const stderr = err.join("");
  expect(stderr).not.toContain(KEY);
  expect(stderr).toContain("TMLR-only: OpenReview only");
  expect(stderr).toMatch(/requests: Crossref 2, OpenAlex 5/);
});

it("merges OpenAlex abstracts, open-access links and arXiv IDs, keeping Crossref abstracts when OpenAlex has none", async () => {
  const { deps, lines } = setup([
    crossrefRoute([
      [
        item(1),
        item(2, {
          abstract:
            "<jats:title>Abstract</jats:title><jats:p>Crossref &amp; text</jats:p>",
        }),
        item(3),
      ],
    ]),
    {
      match: isOpenAlex,
      respond: (url) => {
        expect(url.searchParams.get("filter")).toBe(
          "doi:10.1109/tpami.2026.1|10.1109/tpami.2026.2|10.1109/tpami.2026.3",
        );
        return json({
          results: [
            {
              doi: "https://doi.org/10.1109/TPAMI.2026.1",
              abstract_inverted_index: { Deep: [0], stereo: [1] },
              open_access: { oa_url: "https://arxiv.org/pdf/2611.01234v2" },
              locations: [
                { landing_page_url: "https://arxiv.org/abs/2611.01234v2" },
              ],
            },
            {
              doi: "https://doi.org/10.1109/tpami.2026.1",
              locations: [{ pdf_url: "https://other.example/p.pdf" }],
            },
            { doi: "https://doi.org/10.1109/tpami.2026.2", locations: null },
          ],
        });
      },
    },
  ]);
  expect(await runWatch(ARGS, deps)).toBe(0);
  const [one, two, three] = lines();
  expect(one).toMatchObject({
    abstract: "Deep stereo",
    oa_url: "https://arxiv.org/pdf/2611.01234v2",
    arxiv_id: "2611.01234",
  });
  expect(two).toMatchObject({ abstract: "Crossref & text", oa_url: null });
  expect(three).toMatchObject({ abstract: null, arxiv_id: null });
});

it("still emits Crossref records when OpenAlex fails or its quota is spent, and stops asking", async () => {
  const many = Array.from({ length: 120 }, (_, i) => item(i));
  const { deps, mock, err, lines } = setup([
    crossrefRoute([many]),
    { match: isOpenAlex, respond: () => json({ error: "quota" }, 429) },
  ]);
  expect(await runWatch(ARGS, deps)).toBe(0);
  expect(lines()).toHaveLength(120);
  // one batch, retried once by the shared retry layer, then no further batches
  expect(mock.calls.filter((c) => isOpenAlex(c.url))).toHaveLength(2);
  expect(err.join("")).toContain(
    "OpenAlex enrichment stopped (HTTP 429) after 0 of 120 DOIs",
  );
});

it("skips OpenAlex without a key and sends the polite mailto only when configured", async () => {
  const { deps, mock, err, lines } = setup([crossrefRoute([[item(1)]])], {
    UNPAYWALL_EMAIL: "reader@example.org",
  });
  expect(await runWatch(ARGS, deps)).toBe(0);
  expect(lines()).toHaveLength(1);
  expect(mock.calls.some((c) => isOpenAlex(c.url))).toBe(false);
  const call = mock.calls[0]!;
  expect(call.url.searchParams.get("mailto")).toBe("reader@example.org");
  expect(new Headers(call.init?.headers).get("user-agent")).toContain(
    "mailto:reader@example.org",
  );
  expect(err.join("")).toContain("OPENALEX_API_KEY is not set");
});

it("filters non-articles by Crossref type and title, drops records outside the window, and dedupes DOIs", async () => {
  const { deps, err, lines } = setup(
    [
      crossrefRoute([
        [
          item(1),
          item(2, { type: "journal-issue" }),
          item(3, { type: "component" }),
          item(4, { title: ["Editorial: A Special Issue"] }),
          item(5, {
            title: ["IEEE Transactions on PAMI Publication Information"],
          }),
          item(6, { title: ["Correction to “Paper 3”"] }),
          item(7, { title: ["Correction of Motion Blur in Event Cameras"] }),
          item(8, { created: { "date-time": "2026-11-01T00:00:00Z" } }),
          item(9, { title: [] }),
          item(1),
        ],
      ]),
    ],
    {},
  );
  expect(await runWatch(ARGS, deps)).toBe(0);
  expect(lines().map((l) => l.title)).toEqual([
    "Paper 1",
    "Correction of Motion Blur in Event Cameras",
  ]);
  expect(err.join("")).toMatch(/2 papers/);
});

it("uses the created day when Crossref gives only a year (IEEE early access)", async () => {
  const { deps, lines } = setup(
    [
      crossrefRoute([
        [
          item(1, {
            published: { "date-parts": [[2026]] },
            issued: { "date-parts": [[2026]] },
          }),
          item(2, {
            published: { "date-parts": [[2026, 12]] },
            issued: { "date-parts": [[2026, 12, 3]] },
          }),
        ],
      ]),
    ],
    {},
  );
  await runWatch(ARGS, deps);
  expect(lines().map((l) => l.published)).toEqual(["2026-11-10", "2026-12-03"]);
});

it("passes --until to Crossref as until-created-date", async () => {
  const { deps, mock } = setup([crossrefRoute([[]])], {});
  await runWatch([...ARGS, "--until=2026-11-11"], deps);
  expect(mock.calls[0]!.url.searchParams.get("filter")).toContain(
    "until-created-date:2026-11-11",
  );
});

it("reads conferences from OpenAlex by source, keeping works first listed since --since", async () => {
  const work = (n: number, extra: Record<string, unknown> = {}) => ({
    id: `https://openalex.org/W${n}`,
    doi: n % 2 ? `https://doi.org/10.1109/cvpr.${n}` : null,
    display_name: `Conference paper ${n}`,
    publication_date: "2026-06-17",
    created_date: "2026-11-11",
    type: "article",
    authorships: [{ author: { display_name: "Grace Hopper" } }, {}],
    abstract_inverted_index: { Hello: [0] },
    open_access: { oa_url: null },
    locations: [{ landing_page_url: "https://arxiv.org/abs/2601.00001" }],
    ...extra,
  });
  const page = [
    work(1),
    work(2),
    work(3, { created_date: "2026-10-01" }),
    work(5, { type: "paratext" }),
    work(7, { display_name: "Front Matter" }),
    work(1),
  ];
  const { deps, mock, err, lines } = setup([
    {
      match: isOpenAlex,
      respond: (url) => {
        expect(url.searchParams.get("filter")).toBe(
          "primary_location.source.id:S4210176548,from_publication_date:2025-11-10",
        );
        return json({ results: page, meta: { next_cursor: "next" } });
      },
    },
  ]);
  expect(await runWatch([...ARGS, "--kinds", "conference"], deps)).toBe(0);
  expect(mock.calls.some((c) => isCrossref(c.url))).toBe(false);
  expect(lines()).toEqual([
    {
      source: "openalex",
      title: "Conference paper 1",
      authors: ["Grace Hopper"],
      venue: "CVPR",
      published: "2026-06-17",
      doi: "10.1109/cvpr.1",
      arxiv_id: "2601.00001",
      openreview_id: null,
      abstract: "Hello",
      oa_url: null,
      url: "https://doi.org/10.1109/cvpr.1",
    },
    expect.objectContaining({
      doi: null,
      url: "https://openalex.org/W2",
    }),
  ]);
  const stderr = err.join("");
  expect(stderr).toContain("ICLR: OpenReview only, which needs an API token");
  expect(stderr).toContain(
    "ECCV: no OpenAlex source, or its sources exclude OpenAlex; skipped",
  );
});

it("pages conference works while pages are full", async () => {
  const full = Array.from({ length: 200 }, (_, i) => ({
    id: `https://openalex.org/W${i}`,
    display_name: `P${i}`,
    publication_date: "2026-06-01",
    created_date: "2026-11-12",
  }));
  const { deps, mock, lines } = setup([
    {
      match: isOpenAlex,
      respond: (url) =>
        json({
          results: url.searchParams.get("cursor") === "*" ? full : [],
          meta: { next_cursor: "page2" },
        }),
    },
  ]);
  await runWatch(
    [...ARGS, "--kinds", "conference,journal", "--until", "2026-11-12"],
    deps,
  );
  const pages = mock.calls.filter(
    (c) => isOpenAlex(c.url) && c.url.searchParams.has("cursor"),
  );
  expect(pages.map((c) => c.url.searchParams.get("cursor"))).toEqual([
    "*",
    "page2",
  ]);
  expect(lines()).toHaveLength(200);
});

it("exits 1 with a one-line reason when every source request fails", async () => {
  const { deps, out, err } = setup([
    { match: isCrossref, respond: () => json({}, 503) },
    {
      match: isOpenAlex,
      respond: () => Promise.reject(new TypeError("fetch failed")),
    },
  ]);
  expect(await runWatch([...ARGS, "--kinds", "journal,conference"], deps)).toBe(
    1,
  );
  expect(out).toEqual([]);
  const stderr = err.join("");
  expect(stderr).toContain("IEEE TPAMI: Crossref failed (HTTP 503)");
  expect(stderr).toContain("CVPR: OpenAlex failed (network error)");
  expect(stderr.trim().split("\n").at(-1)).toBe(
    "litscout watch: every source request failed; nothing was fetched",
  );
});

it("exits 2 for bad arguments and unreadable venue files without touching the network", async () => {
  const cases: Array<[string[], string]> = [
    [[], "--since and --venues are required"],
    [
      ["--since", "2026-13-01", "--venues", "list.json"],
      "--since must be a date",
    ],
    [["--since", "2026-11-10"], "required"],
    [[...ARGS, "--kinds", "workshop"], "--kinds takes"],
    [[...ARGS, "--until", "2026-11-01"], "--until is before --since"],
    [[...ARGS, "--since", "2026-11-11"], "given twice"],
    [[...ARGS, "--venues"], "--venues needs a value"],
    [[...ARGS, "--token", "x"], "unknown argument --token"],
    [["--since", "2026-11-10", "--venues", "missing.json"], "cannot be read"],
    [["--since", "2026-11-10", "--venues", "bad.json"], "not valid JSON"],
    [["--since", "2026-11-10", "--venues", "empty.json"], 'no "venues" list'],
  ];
  for (const [argv, message] of cases) {
    const { deps, mock, out, err } = setup([]);
    expect(await runWatch(argv, deps)).toBe(2);
    expect(mock.calls).toEqual([]);
    expect(out).toEqual([]);
    expect(err.join("")).toContain(message);
    expect(err.join("")).not.toContain("/secret/path");
    expect(err.join("").trim().split("\n")).toHaveLength(1);
  }
});

it("prints usage on --help and reports unexpected failures without details", async () => {
  const help = setup([]);
  expect(await runWatch(["--help"], help.deps)).toBe(0);
  expect(help.err.join("")).toContain("usage: litscout watch");
  const broken = setup([crossrefRoute([[item(1)]])], {});
  const stdout = () => {
    throw new Error("EPIPE secret detail");
  };
  expect(await runWatch(ARGS, { ...broken.deps, stdout })).toBe(1);
  const stderr = broken.err.join("");
  expect(stderr).not.toContain("secret detail");
  expect(stderr.trim().split("\n").at(-1)).toBe(
    "litscout watch: unexpected failure; nothing was fetched",
  );
});

it("ignores unknown fields and skips malformed venue entries with a warning", async () => {
  const { deps, mock, err } = setup([crossrefRoute([[]])], {});
  const list = {
    venues: [
      {
        name: "X",
        kind: "journal",
        issn: ["1234-5678", 7, ""],
        extra: { a: 1 },
      },
      { kind: "journal" },
      null,
      { name: "Y", kind: "workshop" },
      {
        name: "Z",
        kind: "journal",
        issn: ["1111-2222"],
        sources: ["openalex"],
      },
    ],
  };
  expect(
    await runWatch(ARGS, {
      ...deps,
      readFile: async () => JSON.stringify(list),
    }),
  ).toBe(0);
  expect(mock.calls.map((c) => c.url.searchParams.get("filter"))).toEqual([
    "issn:1234-5678,from-created-date:2026-11-10",
  ]);
  const stderr = err.join("");
  expect(stderr.match(/without a name/g)).toHaveLength(3);
  expect(stderr).toContain(
    "Z: no ISSN, or its sources exclude Crossref; skipped",
  );
});

it("parses Crossref dates and JATS text", () => {
  expect(fullDate({ "date-parts": [[2026, 1, 5]] })).toBe("2026-01-05");
  expect(fullDate({ "date-parts": [[2026, 1]] })).toBeNull();
  expect(fullDate({ "date-parts": [[2026, 2, 31]] })).toBeNull();
  expect(fullDate(null)).toBeNull();
  expect(publishedDay({ created: { "date-parts": [[2026, 11, 3]] } })).toBe(
    "2026-11-03",
  );
  expect(publishedDay({})).toBeNull();
  expect(plainText("x &#233;&#x41; &lt;b&gt; &bogus;")).toBe(
    "x éA <b> &bogus;",
  );
  expect(plainText("  ")).toBeNull();
});

it("recognises front matter titles but keeps research titles", () => {
  for (const title of [
    "Guest Editorial: Vision",
    "Erratum to “X”",
    "Corrections",
    "Retraction Note: Y",
    "Table of Contents",
    "Issue Information",
    "2025 Index IEEE Transactions on Image Processing Vol. 34",
    "Front Cover",
    "List of Reviewers",
  ])
    expect(isNonArticleTitle(title)).toBe(true);
  for (const title of [
    "Correction of Lens Distortion",
    "Indexing Neural Radiance Fields",
    "Covering Numbers for Deep Nets",
  ])
    expect(isNonArticleTitle(title)).toBe(false);
});

it("parses arguments with defaults and computes the conference look-back", () => {
  expect(parseArgs(ARGS)).toEqual({
    since: "2026-11-10",
    until: undefined,
    venues: "list.json",
    kinds: ["journal"],
  });
  expect(
    parseArgs([...ARGS, "--kinds", "conference,conference"]).kinds,
  ).toEqual(["conference"]);
  expect(yearBefore("2028-02-29")).toBe("2027-03-01");
  expect(yearBefore("2026-11-10")).toBe("2025-11-10");
});

it("spaces requests with the local limiter and honours penalties", async () => {
  const slept: number[] = [];
  let now = 1000;
  const limiter = localLimiter(
    "crossref",
    async (ms) => {
      slept.push(ms);
    },
    () => now,
  );
  await limiter.acquire();
  await limiter.acquire();
  await limiter.penalize(5000);
  now = 1200;
  await limiter.acquire();
  expect(slept).toEqual([500, 4800]);
});

it("stops Crossref paging at the page cap", async () => {
  const full = Array.from({ length: ROWS }, (_, i) => item(i));
  const { fetch: impl, calls } = mockFetch([
    {
      match: isCrossref,
      respond: () => json({ message: { items: full, "next-cursor": "again" } }),
    },
  ]);
  const client = createCrossrefClient({
    fetchImpl: impl,
    sleep: async () => {},
  });
  const items = await client.worksByIssn(["1234-5678"], {
    since: "2026-11-10",
  });
  expect(calls).toHaveLength(50);
  expect(items).toHaveLength(50 * ROWS);
});

it("bundles the CLI without Worker-only imports, so `node dist/cli/index.js watch` loads", async () => {
  const result = await build({
    entryPoints: ["cli/index.ts"],
    bundle: true,
    write: false,
    format: "esm",
    platform: "node",
    target: "node22",
    packages: "external",
    logLevel: "silent",
  });
  expect(result.outputFiles[0]!.text).not.toMatch(/["']cloudflare:/);
});
