/**
 * Live smoke test. OpenAlex always; Semantic Scholar only when S2_API_KEY is in the environment
 * (keyless S2 is skipped to stay off the shared pool). Uses an in-process limiter instead of the DO.
 */

import { describe, expect, it } from "vitest";
import { INITIAL_STATE, intervalFor, reserve } from "../../src/limiter/schedule";
import { RateLimitedError } from "../../src/limiter/s2-limiter";
import { createOpenAlexClient } from "../../src/sources/openalex";
import { createS2Client } from "../../src/sources/s2";
import { coauthorship, getAuthor } from "../../src/tools/authors";
import type { ToolContext } from "../../src/tools/context";
import { getPapers } from "../../src/tools/papers";

const nodeEnv = (globalThis as { process?: { env: Record<string, string | undefined> } }).process?.env ?? {};
const s2Key = nodeEnv.S2_API_KEY || undefined;
const oaKey = nodeEnv.OPENALEX_API_KEY || undefined;

function context(useS2: boolean): ToolContext {
  let state = INITIAL_STATE;
  const acquire = async (): Promise<void> => {
    if (!useS2) throw new RateLimitedError(60_000);
    const next = reserve(state, Date.now(), intervalFor(true), 10_000);
    state = next.state;
    if (!next.result.ok) throw new RateLimitedError(next.result.retryAfterMs);
    await new Promise((r) => setTimeout(r, next.result.ok ? next.result.waitMs : 0));
  };
  return {
    s2: createS2Client({ apiKey: s2Key, acquire, penalize: async () => {} }),
    oa: createOpenAlexClient({ apiKey: oaKey }),
    notices: [],
  };
}

const A = { author_a: "Anupam Chattopadhyay", affiliation_a: "Nanyang Technological University" };
const B = { author_b: "Raphael C.-W. Phan", affiliation_b: "Monash University" };

describe("live: OpenAlex only", () => {
  it("Chattopadhyay vs Phan have 0 shared papers", async () => {
    const ctx = context(false);
    const text = await coauthorship(ctx, { ...A, ...B, limit: 5 });
    console.info(`\n--- OpenAlex-only coauthorship ---\n${text}\n${ctx.notices.map((n) => n.text).join("\n")}`);
    expect(text).toMatch(/Shared papers: 0 /);
  });
});

describe.skipIf(!s2Key)("live: Semantic Scholar with key", () => {
  it("coauthorship across both sources is 0", async () => {
    const ctx = context(true);
    const text = await coauthorship(ctx, { ...A, ...B, limit: 5 });
    console.info(`\n--- S2+OpenAlex coauthorship ---\n${text}`);
    expect(text).toMatch(/Shared papers: 0 /);
  });

  it("get_author merges records and get_paper batches", async () => {
    const ctx = context(true);
    const author = await getAuthor(ctx, { name_or_id: A.author_a, affiliation_hint: "NTU Singapore Nanyang", include_papers: true, sort: "cited", limit: 3 });
    console.info(`\n--- get_author ---\n${author}`);
    expect(author).toMatch(/S2 \d+/);
    const papers = await getPapers(ctx, ["1706.03762", "10.1109/CVPR.2016.90"], false);
    console.info(`\n--- get_paper ---\n${papers}`);
    expect(papers).toMatch(/Attention Is All You Need/i);
    expect(papers).toMatch(/Deep Residual Learning/i);
  });
});
