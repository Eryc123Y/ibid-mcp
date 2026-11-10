/** Compact text renderers. Ids printed here chain into the other tools. Pure. */

import type { MergedPaper } from "./dedupe";
import type { AuthorRecord, Notice, Paper } from "./types";

export const ABSTRACT_CHARS = 600;
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
  return names.length > max ? `${names.slice(0, max).join(", ")} +${names.length - max}` : names.join(", ");
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
  const cites = paper.citationCount !== undefined ? ` · ${paper.citationCount} cites` : "";
  const src = "sources" in paper ? ` [${(paper as MergedPaper).sources.join("+")}]` : "";
  return `${index + 1}. [${paper.id}] ${paper.title}${meta ? ` (${meta})` : ""}${cites} — ${authorList(paper)}${idTail(paper)}${src}`;
}

export function paperDetail(paper: Paper, full: boolean): string {
  const authors = paper.authors
    .slice(0, full ? 100 : 15)
    .map((a) => (a.id ? `${a.name} (${a.id})` : a.name))
    .join("; ");
  const more = paper.authors.length > (full ? 100 : 15) ? ` +${paper.authors.length - (full ? 100 : 15)}` : "";
  const lines = [
    `[${paper.id}] ${paper.title}`,
    `Year: ${paper.year ?? "?"} | Venue: ${paper.venue ?? "?"} | Citations: ${paper.citationCount ?? "?"} | Source: ${paper.source}`,
    `Authors: ${authors}${more}`,
    `IDs: ${[paper.doi && `DOI ${paper.doi}`, paper.arxiv && `arXiv ${paper.arxiv}`, paper.s2Id && `S2 ${paper.s2Id}`, paper.openalexId && `OpenAlex ${paper.openalexId}`]
      .filter(Boolean)
      .join(" | ")}`,
    `Links: ${[paper.url, paper.doi && `https://doi.org/${paper.doi}`, paper.pdfUrl && `PDF ${paper.pdfUrl}`].filter(Boolean).join(" | ")}`,
  ];
  if (paper.abstract) lines.push(`Abstract: ${full ? paper.abstract : truncate(paper.abstract, ABSTRACT_CHARS)}`);
  return lines.join("\n");
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

export function noticesBlock(notices: readonly Notice[]): string {
  const unique = Array.from(new Set(notices.map((n) => `${n.level === "warn" ? "Warning" : "Note"}: ${n.text}`)));
  return unique.length > 0 ? `${unique.join("\n")}\n` : "";
}
