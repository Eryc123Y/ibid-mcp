/** Shared JSON request helper: cache, retry, error mapping. */

import { cached } from "./cache";
import { fetchWithRetry, type RetryOptions } from "./fetch-retry";

export class HttpError extends Error {
  constructor(
    readonly status: number,
    readonly service: string,
    detail: string,
  ) {
    super(`${service} HTTP ${status}: ${detail.slice(0, 200)}`);
    this.name = "HttpError";
  }
}

export interface JsonRequest {
  readonly service: string;
  readonly url: string;
  readonly init: RequestInit;
  /** Cache key without secrets; omit to skip caching. */
  readonly cacheKey?: string;
  readonly ttlSeconds?: number;
  readonly retry: RetryOptions;
  /** Inspect response headers (e.g. remaining budget) before the body is read. */
  readonly onResponse?: (response: Response) => void;
}

export async function requestJson<T>(req: JsonRequest): Promise<T> {
  const load = async (): Promise<{ body: string; cacheable: boolean }> => {
    const response = await fetchWithRetry(req.url, req.init, req.retry);
    req.onResponse?.(response);
    const body = await response.text();
    if (!response.ok) throw new HttpError(response.status, req.service, body);
    return { body, cacheable: true };
  };
  const body = req.cacheKey ? await cached(req.cacheKey, req.ttlSeconds ?? 600, load) : (await load()).body;
  try {
    return JSON.parse(body) as T;
  } catch {
    throw new HttpError(502, req.service, "invalid JSON");
  }
}
