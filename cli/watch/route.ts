/**
 * Which source reads a venue. A venue may name several; the most precise wins:
 * jmlr > acl_anthology > pmlr > doi_prefix > openreview > issn (journals) / openalex_source
 * (conferences), the last two being the original Crossref and OpenAlex paths ("legacy").
 */

import { allows, type AclVenue, type Venue } from "./watchlist";

export const OPENREVIEW_CREDENTIALS =
  "OpenReview needs OPENREVIEW_TOKEN, or OPENREVIEW_USERNAME and OPENREVIEW_PASSWORD";

export type Route =
  | { readonly kind: "jmlr" }
  | { readonly kind: "acl"; readonly id: AclVenue }
  | { readonly kind: "pmlr"; readonly series: string }
  | { readonly kind: "doi"; readonly prefix: string }
  | { readonly kind: "openreview"; readonly ids: readonly string[] }
  | { readonly kind: "legacy"; readonly note?: string }
  | { readonly kind: "skip"; readonly reason: string };

/** What the original path would read for this venue, if anything. */
function legacySource(venue: Venue): string | null {
  if (venue.kind === "journal")
    return venue.issn.length && allows(venue, "crossref")
      ? "its ISSN on Crossref"
      : null;
  return venue.openalexSource && allows(venue, "openalex")
    ? "its OpenAlex source"
    : null;
}

export function route(venue: Venue, openreviewReady: boolean): Route {
  if (venue.jmlr) return { kind: "jmlr" };
  if (venue.aclAnthology) return { kind: "acl", id: venue.aclAnthology };
  if (venue.pmlr) return { kind: "pmlr", series: venue.pmlr };
  if (venue.doiPrefix) return { kind: "doi", prefix: venue.doiPrefix };
  if (!venue.openreview.length || !allows(venue, "openreview"))
    return { kind: "legacy" };
  if (openreviewReady) return { kind: "openreview", ids: venue.openreview };
  const fallback = legacySource(venue);
  return fallback
    ? {
        kind: "legacy",
        note: `${OPENREVIEW_CREDENTIALS}; reading ${fallback} instead`,
      }
    : { kind: "skip", reason: OPENREVIEW_CREDENTIALS };
}
