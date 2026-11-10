/** Source-neutral shapes shared by the backends, the merge logic and the formatters. */

export type Source = "s2" | "openalex";

export interface AuthorRef {
  readonly name: string;
  /** S2 author id (digits) or OpenAlex A-id. */
  readonly id?: string;
}

export interface Paper {
  readonly source: Source;
  /** Chainable id: "CorpusId:123" for S2, "W123" for OpenAlex. */
  readonly id: string;
  readonly title: string;
  readonly year?: number;
  readonly venue?: string;
  readonly authors: readonly AuthorRef[];
  readonly citationCount?: number;
  readonly doi?: string;
  readonly arxiv?: string;
  readonly openalexId?: string;
  readonly s2Id?: string;
  readonly url?: string;
  readonly pdfUrl?: string;
  readonly abstract?: string;
}

export interface AuthorRecord {
  readonly source: Source;
  /** S2 author id or OpenAlex A-id. */
  readonly id: string;
  readonly name: string;
  readonly aliases: readonly string[];
  readonly affiliations: readonly string[];
  readonly paperCount?: number;
  readonly citationCount?: number;
  readonly hIndex?: number;
  readonly orcid?: string;
  /** Papers known for this record (may be partial). */
  readonly papers: readonly Paper[];
}

export interface Notice {
  readonly level: "info" | "warn";
  readonly text: string;
}
