/** Runs the dedicated source for one routed venue and turns failures into per-venue stderr lines. */

import { aclLines } from "./acl";
import { reason, SkipVenue, SourceFailure, type WatchContext } from "./context";
import { doiPrefixLines } from "./doi-prefix";
import { jmlrLines } from "./jmlr";
import type { Outcome } from "./journals";
import type { FeedLine } from "./line";
import { openreviewLines } from "./openreview";
import { pmlrLines } from "./pmlr";
import type { Route } from "./route";
import type { Venue } from "./watchlist";

type Dedicated = Exclude<Route, { kind: "legacy" } | { kind: "skip" }>;

const LABELS: Readonly<Record<Dedicated["kind"], string>> = {
  jmlr: "JMLR",
  acl: "ACL Anthology",
  pmlr: "PMLR",
  doi: "DOI prefix lookup",
  openreview: "OpenReview",
};

function read(
  ctx: WatchContext,
  venue: Venue,
  r: Dedicated,
): Promise<FeedLine[]> {
  switch (r.kind) {
    case "jmlr":
      return jmlrLines(ctx, venue);
    case "acl":
      return aclLines(ctx, venue, r.id);
    case "pmlr":
      return pmlrLines(ctx, venue, r.series);
    case "doi":
      return doiPrefixLines(ctx, venue, r.prefix);
    case "openreview":
      return openreviewLines(ctx, venue, r.ids);
  }
}

export async function readRouted(
  ctx: WatchContext,
  venue: Venue,
  r: Dedicated,
): Promise<Outcome> {
  try {
    const lines = await read(ctx, venue, r);
    return { lines, attempted: 1, failed: 0, skipped: 0 };
  } catch (error) {
    if (error instanceof SkipVenue) {
      ctx.warn(`${venue.name}: ${error.message}; skipped`);
      return { lines: [], attempted: 0, failed: 0, skipped: 0 };
    }
    const failure = error instanceof SourceFailure ? error : null;
    ctx.warn(
      `${venue.name}: ${failure?.label ?? LABELS[r.kind]} failed (${reason(failure ? failure.underlying : error)})`,
    );
    return { lines: [], attempted: 1, failed: 1, skipped: 0 };
  }
}
