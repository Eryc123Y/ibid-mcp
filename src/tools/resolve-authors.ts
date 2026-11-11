/**
 * Resolve author queries (names or ids) to merged clusters across S2 and OpenAlex while
 * spending as few requests as possible: S2 ids go in one batch call, each name costs one S2
 * search (with papers) and one OpenAlex search, and one OR-batched OpenAlex works call
 * supplies coauthor evidence for every OpenAlex candidate of every query.
 */

import { parseAuthorId } from "../core/ids";
import { type AuthorCluster, mergeAuthors, recordKey } from "../core/merge";
import { namesCompatible } from "../core/normalize";
import type { AuthorRecord, Paper } from "../core/types";
import { OR_BATCH_MAX } from "../sources/openalex";
import { type ToolContext, withFallback, optional } from "./context";

export interface AuthorQuery {
  readonly input: string;
  readonly affiliationHint?: string;
}

export interface ResolvedAuthor {
  readonly query: AuthorQuery;
  readonly name: string;
  readonly clusters: readonly AuthorCluster[];
  readonly primary?: AuthorCluster;
}

const S2_CANDIDATES = 8;
const OA_CANDIDATES = 6;
const OA_WORKS_FOR_EVIDENCE = 100;

async function explicitRecords(
  ctx: ToolContext,
  queries: readonly AuthorQuery[],
): Promise<Map<number, AuthorRecord>> {
  const parsed = queries.map((q) => parseAuthorId(q.input));
  const s2Ids = parsed.flatMap((p) => (p.kind === "s2" ? [p.value] : []));
  const oaIds = parsed.flatMap((p) => (p.kind === "openalex" ? [p.value] : []));
  const orcids = parsed.flatMap((p) => (p.kind === "orcid" ? [p.value] : []));

  const [s2, oa, byOrcid] = await Promise.all([
    s2Ids.length > 0
      ? withFallback(
          ctx,
          () => ctx.s2.authorBatch(s2Ids, true),
          async () => [],
        )
      : [],
    oaIds.length > 0
      ? optional(() => ctx.oa.authorsByIds("ids.openalex", oaIds), [])
      : [],
    orcids.length > 0
      ? optional(() => ctx.oa.authorsByIds("orcid", orcids), [])
      : [],
  ]);
  const out = new Map<number, AuthorRecord>();
  parsed.forEach((p, i) => {
    const hit =
      p.kind === "s2"
        ? s2.find((r) => r.id === p.value)
        : p.kind === "openalex"
          ? oa.find((r) => r.id === p.value)
          : p.kind === "orcid"
            ? byOrcid.find((r) => r.orcid?.toUpperCase() === p.value)
            : undefined;
    if (hit) out.set(i, hit);
  });
  return out;
}

/** Attach each OpenAlex work to the candidates that authored it. */
export function attributeWorks(
  records: readonly AuthorRecord[],
  works: readonly Paper[],
): AuthorRecord[] {
  return records.map((r) => {
    if (r.source !== "openalex") return r;
    const mine = works.filter((w) => w.authors.some((a) => a.id === r.id));
    return mine.length > 0 ? { ...r, papers: [...r.papers, ...mine] } : r;
  });
}

function dedupeRecords(records: readonly AuthorRecord[]): AuthorRecord[] {
  const seen = new Map<string, AuthorRecord>();
  records.forEach((r) => {
    const key = recordKey(r);
    const prev = seen.get(key);
    if (!prev || r.papers.length > prev.papers.length) seen.set(key, r);
  });
  return Array.from(seen.values());
}

export async function resolveAuthors(
  ctx: ToolContext,
  queries: readonly AuthorQuery[],
): Promise<ResolvedAuthor[]> {
  const explicit = await explicitRecords(ctx, queries);
  const names = queries.map((q, i) => explicit.get(i)?.name ?? q.input.trim());
  const missing = queries.flatMap((q, i) =>
    parseAuthorId(q.input).kind !== "name" && !explicit.has(i) ? [q.input] : [],
  );
  if (missing.length > 0)
    ctx.notices.push({
      level: "warn",
      text: `Author id(s) not found: ${missing.join(", ")}`,
    });

  const perQuery = await Promise.all(
    names.map(async (name) => {
      const [s2, oa] = await Promise.all([
        withFallback(
          ctx,
          () => ctx.s2.searchAuthors(name, S2_CANDIDATES, true),
          async () => [],
        ),
        optional(() => ctx.oa.searchAuthors(name, OA_CANDIDATES), []),
      ]);
      return [
        ...s2,
        ...oa.filter(
          (r) =>
            namesCompatible(name, r.name) ||
            r.aliases.some((a) => namesCompatible(name, a)),
        ),
      ];
    }),
  );

  const oaIds = Array.from(
    new Set(
      perQuery
        .flat()
        .concat(Array.from(explicit.values()))
        .filter((r) => r.source === "openalex")
        .map((r) => r.id),
    ),
  ).slice(0, OR_BATCH_MAX);
  const evidence =
    oaIds.length > 0
      ? (
          await optional(
            () => ctx.oa.worksByAuthors(oaIds, OA_WORKS_FOR_EVIDENCE, "recent"),
            { papers: [], count: 0 },
          )
        ).papers
      : [];

  return queries.map((query, i) => {
    const pinned = explicit.get(i);
    const pool = dedupeRecords(
      attributeWorks(
        [...(pinned ? [pinned] : []), ...(perQuery[i] ?? [])],
        evidence,
      ),
    );
    const name = names[i] ?? query.input;
    const clusters = mergeAuthors(pool, {
      queryName: name,
      affiliationHint: query.affiliationHint,
    });
    const primary = pinned
      ? clusters.find((c) =>
          c.records.some((r) => recordKey(r) === recordKey(pinned)),
        )
      : clusters[0];
    return { query, name, clusters, primary };
  });
}

export function idsOf(
  cluster: AuthorCluster | undefined,
  source: "s2" | "openalex",
): string[] {
  return (cluster?.records ?? [])
    .filter((r) => r.source === source)
    .map((r) => r.id);
}
