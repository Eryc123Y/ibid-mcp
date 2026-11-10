import { beforeEach, expect, it, vi } from "vitest";
import fixture from "./fixtures/openreview.json";
import { createOpenReviewClient } from "../src/sources/openreview";
import { clearMemoryCache } from "../src/http/cache";
import { json, mockFetch } from "./helpers/mock-fetch";
beforeEach(() => clearMemoryCache());
function setup() {
  const mock = mockFetch([
    { match: (u) => u.pathname === "/notes", respond: () => json(fixture) },
    {
      match: (u) => u.pathname === "/notes/search",
      respond: () => json({ notes: [fixture.notes[0]] }),
    },
  ]);
  const deps = {
    fetchImpl: mock.fetch,
    acquire: vi.fn(async () => {}),
    penalize: vi.fn(async () => {}),
    onResponse: vi.fn(async () => {}),
  };
  return { mock, deps, client: createOpenReviewClient(deps) };
}
it("returns venue, decision and reviewer-only mean and population spread, with one-line summaries", async () => {
  const { client, deps } = setup();
  const r = await client.reviews(
    "https://openreview.net/forum?id=syntheticForum",
    false,
  );
  expect(r).toMatchObject({
    forum: "syntheticForum",
    venue: "Synthetic Conference 2024",
    decision: "Accept",
    ratings: { count: 2, mean: 7, stddev: 1, min: 6, max: 8 },
  });
  expect(r.reviews).toHaveLength(2);
  expect(r.reviews[0]?.summary).toBe("Clear evidence.");
  expect(r.reviews[0]).not.toHaveProperty("text");
  expect(deps.acquire).toHaveBeenCalled();
});
it("resolves by title and arxiv id; full mode includes review content", async () => {
  const { client, mock } = setup();
  const r = await client.reviews("A synthetic reviewed paper", true);
  expect(r.reviews[0]?.text).toMatchObject({
    weaknesses: "Limited baseline comparison.",
  });
  expect(mock.calls[0]?.url.pathname).toBe("/notes/search");
  const a = await client.reviews("2401.00001v2", false);
  expect(a.forum).toBe("syntheticForum");
});
it("does not return unrelated or ambiguous search matches", async () => {
  const client = createOpenReviewClient({
    fetchImpl: async () => json({ notes: [fixture.notes[0]] }),
    acquire: async () => {},
    penalize: async () => {},
  });
  expect((await client.reviews("Some other title", false)).forum).toBeNull();
});
it("returns explicit no-public-review output and handles missing ratings", async () => {
  const client = createOpenReviewClient({
    fetchImpl: async () =>
      json({
        notes: [
          fixture.notes[0],
          {
            id: "review",
            invitations: ["X/-/Official_Review"],
            content: { summary: { value: "No numeric rating" } },
          },
        ],
      }),
    acquire: async () => {},
    penalize: async () => {},
  });
  const r = await client.reviews("syntheticForum", false);
  expect(r.ratings).toBeNull();
  expect(r.reviews[0]?.rating).toBeUndefined();
});
