/** Small builders for author and paper fixtures. */

import type { AuthorRecord, Paper, Source } from "../src/core/types";

export function paper(source: Source, id: string, title: string, authors: string[], extra: Partial<Paper> = {}): Paper {
  return { source, id, title, authors: authors.map((name) => ({ name })), ...extra };
}

export function author(source: Source, id: string, name: string, extra: Partial<AuthorRecord> = {}): AuthorRecord {
  return { source, id, name, aliases: [], affiliations: [], papers: [], ...extra };
}
