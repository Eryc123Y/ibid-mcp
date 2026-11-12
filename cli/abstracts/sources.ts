/**
 * The free sources of `litscout abstracts`, in contract order: OpenAlex, Semantic Scholar,
 * arXiv, Crossref and Europe PMC. Each reuses the shared client in src/sources (or the watch
 * Http helper) and its limiter.
 */

import { normalizeDoi } from "../../src/core/normalize";
import { abstractFromInvertedIndex } from "../../src/sources/openalex";
import { arxivId } from "./input";
import {
  attempt,
  failed,
  found,
  NOTHING,
  perItem,
  TIMEOUT_MS,
  withDoi,
  type Found,
  type Stage,
} from "./stage";
import { cleanAbstract, sameTitle } from "./text";

interface OpenAlexWork {
  readonly doi?: string | null;
  readonly abstract_inverted_index?: Record<string, number[]> | null;
  readonly locations?: ReadonlyArray<{
    readonly landing_page_url?: string | null;
    readonly pdf_url?: string | null;
  }> | null;
}

const ARXIV_URL =
  /arxiv\.org\/(?:abs|pdf)\/([^?#]+?)(?:\.pdf)?\/?(?:[?#].*)?$/i;
const ARXIV_DOI = /^10\.48550\/arxiv\.(.+)$/i;

/** The arXiv id OpenAlex reveals: an arXiv primary DOI (merged works) or an arXiv location. */
export function openalexArxiv(work: OpenAlexWork): string | undefined {
  const fromDoi = normalizeDoi(work.doi)?.match(ARXIV_DOI)?.[1];
  const urls = (work.locations ?? []).flatMap((l) => [
    l.landing_page_url,
    l.pdf_url,
  ]);
  return [fromDoi, ...urls.map((u) => u?.match(ARXIV_URL)?.[1])]
    .map((id) => arxivId(id))
    .find(Boolean);
}

const openalex: Stage = {
  name: "openalex",
  // One GET per DOI: the doi: filter misses journal versions merged into their arXiv preprint.
  run: (pending, ctx) =>
    perItem(
      withDoi(pending),
      async (item) => {
        const work = await ctx.openalex.workByDoi<OpenAlexWork>(
          item.doi!,
          "doi,abstract_inverted_index,locations",
        );
        return found(
          cleanAbstract(
            abstractFromInvertedIndex(work.abstract_inverted_index),
          ),
          openalexArxiv(work),
        );
      },
      ctx,
    ),
};

const s2: Stage = {
  name: "s2",
  // Every remaining DOI in one batch request.
  async run(pending, ctx) {
    const items = withDoi(pending);
    if (!items.length) return NOTHING;
    if (ctx.expired()) return { found: new Map(), skipped: 1 };
    const papers = await attempt(() =>
      ctx.s2.abstractBatch(items.map((p) => `DOI:${p.doi}`)),
    );
    if (failed(papers)) return { found: new Map(), skipped: 1 };
    const results = new Map<number, Found>();
    items.forEach((item, i) => {
      const paper = papers?.[i];
      const arxiv = paper?.externalIds?.ArXiv;
      const hit = found(
        cleanAbstract(paper?.abstract),
        typeof arxiv === "string" ? arxivId(arxiv) : undefined,
      );
      if (hit) results.set(item.index, hit);
    });
    return { found: results, skipped: 0 };
  },
};

/** arXiv's id_list takes many ids; 50 keeps a bad one from costing more than its batch. */
const ARXIV_BATCH = 50;
const TITLE_CANDIDATES = 5;

const arxiv: Stage = {
  name: "arxiv",
  async run(pending, ctx) {
    const results = new Map<number, Found>();
    let skipped = 0;
    const withId = pending.filter((p) => p.arxiv);
    const ids = [...new Set(withId.map((p) => p.arxiv!))];
    const abstracts = new Map<string, string>();
    for (let i = 0; i < ids.length; i += ARXIV_BATCH) {
      if (ctx.expired()) {
        skipped += 1;
        continue;
      }
      const papers = await attempt(() =>
        ctx.arxiv.byIds(ids.slice(i, i + ARXIV_BATCH)),
      );
      if (failed(papers)) skipped += 1;
      (failed(papers) ? [] : (papers ?? [])).forEach((paper) => {
        const text = cleanAbstract(paper.abstract);
        if (paper.arxiv && text) abstracts.set(paper.arxiv.toLowerCase(), text);
      });
    }
    withId.forEach((item) => {
      const text = abstracts.get(item.arxiv!.toLowerCase());
      if (text) results.set(item.index, { abstract: text });
    });
    // Without an id: exact-title search, accepted only when the normalised titles are equal.
    const byTitle = await perItem(
      pending.filter((p) => !p.arxiv && p.title),
      async (item) => {
        const papers = await ctx.arxiv.byTitle(item.title!, TITLE_CANDIDATES);
        const hit = papers.find((p) => sameTitle(p.title, item.title!));
        return hit ? found(cleanAbstract(hit.abstract), hit.arxiv) : null;
      },
      ctx,
    );
    byTitle.found.forEach((hit, index) => results.set(index, hit));
    return { found: results, skipped: skipped + byTitle.skipped };
  },
};

const crossref: Stage = {
  name: "crossref",
  run: (pending, ctx) =>
    perItem(
      withDoi(pending),
      async (item) => {
        const work = await ctx.crossref.work(item.doi!);
        return found(cleanAbstract(work?.abstract));
      },
      ctx,
    ),
};

interface EuropePmcSearch {
  readonly resultList?: {
    readonly result?: ReadonlyArray<{
      readonly doi?: string | null;
      readonly abstractText?: string | null;
    }>;
  };
}

const europepmc: Stage = {
  name: "europepmc",
  run: (pending, ctx) =>
    perItem(
      withDoi(pending),
      async (item) => {
        const params = new URLSearchParams({
          query: `DOI:"${item.doi!.replace(/["\\]/g, "")}"`,
          resultType: "core",
          format: "json",
          pageSize: "5",
        });
        const body = await ctx.http.json<EuropePmcSearch>(
          `https://www.ebi.ac.uk/europepmc/webservices/rest/search?${params}`,
          { service: "Europe PMC", timeoutMs: TIMEOUT_MS },
        );
        const record = (body.resultList?.result ?? []).find(
          (r) => normalizeDoi(r.doi) === item.doi,
        );
        return found(cleanAbstract(record?.abstractText));
      },
      ctx,
    ),
};

export const FREE_STAGES: readonly Stage[] = [
  openalex,
  s2,
  arxiv,
  crossref,
  europepmc,
];
