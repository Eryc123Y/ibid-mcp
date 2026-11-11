import { readFileSync } from "node:fs";
import { beforeEach, expect, it, vi } from "vitest";
import { clearMemoryCache } from "../src/http/cache";
import { createS2Client } from "../src/sources/s2";
import { budgetNotice, createOpenAlexClient } from "../src/sources/openalex";
import { parseArxiv } from "../src/sources/arxiv";
import { createOpenReviewClient } from "../src/sources/openreview";

function recording(name: string) {
  return JSON.parse(
    readFileSync(`test/fixtures/live/${name}.json`, "utf8"),
  ) as {
    status: number;
    headers: Record<string, string>;
    body: unknown;
  };
}
function replay(name: string) {
  const r = recording(name);
  return vi.fn(
    async () =>
      new Response(JSON.stringify(r.body), {
        status: r.status,
        headers: r.headers,
      }),
  );
}
const controls = {
  acquire: async () => {},
  penalize: async () => {},
  sleep: async () => {},
};
beforeEach(() => clearMemoryCache());

it("maps recorded S2 reference wrappers, identifiers and pagination", async () => {
  const s2 = createS2Client({
    ...controls,
    fetchImpl: replay("s2-references"),
  });
  const result = await s2.links("ARXIV:1706.03762", "references", 2, 0);
  expect(result.next).toBe(2);
  expect(result.papers).toHaveLength(2);
  expect(result.papers[0]).toMatchObject({
    id: "CorpusId:21850704",
    arxiv: "1705.04304",
    doi: "10.48550/arxiv.1705.04304",
    title: "A Deep Reinforced Model for Abstractive Summarization",
    year: 2017,
  });
  expect(result.papers[0]?.pdfUrl).toBeUndefined();
});
it.each(["search", "batch", "author"])(
  "surfaces recorded S2 %s throttling",
  async (operation) => {
    const s2 = createS2Client({
      ...controls,
      fetchImpl: replay(`s2-${operation}`),
    });
    const pending =
      operation === "search"
        ? s2.searchPapers("Attention Is All You Need", { limit: 2, offset: 0 })
        : operation === "batch"
          ? s2.paperBatch(["ARXIV:1706.03762"], false)
          : s2.searchAuthors("Geoffrey Hinton", 1, false);
    await expect(pending).rejects.toMatchObject({ status: 429 });
  },
);
it("surfaces OpenAlex exhausted daily credits without retrying before reset", async () => {
  const fetchImpl = replay("openalex-search");
  const oa = createOpenAlexClient({ ...controls, fetchImpl });
  await expect(
    oa.searchWorks("Attention Is All You Need", { limit: 2, page: 1 }),
  ).rejects.toMatchObject({ status: 429 });
  expect(fetchImpl).toHaveBeenCalledTimes(1);
  expect(budgetNotice()?.text).toContain("0/1000 credits left");
});
it("parses recorded single-entry and recent-category arXiv feeds", () => {
  const single = parseArxiv(recording("arxiv-id").body as string);
  expect(single.papers).toHaveLength(1);
  expect(single.papers[0]).toMatchObject({
    title: "Attention Is All You Need",
    arxiv: "1706.03762",
    year: 2017,
  });
  expect(single.papers[0]?.authors).toHaveLength(8);
  const recent = parseArxiv(recording("arxiv-category").body as string);
  expect(recent.total).toBeGreaterThan(2);
  expect(recent.papers).toHaveLength(2);
  expect(recent.papers.every((p) => p.arxiv && p.published && p.pdfUrl)).toBe(
    true,
  );
});
it("handles real OpenReview search wrappers without accepting unrelated titles", async () => {
  const client = createOpenReviewClient({
    ...controls,
    fetchImpl: replay("openreview-search"),
  });
  expect(
    (await client.reviews("Direct Preference Optimization")).forum,
  ).toBeNull();
});
it("surfaces the recorded OpenReview challenge instead of claiming no reviews", async () => {
  const client = createOpenReviewClient({
    ...controls,
    fetchImpl: replay("openreview-public-forum"),
  });
  await expect(client.reviews("ljNZyrAlaa")).rejects.toMatchObject({
    status: 403,
  });
});
