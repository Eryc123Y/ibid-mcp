import { HttpError } from "../../src/http/json";
import type { CrossrefClient } from "../../src/sources/crossref";
import type { OpenAlexClient } from "../../src/sources/openalex";
import { DataError, type Http } from "./http";

export interface Window {
  readonly since: string;
  readonly until?: string;
}

export interface WatchFiles {
  readonly read: (file: string) => Promise<string>;
  /** Absent when the caller gives watch nowhere to keep state. */
  readonly write?: (file: string, text: string) => Promise<void>;
}

export interface WatchContext {
  readonly window: Window;
  /** The run's day, YYYY-MM-DD (UTC). */
  readonly today: string;
  readonly crossref: CrossrefClient;
  readonly openalex: OpenAlexClient;
  readonly openalexKeyed: boolean;
  readonly warn: (text: string) => void;
  readonly http: Http;
  readonly env: Readonly<Record<string, string | undefined>>;
  readonly files: WatchFiles;
  readonly fetch: typeof fetch;
  readonly sleep: (ms: number) => Promise<void>;
  /** One shared promise per key for the run (indexes, logins, registration agencies). */
  readonly memo: <T>(key: string, load: () => Promise<T>) => Promise<T>;
}

export function inWindow(day: string | null, window: Window): boolean {
  return (
    day !== null &&
    day >= window.since &&
    (!window.until || day <= window.until)
  );
}

/** The last day the run covers: --until, else today. */
export function lastDay(ctx: Pick<WatchContext, "window" | "today">): string {
  return ctx.window.until ?? ctx.today;
}

/** Calendar years from `from` years before --since to `to` years after the last day. */
export function years(
  window: Window,
  today: string,
  from: number,
  to: number,
): number[] {
  const first = Number(window.since.slice(0, 4)) - from;
  const last = Number((window.until ?? today).slice(0, 4)) + to;
  return Array.from({ length: last - first + 1 }, (_, i) => first + i);
}

export function nextDay(day: string): string {
  const date = new Date(`${day}T00:00:00Z`);
  date.setUTCDate(date.getUTCDate() + 1);
  return date.toISOString().slice(0, 10);
}

/** A short reason that never echoes URLs (OpenAlex URLs carry the API key). */
export function reason(error: unknown): string {
  if (error instanceof HttpError) return `HTTP ${error.status}`;
  if (error instanceof DataError) return "unreadable response";
  if (error instanceof Error && /timeout|abort/i.test(error.name))
    return "timed out";
  return "network error";
}

/** Thrown by a source when the venue cannot be read for a reason that is not a failure. */
export class SkipVenue extends Error {
  constructor(message: string) {
    super(message);
    this.name = "SkipVenue";
  }
}

/** A failure that names the step that failed (e.g. "OpenReview login"). */
export class SourceFailure extends Error {
  constructor(
    readonly label: string,
    readonly underlying: unknown,
  ) {
    super(label);
    this.name = "SourceFailure";
  }
}
