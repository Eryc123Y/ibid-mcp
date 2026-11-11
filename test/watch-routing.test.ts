import { expect, it } from "vitest";
import { route } from "../cli/watch/route";
import { parseWatchList } from "../cli/watch/watchlist";

function parse(venues: unknown[]) {
  const warnings: string[] = [];
  return {
    venues: parseWatchList(JSON.stringify({ venues }), (w) => warnings.push(w)),
    warnings,
  };
}

it("reads the new optional fields and warns about values it cannot use", () => {
  const { venues, warnings } = parse([
    {
      name: "TACL",
      kind: "journal",
      acl_anthology: " TACL ",
      pmlr: "COLT",
      doi_prefix: "10.4230/LIPIcs.ITP",
      openreview: ["TMLR", 3, ""],
      jmlr: true,
    },
    {
      name: "F",
      kind: "conference",
      acl_anthology: "findings",
      pmlr: "COLT 2026",
      doi_prefix: "10.4230",
      openreview: 7,
      jmlr: "yes",
    },
  ]);
  expect(venues[0]).toMatchObject({
    aclAnthology: "tacl",
    pmlr: "COLT",
    doiPrefix: "10.4230/LIPIcs.ITP",
    openreview: ["TMLR"],
    jmlr: true,
  });
  expect(venues[1]).toMatchObject({ openreview: [], jmlr: false });
  expect(venues[1]!.aclAnthology).toBeUndefined();
  expect(venues[1]!.pmlr).toBeUndefined();
  expect(venues[1]!.doiPrefix).toBeUndefined();
  expect(warnings).toEqual([
    "F: acl_anthology must be one of acl, emnlp, naacl, eacl, conll, tacl, cl, mol; ignored",
    "F: pmlr is not a PMLR series name; ignored",
    "F: doi_prefix is not a DOI prefix; ignored",
  ]);
});

it("routes each venue to its most precise source", () => {
  const { venues } = parse([
    {
      name: "A",
      kind: "journal",
      jmlr: true,
      acl_anthology: "cl",
      issn: ["1"],
    },
    {
      name: "B",
      kind: "journal",
      acl_anthology: "cl",
      pmlr: "ALT",
      issn: ["1"],
    },
    {
      name: "C",
      kind: "conference",
      pmlr: "ALT",
      doi_prefix: "10.1234/x",
      openalex_source: "S1",
    },
    {
      name: "D",
      kind: "conference",
      doi_prefix: "10.1234/x",
      openreview: "X",
      openalex_source: "S1",
    },
    { name: "E", kind: "conference", openreview: "X", openalex_source: "S1" },
    { name: "F", kind: "conference", openalex_source: "S1" },
  ]);
  const keyed = venues.map((v) => route(v, true).kind);
  expect(keyed).toEqual(["jmlr", "acl", "pmlr", "doi", "openreview", "legacy"]);
  const unkeyed = venues.map((v) => route(v, false));
  expect(unkeyed[4]).toEqual({
    kind: "legacy",
    note: expect.stringContaining("OpenReview needs"),
  });
});
