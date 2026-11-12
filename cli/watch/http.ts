/**
 * Plain HTTP for the watch sources that have no client in src/sources: one limiter per host,
 * bounded retries, a fixed project User-Agent and no personal details in any request.
 */

import { fetchWithRetry } from "../../src/http/fetch-retry";
import { HttpError } from "../../src/http/json";
import { intervalLimiter, type LocalLimiter } from "./limiter";

export const USER_AGENT =
  "litscout-watch/0.1 (https://github.com/Eryc123Y/litscout-mcp)";

/** Minimum spacing per host, in milliseconds; unknown hosts get one request a second. */
const HOST_INTERVAL_MS: Readonly<Record<string, number>> = {
  "api.github.com": 1000,
  "raw.githubusercontent.com": 250,
  "proceedings.mlr.press": 1000,
  "api.datacite.org": 500,
  "doi.org": 500,
  "www.jmlr.org": 1000,
  // litscout abstracts: Europe PMC publishes no limit; IEEE allows 10 calls a second (and a
  // daily quota), Elsevier's Abstract Retrieval 9 a second; Springer's free plan is the tightest.
  "www.ebi.ac.uk": 250,
  "ieeexploreapi.ieee.org": 500,
  "api.springernature.com": 1000,
  "api.elsevier.com": 250,
};
const DOWNLOAD_TIMEOUT_MS = 60_000;

export interface Request {
  readonly service: string;
  readonly headers?: Readonly<Record<string, string>>;
  readonly method?: "GET" | "POST";
  readonly body?: string;
  /** Per-attempt timeout; default 60 s (enough for large downloads). */
  readonly timeoutMs?: number;
  /** "error" for requests that carry a key, so no redirect can take it to another host. */
  readonly redirect?: "follow" | "error" | "manual";
}

export interface Http {
  readonly text: (url: string, req: Request) => Promise<string>;
  readonly json: <T>(url: string, req: Request) => Promise<T>;
}

/** A response that arrived but could not be read (bad XML, YAML or JSON). */
export class DataError extends Error {
  constructor(service: string) {
    super(`${service} returned data watch cannot read`);
    this.name = "DataError";
  }
}

export function createHttp(
  fetchImpl: typeof fetch,
  sleep: (ms: number) => Promise<void>,
): Http {
  const limiters = new Map<string, LocalLimiter>();
  const limiter = (hostname: string) => {
    const found = limiters.get(hostname);
    if (found) return found;
    const made = intervalLimiter(HOST_INTERVAL_MS[hostname] ?? 1000, sleep);
    limiters.set(hostname, made);
    return made;
  };
  async function text(url: string, req: Request): Promise<string> {
    const limit = limiter(new URL(url).hostname);
    const response = await fetchWithRetry(
      url,
      {
        method: req.method ?? "GET",
        body: req.body,
        redirect: req.redirect,
        headers: { "user-agent": USER_AGENT, ...req.headers },
        signal: AbortSignal.timeout(req.timeoutMs ?? DOWNLOAD_TIMEOUT_MS),
      },
      {
        retries: 2,
        baseDelayMs: 1000,
        fetchImpl,
        sleep,
        beforeAttempt: limit.acquire,
        onThrottled: limit.penalize,
      },
    );
    if (!response.ok) {
      await response.body?.cancel();
      throw new HttpError(response.status, req.service, "request failed");
    }
    return response.text();
  }
  return {
    text,
    async json<T>(url: string, req: Request): Promise<T> {
      const body = await text(url, {
        ...req,
        headers: { accept: "application/json", ...req.headers },
      });
      try {
        return JSON.parse(body) as T;
      } catch {
        throw new DataError(req.service);
      }
    },
  };
}
