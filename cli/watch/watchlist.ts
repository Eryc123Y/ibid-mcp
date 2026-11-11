/** Reading LitScout Daily's watch list (`summaries/watchlist.json`). Unknown fields are ignored. */

export type VenueKind = "journal" | "conference";

/** ACL Anthology venue ids whose main volumes watch knows how to pick. */
export const ACL_VENUES = [
  "acl",
  "emnlp",
  "naacl",
  "eacl",
  "conll",
  "tacl",
  "cl",
  "mol",
] as const;
export type AclVenue = (typeof ACL_VENUES)[number];

export interface Venue {
  readonly name: string;
  readonly kind: VenueKind;
  readonly issn: readonly string[];
  readonly openalexSource?: string;
  readonly openreviewVenues: readonly string[];
  readonly sources?: readonly string[];
  readonly aclAnthology?: AclVenue;
  readonly pmlr?: string;
  readonly doiPrefix?: string;
  /** OpenReview venue ids; `{year}` is expanded over the window. */
  readonly openreview: readonly string[];
  readonly jmlr: boolean;
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

/** A DOI prefix with at least one suffix character; no spaces, quotes or query syntax. */
export const DOI_PREFIX = /^10\.\d{4,9}\/[A-Za-z0-9][A-Za-z0-9._-]{0,80}$/;
const PMLR_SERIES = /^[A-Za-z][A-Za-z0-9&+. -]{0,60}$/;

type Checked<T> = { value?: T; problem?: string };

function aclField(raw: unknown): Checked<AclVenue> {
  if (raw === undefined) return {};
  const id = isText(raw) ? raw.trim().toLowerCase() : "";
  return (ACL_VENUES as readonly string[]).includes(id)
    ? { value: id as AclVenue }
    : { problem: `acl_anthology must be one of ${ACL_VENUES.join(", ")}` };
}

function pmlrField(raw: unknown): Checked<string> {
  if (raw === undefined) return {};
  const series = isText(raw) ? raw.trim() : "";
  return PMLR_SERIES.test(series) && !/\s\d{4}$/.test(series)
    ? { value: series }
    : { problem: "pmlr is not a PMLR series name" };
}

function doiPrefixField(raw: unknown): Checked<string> {
  if (raw === undefined) return {};
  const prefix = isText(raw) ? raw.trim() : "";
  return DOI_PREFIX.test(prefix)
    ? { value: prefix }
    : { problem: "doi_prefix is not a DOI prefix" };
}

function newFields(
  name: string,
  entry: Record<string, unknown>,
  warn: (text: string) => void,
) {
  const acl = aclField(entry.acl_anthology);
  const pmlr = pmlrField(entry.pmlr);
  const doi = doiPrefixField(entry.doi_prefix);
  [acl, pmlr, doi].forEach(
    (c) => c.problem && warn(`${name}: ${c.problem}; ignored`),
  );
  const openreview = isText(entry.openreview)
    ? [entry.openreview.trim()]
    : texts(entry.openreview);
  return {
    aclAnthology: acl.value,
    pmlr: pmlr.value,
    doiPrefix: doi.value,
    openreview,
    jmlr: entry.jmlr === true,
  };
}

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
    ...newFields(name, entry, warn),
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
    ? `${venue.name}: OpenReview only, which needs an API token and the openreview field; skipped`
    : `${venue.name}: ${missing}; skipped`;
}
