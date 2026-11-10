import { expect, it } from "vitest";
import {
  creditRoom,
  sourceFor,
  validateVenueDraw,
} from "../eval/collection-policy";
it("reserves over 20 percent of keyless credits and accounts for prior use", () => {
  expect(creditRoom(1000, 1000, 0, 10)).toBe(true);
  expect(creditRoom(1000, 210, 0, 10)).toBe(false);
  expect(creditRoom(1000, 211, 0, 10)).toBe(true);
  expect(creditRoom(1000, 1000, 790, 10)).toBe(false);
  expect(creditRoom(1000, 0, 0, 1)).toBe(false);
});
it("preserves the measurement's source selection by prefix then works count", () => {
  expect(
    sourceFor("Synthetic Journal of Testing", [
      { id: "other", display_name: "Other", works_count: 100 },
      {
        id: "correct",
        display_name: "Synthetic Journal of Testing",
        works_count: 10,
      },
    ]),
  ).toBe("correct");
});
it("rejects incomplete or duplicate venue samples without silently replacing papers", () => {
  const papers = Array.from({ length: 40 }, (_, i) => ({
    id: `W${i}`,
    title: `Paper ${i}`,
    publication_year: 2024,
  }));
  expect(() => validateVenueDraw(papers, 2024)).not.toThrow();
  expect(() => validateVenueDraw(papers.slice(1), 2024)).toThrow();
  expect(() =>
    validateVenueDraw([...papers.slice(1), papers[1]!], 2024),
  ).toThrow();
  expect(() => validateVenueDraw(papers, 2023)).toThrow();
});
