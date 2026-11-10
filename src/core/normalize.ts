/** Text normalisation used for name matching and deduplication. Pure functions. */

import type { Paper } from "./types";

/** Lower-case, strip diacritics and punctuation, collapse whitespace. */
export function foldText(text: string): string {
  return text
    .normalize("NFKD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

export interface NameParts {
  readonly surname: string;
  readonly given: readonly string[];
}

/** Split a personal name into surname and given-name tokens. Handles "Surname, Given". */
export function nameParts(name: string): NameParts {
  const commaForm = name.includes(",");
  const ordered = commaForm
    ? `${name.slice(name.indexOf(",") + 1)} ${name.slice(0, name.indexOf(","))}`
    : name;
  const tokens = foldText(ordered.replace(/[.\-]/g, " ")).split(" ").filter(Boolean);
  if (tokens.length === 0) return { surname: "", given: [] };
  return { surname: tokens[tokens.length - 1] ?? "", given: tokens.slice(0, -1) };
}

/**
 * Whether two names can denote the same person: same surname, and the given names agree
 * token by token where both are present (an initial matches any name starting with it).
 */
export function namesCompatible(a: string, b: string): boolean {
  const pa = nameParts(a);
  const pb = nameParts(b);
  if (!pa.surname || pa.surname !== pb.surname) return false;
  const n = Math.min(pa.given.length, pb.given.length);
  for (let i = 0; i < n; i += 1) {
    const x = pa.given[i] ?? "";
    const y = pb.given[i] ?? "";
    const ok = x.length === 1 || y.length === 1 ? x[0] === y[0] : x === y;
    if (!ok) return false;
  }
  return true;
}

/** Whether two names are identical after folding (stronger evidence than compatibility). */
export function namesEqual(a: string, b: string): boolean {
  const pa = nameParts(a);
  const pb = nameParts(b);
  return pa.surname === pb.surname && pa.given.join(" ") === pb.given.join(" ");
}

/** Canonical key for a coauthor name: first initial + surname. */
export function nameKey(name: string): string {
  const p = nameParts(name);
  return `${p.given[0]?.[0] ?? ""} ${p.surname}`.trim();
}

/** Title key for dedupe: folded, without spaces, first 120 chars. */
export function titleKey(title: string): string {
  return foldText(title).replace(/\s/g, "").slice(0, 120);
}

export function normalizeDoi(doi: string | undefined | null): string | undefined {
  if (!doi) return undefined;
  const cleaned = doi.trim().replace(/^https?:\/\/(?:dx\.)?doi\.org\//i, "").replace(/^doi:/i, "").toLowerCase();
  return cleaned.startsWith("10.") ? cleaned : undefined;
}

/** All dedupe keys for a paper: its DOI, its arXiv id and its title. */
export function paperKeys(paper: Pick<Paper, "doi" | "arxiv" | "title">): string[] {
  const keys: string[] = [];
  const doi = normalizeDoi(paper.doi);
  if (doi) keys.push(`doi:${doi}`);
  if (paper.arxiv) keys.push(`arxiv:${paper.arxiv.toLowerCase().replace(/v\d+$/, "")}`);
  const t = titleKey(paper.title);
  if (t.length >= 12) keys.push(`title:${t}`);
  return keys;
}

const STOP = new Set(["of", "the", "and", "for", "de", "at", "in", "university", "univ", "institute", "school", "dept", "department"]);

/** Content tokens of an affiliation string, for overlap scoring. */
export function affiliationTokens(text: string): Set<string> {
  return new Set(
    foldText(text)
      .split(" ")
      .filter((t) => t.length > 1 && !STOP.has(t)),
  );
}

export function jaccard<T>(a: ReadonlySet<T>, b: ReadonlySet<T>): number {
  if (a.size === 0 || b.size === 0) return 0;
  let inter = 0;
  for (const x of a) if (b.has(x)) inter += 1;
  return inter / (a.size + b.size - inter);
}
