/**
 * Cross-source author merging. S2 and OpenAlex both split one person into several records;
 * this clusters records by name compatibility plus affiliation, coauthor and paper overlap.
 * Pure: no I/O.
 */

import {
  affiliationTokens,
  nameKey,
  namesCompatible,
  namesEqual,
  paperKeys,
} from "./normalize";
import type { AuthorRecord } from "./types";

export const MERGE_THRESHOLD = 0.5;
const HIGH_CONFIDENCE = 0.8;

export type Confidence = "high" | "medium" | "single";

export interface MergeLink {
  readonly a: string;
  readonly b: string;
  readonly score: number;
  readonly reasons: readonly string[];
}

export interface AuthorCluster {
  readonly records: readonly AuthorRecord[];
  /** Links that joined the cluster (a maximum spanning tree). */
  readonly links: readonly MergeLink[];
  readonly confidence: Confidence;
  /** Fraction of affiliation-hint tokens found in the cluster's affiliations (0..1). */
  readonly hintMatch: number;
}

export interface Features {
  readonly record: AuthorRecord;
  readonly key: string;
  readonly names: readonly string[];
  readonly aff: Set<string>;
  readonly coauthors: Set<string>;
  readonly papers: Set<string>;
}

export function recordKey(r: Pick<AuthorRecord, "source" | "id">): string {
  return `${r.source}:${r.id}`;
}

export function features(record: AuthorRecord): Features {
  const names = [record.name, ...record.aliases];
  const aff = new Set<string>();
  record.affiliations.forEach((a) => affiliationTokens(a).forEach((t) => aff.add(t)));
  const coauthors = new Set<string>();
  const papers = new Set<string>();
  for (const p of record.papers) {
    paperKeys(p).forEach((k) => papers.add(k));
    for (const au of p.authors) {
      const self = au.id === record.id || names.some((n) => namesCompatible(n, au.name));
      if (!self) coauthors.add(nameKey(au.name));
    }
  }
  return { record, key: recordKey(record), names, aff, coauthors, papers };
}

function anyCompatible(a: readonly string[], b: readonly string[]): boolean {
  return a.some((x) => b.some((y) => namesCompatible(x, y)));
}

function intersectionSize<T>(a: ReadonlySet<T>, b: ReadonlySet<T>): number {
  let n = 0;
  for (const x of a) if (b.has(x)) n += 1;
  return n;
}

/** Evidence that two records denote the same person, in [0, 1]. */
export function pairScore(x: Features, y: Features): MergeLink {
  const base = { a: x.key, b: y.key };
  if (!anyCompatible(x.names, y.names)) return { ...base, score: 0, reasons: ["names incompatible"] };
  const ox = x.record.orcid;
  const oy = y.record.orcid;
  if (ox && oy) {
    return ox === oy
      ? { ...base, score: 1, reasons: ["same ORCID"] }
      : { ...base, score: 0, reasons: ["different ORCIDs"] };
  }

  const reasons: string[] = [];
  let score = 0;
  const sharedPapers = intersectionSize(x.papers, y.papers);
  if (sharedPapers > 0) {
    score += sharedPapers >= 3 ? 0.8 : 0.6;
    reasons.push(`${sharedPapers} shared papers`);
  }
  // Coauthor keys are initial+surname, so small overlaps are weak evidence on their own.
  const sharedCo = intersectionSize(x.coauthors, y.coauthors);
  if (sharedCo > 0) {
    score += sharedCo >= 8 ? 0.5 : sharedCo >= 4 ? 0.35 : sharedCo >= 2 ? 0.2 : 0.1;
    reasons.push(`${sharedCo} shared coauthors`);
  }
  const aff = overlap(x.aff, y.aff);
  if (aff >= 0.5) {
    score += aff >= 0.8 ? 0.3 : 0.15;
    reasons.push(`affiliation ${aff.toFixed(2)}`);
  }
  if (namesEqual(x.record.name, y.record.name)) {
    score += 0.1;
    reasons.push("same name");
  }
  return { ...base, score: Math.min(1, Number(score.toFixed(2))), reasons };
}

/** Overlap coefficient: robust when one record lists many more institutions than the other. */
function overlap(a: ReadonlySet<string>, b: ReadonlySet<string>): number {
  if (a.size === 0 || b.size === 0) return 0;
  return intersectionSize(a, b) / Math.min(a.size, b.size);
}

function hintMatch(aff: ReadonlySet<string>, hint: ReadonlySet<string>): number {
  if (hint.size === 0) return 0;
  return intersectionSize(hint, aff) / hint.size;
}

/**
 * Cluster author records. Records whose names are incompatible with `queryName` are dropped
 * (pass undefined to keep all). Clusters are ordered best-first: affiliation-hint match,
 * then number of merged records, then citations.
 */
export function mergeAuthors(
  records: readonly AuthorRecord[],
  options: { readonly queryName?: string; readonly affiliationHint?: string } = {},
): AuthorCluster[] {
  const kept = options.queryName
    ? records.filter((r) => [r.name, ...r.aliases].some((n) => namesCompatible(options.queryName ?? "", n)))
    : records;
  const feats = kept.map(features);
  const parent = feats.map((_, i) => i);
  const find = (i: number): number => {
    let root = i;
    while (parent[root] !== root) root = parent[root] ?? root;
    return root;
  };

  const candidates: Array<{ i: number; j: number; link: MergeLink }> = [];
  for (let i = 0; i < feats.length; i += 1) {
    for (let j = i + 1; j < feats.length; j += 1) {
      const fi = feats[i];
      const fj = feats[j];
      if (!fi || !fj) continue;
      const link = pairScore(fi, fj);
      if (link.score >= MERGE_THRESHOLD) candidates.push({ i, j, link });
    }
  }
  candidates.sort((p, q) => q.link.score - p.link.score);

  const treeLinks = new Map<number, MergeLink[]>();
  const orcids = new Map<number, ReadonlySet<string>>(
    feats.map((f, i) => [i, new Set(f.record.orcid ? [f.record.orcid.toUpperCase()] : [])]),
  );
  for (const { i, j, link } of candidates) {
    const ri = find(i);
    const rj = find(j);
    if (ri === rj) continue;
    const oi = orcids.get(ri) ?? new Set<string>();
    const oj = orcids.get(rj) ?? new Set<string>();
    // Never chain two people with different ORCIDs together through intermediate records.
    if (oi.size > 0 && oj.size > 0 && ![...oi].some((o) => oj.has(o))) continue;
    parent[rj] = ri;
    orcids.set(ri, new Set([...oi, ...oj]));
    treeLinks.set(ri, [...(treeLinks.get(ri) ?? []), ...(treeLinks.get(rj) ?? []), link]);
    treeLinks.delete(rj);
  }

  const groups = new Map<number, Features[]>();
  feats.forEach((f, i) => {
    const root = find(i);
    groups.set(root, [...(groups.get(root) ?? []), f]);
  });

  const hint = affiliationTokens(options.affiliationHint ?? "");
  const clusters = Array.from(groups.entries()).map(([root, members]): AuthorCluster => {
    const links = treeLinks.get(root) ?? [];
    const aff = new Set<string>();
    members.forEach((m) => m.aff.forEach((t) => aff.add(t)));
    const minScore = links.reduce((m, l) => Math.min(m, l.score), 1);
    const confidence: Confidence = links.length === 0 ? "single" : minScore >= HIGH_CONFIDENCE ? "high" : "medium";
    return { records: members.map((m) => m.record), links, confidence, hintMatch: hintMatch(aff, hint) };
  });

  const citations = (c: AuthorCluster): number =>
    c.records.reduce((m, r) => Math.max(m, r.citationCount ?? 0), 0);
  return clusters.sort(
    (a, b) => b.hintMatch - a.hintMatch || b.records.length - a.records.length || citations(b) - citations(a),
  );
}
