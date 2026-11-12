/** Abstract clean-up and title comparison for `litscout abstracts`. Pure functions. */

import { plainText } from "../../src/sources/crossref";

/** Shorter than this is a fragment, a teaser or a placeholder, not an abstract. */
export const MIN_ABSTRACT_LENGTH = 100;

/** Text that stands in for a missing abstract, matched at the start after clean-up. */
const PLACEHOLDERS: readonly RegExp[] = [
  /^(?:no|not) abstract\b/i,
  /^abstract (?:is )?(?:not |un)available\b/i,
  /^abstract not provided\b/i,
  // Only as the whole statement: "None of the existing methods ..." is a real abstract.
  /^(?:not available|unavailable|n\/a|none)(?:\s*[.:;]|\s*$)/i,
  // IEEE Xplore's stand-in for scanned articles.
  /^first page of the article\b/i,
];

/**
 * A leading "Abstract" heading: followed by punctuation, or by a capitalised word. "Abstract
 * reasoning is ..." keeps its first word.
 */
const LABEL =
  /^(?:abstract|Abstract|ABSTRACT)(?:\s*[:.\-–—]\s*|\s+(?=\p{Lu}))/u;
/** Publisher copyright lines that open or close some abstracts (Elsevier, Wiley). */
const COPYRIGHT_HEAD =
  /^(?:©|copyright\b)\s*(?:©\s*)?\d{4}\b.{0,200}?all rights reserved\.?\s*/i;
// "©" or "Copyright", never "(c)": an enumeration "(a) ... (c) 2000 participants" is text.
const COPYRIGHT_TAIL = /\s*(?:©|copyright\s*©?)\s*\d{4}\b[^©]{0,200}$/i;

/**
 * Plain text from JATS, HTML or plain input: tags stripped, entities decoded, whitespace collapsed,
 * a leading "Abstract" heading and copyright lines removed. Null when the result is shorter than
 * MIN_ABSTRACT_LENGTH or looks like a placeholder.
 */
export function cleanAbstract(raw: string | null | undefined): string | null {
  const text = (plainText(raw) ?? "")
    .replace(LABEL, "")
    .replace(COPYRIGHT_HEAD, "")
    .replace(COPYRIGHT_TAIL, "")
    .trim();
  if (text.length < MIN_ABSTRACT_LENGTH) return null;
  return PLACEHOLDERS.some((p) => p.test(text)) ? null : text;
}

/** Lower case, accents dropped, every run of non-letters and non-digits one space. Keeps Greek. */
function foldTitle(title: string): string {
  return title
    .normalize("NFKD")
    .replace(/\p{M}/gu, "")
    .toLowerCase()
    .replace(/[^\p{L}\p{N}]+/gu, " ")
    .trim();
}

/** Whether two titles are equal once case, accents, punctuation and spacing are ignored. */
export function sameTitle(a: string, b: string): boolean {
  const x = foldTitle(a);
  return x.length > 0 && x === foldTitle(b);
}
