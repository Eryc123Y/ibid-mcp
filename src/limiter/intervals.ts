/** Per-source request spacing, free of Worker imports so the CLI can share it. */

export type LimitedSource =
  "s2" | "openalex" | "arxiv" | "openreview" | "core" | "crossref";
export function sourceInterval(source: LimitedSource, keyed: boolean): number {
  return {
    s2: keyed ? 1000 : 3000,
    openalex: 100,
    arxiv: 3000,
    openreview: 1000,
    core: 1000,
    crossref: 500,
  }[source];
}
