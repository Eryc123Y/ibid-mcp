import { describe, expect, it } from "vitest";
import { features, mergeAuthors, pairScore } from "../src/core/merge";
import { namesCompatible } from "../src/core/normalize";
import { author, paper } from "./fixtures";

const ntu = ["Nanyang Technological University"];

const s2Main = author("s2", "1680036", "Anupam Chattopadhyay", {
  affiliations: ntu,
  citationCount: 7000,
  papers: [
    paper(
      "s2",
      "CorpusId:1",
      "Fault attacks on lightweight ciphers",
      ["Anupam Chattopadhyay", "Zakaria Najm", "Shivam Bhasin"],
      { doi: "10.1/a" },
    ),
    paper("s2", "CorpusId:2", "Logic locking: A Survey", [
      "Anupam Chattopadhyay",
      "Shivam Bhasin",
      "Dirmanto Jap",
    ]),
  ],
});
const s2Split = author("s2", "2109876", "A. Chattopadhyay", {
  papers: [
    paper("s2", "CorpusId:3", "Side channel analysis of PRESENT", [
      "A. Chattopadhyay",
      "S. Bhasin",
      "D. Jap",
      "Z. Najm",
    ]),
    paper("s2", "CorpusId:2", "Logic Locking: a survey", [
      "A. Chattopadhyay",
      "S. Bhasin",
    ]),
  ],
});
const oaMain = author("openalex", "A5089860351", "Anupam Chattopadhyay", {
  affiliations: ntu,
  citationCount: 7178,
  papers: [
    paper(
      "openalex",
      "W1",
      "Fault Attacks on Lightweight Ciphers",
      ["Anupam Chattopadhyay", "Zakaria Najm"],
      { doi: "10.1/A" },
    ),
  ],
});
const delhi = author("openalex", "A5011312056", "Anupam Chattopadhyay", {
  affiliations: ["University of Delhi"],
  citationCount: 852,
  papers: [
    paper("openalex", "W9", "Plant pathology in India", [
      "Anupam Chattopadhyay",
      "R. Sharma",
    ]),
  ],
});

describe("namesCompatible", () => {
  it.each([
    ["Anupam Chattopadhyay", "A. Chattopadhyay", true],
    ["Raphael C.-W. Phan", "Raphael Phan", true],
    ["Phan, Raphael", "R. Phan", true],
    ["José García", "Jose Garcia", true],
    ["Anupam Chattopadhyay", "Bikash Chattopadhyay", false],
    ["Anupam Chattopadhyay", "Anupam Basu", false],
  ])("%s ~ %s → %s", (a, b, expected) => {
    expect(namesCompatible(a, b)).toBe(expected);
  });
});

describe("pairScore", () => {
  it("is strong for a shared paper plus shared coauthors", () => {
    const link = pairScore(features(s2Main), features(oaMain));
    expect(link.score).toBeGreaterThanOrEqual(0.8);
    expect(link.reasons.join(" ")).toMatch(/shared paper/);
  });

  it("is 1 for the same ORCID and 0 for different ORCIDs", () => {
    const a = author("s2", "1", "Jane Doe", { orcid: "0000-0000-0000-0001" });
    const b = author("openalex", "A1", "J. Doe", {
      orcid: "0000-0000-0000-0001",
    });
    const c = author("openalex", "A2", "Jane Doe", {
      orcid: "0000-0000-0000-0002",
    });
    expect(pairScore(features(a), features(b)).score).toBe(1);
    expect(pairScore(features(a), features(c)).score).toBe(0);
  });

  it("does not merge on an identical name alone", () => {
    const a = author("s2", "1", "Wei Wang");
    const b = author("openalex", "A1", "Wei Wang");
    expect(pairScore(features(a), features(b)).score).toBeLessThan(0.5);
  });
});

describe("mergeAuthors", () => {
  it("merges split S2 and OpenAlex records of one person and keeps the namesake apart", () => {
    const clusters = mergeAuthors([s2Main, s2Split, oaMain, delhi], {
      queryName: "Anupam Chattopadhyay",
    });
    const primary = clusters[0];
    expect(primary?.records.map((r) => r.id).sort()).toEqual([
      "1680036",
      "2109876",
      "A5089860351",
    ]);
    expect(primary?.links).toHaveLength(2);
    expect(["high", "medium"]).toContain(primary?.confidence);
    expect(clusters[1]?.records.map((r) => r.id)).toEqual(["A5011312056"]);
    expect(clusters[1]?.confidence).toBe("single");
  });

  it("never chains records with different ORCIDs through an intermediate record", () => {
    const shared = [
      paper("s2", "C1", "A long shared paper title one", ["Jane Doe", "X Y"]),
      paper("s2", "C2", "A long shared paper title two", ["Jane Doe", "X Y"]),
      paper("s2", "C3", "A long shared paper title three", ["Jane Doe"]),
    ];
    const bridge = author("s2", "1", "J. Doe", { papers: shared });
    const p1 = author("openalex", "A1", "Jane Doe", {
      orcid: "0000-0000-0000-0001",
      papers: shared,
    });
    const p2 = author("openalex", "A2", "Jane Doe", {
      orcid: "0000-0000-0000-0002",
      papers: shared,
    });
    const clusters = mergeAuthors([bridge, p1, p2], { queryName: "Jane Doe" });
    expect(clusters).toHaveLength(2);
    expect(
      clusters.every(
        (c) => new Set(c.records.map((r) => r.orcid).filter(Boolean)).size <= 1,
      ),
    ).toBe(true);
  });

  it("does not merge on a few shared coauthors alone", () => {
    const a = author("s2", "1", "Amit Kumar", {
      papers: [
        paper("s2", "C1", "First paper about networks", [
          "Amit Kumar",
          "S. Das",
          "R. Roy",
        ]),
      ],
    });
    const b = author("openalex", "A1", "Amit Kumar", {
      papers: [
        paper("openalex", "W1", "Different paper on soil", [
          "Amit Kumar",
          "S. Das",
          "R. Roy",
        ]),
      ],
    });
    expect(mergeAuthors([a, b], { queryName: "Amit Kumar" })).toHaveLength(2);
  });

  it("ranks the cluster matching the affiliation hint first", () => {
    const clusters = mergeAuthors([s2Main, oaMain, delhi], {
      queryName: "Anupam Chattopadhyay",
      affiliationHint: "University of Delhi",
    });
    expect(clusters[0]?.records.map((r) => r.id)).toEqual(["A5011312056"]);
    expect(clusters[0]?.hintMatch).toBe(1);
  });

  it("drops records whose names are incompatible with the query", () => {
    const other = author("s2", "77", "Bikash Chattopadhyay");
    const clusters = mergeAuthors([s2Main, other], {
      queryName: "Anupam Chattopadhyay",
    });
    expect(clusters.flatMap((c) => c.records.map((r) => r.id))).toEqual([
      "1680036",
    ]);
  });

  it("reports medium confidence for a single weak-but-sufficient link", () => {
    const a = author("s2", "1", "Jane Doe", {
      affiliations: ["Monash University"],
      papers: [
        paper("s2", "C1", "Paper one about graphs", [
          "Jane Doe",
          "Bob Smith",
          "Carol Jones",
        ]),
      ],
    });
    const b = author("openalex", "A1", "Jane Doe", {
      affiliations: ["Monash University"],
      papers: [
        paper("openalex", "W2", "Different paper on trees", [
          "Jane Doe",
          "Bob Smith",
        ]),
      ],
    });
    const [cluster] = mergeAuthors([a, b], { queryName: "Jane Doe" });
    expect(cluster?.records).toHaveLength(2);
    expect(cluster?.confidence).toBe("medium");
  });
});
