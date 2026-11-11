import { HttpError } from "../../src/http/json";
import type { CrossrefClient } from "../../src/sources/crossref";
import type { OpenAlexClient } from "../../src/sources/openalex";

export interface Window {
  readonly since: string;
  readonly until?: string;
}

export interface WatchContext {
  readonly window: Window;
  readonly crossref: CrossrefClient;
  readonly openalex: OpenAlexClient;
  readonly openalexKeyed: boolean;
  readonly warn: (text: string) => void;
}

export function inWindow(day: string | null, window: Window): boolean {
  return (
    day !== null &&
    day >= window.since &&
    (!window.until || day <= window.until)
  );
}

/** A short reason that never echoes URLs (OpenAlex URLs carry the API key). */
export function reason(error: unknown): string {
  if (error instanceof HttpError) return `HTTP ${error.status}`;
  if (error instanceof Error && /timeout|abort/i.test(error.name))
    return "timed out";
  return "network error";
}
