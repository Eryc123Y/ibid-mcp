import { beforeEach, describe, expect, it } from "vitest";
import { runAbstracts, type AbstractsDeps } from "../cli/abstracts/run";
import { clearMemoryCache } from "../src/http/cache";
import { json, mockFetch, type Route } from "./helpers/mock-fetch";

beforeEach(() => clearMemoryCache());

/** A plausible abstract, long enough for the 100-character guard, tagged so tests can tell them apart. */
const text = (tag: string) =>
  `${tag} studies a problem that matters, proposes a method that works and reports experiments showing gains over earlier work.`;

/** OpenAlex's inverted index for a sentence. */
function inverted(sentence: string): Record<string, number[]> {
  const index: Record<string, number[]> = {};
  sentence
    .split(" ")
    .forEach((word, i) => (index[word] = [...(index[word] ?? []), i]));
  return index;
}

function atom(
  entries: ReadonlyArray<{ id: string; title: string; summary: string }>,
) {
  const body = entries
    .map(
      (e) =>
        `<entry><id>http://arxiv.org/abs/${e.id}v1</id><title>${e.title}</title><summary>${e.summary}</summary><published>2025-01-01T00:00:00Z</published></entry>`,
    )
    .join("");
  return new Response(
    `<?xml version="1.0" encoding="UTF-8"?><feed xmlns="http://www.w3.org/2005/Atom"><totalResults>${entries.length}</totalResults>${body}</feed>`,
    { headers: { "content-type": "application/atom+xml" } },
  );
}

const host = (name: string, path?: RegExp) => (url: URL) =>
  url.hostname === name &&
  (!path || path.test(decodeURIComponent(url.pathname)));

/** Routes that answer "not found" for every source; tests put their hits in front. */
const MISSES: Route[] = [
  {
    match: host("api.openalex.org"),
    respond: () => json({ error: "Not Found" }, 404),
  },
  {
    match: host("api.semanticscholar.org"),
    respond: (_url, init) =>
      json(JSON.parse(String(init?.body)).ids.map(() => null)),
  },
  { match: host("export.arxiv.org"), respond: () => atom([]) },
  {
    match: host("api.crossref.org"),
    respond: () => json({ status: "error" }, 404),
  },
  {
    match: host("www.ebi.ac.uk"),
    respond: () => json({ hitCount: 0, resultList: { result: [] } }),
  },
  {
    match: host("ieeexploreapi.ieee.org"),
    respond: () => json({ total_records: 0, articles: [] }),
  },
  {
    match: host("api.springernature.com"),
    respond: () => json({ records: [] }),
  },
  {
    match: host("api.elsevier.com"),
    respond: () => json({ error: "nf" }, 404),
  },
];

function setup(
  lines: readonly unknown[] | string,
  routes: Route[] = [],
  env: AbstractsDeps["env"] = {},
  now?: () => number,
) {
  const mock = mockFetch([...routes, ...MISSES]);
  const out: string[] = [];
  const err: string[] = [];
  const slept: number[] = [];
  const stdin =
    typeof lines === "string"
      ? lines
      : lines.map((l) => JSON.stringify(l)).join("\n") + "\n";
  const deps: AbstractsDeps = {
    fetch: mock.fetch,
    env,
    readStdin: async () => stdin,
    stdout: (chunk) => out.push(chunk),
    stderr: (chunk) => err.push(chunk),
    sleep: async (ms) => {
      slept.push(ms);
    },
    now,
  };
  return {
    calls: mock.calls,
    slept,
    run: (argv: readonly string[] = []) => runAbstracts(argv, deps),
    out: () => out.join(""),
    err: () => err.join(""),
    results: () =>
      out
        .join("")
        .split("\n")
        .filter(Boolean)
        .map((l) => JSON.parse(l) as Record<string, unknown>),
    on: (name: string) => mock.calls.filter((c) => c.url.hostname === name),
  };
}

describe("litscout abstracts: order and short-circuiting", () => {
  it("walks the sources in order and stops at the first hit per item", async () => {
    const t = setup(
      [
        { id: "oa", doi: "10.1109/oa.1" },
        { id: "s2", doi: "10.1109/s2.1" },
        { id: "ax", doi: "10.1109/ax.1" },
        { id: "cr", doi: "10.1109/cr.1" },
        { id: "pmc", doi: "10.1371/pmc.1" },
        { id: "none", doi: "10.1109/none.1" },
      ],
      [
        {
          match: host("api.openalex.org", /doi:10\.1109\/oa\.1$/),
          respond: () =>
            json({
              id: "https://openalex.org/W1",
              abstract_inverted_index: inverted(text("OpenAlex")),
            }),
        },
        {
          match: host("api.semanticscholar.org"),
          respond: (_url, init) =>
            json(
              (JSON.parse(String(init?.body)).ids as string[]).map((id) =>
                id === "DOI:10.1109/s2.1"
                  ? { abstract: text("S2"), externalIds: {} }
                  : id === "DOI:10.1109/ax.1"
                    ? { abstract: null, externalIds: { ArXiv: "2501.00001" } }
                    : null,
              ),
            ),
        },
        {
          match: host("export.arxiv.org"),
          respond: () =>
            atom([{ id: "2501.00001", title: "X", summary: text("arXiv") }]),
        },
        {
          match: host("api.crossref.org", /\/works\/10\.1109\/cr\.1$/),
          respond: () =>
            json({
              message: { abstract: `<jats:p>${text("Crossref")}</jats:p>` },
            }),
        },
        {
          match: host("www.ebi.ac.uk"),
          respond: (url) =>
            json({
              resultList: {
                result: url.searchParams.get("query")?.includes("10.1371/pmc.1")
                  ? [
                      {
                        doi: "10.1371/PMC.1",
                        abstractText: `<h4>Aim</h4>${text("EuropePMC")}`,
                      },
                    ]
                  : [],
              },
            }),
        },
      ],
    );
    expect(await t.run()).toBe(0);
    expect(t.results()).toEqual([
      { id: "oa", abstract: text("OpenAlex"), source: "openalex" },
      { id: "s2", abstract: text("S2"), source: "s2" },
      { id: "ax", abstract: text("arXiv"), source: "arxiv" },
      { id: "cr", abstract: text("Crossref"), source: "crossref" },
      { id: "pmc", abstract: `Aim ${text("EuropePMC")}`, source: "europepmc" },
      { id: "none", abstract: null, source: null },
    ]);
    // Every DOI goes to OpenAlex; S2 gets one batch of the five OpenAlex missed.
    expect(t.on("api.openalex.org")).toHaveLength(6);
    const s2 = t.on("api.semanticscholar.org");
    expect(s2).toHaveLength(1);
    expect(JSON.parse(String(s2[0]!.init?.body)).ids).toEqual([
      "DOI:10.1109/s2.1",
      "DOI:10.1109/ax.1",
      "DOI:10.1109/cr.1",
      "DOI:10.1371/pmc.1",
      "DOI:10.1109/none.1",
    ]);
    // Crossref is asked only about items still empty after arXiv.
    expect(
      t.on("api.crossref.org").map((c) => decodeURIComponent(c.url.pathname)),
    ).toEqual([
      "/works/10.1109/cr.1",
      "/works/10.1371/pmc.1",
      "/works/10.1109/none.1",
    ]);
    expect(t.on("www.ebi.ac.uk")).toHaveLength(2);
    // No keys: no publisher API is contacted.
    expect(t.on("ieeexploreapi.ieee.org")).toHaveLength(0);
    expect(t.on("api.springernature.com")).toHaveLength(0);
    expect(t.on("api.elsevier.com")).toHaveLength(0);
  });

  it("prints exactly one line per input, in input order, and only JSON on stdout", async () => {
    const items = [
      { id: "3", doi: "10.1234/c" },
      { id: "1" },
      { id: "3", doi: "10.1234/c" },
      { id: "2", title: "No such paper" },
    ];
    const t = setup(items);
    expect(await t.run()).toBe(0);
    expect(t.results().map((r) => r.id)).toEqual(["3", "1", "3", "2"]);
    expect(t.out().split("\n")).toHaveLength(items.length + 1);
    t.results().forEach((r) =>
      expect(r).toEqual({ id: r.id, abstract: null, source: null }),
    );
    expect(t.err().trim().split("\n")).toHaveLength(1);
  });

  it("prints nothing and exits 0 for empty input", async () => {
    const t = setup("");
    expect(await t.run()).toBe(0);
    expect(t.out()).toBe("");
    expect(t.calls).toHaveLength(0);
  });
});

describe("litscout abstracts: OpenAlex", () => {
  it("rebuilds the inverted index in word order and passes on the arXiv ID it reveals", async () => {
    const sentence = text("Rebuilt");
    const t = setup(
      [
        { id: "a", doi: "10.1109/a.1" },
        { id: "b", doi: "10.1109/b.1" },
      ],
      [
        {
          match: host("api.openalex.org", /doi:10\.1109\/a\.1$/),
          respond: () => {
            // Keys deliberately out of order: the rebuild must follow positions, not key order.
            const index = inverted(sentence);
            const reversed = Object.fromEntries(
              Object.entries(index).reverse(),
            );
            return json({ abstract_inverted_index: reversed });
          },
        },
        {
          match: host("api.openalex.org", /doi:10\.1109\/b\.1$/),
          respond: () =>
            json({
              abstract_inverted_index: null,
              locations: [
                { landing_page_url: "https://doi.org/10.1109/b.1" },
                { landing_page_url: "http://arxiv.org/abs/2503.14501" },
              ],
            }),
        },
        {
          match: host("export.arxiv.org"),
          respond: (url) =>
            url.searchParams.get("id_list") === "2503.14501"
              ? atom([
                  { id: "2503.14501", title: "B", summary: text("Preprint") },
                ])
              : atom([]),
        },
      ],
    );
    await t.run();
    expect(t.results()).toEqual([
      { id: "a", abstract: sentence, source: "openalex" },
      { id: "b", abstract: text("Preprint"), source: "arxiv" },
    ]);
    const oa = t.on("api.openalex.org")[0]!.url;
    expect(oa.searchParams.get("select")).toContain("abstract_inverted_index");
  });

  it("takes the arXiv ID from an arXiv DOI and sends the OpenAlex key only when set", async () => {
    const t = setup(
      [{ id: "a", doi: "10.1109/a.1" }],
      [
        {
          match: host("api.openalex.org"),
          respond: () =>
            json({ doi: "https://doi.org/10.48550/arxiv.2601.06496" }),
        },
        {
          match: host("export.arxiv.org"),
          respond: () =>
            atom([{ id: "2601.06496", title: "A", summary: text("Merged") }]),
        },
      ],
      { OPENALEX_API_KEY: "oa-secret" },
    );
    await t.run();
    expect(t.results()[0]).toEqual({
      id: "a",
      abstract: text("Merged"),
      source: "arxiv",
    });
    expect(t.on("api.openalex.org")[0]!.url.searchParams.get("api_key")).toBe(
      "oa-secret",
    );
    expect(t.err()).not.toContain("oa-secret");
  });

  it("rejects placeholders and short abstracts and moves on", async () => {
    const t = setup(
      [
        { id: "a", doi: "10.1234/a" },
        { id: "b", doi: "10.1234/b" },
      ],
      [
        {
          match: host("api.openalex.org", /doi:10\.1234\/a$/),
          respond: () =>
            json({
              abstract_inverted_index: inverted("No abstract available."),
            }),
        },
        {
          match: host("api.openalex.org", /doi:10\.1234\/b$/),
          respond: () =>
            json({ abstract_inverted_index: inverted("A short note.") }),
        },
        {
          match: host("api.crossref.org"),
          respond: (url) =>
            json({
              message: { abstract: text(decodeURIComponent(url.pathname)) },
            }),
        },
      ],
    );
    await t.run();
    expect(t.results().map((r) => r.source)).toEqual(["crossref", "crossref"]);
  });
});

describe("litscout abstracts: Semantic Scholar", () => {
  it("asks for abstract and externalIds only, with the key header when S2_API_KEY is set", async () => {
    const keyed = setup([{ id: "a", doi: "10.1234/a" }], [], {
      S2_API_KEY: "s2-secret",
    });
    await keyed.run();
    const call = keyed.on("api.semanticscholar.org")[0]!;
    expect(call.url.pathname).toBe("/graph/v1/paper/batch");
    expect(call.url.searchParams.get("fields")).toBe("abstract,externalIds");
    expect(call.init?.method).toBe("POST");
    expect(new Headers(call.init?.headers).get("x-api-key")).toBe("s2-secret");
    expect(keyed.err()).not.toContain("s2-secret");

    clearMemoryCache(); // the same request would otherwise come from the response cache
    const anonymous = setup([{ id: "a", doi: "10.1234/a" }]);
    await anonymous.run();
    const bare = anonymous.on("api.semanticscholar.org")[0]!;
    expect(new Headers(bare.init?.headers).has("x-api-key")).toBe(false);
  });

  it("retries a 429 once, then skips S2 and lets later sources fill the item", async () => {
    const t = setup(
      [{ id: "a", doi: "10.1234/a" }],
      [
        {
          match: host("api.semanticscholar.org"),
          respond: () => json({ message: "Too Many Requests" }, 429),
        },
        {
          match: host("api.crossref.org"),
          respond: () => json({ message: { abstract: text("Later") } }),
        },
      ],
    );
    expect(await t.run()).toBe(0);
    expect(t.on("api.semanticscholar.org")).toHaveLength(2);
    expect(t.slept.some((ms) => ms > 0)).toBe(true);
    expect(t.results()).toEqual([
      { id: "a", abstract: text("Later"), source: "crossref" },
    ]);
    expect(t.err()).toMatch(/1 skipped request/);
    expect(t.err()).not.toMatch(/https?:/);
  });

  it("counts a 5xx or a network error as skipped without stopping the run", async () => {
    const t = setup(
      [{ id: "a", doi: "10.1234/a" }],
      [
        { match: host("api.openalex.org"), respond: () => json({}, 503) },
        {
          match: host("api.crossref.org"),
          respond: () => {
            throw new TypeError("fetch failed https://api.crossref.org/secret");
          },
        },
        {
          match: host("www.ebi.ac.uk"),
          respond: () =>
            json({
              resultList: {
                result: [{ doi: "10.1234/a", abstractText: text("PMC") }],
              },
            }),
        },
      ],
    );
    expect(await t.run()).toBe(0);
    expect(t.results()[0]).toMatchObject({ source: "europepmc" });
    expect(t.err()).toMatch(/2 skipped requests/);
    expect(t.err()).not.toContain("secret");
  });
});

describe("litscout abstracts: arXiv", () => {
  it("looks up input arXiv IDs in one id_list request", async () => {
    const t = setup(
      [
        { id: "a", arxiv: "2501.00001" },
        { id: "b", arxiv: "2501.00002v3" },
      ],
      [
        {
          match: host("export.arxiv.org"),
          respond: () =>
            atom([
              { id: "2501.00002", title: "B", summary: text("Second") },
              { id: "2501.00001", title: "A", summary: text("First") },
            ]),
        },
      ],
    );
    await t.run();
    expect(t.results()).toEqual([
      { id: "a", abstract: text("First"), source: "arxiv" },
      { id: "b", abstract: text("Second"), source: "arxiv" },
    ]);
    const calls = t.on("export.arxiv.org");
    expect(calls).toHaveLength(1);
    expect(calls[0]!.url.searchParams.get("id_list")).toBe(
      "2501.00001,2501.00002",
    );
    // Items without a DOI never reach the DOI-only sources.
    expect(t.on("api.openalex.org")).toHaveLength(0);
    expect(t.on("api.crossref.org")).toHaveLength(0);
  });

  it("accepts a title search hit only when the normalised titles are equal", async () => {
    const t = setup(
      [
        { id: "same", title: "Spatial Intelligence: A Survey" },
        { id: "other", title: "Video Diffusion Models" },
      ],
      [
        {
          match: host("export.arxiv.org"),
          respond: (url) =>
            (url.searchParams.get("search_query") ?? "").includes("Spatial")
              ? atom([
                  {
                    id: "2601.06496",
                    title: "Spatial   intelligence -- a survey",
                    summary: text("Survey"),
                  },
                ])
              : atom([
                  {
                    id: "2601.00009",
                    title: "Video Diffusion Models: A Survey",
                    summary: text("Wrong"),
                  },
                ]),
        },
      ],
    );
    await t.run();
    expect(t.results()).toEqual([
      { id: "same", abstract: text("Survey"), source: "arxiv" },
      { id: "other", abstract: null, source: null },
    ]);
    const queries = t
      .on("export.arxiv.org")
      .map((c) => c.url.searchParams.get("search_query"));
    expect(queries).toEqual([
      'ti:"Spatial Intelligence A Survey"',
      'ti:"Video Diffusion Models"',
    ]);
  });

  it("spaces arXiv requests three seconds apart", async () => {
    const t = setup([
      { id: "a", title: "First title" },
      { id: "b", title: "Second title" },
    ]);
    await t.run();
    expect(t.on("export.arxiv.org")).toHaveLength(2);
    expect(t.slept.some((ms) => ms >= 2900)).toBe(true);
  });
});

describe("litscout abstracts: Europe PMC", () => {
  it("queries by DOI with resultType=core and ignores a record for another DOI", async () => {
    const t = setup(
      [{ id: "a", doi: "10.7554/elife.1" }],
      [
        {
          match: host("www.ebi.ac.uk"),
          respond: () =>
            json({
              resultList: {
                result: [
                  { doi: "10.7554/elife.2", abstractText: text("Other") },
                ],
              },
            }),
        },
      ],
    );
    await t.run();
    expect(t.results()[0]).toEqual({ id: "a", abstract: null, source: null });
    const url = t.on("www.ebi.ac.uk")[0]!.url;
    expect(url.pathname).toBe("/europepmc/webservices/rest/search");
    expect(url.searchParams.get("query")).toBe('DOI:"10.7554/elife.1"');
    expect(url.searchParams.get("resultType")).toBe("core");
    expect(url.searchParams.get("format")).toBe("json");
  });
});

describe("litscout abstracts: publisher APIs", () => {
  const keys = {
    IEEE_API_KEY: "ieee-secret",
    SPRINGER_API_KEY: "springer-secret",
    ELSEVIER_API_KEY: "elsevier-secret",
  };
  const items = [
    { id: "ieee", doi: "10.1109/tpami.2026.1" },
    { id: "springer", doi: "10.1007/s11263-026-1" },
    { id: "elsevier", doi: "10.1016/j.patcog.2026.1" },
    { id: "acm", doi: "10.1145/1" },
  ];

  it("are skipped silently without keys", async () => {
    const t = setup(items);
    await t.run();
    expect(t.on("ieeexploreapi.ieee.org")).toHaveLength(0);
    expect(t.on("api.springernature.com")).toHaveLength(0);
    expect(t.on("api.elsevier.com")).toHaveLength(0);
    // Only the summary line: no warning about the missing keys.
    expect(t.err().trim().split("\n")).toHaveLength(1);
    expect(t.err()).not.toMatch(/key/i);
  });

  it("are asked only about their own DOI prefixes, with keys kept out of stderr and stdout", async () => {
    const t = setup(
      items,
      [
        {
          match: host("ieeexploreapi.ieee.org"),
          respond: (url) =>
            json({
              articles: [
                {
                  doi: url.searchParams.get("doi"),
                  abstract: `<p>${text("IEEE")}</p>`,
                },
              ],
            }),
        },
        {
          match: host("api.springernature.com"),
          respond: () =>
            json({
              records: [
                {
                  doi: "10.1007/s11263-026-1",
                  abstract: {
                    h1: "Abstract",
                    p: [text("Springer"), "Second paragraph."],
                  },
                },
              ],
            }),
        },
        {
          match: host("api.elsevier.com"),
          respond: () =>
            json({
              "abstracts-retrieval-response": {
                coredata: {
                  "dc:description": `${text("Elsevier")} © 2026 Elsevier Ltd. All rights reserved.`,
                },
              },
            }),
        },
      ],
      keys,
    );
    await t.run();
    expect(t.results()).toEqual([
      { id: "ieee", abstract: text("IEEE"), source: "ieee" },
      {
        id: "springer",
        abstract: `${text("Springer")} Second paragraph.`,
        source: "springer",
      },
      { id: "elsevier", abstract: text("Elsevier"), source: "elsevier" },
      { id: "acm", abstract: null, source: null },
    ]);
    const ieee = t.on("ieeexploreapi.ieee.org");
    expect(ieee).toHaveLength(1);
    expect(ieee[0]!.url.pathname).toBe("/api/v1/search/articles");
    expect(ieee[0]!.url.searchParams.get("doi")).toBe("10.1109/tpami.2026.1");
    expect(ieee[0]!.url.searchParams.get("apikey")).toBe("ieee-secret");
    const springer = t.on("api.springernature.com");
    expect(springer).toHaveLength(1);
    expect(springer[0]!.url.pathname).toBe("/meta/v2/json");
    expect(springer[0]!.url.searchParams.get("q")).toBe(
      "doi:10.1007/s11263-026-1",
    );
    expect(springer[0]!.url.searchParams.get("api_key")).toBe(
      "springer-secret",
    );
    const elsevier = t.on("api.elsevier.com");
    expect(elsevier).toHaveLength(1);
    expect(decodeURIComponent(elsevier[0]!.url.pathname)).toBe(
      "/content/abstract/doi/10.1016/j.patcog.2026.1",
    );
    expect(elsevier[0]!.url.searchParams.has("apiKey")).toBe(false);
    expect(new Headers(elsevier[0]!.init?.headers).get("x-els-apikey")).toBe(
      "elsevier-secret",
    );
    for (const secret of Object.values(keys)) {
      expect(t.err()).not.toContain(secret);
      expect(t.out()).not.toContain(secret);
    }
    expect(t.err()).toMatch(/ieee 1, springer 1, elsevier 1/);
  });

  it("ignores an IEEE record whose DOI differs from the one asked for", async () => {
    const t = setup(
      [{ id: "ieee", doi: "10.1109/tpami.2026.1" }],
      [
        {
          match: host("ieeexploreapi.ieee.org"),
          respond: () =>
            json({
              articles: [
                { doi: "10.1109/tpami.2026.9", abstract: text("Wrong") },
              ],
            }),
        },
      ],
      { IEEE_API_KEY: "k" },
    );
    await t.run();
    expect(t.results()[0]).toMatchObject({ abstract: null, source: null });
  });
});

describe("litscout abstracts: input and summary", () => {
  it("exits 2 with nothing on stdout for invalid JSON", async () => {
    const t = setup('{"id":"a"}\n{oops');
    expect(await t.run()).toBe(2);
    expect(t.out()).toBe("");
    expect(t.calls).toHaveLength(0);
    expect(t.err()).toMatch(/line 2/);
  });

  it("exits 2 for more than 200 lines", async () => {
    const t = setup(Array.from({ length: 201 }, (_, i) => ({ id: String(i) })));
    expect(await t.run()).toBe(2);
    expect(t.out()).toBe("");
  });

  it("exits 2 for unknown arguments and 0 for --help", async () => {
    expect(await setup([]).run(["--fast"])).toBe(2);
    const help = setup([]);
    expect(await help.run(["--help"])).toBe(0);
    expect(help.err()).toMatch(/usage: litscout abstracts/);
    expect(help.out()).toBe("");
  });

  it("ends with one summary line of counts per source", async () => {
    const t = setup(
      [{ id: "a", doi: "10.1234/a" }, { id: "b" }],
      [
        {
          match: host("api.crossref.org"),
          respond: () => json({ message: { abstract: text("C") } }),
        },
      ],
    );
    await t.run();
    expect(t.err()).toBe(
      "litscout abstracts: 2 items, 1 filled (openalex 0, s2 0, arxiv 0, crossref 1, europepmc 0, ieee 0, springer 0, elsevier 0); 0 skipped requests\n",
    );
  });
});

describe("litscout abstracts: limits", () => {
  it("stops asking a source after three failures in a row and counts the rest as skipped", async () => {
    const items = Array.from({ length: 5 }, (_, i) => ({
      id: String(i),
      doi: `10.1234/x${i}`,
    }));
    const t = setup(items, [
      { match: host("www.ebi.ac.uk"), respond: () => json({}, 503) },
    ]);
    expect(await t.run()).toBe(0);
    const queries = t
      .on("www.ebi.ac.uk")
      .map((c) => c.url.searchParams.get("query"));
    expect(new Set(queries).size).toBe(3);
    expect(t.err()).toMatch(/5 skipped requests/);
    expect(t.results()).toHaveLength(5);
  });

  it("asks an uncached source once per DOI, however often the DOI repeats", async () => {
    const t = setup(
      [
        { id: "a", doi: "10.1234/same" },
        { id: "b", doi: "10.1234/same" },
      ],
      [
        {
          match: host("www.ebi.ac.uk"),
          respond: () =>
            json({
              resultList: {
                result: [{ doi: "10.1234/same", abstractText: text("Shared") }],
              },
            }),
        },
      ],
    );
    await t.run();
    expect(t.on("www.ebi.ac.uk")).toHaveLength(1);
    expect(t.results().map((r) => r.source)).toEqual([
      "europepmc",
      "europepmc",
    ]);
  });

  it("answers every item and says so when the time budget is spent", async () => {
    let clock = 0;
    const t = setup(
      [
        { id: "a", doi: "10.1234/a" },
        { id: "b", doi: "10.1234/b" },
      ],
      [
        {
          match: host("api.openalex.org"),
          respond: () => {
            clock += 16 * 60 * 1000; // each lookup "takes" 16 minutes
            return json({ error: "Not Found" }, 404);
          },
        },
      ],
      {},
      () => clock,
    );
    expect(await t.run()).toBe(0);
    expect(t.on("api.openalex.org")).toHaveLength(1);
    expect(t.on("api.crossref.org")).toHaveLength(0);
    expect(t.results()).toEqual([
      { id: "a", abstract: null, source: null },
      { id: "b", abstract: null, source: null },
    ]);
    expect(t.err()).toMatch(/time budget spent\n$/);
  });

  it("refuses redirects on requests that carry a publisher key", async () => {
    const t = setup([{ id: "e", doi: "10.1016/j.x.2026.1" }], [], {
      ELSEVIER_API_KEY: "k",
    });
    await t.run();
    expect(t.on("api.elsevier.com")[0]!.init?.redirect).toBe("error");
  });
});
