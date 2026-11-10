/** Paper tools: search_papers, get_paper, paper_links. Each returns compact text. */

import { dedupePapers } from "../core/dedupe";
import { paperDetail, paperLine } from "../core/format";
import { IdParseError, type ParsedPaperId, parsePaperId } from "../core/ids";
import { paperKeys } from "../core/normalize";
import type { Paper } from "../core/types";
import { type ToolContext, withFallback } from "./context";

type OaFilter = { attr: "doi" | "ids.openalex" | "ids.pmid" | "ids.pmcid"; value: string };

function oaFilterOf(p: ParsedPaperId): OaFilter | undefined {
  if (p.openalexId) return { attr: "ids.openalex", value: p.openalexId };
  return p.openalexFilter;
}

function matchesId(paper: Paper, id: ParsedPaperId): boolean {
  switch (id.kind) {
    case "openalex":
      return paper.openalexId === id.value;
    case "doi":
      return paper.doi === id.value;
    case "arxiv":
      return paper.arxiv?.toLowerCase() === id.value || paper.doi === `10.48550/arxiv.${id.value}`;
    default:
      return false;
  }
}

export interface SearchArgs {
  readonly query: string;
  readonly year_from?: number;
  readonly year_to?: number;
  readonly venue?: string;
  readonly limit: number;
  readonly offset: number;
}

export async function searchPapers(ctx: ToolContext, args: SearchArgs): Promise<string> {
  const result = await withFallback(
    ctx,
    async () => {
      const r = await ctx.s2.searchPapers(args.query, {
        yearFrom: args.year_from,
        yearTo: args.year_to,
        venue: args.venue,
        limit: args.limit,
        offset: args.offset,
      });
      return { ...r, source: "Semantic Scholar" };
    },
    async () => {
      if (args.venue) ctx.notices.push({ level: "info", text: "venue filter is ignored in the OpenAlex fallback." });
      const r = await ctx.oa.searchWorks(args.query, {
        yearFrom: args.year_from,
        yearTo: args.year_to,
        limit: args.limit,
        page: Math.floor(args.offset / args.limit) + 1,
      });
      return { total: r.count, papers: r.papers, source: "OpenAlex" };
    },
  );
  if (result.papers.length === 0) return `No papers found for "${args.query}" (${result.source}).`;
  const lines = result.papers.map((p, i) => paperLine(p, args.offset + i));
  const next = args.offset + result.papers.length < result.total ? `\nMore: offset=${args.offset + result.papers.length}` : "";
  return `${result.papers.length} of ${result.total} (${result.source}):\n${lines.join("\n")}${next}`;
}

/** Resolve OpenAlex W-ids to DOIs so S2 can address them in the same batch. */
async function s2AddressFor(ctx: ToolContext, parsed: readonly ParsedPaperId[]): Promise<Map<number, string>> {
  const out = new Map<number, string>();
  const wIds = parsed.flatMap((p, i) => (p.kind === "openalex" ? [{ i, value: p.value }] : []));
  if (wIds.length > 0) {
    const works = await ctx.oa.worksByIds(wIds.map((w) => ({ attr: "ids.openalex" as const, value: w.value })), false);
    wIds.forEach(({ i, value }) => {
      const doi = works.find((w) => w.openalexId === value)?.doi;
      if (doi) out.set(i, `DOI:${doi}`);
    });
  }
  parsed.forEach((p, i) => p.s2 && out.set(i, p.s2));
  return out;
}

export async function getPapers(ctx: ToolContext, ids: readonly string[], full: boolean): Promise<string> {
  const errors: string[] = [];
  const parsed: ParsedPaperId[] = [];
  ids.forEach((raw) => {
    try {
      parsed.push(parsePaperId(raw));
    } catch (e) {
      errors.push(e instanceof IdParseError ? e.message : String(e));
    }
  });

  const s2Results = await withFallback(
    ctx,
    async () => {
      const addresses = await s2AddressFor(ctx, parsed);
      const order = Array.from(addresses.entries());
      const batch = await ctx.s2.paperBatch(order.map(([, a]) => a), true);
      const byIndex = new Map<number, Paper>();
      order.forEach(([i], k) => {
        const p = batch[k];
        if (p) byIndex.set(i, p);
      });
      return byIndex;
    },
    async () => new Map<number, Paper>(),
  );

  // One OpenAlex call covers S2 misses and missing abstracts.
  const wanted = parsed.flatMap((p, i) => {
    const found = s2Results.get(i);
    if (found && found.abstract) return [];
    const filter = found?.doi ? { attr: "doi" as const, value: found.doi } : oaFilterOf(p);
    return filter ? [{ i, filter }] : [];
  });
  const oaWorks = wanted.length > 0 ? await ctx.oa.worksByIds(wanted.map((w) => w.filter), true) : [];

  const blocks = parsed.map((p, i) => {
    const s2 = s2Results.get(i);
    const oa = oaWorks.find((w) => (s2 ? paperKeys(w).some((k) => paperKeys(s2).includes(k)) : matchesId(w, p)));
    const merged = s2 && oa ? dedupePapers([s2, oa])[0] : (s2 ?? oa);
    if (!merged) return `Not found: ${ids[i] ?? p.value}`;
    const withAbstract = s2 && !s2.abstract && oa?.abstract ? { ...merged, abstract: oa.abstract } : merged;
    return paperDetail(withAbstract, full);
  });
  return [...errors, ...blocks].join("\n\n");
}

export interface LinksArgs {
  readonly id: string;
  readonly direction: "citations" | "references";
  readonly limit: number;
  readonly offset: number;
}

async function openAlexLinks(ctx: ToolContext, parsed: ParsedPaperId, args: LinksArgs): Promise<Paper[]> {
  const filter = oaFilterOf(parsed);
  if (!filter) throw new Error("OpenAlex fallback needs a DOI, arXiv id or W-id for this paper.");
  const workId = parsed.openalexId ?? (await ctx.oa.worksByIds([filter], false))[0]?.openalexId;
  if (!workId) return [];
  if (args.direction === "citations") {
    return (await ctx.oa.citingWorks(workId, args.limit, Math.floor(args.offset / args.limit) + 1)).papers;
  }
  const refs = (await ctx.oa.referencedWorkIds(workId)).slice(args.offset, args.offset + args.limit);
  return refs.length > 0 ? ctx.oa.worksByIds(refs.map((value) => ({ attr: "ids.openalex", value })), false) : [];
}

export async function paperLinks(ctx: ToolContext, args: LinksArgs): Promise<string> {
  const parsed = parsePaperId(args.id);
  const result = await withFallback(
    ctx,
    async () => {
      const address = (await s2AddressFor(ctx, [parsed])).get(0);
      if (!address) return { papers: await openAlexLinks(ctx, parsed, args), source: "OpenAlex", next: undefined };
      const r = await ctx.s2.links(address, args.direction, args.limit, args.offset);
      return { ...r, source: "Semantic Scholar" };
    },
    async () => ({ papers: await openAlexLinks(ctx, parsed, args), source: "OpenAlex", next: undefined }),
  );
  if (result.papers.length === 0) return `No ${args.direction} found for ${args.id} (${result.source}).`;
  const label = args.direction === "citations" ? "Papers citing" : "References of";
  const lines = result.papers.map((p, i) => paperLine(p, args.offset + i));
  const next = result.next !== undefined ? `\nMore: offset=${result.next}` : "";
  return `${label} ${args.id} (${result.source}, ${result.papers.length} shown):\n${lines.join("\n")}${next}`;
}
