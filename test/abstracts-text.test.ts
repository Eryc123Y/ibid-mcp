import { describe, expect, it } from "vitest";
import {
  cleanDoi,
  parseInput,
  InputError,
  MAX_LINES,
} from "../cli/abstracts/input";
import { cleanAbstract, sameTitle } from "../cli/abstracts/text";

const BODY =
  "We study a problem that matters, propose a method that works, and report experiments that show the method improves on prior work.";

describe("cleanAbstract", () => {
  it("strips JATS and HTML tags, decodes entities and collapses whitespace", () => {
    const raw = `<jats:title>Abstract</jats:title>\n<jats:p>We study a problem &amp; <i>propose</i>   a method</jats:p><h4>Results</h4><p>${BODY}</p>`;
    expect(cleanAbstract(raw)).toBe(
      `We study a problem & propose a method Results ${BODY}`,
    );
  });

  it("drops a leading Abstract label", () => {
    expect(cleanAbstract(`Abstract: ${BODY}`)).toBe(BODY);
    expect(cleanAbstract(`ABSTRACT ${BODY}`)).toBe(BODY);
  });

  it("keeps a first word that only looks like a label or a placeholder", () => {
    const reasoning = `Abstract reasoning is hard. ${BODY}`;
    expect(cleanAbstract(reasoning)).toBe(reasoning);
    const none = `None of the existing methods scale. ${BODY}`;
    expect(cleanAbstract(none)).toBe(none);
  });

  it("removes publisher copyright lines at either end", () => {
    expect(
      cleanAbstract(`${BODY} © 2026 The Author(s). Published by Elsevier B.V.`),
    ).toBe(BODY);
    expect(
      cleanAbstract(`© 2026 Elsevier Ltd. All rights reserved. ${BODY}`),
    ).toBe(BODY);
  });

  it("rejects text under 100 characters", () => {
    expect(cleanAbstract("Too short to be an abstract.")).toBeNull();
    expect(cleanAbstract("<p>  </p>")).toBeNull();
    expect(cleanAbstract(null)).toBeNull();
    expect(cleanAbstract(undefined)).toBeNull();
  });

  it("rejects placeholders even when padded past the length guard", () => {
    const pad = " ".repeat(5) + "x".repeat(120);
    for (const text of [
      "No abstract available",
      "Abstract not available",
      "Abstract unavailable",
      "No abstract is available for this item.",
      "First Page of the Article",
    ]) {
      expect(cleanAbstract(text)).toBeNull();
      expect(cleanAbstract(`${text}.${pad}`)).toBeNull();
    }
  });
});

describe("sameTitle", () => {
  it("ignores case, punctuation, diacritics and spacing", () => {
    expect(
      sameTitle(
        "Spatial Intelligence: A Survey—of Models",
        "spatial intelligence a survey of   models",
      ),
    ).toBe(true);
    expect(sameTitle("Café Networks", "Cafe networks")).toBe(true);
  });

  it("rejects different or empty titles", () => {
    expect(sameTitle("A survey of models", "A survey of models, part II")).toBe(
      false,
    );
    expect(sameTitle("", "")).toBe(false);
  });
});

describe("parseInput", () => {
  it("reads JSON Lines, skipping blank lines and normalising identifiers", () => {
    const items = parseInput(
      [
        '{"id":"a","doi":"https://doi.org/10.1109/TPAMI.2026.1"}',
        "",
        '{"id":"b","arxiv":"arXiv:2503.14501v2","title":"T"}',
        '{"id":"c","doi":"not-a-doi","arxiv":"garbage"}',
        '{"id":"d","doi":null,"arxiv":null,"title":null}',
        "   ",
      ].join("\n"),
    );
    expect(items).toEqual([
      { id: "a", doi: "10.1109/tpami.2026.1" },
      { id: "b", arxiv: "2503.14501", title: "T" },
      { id: "c" },
      { id: "d" },
    ]);
  });

  it("drops DOIs that could change the request path or have no suffix", () => {
    expect(cleanDoi("10.1007/s11263-026-03114-5")).toBe(
      "10.1007/s11263-026-03114-5",
    );
    expect(cleanDoi("10.1002/(SICI)1097-4571<3::AID>")).toBe(
      "10.1002/(sici)1097-4571<3::aid>",
    );
    for (const bad of [
      "10.1/../../authors",
      "10.1109/./x",
      "10.1109/",
      "10.1109",
      "10.1109/a b",
      "10.abc/x",
    ])
      expect(cleanDoi(bad)).toBeUndefined();
  });

  it("accepts up to the line limit and rejects more", () => {
    const line = (i: number) => JSON.stringify({ id: String(i) });
    const ok = Array.from({ length: MAX_LINES }, (_, i) => line(i)).join("\n");
    expect(parseInput(ok)).toHaveLength(MAX_LINES);
    expect(() => parseInput(`${ok}\n${line(MAX_LINES)}`)).toThrow(InputError);
  });

  it.each([
    ["invalid JSON", "{not json"],
    ["an array", "[1,2]"],
    ["a missing id", '{"doi":"10.1/x"}'],
    ["a numeric id", '{"id":1}'],
    ["a non-string doi", '{"id":"a","doi":5}'],
    ["a non-string arxiv", '{"id":"a","arxiv":2503.14501}'],
    ["a non-string title", '{"id":"a","title":["x"]}'],
  ])("rejects %s", (_label, text) => {
    expect(() => parseInput(text)).toThrow(InputError);
  });

  it("says which line is wrong without echoing its content", () => {
    try {
      parseInput('{"id":"a"}\n{"id":"secret-looking-value", "doi": 3}');
      expect.unreachable();
    } catch (error) {
      expect((error as Error).message).toContain("line 2");
      expect((error as Error).message).not.toContain("secret-looking-value");
    }
  });
});

describe("review fixes", () => {
  it("keeps bare < and > that are not tags", () => {
    const stats = `Accuracy rose (p < 0.05, n > 10) and <i>held</i>. ${BODY}`;
    expect(cleanAbstract(stats)).toBe(
      `Accuracy rose (p < 0.05, n > 10) and held . ${BODY}`,
    );
  });

  it("keeps an enumeration that mentions (c) and a number", () => {
    const listed = `${BODY} We test (a) speed, (b) memory and (c) 2000 participants.`;
    expect(cleanAbstract(listed)).toBe(listed);
  });

  it("tells Greek letters apart in titles", () => {
    expect(
      sameTitle("α-Synuclein aggregation", "β-synuclein aggregation"),
    ).toBe(false);
    expect(
      sameTitle("α-Synuclein aggregation", "α synuclein  Aggregation"),
    ).toBe(true);
  });

  it("takes the arXiv ID from an arXiv DOI, strips a BOM and drops impossible or oversized values", () => {
    expect(
      parseInput(
        '﻿{"id":"a","doi":"10.48550/arXiv.2503.14501"}\n' +
          '{"id":"b","arxiv":"9913.00001"}\n' +
          `{"id":"c","doi":"10.1234/${"x".repeat(400)}","title":"${"t".repeat(1200)}"}`,
      ),
    ).toEqual([
      { id: "a", doi: "10.48550/arxiv.2503.14501", arxiv: "2503.14501" },
      { id: "b" },
      { id: "c" },
    ]);
  });
});
