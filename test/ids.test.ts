import { describe, expect, it } from "vitest";
import { IdParseError, parseAuthorId, parsePaperId } from "../src/core/ids";

describe("parsePaperId", () => {
  it.each([
    ["10.1145/3292500.3330701", "doi", "DOI:10.1145/3292500.3330701"],
    ["doi:10.1109/TIFS.2020.123", "doi", "DOI:10.1109/tifs.2020.123"],
    [
      "https://doi.org/10.1109/ACCESS.2021.3051234",
      "doi",
      "DOI:10.1109/access.2021.3051234",
    ],
    ["2106.15928", "arxiv", "ARXIV:2106.15928"],
    ["arXiv:2106.15928v3", "arxiv", "ARXIV:2106.15928"],
    ["https://arxiv.org/abs/1706.03762v7", "arxiv", "ARXIV:1706.03762"],
    ["https://arxiv.org/pdf/1706.03762.pdf", "arxiv", "ARXIV:1706.03762"],
    ["hep-th/9901001", "arxiv", "ARXIV:hep-th/9901001"],
    [
      "649def34f8be52c8b66281af98ae884c09aef38b",
      "s2",
      "649def34f8be52c8b66281af98ae884c09aef38b",
    ],
    [
      "https://www.semanticscholar.org/paper/Construction-of-the-Literature/649def34f8be52c8b66281af98ae884c09aef38b",
      "s2",
      "649def34f8be52c8b66281af98ae884c09aef38b",
    ],
    ["CorpusId:215416146", "corpus", "CorpusId:215416146"],
    ["PMID:19872477", "pmid", "PMID:19872477"],
    ["PMCID:PMC2323736", "pmcid", "PMCID:2323736"],
  ])("parses %s", (input, kind, s2) => {
    const parsed = parsePaperId(input);
    expect(parsed.kind).toBe(kind);
    expect(parsed.s2).toBe(s2);
  });

  it("maps OpenAlex W-ids (bare and URL) without an S2 address", () => {
    for (const input of [
      "W2741809807",
      "w2741809807",
      "https://openalex.org/W2741809807",
      "https://api.openalex.org/works/W2741809807",
    ]) {
      const parsed = parsePaperId(input);
      expect(parsed).toMatchObject({
        kind: "openalex",
        value: "W2741809807",
        openalexId: "W2741809807",
      });
      expect(parsed.s2).toBeUndefined();
    }
  });

  it("gives arXiv ids an OpenAlex DataCite DOI filter", () => {
    expect(parsePaperId("2106.15928").openalexFilter).toEqual({
      attr: "doi",
      value: "10.48550/arxiv.2106.15928",
    });
  });

  it("treats arXiv DataCite DOIs as arXiv ids", () => {
    expect(parsePaperId("10.48550/arXiv.2106.15928")).toMatchObject({
      kind: "arxiv",
      s2: "ARXIV:2106.15928",
    });
  });

  it("lower-cases DOIs for OpenAlex filters", () => {
    expect(parsePaperId("10.1109/TIFS.2020.123").openalexFilter).toEqual({
      attr: "doi",
      value: "10.1109/tifs.2020.123",
    });
  });

  it.each([
    "",
    "attention is all you need",
    "doi:not-a-doi",
    "1234",
    "CorpusId:abc",
  ])("rejects %j", (input) => {
    expect(() => parsePaperId(input)).toThrow(IdParseError);
  });
});

describe("parseAuthorId", () => {
  it.each([
    ["1741101", { kind: "s2", value: "1741101" }],
    [
      "https://www.semanticscholar.org/author/Oren-Etzioni/1741101",
      { kind: "s2", value: "1741101" },
    ],
    ["A5089860351", { kind: "openalex", value: "A5089860351" }],
    [
      "https://openalex.org/A5089860351",
      { kind: "openalex", value: "A5089860351" },
    ],
    ["0000-0002-8818-6983", { kind: "orcid", value: "0000-0002-8818-6983" }],
    [
      "https://orcid.org/0000-0002-1694-435X",
      { kind: "orcid", value: "0000-0002-1694-435X" },
    ],
    ["Anupam Chattopadhyay", { kind: "name", value: "Anupam Chattopadhyay" }],
    ["Raphael C.-W. Phan", { kind: "name", value: "Raphael C.-W. Phan" }],
  ])("classifies %s", (input, expected) => {
    expect(parseAuthorId(input)).toEqual(expected);
  });
});
