/** Reading LitScout Daily's watch list (`summaries/watchlist.json`). Unknown fields are ignored. */

export type VenueKind = "journal" | "conference";

export interface Venue {
  readonly name: string;
  readonly kind: VenueKind;
  readonly issn: readonly string[];
  readonly openalexSource?: string;
  readonly openreviewVenues: readonly string[];
  readonly sources?: readonly string[];
}

export class WatchError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "WatchError";
  }
}

const isText = (v: unknown): v is string =>
  typeof v === "string" && v.trim().length > 0;

const texts = (v: unknown): string[] =>
  Array.isArray(v) ? v.filter(isText).map((s) => s.trim()) : [];

function venue(raw: unknown, warn: (text: string) => void): Venue | null {
  const entry = (raw ?? {}) as Record<string, unknown>;
  const name = isText(entry.name) ? entry.name.trim() : undefined;
  const kind = entry.kind;
  if (!name || (kind !== "journal" && kind !== "conference")) {
    warn(
      `watch list entry without a name or a journal/conference kind skipped`,
    );
    return null;
  }
  return {
    name,
    kind,
    issn: texts(entry.issn),
    openalexSource: isText(entry.openalex_source)
      ? entry.openalex_source.trim()
      : undefined,
    openreviewVenues: texts(entry.openreview_venues),
    sources: Array.isArray(entry.sources) ? texts(entry.sources) : undefined,
  };
}

export function parseWatchList(
  text: string,
  warn: (text: string) => void,
): Venue[] {
  let data: unknown;
  try {
    data = JSON.parse(text);
  } catch {
    throw new WatchError("the venue file is not valid JSON");
  }
  const venues = (data as { venues?: unknown } | null)?.venues;
  if (!Array.isArray(venues))
    throw new WatchError('the venue file has no "venues" list');
  return venues
    .map((raw) => venue(raw, warn))
    .filter((v): v is Venue => v !== null);
}

/** Whether the venue's optional `sources` allows this source. */
export function allows(venue: Venue, source: string): boolean {
  return !venue.sources || venue.sources.includes(source);
}

/** The stderr line for a venue this command cannot read. */
export function skipLine(venue: Venue, missing: string): string {
  return venue.openreviewVenues.length
    ? `${venue.name}: OpenReview only, which needs an API token (not supported yet); skipped`
    : `${venue.name}: ${missing}; skipped`;
}
