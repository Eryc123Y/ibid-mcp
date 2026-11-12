/**
 * Publisher metadata APIs for `litscout abstracts`, each tried only for its own DOI prefix and
 * only when its key is set; without the key the stage makes no request and says nothing. Keys
 * come from the environment and travel only to their own API (IEEE and Springer take them as a
 * query parameter, Elsevier as a header). Errors never carry URLs, so they cannot leak a key.
 */

import { doiPath, normalizeDoi } from "../../src/core/normalize";
import {
  NOTHING,
  perItem,
  TIMEOUT_MS,
  withDoi,
  type AbstractsContext,
  type Pending,
  type Stage,
  found,
} from "./stage";
import { cleanAbstract } from "./text";

/** A stage for one publisher: skipped without its key, else one request per matching DOI. */
function publisher(
  name: Stage["name"],
  keyVar: string,
  prefix: string,
  lookup: (
    doi: string,
    key: string,
    ctx: AbstractsContext,
  ) => Promise<string | null | undefined>,
): Stage {
  return {
    name,
    run(pending: readonly Pending[], ctx: AbstractsContext) {
      const key = ctx.env[keyVar]?.trim();
      if (!key) return Promise.resolve(NOTHING);
      return perItem(
        withDoi(pending, prefix),
        async (item) => found(cleanAbstract(await lookup(item.doi!, key, ctx))),
        ctx,
      );
    },
  };
}

/** Every string inside a value, in document order (Springer abstracts can be {h1, p: [...]}). */
export function strings(value: unknown): string[] {
  if (typeof value === "string") return [value];
  if (Array.isArray(value)) return value.flatMap(strings);
  if (value && typeof value === "object")
    return Object.values(value).flatMap(strings);
  return [];
}

interface IeeeSearch {
  readonly articles?: ReadonlyArray<{
    readonly doi?: string | null;
    readonly abstract?: string | null;
  }>;
}

/** IEEE Xplore Metadata API: `doi` overrides every other search parameter. */
const ieee = publisher(
  "ieee",
  "IEEE_API_KEY",
  "10.1109/",
  async (doi, key, ctx) => {
    const params = new URLSearchParams({
      doi,
      format: "json",
      max_records: "5",
      apikey: key,
    });
    const body = await ctx.http.json<IeeeSearch>(
      `https://ieeexploreapi.ieee.org/api/v1/search/articles?${params}`,
      { service: "IEEE Xplore", timeoutMs: TIMEOUT_MS, redirect: "error" },
    );
    return body.articles?.find((a) => normalizeDoi(a.doi) === doi)?.abstract;
  },
);

interface SpringerMeta {
  readonly records?: ReadonlyArray<{
    readonly doi?: string | null;
    readonly abstract?: unknown;
  }>;
}

/** Springer Nature Meta API v2. */
const springer = publisher(
  "springer",
  "SPRINGER_API_KEY",
  "10.1007/",
  async (doi, key, ctx) => {
    const params = new URLSearchParams({
      q: `doi:${doi}`,
      p: "5",
      api_key: key,
    });
    const body = await ctx.http.json<SpringerMeta>(
      `https://api.springernature.com/meta/v2/json?${params}`,
      { service: "Springer Nature", timeoutMs: TIMEOUT_MS, redirect: "error" },
    );
    const record = body.records?.find((r) => normalizeDoi(r.doi) === doi);
    return record ? strings(record.abstract).join(" ") : null;
  },
);

interface ElsevierAbstract {
  readonly "abstracts-retrieval-response"?: {
    readonly coredata?: { readonly "dc:description"?: unknown };
  };
}

/** Elsevier (Scopus) Abstract Retrieval API; the META_ABS view carries `dc:description`. */
const elsevier = publisher(
  "elsevier",
  "ELSEVIER_API_KEY",
  "10.1016/",
  async (doi, key, ctx) => {
    const body = await ctx.http.json<ElsevierAbstract>(
      `https://api.elsevier.com/content/abstract/doi/${doiPath(doi)}?view=META_ABS`,
      {
        service: "Elsevier",
        headers: { "X-ELS-APIKey": key },
        timeoutMs: TIMEOUT_MS,
        // fetch keeps custom headers across a cross-origin redirect; the key must not follow one.
        redirect: "error",
      },
    );
    const description =
      body["abstracts-retrieval-response"]?.coredata?.["dc:description"];
    return strings(description).join(" ");
  },
);

export const PUBLISHER_STAGES: readonly Stage[] = [ieee, springer, elsevier];
