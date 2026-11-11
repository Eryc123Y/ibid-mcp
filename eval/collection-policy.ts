/** Stay strictly below 80%, including other callers sharing the keyless IP. */
export function creditRoom(
  limit: number,
  remaining: number,
  spent: number,
  cost: number,
): boolean {
  return (
    limit > 0 && remaining - cost > limit * 0.2 && spent + cost < limit * 0.8
  );
}
export function sourceFor(
  name: string,
  sources: Array<{ id: string; display_name: string; works_count: number }>,
): string {
  const sorted = [...sources].sort((a, b) => b.works_count - a.works_count);
  const exact = sorted.filter((s) =>
    s.display_name.toLowerCase().startsWith(name.toLowerCase().slice(0, 25)),
  );
  const result = (exact.length ? exact : sorted)[0];
  if (!result) throw new Error(`No source for ${name}`);
  return result.id.split("/").at(-1)!;
}
export function validateVenueDraw(
  papers: Array<{ id: string; title: string; publication_year: number }>,
  year: number,
): void {
  if (
    papers.length !== 40 ||
    new Set(papers.map((p) => p.id)).size !== 40 ||
    papers.some((p) => !p.title || p.publication_year !== year)
  )
    throw new Error(
      "Expected 40 unique titled papers in the specified year; preserve this draw for inspection",
    );
}
/** Singleton lookups are free; check the shared-IP balance before paid requests. */
export async function probeBudget(
  fetchImpl: typeof fetch,
): Promise<{ limit: number; remaining: number }> {
  const response = await fetchImpl(
    "https://api.openalex.org/works/W2741809807?select=id",
  );
  await response.body?.cancel();
  if (!response.ok)
    throw new Error(`OpenAlex quota probe returned HTTP ${response.status}`);
  const h = response.headers;
  const limit = Number(h.get("x-ratelimit-limit"));
  const remaining = Number(h.get("x-ratelimit-remaining"));
  if (
    !h.has("x-ratelimit-remaining") ||
    !Number.isFinite(remaining) ||
    remaining < 0 ||
    !Number.isFinite(limit) ||
    limit <= 0
  )
    throw new Error(
      "OpenAlex quota headers missing or invalid; refuse paid collection",
    );
  return { limit, remaining };
}
