/** Cross-source paper deduplication by DOI, arXiv id or normalised title. Pure. */

import { paperKeys } from "./normalize";
import type { Paper, Source } from "./types";

export interface MergedPaper extends Paper {
  /** Sources that contributed this paper. */
  readonly sources: readonly Source[];
}

function mergeTwo(a: MergedPaper, b: Paper): MergedPaper {
  // Prefer the S2 record for ids (CorpusId chains to S2 tools); fill gaps from the other.
  const [primary, secondary] =
    a.source === "s2" || b.source !== "s2" ? [a, b] : [b, a];
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

function maxDefined(
  a: number | undefined,
  b: number | undefined,
): number | undefined {
  if (a === undefined) return b;
  if (b === undefined) return a;
  return Math.max(a, b);
}

function stripUndefined<T extends object>(obj: T): Partial<T> {
  return Object.fromEntries(
    Object.entries(obj).filter(([, v]) => v !== undefined),
  ) as Partial<T>;
}

/**
 * Deduplicate papers from any mix of sources. Two papers are the same when they share any key
 * (DOI, arXiv id, or normalised title of at least 12 chars). Order of first appearance is kept.
 */
export function dedupePapers(papers: readonly Paper[]): MergedPaper[] {
  const merged = new Map<number, MergedPaper>();
  const keyToIndex = new Map<string, number>();
  for (const [index, paper] of papers.entries()) {
    const keys = paperKeys(paper);
    const hits = [
      ...new Set(
        keys.flatMap((key) =>
          keyToIndex.has(key) ? [keyToIndex.get(key)!] : [],
        ),
      ),
    ].sort((a, b) => a - b);
    const target = hits[0] ?? index;
    let combined: MergedPaper = { ...paper, sources: [paper.source] };
    for (const hit of hits) {
      const existing = merged.get(hit)!;
      combined = {
        ...mergeTwo(existing, combined),
        sources: [...new Set([...existing.sources, ...combined.sources])],
      };
      merged.delete(hit);
    }
    merged.set(target, combined);
    for (const [key, previous] of keyToIndex)
      if (hits.includes(previous)) keyToIndex.set(key, target);
    for (const key of [...keys, ...paperKeys(combined)])
      keyToIndex.set(key, target);
  }
  return [...merged.entries()]
    .sort((a, b) => a[0] - b[0])
    .map(([, paper]) => paper);
}
