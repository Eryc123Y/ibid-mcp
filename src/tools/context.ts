/** Per-request tool context: backend clients plus a notice collector, and the S2→OpenAlex fallback. */

import type { Notice } from "../core/types";
import type { AppEnv } from "../env";
import { HttpError } from "../http/json";
import { acquireS2Slot, penalizeS2, RateLimitedError } from "../limiter/s2-limiter";
import { budgetNotice, createOpenAlexClient, type OpenAlexClient } from "../sources/openalex";
import { createS2Client, type S2Client } from "../sources/s2";

export interface ToolContext {
  readonly s2: S2Client;
  readonly oa: OpenAlexClient;
  readonly notices: Notice[];
}

export function createToolContext(env: AppEnv): ToolContext {
  return {
    s2: createS2Client({
      apiKey: env.S2_API_KEY || undefined,
      acquire: () => acquireS2Slot(env),
      penalize: (ms) => penalizeS2(env, ms),
    }),
    oa: createOpenAlexClient({ apiKey: env.OPENALEX_API_KEY || undefined }),
    notices: [],
  };
}

/** S2 failures that justify falling back to OpenAlex rather than failing the tool. */
export function isS2Unavailable(error: unknown): boolean {
  if (error instanceof RateLimitedError) return true;
  return error instanceof HttpError && (error.status === 429 || error.status >= 500);
}

export function describeS2Failure(error: unknown): string {
  return error instanceof RateLimitedError
    ? "Semantic Scholar queue is full (1 req/s shared by all clients)"
    : `Semantic Scholar unavailable (${error instanceof Error ? error.message : String(error)})`;
}

/** Run the S2 path; on rate limiting or outage, record a notice and run the OpenAlex path. */
export async function withFallback<T>(
  ctx: ToolContext,
  primary: () => Promise<T>,
  fallback: () => Promise<T>,
): Promise<T> {
  try {
    return await primary();
  } catch (error) {
    if (!isS2Unavailable(error)) throw error;
    ctx.notices.push({ level: "warn", text: `${describeS2Failure(error)}; fell back to OpenAlex. Retry later for S2 data.` });
    return fallback();
  }
}

/** Notices to print at the top of a tool result, including the OpenAlex budget warning. */
export function collectNotices(ctx: ToolContext): Notice[] {
  const budget = budgetNotice();
  return budget ? [...ctx.notices, budget] : [...ctx.notices];
}
