/** Cross-source paper deduplication by DOI, arXiv id or normalised title. Pure. */

import { paperKeys } from "./normalize";
import type { Paper, Source } from "./types";

export interface MergedPaper extends Paper {
  /** Sources that contributed this paper. */
  readonly sources: readonly Source[];
}

function mergeTwo(a: MergedPaper, b: Paper): MergedPaper {
  // Prefer the S2 record for ids (CorpusId chains to S2 tools); fill gaps from the other.
  const [primary, secondary] = a.source === "s2" || b.source !== "s2" ? [a, b] : [b, a];
  const sources = Array.from(new Set<Source>([...a.sources, b.source]));
  return {
    ...secondary,
    ...stripUndefined(primary),
    abstract: primary.abstract ?? secondary.abstract,
    citationCount: maxDefined(primary.citationCount, secondary.citationCount),
    s2Id: primary.s2Id ?? secondary.s2Id,
    openalexId: primary.openalexId ?? secondary.openalexId,
    doi: primary.doi ?? secondary.doi,
    arxiv: primary.arxiv ?? secondary.arxiv,
    authors: primary.authors.length > 0 ? primary.authors : secondary.authors,
    sources,
  };
}

function maxDefined(a: number | undefined, b: number | undefined): number | undefined {
  if (a === undefined) return b;
  if (b === undefined) return a;
  return Math.max(a, b);
}

function stripUndefined<T extends object>(obj: T): Partial<T> {
  return Object.fromEntries(Object.entries(obj).filter(([, v]) => v !== undefined)) as Partial<T>;
}

/**
 * Deduplicate papers from any mix of sources. Two papers are the same when they share any key
 * (DOI, arXiv id, or normalised title of at least 12 chars). Order of first appearance is kept.
 */
export function dedupePapers(papers: readonly Paper[]): MergedPaper[] {
  const merged: MergedPaper[] = [];
  const keyToIndex = new Map<string, number>();

  for (const paper of papers) {
    const keys = paperKeys(paper);
    const hit = keys.map((k) => keyToIndex.get(k)).find((i): i is number => i !== undefined);
    if (hit === undefined) {
      const index = merged.length;
      merged.push({ ...paper, sources: [paper.source] });
      keys.forEach((k) => keyToIndex.set(k, index));
      continue;
    }
    const existing = merged[hit];
    if (!existing) continue;
    const combined = mergeTwo(existing, paper);
    merged[hit] = combined;
    paperKeys(combined).forEach((k) => keyToIndex.set(k, hit));
  }
  return merged;
}
