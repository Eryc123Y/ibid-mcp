/** Author tools: get_author (cross-record merge) and coauthorship. */

import { dedupePapers } from "../core/dedupe";
import { authorRecordLine, paperLine } from "../core/format";
import type { AuthorCluster } from "../core/merge";
import type { Paper } from "../core/types";
import { optional, type ToolContext } from "./context";
import { idsOf, type ResolvedAuthor, resolveAuthors } from "./resolve-authors";

const OTHER_CANDIDATES = 5;

const MAX_RECORDS = 12;
const MAX_LINKS = 10;

function clusterSummary(cluster: AuthorCluster): string {
  const shown = cluster.records
    .slice(0, MAX_RECORDS)
    .map((r) => `  ${authorRecordLine(r)}`);
  const hidden = cluster.records.length - shown.length;
  const header =
    cluster.records.length > 1
      ? `Merged ${cluster.records.length} records (confidence: ${cluster.confidence}):`
      : "Single record (no other record matched strongly enough to merge):";
  const links = cluster.links
    .slice(0, MAX_LINKS)
    .map((l) => `  ${l.a} ~ ${l.b} ${l.score} (${l.reasons.join(", ")})`);
  const moreLinks = cluster.links.length - links.length;
  return [
    header,
    ...shown,
    ...(hidden > 0 ? [`  +${hidden} more records`] : []),
    ...(links.length > 0 ? ["Evidence:", ...links] : []),
    ...(moreLinks > 0 ? [`  +${moreLinks} more links`] : []),
  ].join("\n");
}

function sortPapers(
  papers: readonly Paper[],
  sort: "recent" | "cited",
): Paper[] {
  const key = (p: Paper): number =>
    sort === "recent" ? (p.year ?? 0) : (p.citationCount ?? 0);
  return [...papers].sort(
    (a, b) =>
      key(b) - key(a) || (b.citationCount ?? 0) - (a.citationCount ?? 0),
  );
}

function clusterPapers(cluster: AuthorCluster): Paper[] {
  return dedupePapers(cluster.records.flatMap((r) => r.papers));
}

export interface GetAuthorArgs {
  readonly name_or_id: string;
  readonly affiliation_hint?: string;
  readonly include_papers: boolean;
  readonly sort: "recent" | "cited";
  readonly limit: number;
}

function headline(resolved: ResolvedAuthor, cluster: AuthorCluster): string {
  // Prefer the fullest spelling ("Anupam Chattopadhyay" over "A. Chattopadhyay").
  const best = cluster.records.reduce((a, b) =>
    b.name.replace(/\./g, "").length > a.name.replace(/\./g, "").length ? b : a,
  );
  const affs = Array.from(
    new Set(cluster.records.flatMap((r) => r.affiliations)),
  ).slice(0, 4);
  const hint = resolved.query.affiliationHint
    ? ` | affiliation hint match ${(cluster.hintMatch * 100).toFixed(0)}%`
    : "";
  return `${best.name}${affs.length ? ` — ${affs.join("; ")}` : ""}${hint}`;
}

export async function getAuthor(
  ctx: ToolContext,
  args: GetAuthorArgs,
): Promise<string> {
  const [resolved] = await resolveAuthors(ctx, [
    { input: args.name_or_id, affiliationHint: args.affiliation_hint },
  ]);
  if (!resolved?.primary) return `No author found for "${args.name_or_id}".`;
  const { primary } = resolved;
  const parts = [headline(resolved, primary), clusterSummary(primary)];

  const others = resolved.clusters
    .filter((c) => c !== primary)
    .slice(0, OTHER_CANDIDATES);
  if (others.length > 0) {
    parts.push(
      `Other candidates with a compatible name (not merged):\n${others
        .map((c) => c.records.map((r) => `  ${authorRecordLine(r)}`).join("\n"))
        .join("\n")}`,
    );
  }
  if (args.include_papers) {
    const papers = sortPapers(clusterPapers(primary), args.sort).slice(
      0,
      args.limit,
    );
    parts.push(
      papers.length > 0
        ? `Papers (${args.sort}, ${papers.length} shown; partial for very prolific authors):\n${papers.map(paperLine).join("\n")}`
        : "Papers: none loaded.",
    );
  }
  return parts.join("\n\n");
}

export interface CoauthorshipArgs {
  readonly author_a: string;
  readonly author_b: string;
  readonly affiliation_a?: string;
  readonly affiliation_b?: string;
  readonly limit: number;
}

/** S2 papers of one side whose author list contains an S2 id of the other side. */
export function s2SharedPapers(a: AuthorCluster, b: AuthorCluster): Paper[] {
  const aIds = new Set(idsOf(a, "s2"));
  const bIds = new Set(idsOf(b, "s2"));
  const fromA = a.records
    .filter((r) => r.source === "s2")
    .flatMap((r) =>
      r.papers.filter((p) => p.authors.some((x) => x.id && bIds.has(x.id))),
    );
  const fromB = b.records
    .filter((r) => r.source === "s2")
    .flatMap((r) =>
      r.papers.filter((p) => p.authors.some((x) => x.id && aIds.has(x.id))),
    );
  return [...fromA, ...fromB];
}

function sideLabel(label: string, r: ResolvedAuthor): string {
  if (!r.primary) return `${label}: "${r.query.input}" not found`;
  const s2 = idsOf(r.primary, "s2");
  const oa = idsOf(r.primary, "openalex");
  const others = r.clusters.length - 1;
  const note =
    others > 0
      ? `; ${others} other unmerged record group(s) not used, pass ids or an affiliation to choose`
      : "";
  return `${label}: ${r.name} — S2 [${s2.join(", ") || "none"}], OpenAlex [${oa.join(", ") || "none"}] (merge confidence: ${r.primary.confidence}${note})`;
}

export async function coauthorship(
  ctx: ToolContext,
  args: CoauthorshipArgs,
): Promise<string> {
  const [a, b] = await resolveAuthors(ctx, [
    { input: args.author_a, affiliationHint: args.affiliation_a },
    { input: args.author_b, affiliationHint: args.affiliation_b },
  ]);
  if (!a?.primary || !b?.primary) {
    return [a && sideLabel("A", a), b && sideLabel("B", b)]
      .filter(Boolean)
      .join("\n");
  }
  const s2Shared = s2SharedPapers(a.primary, b.primary);
  const oaA = idsOf(a.primary, "openalex");
  const oaB = idsOf(b.primary, "openalex");
  const oaShared =
    oaA.length > 0 && oaB.length > 0
      ? (
          await optional(() => ctx.oa.sharedWorks(oaA, oaB, 50), {
            papers: [],
            count: 0,
          })
        ).papers
      : [];
  const shared = sortPapers(dedupePapers([...s2Shared, ...oaShared]), "recent");

  const header = [
    sideLabel("A", a),
    sideLabel("B", b),
    `Shared papers: ${shared.length} (S2 ${dedupePapers(s2Shared).length}, OpenAlex ${oaShared.length}, deduplicated by DOI/arXiv/title)`,
  ];
  const list = shared.slice(0, args.limit).map(paperLine);
  return [...header, ...list].join("\n");
}

/** Intersection across two to six researchers, using the same disambiguation evidence. */
export async function coauthorshipGroup(
  ctx: ToolContext,
  authors: readonly string[],
  limit: number,
): Promise<string> {
  const resolved = await resolveAuthors(
    ctx,
    authors.map((input) => ({ input })),
  );
  if (resolved.some((r) => !r.primary))
    return resolved.map((r, i) => sideLabel(String(i + 1), r)).join("\n");
  const clusters = resolved.map((r) => r.primary!);
  const s2Groups = clusters.map((c) => new Set(idsOf(c, "s2")));
  const candidates = clusters.flatMap((c) => clusterPapers(c));
  const shared = candidates.filter(
    (p) =>
      p.source === "s2" &&
      s2Groups.every((group) => p.authors.some((a) => a.id && group.has(a.id))),
  );
  const oaGroups = clusters.map((c) => idsOf(c, "openalex"));
  const oa = oaGroups.every((g) => g.length > 0)
    ? await optional(() => ctx.oa.sharedWorksMany(oaGroups, 100), {
        papers: [],
        count: 0,
      })
    : { papers: [], count: 0 };
  const papers = sortPapers(
    dedupePapers([...shared, ...oa.papers]),
    "recent",
  ).slice(0, limit);
  return [
    ...resolved.map((r, i) => sideLabel(String(i + 1), r)),
    `Shared papers: ${papers.length} (loaded records only; prolific author lists may be partial)`,
    ...papers.map(paperLine),
  ].join("\n");
}
