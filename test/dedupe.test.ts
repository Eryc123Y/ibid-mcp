import { describe, expect, it } from "vitest";
import { dedupePapers } from "../src/core/dedupe";
import { paper } from "./fixtures";

describe("dedupePapers", () => {
  it("merges records that share a DOI, preferring the S2 id and filling gaps", () => {
    const oa = paper("openalex", "W1", "A Study of Things", ["A"], {
      doi: "10.1/X",
      openalexId: "W1",
      abstract: "abs",
      citationCount: 12,
    });
    const s2 = paper("s2", "CorpusId:9", "A study of things", ["A", "B"], {
      doi: "10.1/x",
      citationCount: 10,
    });
    const [merged, ...rest] = dedupePapers([oa, s2]);
    expect(rest).toHaveLength(0);
    expect(merged).toMatchObject({
      id: "CorpusId:9",
      source: "s2",
      openalexId: "W1",
      abstract: "abs",
      citationCount: 12,
    });
    expect(merged?.sources).toEqual(["openalex", "s2"]);
  });

  it("merges by normalised title when DOIs are missing", () => {
    const a = paper(
      "s2",
      "CorpusId:1",
      "Deep Residual Learning for Image Recognition",
      ["K. He"],
    );
    const b = paper(
      "openalex",
      "W2",
      "Deep residual learning for image recognition.",
      ["Kaiming He"],
    );
    expect(dedupePapers([a, b])).toHaveLength(1);
  });

  it("merges by arXiv id across versions", () => {
    const a = paper("s2", "CorpusId:1", "Attention Is All You Need", [], {
      arxiv: "1706.03762",
    });
    const b = paper(
      "openalex",
      "W3",
      "Attention is all you need (preprint)",
      [],
      { arxiv: "1706.03762v5" },
    );
    expect(dedupePapers([a, b])).toHaveLength(1);
  });

  it("keeps distinct papers and does not merge on very short titles", () => {
    const a = paper("s2", "CorpusId:1", "Editorial", []);
    const b = paper("openalex", "W4", "Editorial", []);
    const c = paper("s2", "CorpusId:2", "Another long and unrelated title", []);
    expect(dedupePapers([a, b, c])).toHaveLength(3);
  });

  it("chains keys: a DOI match then a title match collapse into one", () => {
    const a = paper(
      "s2",
      "CorpusId:1",
      "Graph Neural Networks for Testing",
      [],
      { doi: "10.2/g" },
    );
    const b = paper(
      "openalex",
      "W5",
      "Graph neural networks for testing",
      [],
      {},
    );
    const c = paper(
      "openalex",
      "W6",
      "GNNs for testing (journal version)",
      [],
      { doi: "10.2/G" },
    );
    expect(dedupePapers([a, b, c])).toHaveLength(1);
  });
});

it("merges transitive bridge records regardless of arrival order", () => {
  const a = paper("s2", "a", "The original published title", [], {
    doi: "10.1/bridge",
  });
  const b = paper("arxiv", "b", "A changed preprint title", [], {
    arxiv: "2401.00001",
  });
  const bridge = paper("openalex", "c", "Bridge metadata", [], {
    doi: "10.1/bridge",
    arxiv: "2401.00001",
  });
  expect(dedupePapers([a, b, bridge])).toHaveLength(1);
});
