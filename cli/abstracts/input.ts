/**
 * stdin for `litscout abstracts`: JSON Lines, one `{"id", "doi"?, "arxiv"?, "title"?}` per line.
 * Types are checked strictly (bad input is exit 2); values are normalised leniently, so a DOI or
 * arXiv id that cannot be recognised is dropped rather than failing the whole run.
 */

import { z } from "zod";
import { normalizeDoi } from "../../src/core/normalize";

export const MAX_LINES = 200;
/** 200 lines with long titles fit easily; anything bigger is not this contract. */
export const MAX_BYTES = 1_000_000;
/** Longer values are no real DOI or title; dropping them keeps URLs small. */
export const MAX_DOI_LENGTH = 300;
export const MAX_TITLE_LENGTH = 1000;

export interface AbstractRequest {
  /** Opaque; echoed back unchanged. */
  readonly id: string;
  /** Lower-case, without a doi.org prefix. */
  readonly doi?: string;
  /** Without "arXiv:" and without a version. */
  readonly arxiv?: string;
  readonly title?: string;
}

export class InputError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "InputError";
  }
}

// null is accepted as "absent": JSON writers often emit it for missing optional fields.
const LINE = z.object({
  id: z.string(),
  doi: z.string().nullish(),
  arxiv: z.string().nullish(),
  title: z.string().nullish(),
});

// YYMM.NNNNN with a real month: arXiv rejects a whole id_list over one impossible id.
const ARXIV_NEW = /^(\d{2}(?:0[1-9]|1[0-2])\.\d{4,5})(?:v\d+)?$/i;
const ARXIV_DOI = /^10\.48550\/arxiv\.(.+)$/i;
const ARXIV_OLD = /^([a-z-]+(?:\.[a-z]{2})?\/\d{7})(?:v\d+)?$/i;

/**
 * A DOI as lookups use it, or undefined. Besides the "10." prefix it must have a suffix, no
 * whitespace and no "." or ".." path segment: DOIs go into URL paths, where such a segment
 * would be resolved into another path on the same host.
 */
export function cleanDoi(raw: string | null | undefined): string | undefined {
  const doi = normalizeDoi(raw);
  if (!doi || doi.length > MAX_DOI_LENGTH || !/^10\.\d{4,9}\/\S+$/.test(doi))
    return undefined;
  return doi.split("/").some((s) => s === "." || s === "..") ? undefined : doi;
}

/** An arXiv id without prefix or version, or undefined when it is not one. */
export function arxivId(raw: string | null | undefined): string | undefined {
  const value = (raw ?? "").trim().replace(/^arxiv:/i, "");
  const match = value.match(ARXIV_NEW) ?? value.match(ARXIV_OLD);
  return match?.[1];
}

function parseLine(line: string, n: number): AbstractRequest {
  let data: unknown;
  try {
    data = JSON.parse(line);
  } catch {
    throw new InputError(`line ${n} is not valid JSON`);
  }
  // Messages name the line and the rule, never the content: ids and titles are the caller's data.
  if (typeof data !== "object" || data === null || Array.isArray(data))
    throw new InputError(`line ${n} is not a JSON object`);
  const parsed = LINE.safeParse(data);
  if (!parsed.success)
    throw new InputError(
      `line ${n}: "id" must be a string, and "doi", "arxiv" and "title" strings when given`,
    );
  const { id, doi, arxiv, title } = parsed.data;
  // An arXiv DOI names the preprint itself.
  const arxivFromDoi = arxivId(cleanDoi(doi)?.match(ARXIV_DOI)?.[1]);
  const cleanArxiv = arxivId(arxiv) ?? arxivFromDoi;
  const spaced = title?.replace(/\s+/g, " ").trim();
  const cleanTitle =
    spaced && spaced.length <= MAX_TITLE_LENGTH ? spaced : undefined;
  return {
    id,
    ...(cleanDoi(doi) ? { doi: cleanDoi(doi) } : {}),
    ...(cleanArxiv ? { arxiv: cleanArxiv } : {}),
    ...(cleanTitle ? { title: cleanTitle } : {}),
  };
}

/** Every non-blank line as a request, in order. Throws InputError for anything off-contract. */
export function parseInput(text: string): AbstractRequest[] {
  if (text.length > MAX_BYTES)
    throw new InputError(`input is larger than ${MAX_BYTES} bytes`);
  const lines = text
    .replace(/^\uFEFF/, "")
    .split(/\r?\n/)
    .map((line, i) => ({ line: line.trim(), n: i + 1 }))
    .filter(({ line }) => line.length > 0);
  if (lines.length > MAX_LINES)
    throw new InputError(`more than ${MAX_LINES} lines`);
  return lines.map(({ line, n }) => parseLine(line, n));
}
