/** The feed contract shared with LitScout Daily (`summaries/feed.py`): one JSON object per stdout line. */

export interface FeedLine {
  readonly source:
    | "openalex"
    | "crossref"
    | "openreview"
    | "acl-anthology"
    | "pmlr"
    | "datacite"
    | "jmlr";
  readonly title: string;
  readonly authors: readonly string[];
  readonly venue: string;
  readonly published: string;
  readonly doi: string | null;
  readonly arxiv_id: string | null;
  readonly openreview_id: string | null;
  readonly abstract: string | null;
  readonly oa_url: string | null;
  readonly url: string;
}

/** Titles of front matter, notices and corrections that journals register as articles. */
const NON_ARTICLE_TITLES: readonly RegExp[] = [
  /^(?:guest\s+)?editorials?\b/i,
  /^editor['’]?s?['’]?\s+(?:note|introduction|preface)\b/i,
  /^(?:erratum|errata|corrigend(?:um|a)|addendum)\b/i,
  /^corrections?(?:\s+to\b|\s*[:\-–]|\s*$)/i,
  /^(?:retraction|retracted|withdrawn|expression of concern)\b/i,
  /^(?:front|back)\s*matter\b/i,
  /^(?:(?:inside\s+)?(?:front|back)\s+)?cover(?:\s+image)?\s*$/i,
  /\b(?:table of contents|issue information|publication information|information for authors|society information|masthead)\b/i,
  /^contents\s*$/i,
  /^(?:\d{4}\s+)?(?:author\s+|subject\s+)?index\b/i,
  /^(?:list of\s+)?reviewers\b|^reviewer list\b|^thanks? (?:you )?to (?:our )?reviewers\b/i,
  /^(?:in memoriam|obituary|call for papers|blank page)\b/i,
  /(?:^|:\s*)preface\s*$/i,
];

export function isNonArticleTitle(title: string): boolean {
  return NON_ARTICLE_TITLES.some((pattern) => pattern.test(title.trim()));
}

const ARXIV = /(?:arxiv\.org\/(?:abs|pdf)\/|arxiv[.:/])\s*(\d{4}\.\d{4,5})/i;

/** The first new-style arXiv ID (without version) in any of the strings. */
export function arxivIdIn(texts: ReadonlyArray<string | null | undefined>) {
  for (const text of texts) {
    const match = ARXIV.exec(text ?? "");
    if (match) return match[1]!;
  }
  return null;
}

export function doiUrl(doi: string): string {
  return `https://doi.org/${doi}`;
}

export function dayOrNull(text: string | null | undefined): string | null {
  const day = (text ?? "").slice(0, 10);
  return /^\d{4}-\d{2}-\d{2}$/.test(day) && !Number.isNaN(Date.parse(day))
    ? day
    : null;
}
