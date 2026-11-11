import { titleKey } from "../src/core/normalize";
export interface SamplePaper {
  id: string;
  title: string;
  year: number;
  venue: string;
  on_arxiv: boolean;
}
export interface CoverageSample {
  provenance: {
    kind: string;
    source: string;
    seed: number;
    recorded_at: string;
  };
  papers: SamplePaper[];
}
export function validateSample(sample: CoverageSample): void {
  if (sample.provenance.kind !== "recorded")
    throw new Error(
      "Acceptance requires recorded fixtures; synthetic data cannot establish coverage.",
    );
  if (sample.papers.length !== 600)
    throw new Error("Expected 600 sampled papers");
  if (new Set(sample.papers.map((p) => p.id)).size !== 600)
    throw new Error("Sample ids must be unique");
  if (
    !sample.provenance.source ||
    sample.provenance.seed !== 7 ||
    !sample.provenance.recorded_at
  )
    throw new Error("Sampling provenance missing");
  const counts = new Map<string, number>();
  for (const paper of sample.papers) {
    if (!paper.title || typeof paper.on_arxiv !== "boolean")
      throw new Error("Missing title or arXiv observation");
    if (paper.year !== (paper.venue === "ICCV" ? 2023 : 2024))
      throw new Error(
        "Expected 2024 papers, except the reference sample uses ICCV 2023",
      );
    counts.set(paper.venue, (counts.get(paper.venue) ?? 0) + 1);
  }
  if (counts.size !== 15 || [...counts.values()].some((n) => n !== 40))
    throw new Error("Expected 15 venues with 40 papers each");
}
export async function evaluateCoverage(
  sample: CoverageSample,
  search: (
    paper: SamplePaper,
  ) => Promise<{ papers: ReadonlyArray<{ title: string }> }>,
) {
  validateSample(sample);
  const missing: string[] = [];
  const perVenue: Record<string, { found: number; total: number }> = {};
  for (const paper of sample.papers) {
    const result = await search(paper);
    const found = result.papers.some(
      (p) => titleKey(p.title) === titleKey(paper.title),
    );
    if (!found) missing.push(paper.id);
    const previous = perVenue[paper.venue] ?? { found: 0, total: 0 };
    perVenue[paper.venue] = {
      found: previous.found + Number(found),
      total: previous.total + 1,
    };
  }
  const total = sample.papers.length;
  const found = total - missing.length;
  return {
    total,
    found,
    coverage: found / total,
    passed: found / total >= 0.9,
    target: 0.9,
    arxiv_baseline: sample.papers.filter((p) => p.on_arxiv).length / total,
    per_venue: perVenue,
    missing,
    provenance: sample.provenance,
  };
}
