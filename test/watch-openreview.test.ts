import { beforeEach, expect, it } from "vitest";
import { clearMemoryCache } from "../src/http/cache";
import { venueIds } from "../cli/watch/openreview";
import { json } from "./helpers/mock-fetch";
import { harness, host } from "./helpers/watch-harness";

beforeEach(() => clearMemoryCache());

const COLM = {
  name: "COLM",
  kind: "conference",
  group: "NLP",
  openreview: "colmweb.org/COLM/{year}/Conference",
};
const ARGS = [
  "--since",
  "2026-06-01",
  "--venues",
  "list.json",
  "--kinds",
  "conference",
];
const day = (text: string) => Date.parse(`${text}T12:00:00Z`);

/**
 * Synthetic notes in the API v2 shape (`content.<field>.value`): the API answers anonymous
 * scripts with a browser challenge, so no live recording was possible.
 */
function note(
  id: string,
  pdate: number | undefined,
  extra: Record<string, unknown> = {},
) {
  return {
    id,
    forum: id,
    pdate,
    cdate: day("2026-03-01"),
    content: {
      title: { value: `Paper ${id}` },
      authors: { value: ["Noam Chomsky", " "] },
      abstract: { value: `Abstract of ${id}.` },
      venueid: { value: "colmweb.org/COLM/2026/Conference" },
      pdf: { value: `/pdf/${id}.pdf` },
      ...extra,
    },
  };
}

function openreview(byVenue: Record<string, unknown[]>, token = "or-secret") {
  return {
    match: host("api2.openreview.net"),
    respond: (url: URL, init: RequestInit | undefined) => {
      if (url.pathname === "/login") {
        const body = JSON.parse(String(init?.body)) as {
          id: string;
          password: string;
        };
        return body.password === "right"
          ? json({ token: "from-login" })
          : json({ message: "Invalid username or password" }, 400);
      }
      expect(url.pathname).toBe("/notes");
      expect(new Headers(init?.headers).get("authorization")).toBe(
        `Bearer ${token}`,
      );
      expect(url.searchParams.get("sort")).toBe("pdate:desc");
      const notes = byVenue[url.searchParams.get("content.venueid")!] ?? [];
      return json({ notes, count: notes.length });
    },
  };
}

it("reads accepted papers by venue id with a token, expanding {year} and keeping those published in the window", async () => {
  const h = harness(
    [COLM],
    [
      openreview({
        "colmweb.org/COLM/2026/Conference": [
          note("Acc1", day("2026-07-08")),
          note("Old1", day("2026-05-01")),
          note("NoDate", undefined),
        ],
      }),
    ],
    { OPENREVIEW_TOKEN: "or-secret" },
  );
  expect(await h.run(ARGS)).toBe(0);
  const venues = h.calls.map((c) => c.url.searchParams.get("content.venueid"));
  expect(venues).toEqual([
    "colmweb.org/COLM/2025/Conference",
    "colmweb.org/COLM/2026/Conference",
    "colmweb.org/COLM/2027/Conference",
  ]);
  expect(h.lines()).toEqual([
    {
      source: "openreview",
      title: "Paper Acc1",
      authors: ["Noam Chomsky"],
      venue: "COLM",
      published: "2026-07-08",
      doi: null,
      arxiv_id: null,
      openreview_id: "Acc1",
      abstract: "Abstract of Acc1.",
      oa_url: "https://openreview.net/pdf?id=Acc1",
      url: "https://openreview.net/forum?id=Acc1",
    },
  ]);
  expect(h.stderr()).not.toContain("or-secret");
  expect(h.stderr()).toMatch(/OpenReview 3/);
});

it("pages through accepted notes and stops once a sorted page is older than --since", async () => {
  const full = Array.from({ length: 1000 }, (_, i) =>
    note(`N${i}`, day("2026-07-08") - i * 1000),
  );
  const older = Array.from({ length: 1000 }, (_, i) =>
    note(`M${i}`, day("2026-01-08") - i * 1000),
  );
  const pages = [full, older, older];
  const h = harness(
    [{ name: "TMLR", kind: "journal", openreview: ["TMLR"] }],
    [
      {
        match: host("api2.openreview.net"),
        respond: (url: URL) => {
          const offset = Number(url.searchParams.get("offset"));
          return json({ notes: pages[offset / 1000] ?? [] });
        },
      },
    ],
    { OPENREVIEW_TOKEN: "or-secret" },
  );
  expect(await h.run(["--since", "2026-06-01", "--venues", "list.json"])).toBe(
    0,
  );
  expect(h.calls.map((c) => c.url.searchParams.get("offset"))).toEqual([
    "0",
    "1000",
  ]);
  expect(h.lines()).toHaveLength(1000);
});

it("logs in with a username and password when no token is set, without printing them", async () => {
  const h = harness([COLM], [openreview({}, "from-login")], {
    OPENREVIEW_USERNAME: "reader@example.org",
    OPENREVIEW_PASSWORD: "right",
  });
  expect(await h.run(ARGS)).toBe(0);
  const login = h.calls.filter((c) => c.url.pathname === "/login");
  expect(login).toHaveLength(1);
  expect(login[0]!.init?.method).toBe("POST");
  expect(h.stderr()).not.toMatch(/right|reader@example/);
});

it("reports a failed login per venue", async () => {
  const h = harness(
    [
      COLM,
      {
        ...COLM,
        name: "RLC",
        openreview: "rl-conference.cc/RLC/{year}/Conference",
      },
    ],
    [openreview({})],
    { OPENREVIEW_USERNAME: "reader", OPENREVIEW_PASSWORD: "wrong" },
  );
  expect(await h.run(ARGS)).toBe(1);
  expect(h.calls.filter((c) => c.url.pathname === "/login")).toHaveLength(1);
  expect(h.stderr()).toContain("COLM: OpenReview login failed (HTTP 400)");
  expect(h.stderr()).toContain("RLC: OpenReview login failed (HTTP 400)");
});

it("without credentials, falls back to the venue's other source or skips it with a reason", async () => {
  const h = harness(
    [
      COLM,
      {
        name: "TMLR",
        kind: "journal",
        openreview: "TMLR",
        issn: ["2835-8856"],
      },
    ],
    [
      {
        match: host("api.crossref.org"),
        respond: () => json({ message: { items: [] } }),
      },
    ],
  );
  expect(
    await h.run([...ARGS.slice(0, 4), "--kinds", "journal,conference"]),
  ).toBe(0);
  const stderr = h.stderr();
  expect(stderr).toContain(
    "COLM: OpenReview needs OPENREVIEW_TOKEN, or OPENREVIEW_USERNAME and OPENREVIEW_PASSWORD; skipped",
  );
  expect(stderr).toContain(
    "TMLR: OpenReview needs OPENREVIEW_TOKEN, or OPENREVIEW_USERNAME and OPENREVIEW_PASSWORD; reading its ISSN on Crossref instead",
  );
  expect(h.calls.map((c) => c.url.hostname)).toEqual(["api.crossref.org"]);
});

it("expands {year} over the window and leaves fixed ids alone", () => {
  expect(venueIds("TMLR", { since: "2026-01-05" }, "2026-11-12")).toEqual([
    "TMLR",
  ]);
  expect(
    venueIds(
      "rl-conference.cc/RLC/{year}/Conference",
      { since: "2026-01-05", until: "2026-02-01" },
      "2026-11-12",
    ),
  ).toEqual([
    "rl-conference.cc/RLC/2025/Conference",
    "rl-conference.cc/RLC/2026/Conference",
    "rl-conference.cc/RLC/2027/Conference",
  ]);
});
