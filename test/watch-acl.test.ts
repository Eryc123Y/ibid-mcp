import { beforeEach, expect, it } from "vitest";
import { clearMemoryCache } from "../src/http/cache";
import { anthologyPapers, isMainVolume } from "../cli/watch/acl";
import { json, type Route } from "./helpers/mock-fetch";
import { fixture, harness, host, text } from "./helpers/watch-harness";

beforeEach(() => clearMemoryCache());

const SINCE_SHA = "bdcb7cf57f2ec2b9e5e0c20c6d1b8e3a0d4f5e61";
const BEFORE_SHA = "a75fcdc07381dca29654bb8fc588e7bc1cd34c95";

interface Commit {
  readonly sha: string;
  readonly date: string;
}

/** GitHub commit lookups per file: `since` answers the in-window query, `before` the one up to --since. */
function github(
  files: Record<string, { since: Commit[]; before: Commit[] }>,
): Route {
  return {
    match: host("api.github.com"),
    respond: (url) => {
      expect(url.pathname).toBe("/repos/acl-org/acl-anthology/commits");
      expect(url.searchParams.get("per_page")).toBe("1");
      const file = url.searchParams.get("path")!.replace("data/xml/", "");
      const entry = files[file] ?? { since: [], before: [] };
      const list = url.searchParams.has("since") ? entry.since : entry.before;
      return json(
        list.map((c) => ({
          sha: c.sha,
          commit: { committer: { date: c.date } },
        })),
      );
    },
  };
}

function raw(files: Record<string, string>): Route {
  return {
    match: host("raw.githubusercontent.com"),
    respond: (url) => {
      const [, owner, repo, sha, ...rest] = url.pathname.split("/");
      expect(`${owner}/${repo}`).toBe("acl-org/acl-anthology");
      const body = files[`${sha}:${rest.join("/")}`];
      return body === undefined ? text("404: Not Found", 404) : text(body);
    },
  };
}

const TACL = {
  name: "TACL",
  kind: "journal",
  group: "NLP",
  issn: ["2307-387X"],
  acl_anthology: "tacl",
};

it("finds the TACL papers added since --since by comparing the Anthology file before and after", async () => {
  const realSince = JSON.parse(fixture("github-commits-since.json")) as Array<{
    sha: string;
    commit: { committer: { date: string } };
  }>;
  const realBefore = JSON.parse(
    fixture("github-commits-before.json"),
  ) as typeof realSince;
  const h = harness(
    [TACL],
    [
      github({
        "2026.tacl.xml": {
          since: realSince.map((c) => ({
            sha: c.sha,
            date: c.commit.committer.date,
          })),
          before: realBefore.map((c) => ({
            sha: c.sha,
            date: c.commit.committer.date,
          })),
        },
      }),
      raw({
        [`${realSince[0]!.sha}:data/xml/2026.tacl.xml`]: fixture(
          "acl-2026.tacl.after.xml",
        ),
        [`${realBefore[0]!.sha}:data/xml/2026.tacl.xml`]: fixture(
          "acl-2026.tacl.before.xml",
        ),
      }),
      {
        match: host("api.openalex.org"),
        respond: (url) => {
          expect(url.searchParams.get("filter")).toBe(
            "doi:10.1162/tacl.a.810|10.1162/tacl.a.811",
          );
          return json({
            results: [
              {
                doi: "https://doi.org/10.1162/tacl.a.810",
                locations: [
                  { landing_page_url: "https://arxiv.org/abs/2601.04321" },
                ],
                open_access: { oa_url: "https://elsewhere.example/p.pdf" },
              },
            ],
          });
        },
      },
    ],
    { OPENALEX_API_KEY: "k" },
  );
  expect(realSince[0]!.sha.startsWith(SINCE_SHA.slice(0, 10))).toBe(true);
  expect(realBefore[0]!.sha).toBe(BEFORE_SHA);
  expect(await h.run(["--since", "2026-10-20", "--venues", "list.json"])).toBe(
    0,
  );
  const lines = h.lines();
  expect(lines.map((l) => l.title)).toEqual([
    "Byte-pair Encoding Captures Aspects of Word Meaning that Distributional Semantics Overlooks",
    "The Extractive-Abstractive Spectrum: Uncovering Verifiability Trade-offs in LLM Generations",
  ]);
  expect(lines[0]).toEqual({
    source: "acl-anthology",
    title: lines[0]!.title,
    authors: expect.arrayContaining([expect.any(String)]),
    venue: "TACL",
    published: "2026-10-26",
    doi: "10.1162/tacl.a.810",
    arxiv_id: "2601.04321",
    openreview_id: null,
    abstract:
      "Synthetic abstract for paper 3: the recorded text is not committed. Uses $O(n)$ & https://example.org.",
    oa_url: "https://aclanthology.org/2026.tacl-1.113.pdf",
    url: "https://aclanthology.org/2026.tacl-1.113/",
  });
  expect(lines[1]).toMatchObject({ arxiv_id: null });
  // the most precise source wins: no Crossref request although the venue has an ISSN
  expect(h.calls.some((c) => c.url.hostname === "api.crossref.org")).toBe(
    false,
  );
  const gh = h.calls.filter((c) => c.url.hostname === "api.github.com");
  expect(gh.map((c) => c.url.searchParams.get("path"))).toEqual([
    "data/xml/2025.tacl.xml",
    "data/xml/2026.tacl.xml",
    "data/xml/2026.tacl.xml",
  ]);
  expect(gh[1]!.url.searchParams.get("since")).toBe("2026-10-20T00:00:00Z");
  expect(gh[2]!.url.searchParams.get("until")).toBe("2026-10-20T00:00:00Z");
  expect(new Headers(gh[0]!.init?.headers).get("user-agent")).toMatch(
    /^litscout-watch\//,
  );
  expect(h.stderr()).toMatch(
    /requests: Crossref 0, OpenAlex 1, GitHub 3, ACL Anthology data 2/,
  );
});

it("downloads nothing when no commit touched the venue's files in the window", async () => {
  const h = harness([TACL], [github({})]);
  expect(await h.run(["--since", "2026-11-10", "--venues", "list.json"])).toBe(
    0,
  );
  expect(h.lines()).toEqual([]);
  expect(h.calls.map((c) => c.url.hostname)).toEqual([
    "api.github.com",
    "api.github.com",
  ]);
});

it("reads only long, short and main volumes of a conference and dates them by ingestion", async () => {
  const h = harness(
    [{ name: "ACL", kind: "conference", acl_anthology: "acl" }],
    [
      github({
        "2026.acl.xml": {
          since: [{ sha: "c1c1c1c1c1", date: "2026-06-23T10:00:00Z" }],
          before: [],
        },
      }),
      raw({ "c1c1c1c1c1:data/xml/2026.acl.xml": fixture("acl-2026.acl.xml") }),
    ],
    { GITHUB_TOKEN: "gh-secret" },
  );
  expect(
    await h.run([
      "--since",
      "2026-06-01",
      "--venues",
      "list.json",
      "--kinds",
      "conference",
    ]),
  ).toBe(0);
  const lines = h.lines();
  expect(lines.map((l) => l.url)).toEqual([
    "https://aclanthology.org/2026.acl-long.1/",
    "https://aclanthology.org/2026.acl-long.12/",
    "https://aclanthology.org/2026.acl-short.12/",
  ]);
  expect(lines.every((l) => l.published === "2026-06-22")).toBe(true);
  expect(lines[1]!.authors).toContain("Hinrich Schuetze");
  expect(lines[2]!.title).toBe(
    "StructMem: Structured Memory for Long-Horizon Behavior in LLMs",
  );
  const gh = h.calls.find((c) => c.url.hostname === "api.github.com")!;
  expect(new Headers(gh.init?.headers).get("authorization")).toBe(
    "Bearer gh-secret",
  );
  expect(h.stderr()).not.toContain("gh-secret");
});

it("uses the commit day when the volume's ingest date is outside the window, and keeps papers without a DOI", async () => {
  const h = harness(
    [{ name: "MoL", kind: "conference", acl_anthology: "mol" }],
    [
      github({
        "2025.mol.xml": {
          since: [{ sha: "a2a2a2a2a2", date: "2026-02-18T12:00:00Z" }],
          before: [{ sha: "a1a1a1a1a1", date: "2026-01-02T00:00:00Z" }],
        },
      }),
      raw({
        "a2a2a2a2a2:data/xml/2025.mol.xml": fixture("acl-2025.mol.xml"),
        "a1a1a1a1a1:data/xml/2025.mol.xml": '<collection id="2025.mol"/>',
      }),
    ],
  );
  expect(
    await h.run([
      "--since",
      "2026-02-18",
      "--venues",
      "list.json",
      "--kinds",
      "conference",
    ]),
  ).toBe(0);
  expect(h.lines()).toEqual([
    expect.objectContaining({
      title: "Realizational Morphology in a Modular Minimalist Grammar",
      authors: ["Edward P. Stabler"],
      published: "2026-02-18",
      doi: null,
      abstract: null,
      url: "https://aclanthology.org/2025.mol-1.1/",
      oa_url: "https://aclanthology.org/2025.mol-1.1.pdf",
    }),
    expect.objectContaining({ title: "The Typology of TSL Case Assignment" }),
  ]);
  // no OpenAlex key: no enrichment request and no warning about it for Anthology venues
  expect(h.calls.some((c) => c.url.hostname === "api.openalex.org")).toBe(
    false,
  );
});

it("reports a failing GitHub lookup for the venue and carries on", async () => {
  const h = harness(
    [TACL, { name: "COLT", kind: "journal", pmlr: "COLT" }],
    [
      {
        match: host("api.github.com"),
        respond: () => json({ message: "rate limited" }, 403),
      },
      { match: host("proceedings.mlr.press"), respond: () => text("") },
    ],
  );
  expect(await h.run(["--since", "2026-11-10", "--venues", "list.json"])).toBe(
    0,
  );
  expect(h.stderr()).toContain("TACL: ACL Anthology failed (HTTP 403)");
});

it("selects main volumes per venue and parses Anthology XML into papers", () => {
  expect(isMainVolume("acl", "long")).toBe(true);
  expect(isMainVolume("emnlp", "main")).toBe(true);
  expect(isMainVolume("acl", "demo")).toBe(false);
  expect(isMainVolume("conll", "babylm")).toBe(false);
  expect(isMainVolume("conll", "1")).toBe(true);
  expect(isMainVolume("cl", "3")).toBe(true);
  const papers = anthologyPapers(fixture("acl-2026.acl.xml"), "acl");
  expect(papers.map((p) => p.id)).toEqual([
    "2026.acl-long.1",
    "2026.acl-long.12",
    "2026.acl-short.12",
  ]);
  expect(papers[0]!.ingestDate).toBe("2026-06-22");
  expect(anthologyPapers('<collection id="x"/>', "acl")).toEqual([]);
  expect(() => anthologyPapers("<collection", "acl")).toThrow();
});

it("bounds the window with --until and hints at GITHUB_TOKEN when GitHub refuses", async () => {
  const h = harness(
    [TACL],
    [
      {
        match: host("api.github.com"),
        respond: () => json({ message: "API rate limit exceeded" }, 403),
      },
    ],
  );
  expect(
    await h.run([
      "--since",
      "2026-10-20",
      "--until",
      "2026-10-31",
      "--venues",
      "list.json",
    ]),
  ).toBe(1);
  expect(h.calls[0]!.url.searchParams.get("until")).toBe(
    "2026-11-01T00:00:00Z",
  );
  const stderr = h.stderr();
  expect(
    stderr.match(/GitHub refused a commit lookup \(HTTP 403\)/g),
  ).toHaveLength(1);
  expect(stderr).toContain("without GITHUB_TOKEN it allows 60 an hour");
});
