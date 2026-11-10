import { ABSTRACT_CHARS, truncate } from "../core/format";
import { dedupePapers } from "../core/dedupe";
import type { Paper } from "../core/types";
import { optional, type ToolContext } from "./context";
export interface SearchArgs {
  readonly query: string;
  readonly year_from?: number;
  readonly year_to?: number;
  readonly venue?: string;
  readonly limit: number;
  readonly offset: number;
  readonly full?: boolean;
  readonly recent?: boolean;
  readonly category?: string;
  readonly open_access?: boolean;
}
export function compactPaper(paper: Paper, full = false): Paper {
  return {
    ...paper,
    abstract: full
      ? paper.abstract
      : paper.abstract
        ? truncate(paper.abstract, ABSTRACT_CHARS - 1)
        : undefined,
    authors: full ? paper.authors : paper.authors.slice(0, 5),
  };
}
export async function searchPapers(ctx: ToolContext, args: SearchArgs) {
  const [s2, oa, arxiv, core] = await Promise.all([
    args.query.trim()
      ? optional(
          () =>
            ctx.s2.searchPapers(args.query, {
              yearFrom: args.year_from,
              yearTo: args.year_to,
              venue: args.venue,
              limit: args.limit,
              offset: args.offset,
            }),
          { total: 0, papers: [] },
        )
      : { total: 0, papers: [] },
    args.query.trim()
      ? optional(
          () =>
            ctx.oa.searchWorks(args.query, {
              yearFrom: args.year_from,
              yearTo: args.year_to,
              limit: args.limit,
              page: Math.floor(args.offset / args.limit) + 1,
            }),
          { count: 0, papers: [] },
        )
      : { count: 0, papers: [] },
    (args.recent || args.category) && ctx.arxiv
      ? optional(() => ctx.arxiv!.search(args), { total: 0, papers: [] })
      : { total: 0, papers: [] },
    args.open_access && ctx.core
      ? optional(() => ctx.core!.search(args.query, args.limit, args.offset), {
          total: 0,
          papers: [],
        })
      : { total: 0, papers: [] },
  ]);
  const matched = dedupePapers([
    ...s2.papers,
    ...oa.papers,
    ...arxiv.papers,
    ...core.papers,
  ])
    .filter(
      (p) =>
        (!args.year_from ||
          (p.year !== undefined && p.year >= args.year_from)) &&
        (!args.year_to || (p.year !== undefined && p.year <= args.year_to)),
    )
    .filter((p) => !args.open_access || Boolean(p.pdfUrl))
    .filter(
      (p) =>
        !args.venue ||
        p.venue?.toLowerCase().includes(args.venue.toLowerCase()),
    );
  const papers = args.recent
    ? [...matched].sort((a, b) =>
        (b.published ?? String(b.year ?? "")).localeCompare(
          a.published ?? String(a.year ?? ""),
        ),
      )
    : matched;
  return {
    papers: papers.slice(0, args.limit).map((p) => compactPaper(p, args.full)),
    next_offset:
      Math.max(s2.total, oa.count, arxiv.total, core.total) >
      args.offset + args.limit
        ? args.offset + args.limit
        : undefined,
  };
}
