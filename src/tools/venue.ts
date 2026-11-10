import type { AppEnv } from "../env";
import { lookupVenue, type VenueTable } from "../sources/venue";
import type { ToolContext } from "./context";
export async function venue(env: AppEnv, ctx: ToolContext, query: string) {
  const table = await env.OAUTH_KV.get<VenueTable>("litscout:venues", "json");
  if (!table?.venues?.length) {
    ctx.report?.sources_skipped.push({
      source: "venue_table",
      reason:
        "Venue data unavailable; rerun litscout deploy to download official tables.",
    });
    return { matches: [] };
  }
  ctx.report?.sources_used.push("venue_table");
  return lookupVenue(table, query);
}
