/** fetch with bounded retries for 429 and 5xx, exponential backoff and Retry-After support. */

export interface RetryOptions {
  readonly retries: number;
  readonly baseDelayMs: number;
  /** Hard cap on any single backoff sleep. */
  readonly maxDelayMs?: number;
  /** Runs before every attempt (e.g. acquire a rate-limiter slot). May throw to abort. */
  readonly beforeAttempt?: () => Promise<void>;
  /** Told about a 429 so a shared limiter can back off too. */
  readonly onThrottled?: (delayMs: number) => Promise<void>;
  readonly fetchImpl?: typeof fetch;
  readonly random?: () => number;
  readonly sleep?: (ms: number) => Promise<void>;
}

const defaultSleep = (ms: number): Promise<void> =>
  new Promise((resolve) => setTimeout(resolve, ms));

export function isRetryableStatus(status: number): boolean {
  return status === 429 || (status >= 500 && status <= 599);
}

export function retryAfterMs(header: string | null): number | undefined {
  if (!header) return undefined;
  const seconds = Number(header);
  if (Number.isFinite(seconds)) return Math.max(0, seconds * 1000);
  const date = Date.parse(header);
  return Number.isNaN(date) ? undefined : Math.max(0, date - Date.now());
}

export function backoffMs(
  attempt: number,
  baseDelayMs: number,
  maxDelayMs: number,
): number {
  return Math.min(maxDelayMs, baseDelayMs * 2 ** attempt);
}

/**
 * Returns the last response (possibly non-2xx) once retries are exhausted. Network errors are
 * retried too and re-thrown after the last attempt.
 */
export async function fetchWithRetry(
  url: string,
  init: RequestInit,
  options: RetryOptions,
): Promise<Response> {
  const doFetch = options.fetchImpl ?? fetch;
  const sleep = options.sleep ?? defaultSleep;
  const maxDelay = options.maxDelayMs ?? 8000;
  let lastError: unknown;

  for (let attempt = 0; attempt <= options.retries; attempt += 1) {
    if (options.beforeAttempt) await options.beforeAttempt();
    try {
      const response = await doFetch(url, {
        ...init,
        signal: init.signal ?? AbortSignal.timeout(12000),
      });
      if (!isRetryableStatus(response.status)) return response;
      const hinted = retryAfterMs(response.headers.get("retry-after"));
      const delay =
        hinted ??
        Math.min(
          maxDelay,
          backoffMs(attempt, options.baseDelayMs, maxDelay) *
            (0.75 + (options.random ?? Math.random)() * 0.5),
        );
      if (response.status === 429 && options.onThrottled)
        await options.onThrottled(delay);
      if (attempt === options.retries || delay > maxDelay) return response;
      await response.body?.cancel();
      await sleep(delay);
    } catch (error) {
      if (error instanceof Error && error.name === "RateLimitedError")
        throw error;
      lastError = error;
      if (attempt === options.retries) break;
      await sleep(backoffMs(attempt, options.baseDelayMs, maxDelay));
    }
  }
  throw lastError instanceof Error ? lastError : new Error("fetch failed");
}
