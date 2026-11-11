export interface VenueRank {
  system: "CCF" | "ICORE";
  rank: string;
  year: number;
  source: string;
}
export interface VenueRecord {
  name: string;
  acronym: string;
  dblp?: string;
  ranks: VenueRank[];
}
export interface VenueTable {
  downloaded_at: string;
  venues: VenueRecord[];
}
const normalize = (s: string) => s.toLowerCase().replace(/[^\p{L}\p{N}]/gu, "");
function distance(a: string, b: string): number {
  let previous = Array.from({ length: b.length + 1 }, (_, i) => i);
  for (let i = 1; i <= a.length; i++) {
    const row = [i];
    for (let j = 1; j <= b.length; j++)
      row[j] = Math.min(
        row[j - 1]! + 1,
        previous[j]! + 1,
        previous[j - 1]! + (a[i - 1] === b[j - 1] ? 0 : 1),
      );
    previous = row;
  }
  return previous[b.length]!;
}
export function lookupVenue(table: VenueTable, query: string) {
  const q = normalize(query);
  const scored = table.venues
    .map((v) => {
      const name = normalize(v.name);
      const acronym = normalize(v.acronym);
      const exact = q === name || Boolean(acronym && q === acronym);
      const score = exact
        ? 1
        : Math.max(
            1 - distance(q, name) / Math.max(q.length, name.length, 1),
            acronym
              ? 1 - distance(q, acronym) / Math.max(q.length, acronym.length)
              : 0,
          );
      return { ...v, exact, score };
    })
    .filter((v) => v.score >= 0.65)
    .sort((a, b) => b.score - a.score)
    .slice(0, 5);
  return {
    matches: scored,
    downloaded_at: table.downloaded_at,
    notice:
      "Venue ranks describe venues; assess individual papers using their evidence.",
  };
}
