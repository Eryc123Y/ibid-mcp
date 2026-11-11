/** OpenAlex enrichment of Crossref DOIs: abstract, open-access link and arXiv ID. */

import { normalizeDoi } from "../../src/core/normalize";
import { abstractFromInvertedIndex } from "../../src/sources/openalex";
import { reason, type WatchContext } from "./context";
import { arxivIdIn } from "./line";

export const DOI_BATCH = 50;
const SELECT = "doi,abstract_inverted_index,open_access,locations";

export interface Enrichment {
  readonly abstract: string | null;
  readonly oaUrl: string | null;
  readonly arxivId: string | null;
}

export interface OpenAlexWork {
  readonly id?: string;
  readonly doi?: string | null;
  readonly abstract_inverted_index?: Record<string, number[]> | null;
  readonly open_access?: { oa_url?: string | null } | null;
  readonly locations?: ReadonlyArray<{
    landing_page_url?: string | null;
    pdf_url?: string | null;
  }> | null;
}

export function enrichment(work: OpenAlexWork): Enrichment {
  const urls = [
    work.doi,
    ...(work.locations ?? []).flatMap((l) => [l.landing_page_url, l.pdf_url]),
  ];
  return {
    abstract: abstractFromInvertedIndex(work.abstract_inverted_index) ?? null,
    oaUrl: work.open_access?.oa_url ?? null,
    arxivId: arxivIdIn(urls),
  };
}

function merge(a: Enrichment | undefined, b: Enrichment): Enrichment {
  return a
    ? {
        abstract: a.abstract ?? b.abstract,
        oaUrl: a.oaUrl ?? b.oaUrl,
        arxivId: a.arxivId ?? b.arxivId,
      }
    : b;
}

/** Enrichment by DOI. Stops at the first failure (quota spent or OpenAlex down) and keeps what it has. */
export async function enrichDois(
  ctx: WatchContext,
  dois: readonly string[],
): Promise<Map<string, Enrichment>> {
  const found = new Map<string, Enrichment>();
  if (!dois.length) return found;
  if (!ctx.openalexKeyed) {
    ctx.warn(
      "OPENALEX_API_KEY is not set: journal papers go out without OpenAlex abstracts, open-access links or arXiv IDs",
    );
    return found;
  }
  const usable = dois.filter((d) => !/[,|]/.test(d));
  for (let i = 0; i < usable.length; i += DOI_BATCH) {
    const chunk = usable.slice(i, i + DOI_BATCH);
    try {
      const page = await ctx.openalex.worksPage<OpenAlexWork>({
        filter: `doi:${chunk.join("|")}`,
        select: SELECT,
        perPage: DOI_BATCH,
      });
      page.results.forEach((work) => {
        const doi = normalizeDoi(work.doi);
        if (doi) found.set(doi, merge(found.get(doi), enrichment(work)));
      });
    } catch (error) {
      ctx.warn(
        `OpenAlex enrichment stopped (${reason(error)}) after ${i} of ${usable.length} DOIs; the rest go out with Crossref data only`,
      );
      break;
    }
  }
  return found;
}
