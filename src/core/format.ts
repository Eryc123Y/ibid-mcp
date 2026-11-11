/** Compact text renderers. Ids printed here chain into the other tools. Pure. */

import type { MergedPaper } from "./dedupe";
import type { AuthorRecord, Paper } from "./types";

export const ABSTRACT_CHARS = 300;
const AUTHOR_NAMES = 5;

export function truncate(text: string, max: number): string {
  if (text.length <= max) return text;
  const cut = text.slice(0, max);
  const space = cut.lastIndexOf(" ");
  return `${(space > max * 0.7 ? cut.slice(0, space) : cut).trimEnd()}…`;
}

function authorList(paper: Paper, max = AUTHOR_NAMES): string {
  const names = paper.authors.map((a) => a.name);
  if (names.length === 0) return "";
  return names.length > max
    ? `${names.slice(0, max).join(", ")} +${names.length - max}`
    : names.join(", ");
}

function idTail(paper: Paper): string {
  const parts = [
    paper.doi ? `doi:${paper.doi}` : undefined,
    paper.arxiv ? `arXiv:${paper.arxiv}` : undefined,
    paper.source === "s2" && paper.openalexId ? paper.openalexId : undefined,
  ].filter(Boolean);
  return parts.length > 0 ? ` | ${parts.join(" ")}` : "";
}

/** One line per paper: id, title, year, venue, citations, authors, external ids. */
export function paperLine(paper: Paper, index: number): string {
  const meta = [paper.year, paper.venue].filter(Boolean).join(", ");
  const cites =
    paper.citationCount !== undefined ? ` · ${paper.citationCount} cites` : "";
  const src =
    "sources" in paper ? ` [${(paper as MergedPaper).sources.join("+")}]` : "";
  return `${index + 1}. [${paper.id}] ${paper.title}${meta ? ` (${meta})` : ""}${cites} — ${authorList(paper)}${idTail(paper)}${src}`;
}

export function authorRecordLine(r: AuthorRecord): string {
  const stats = [
    r.paperCount !== undefined ? `${r.paperCount} papers` : undefined,
    r.citationCount !== undefined ? `${r.citationCount} cites` : undefined,
    r.hIndex !== undefined ? `h=${r.hIndex}` : undefined,
  ].filter(Boolean);
  const aff = r.affiliations.slice(0, 3).join("; ");
  return `${r.source === "s2" ? "S2" : "OpenAlex"} ${r.id}: ${r.name}${stats.length ? ` (${stats.join(", ")})` : ""}${aff ? ` — ${aff}` : ""}${r.orcid ? ` — ORCID ${r.orcid}` : ""}`;
}
