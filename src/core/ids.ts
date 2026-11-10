/**
 * Paper and author identifier parsing. Pure functions: no I/O.
 *
 * A parsed paper id knows how to address Semantic Scholar (`s2`) and, when possible,
 * OpenAlex (`openalexFilter`, an OpenAlex filter clause, or `openalexId`).
 */

export type PaperIdKind =
  "s2" | "corpus" | "doi" | "arxiv" | "openalex" | "pmid" | "pmcid";

export interface ParsedPaperId {
  readonly kind: PaperIdKind;
  /** Canonical value (DOI lower-cased, arXiv without version, W-id upper-cased). */
  readonly value: string;
  /** Id accepted by the S2 Graph API, or undefined when S2 cannot address it directly. */
  readonly s2?: string;
  /** OpenAlex work id (W...), when known without a lookup. */
  readonly openalexId?: string;
  /** OpenAlex filter attribute and value (for OR-batching), when available. */
  readonly openalexFilter?: {
    readonly attr: "doi" | "ids.pmid" | "ids.pmcid";
    readonly value: string;
  };
}

export class IdParseError extends Error {
  constructor(input: string) {
    super(
      `Unrecognised paper id "${input}". Accepted: DOI (10.x/...), arXiv id (2106.15928), ` +
        `S2 id (40-hex or CorpusId:N), OpenAlex W-id (W123), PMID:N, PMCID:N, or their URLs. ` +
        `Use search_papers for titles.`,
    );
    this.name = "IdParseError";
  }
}

const DOI_RE = /^10\.\d{4,9}\/\S+$/i;
const ARXIV_NEW_RE = /^(\d{4}\.\d{4,5})(v\d+)?$/i;
const ARXIV_OLD_RE = /^([a-z-]+(?:\.[a-z]{2})?\/\d{7})(v\d+)?$/i;
const S2_SHA_RE = /^[0-9a-f]{40}$/i;
const OPENALEX_W_RE = /^w\d+$/i;
const ARXIV_DOI_RE = /^10\.48550\/arxiv\.(.+)$/i;

function stripUrl(input: string): string {
  const trimmed = input.trim();
  const patterns: ReadonlyArray<
    readonly [RegExp, (m: RegExpMatchArray) => string]
  > = [
    [
      /^https?:\/\/(?:dx\.)?doi\.org\/(.+)$/i,
      (m) => `doi:${decodeURIComponent(m[1] ?? "")}`,
    ],
    [
      /^https?:\/\/(?:www\.)?arxiv\.org\/(?:abs|pdf|html)\/([^?#]+?)(?:\.pdf)?\/?(?:[?#].*)?$/i,
      (m) => `arxiv:${m[1] ?? ""}`,
    ],
    [
      /^https?:\/\/(?:www\.|api\.)?openalex\.org\/(?:works\/)?(w\d+)/i,
      (m) => m[1] ?? "",
    ],
    [
      /^https?:\/\/(?:www\.)?semanticscholar\.org\/paper\/(?:[^/]*\/)?([0-9a-f]{40})/i,
      (m) => m[1] ?? "",
    ],
  ];
  for (const [re, fn] of patterns) {
    const match = trimmed.match(re);
    if (match) return fn(match);
  }
  return trimmed;
}

function doiId(doi: string): ParsedPaperId {
  const value = doi.toLowerCase();
  const arxiv = value.match(ARXIV_DOI_RE);
  if (arxiv?.[1]) return arxivId(arxiv[1]);
  return {
    kind: "doi",
    value,
    s2: `DOI:${value}`,
    openalexFilter: { attr: "doi", value },
  };
}

function arxivId(raw: string): ParsedPaperId {
  const m = raw.match(ARXIV_NEW_RE) ?? raw.match(ARXIV_OLD_RE);
  if (!m?.[1]) throw new IdParseError(raw);
  const value = m[1].toLowerCase();
  // OpenAlex indexes arXiv preprints under the DataCite DOI 10.48550/arXiv.<id>.
  return {
    kind: "arxiv",
    value,
    s2: `ARXIV:${value}`,
    openalexFilter: { attr: "doi", value: `10.48550/arxiv.${value}` },
  };
}

/** Parse any supported paper identifier. Throws IdParseError for unsupported input. */
export function parsePaperId(input: string): ParsedPaperId {
  const raw = stripUrl(input);
  if (raw.length === 0) throw new IdParseError(input);

  const prefixed = raw.match(/^([a-z]+):\s*(.+)$/i);
  if (prefixed?.[1] && prefixed[2]) {
    const prefix = prefixed[1].toLowerCase();
    const rest = prefixed[2].trim();
    switch (prefix) {
      case "doi":
        if (DOI_RE.test(rest)) return doiId(rest);
        break;
      case "arxiv":
        return arxivId(rest);
      case "corpusid":
        if (/^\d+$/.test(rest))
          return { kind: "corpus", value: rest, s2: `CorpusId:${rest}` };
        break;
      case "pmid":
        if (/^\d+$/.test(rest)) {
          return {
            kind: "pmid",
            value: rest,
            s2: `PMID:${rest}`,
            openalexFilter: { attr: "ids.pmid", value: rest },
          };
        }
        break;
      case "pmcid": {
        const pmc = rest.replace(/^pmc/i, "");
        if (/^\d+$/.test(pmc)) {
          return {
            kind: "pmcid",
            value: pmc,
            s2: `PMCID:${pmc}`,
            openalexFilter: { attr: "ids.pmcid", value: `PMC${pmc}` },
          };
        }
        break;
      }
      case "openalex":
        if (OPENALEX_W_RE.test(rest)) return openalexWork(rest);
        break;
      case "s2":
        if (S2_SHA_RE.test(rest))
          return {
            kind: "s2",
            value: rest.toLowerCase(),
            s2: rest.toLowerCase(),
          };
        if (/^\d+$/.test(rest))
          return { kind: "corpus", value: rest, s2: `CorpusId:${rest}` };
        break;
      default:
        break;
    }
    throw new IdParseError(input);
  }

  if (DOI_RE.test(raw)) return doiId(raw);
  if (S2_SHA_RE.test(raw))
    return { kind: "s2", value: raw.toLowerCase(), s2: raw.toLowerCase() };
  if (OPENALEX_W_RE.test(raw)) return openalexWork(raw);
  if (ARXIV_NEW_RE.test(raw) || ARXIV_OLD_RE.test(raw)) return arxivId(raw);
  throw new IdParseError(input);
}

function openalexWork(raw: string): ParsedPaperId {
  const value = raw.toUpperCase();
  return { kind: "openalex", value, openalexId: value };
}

export type AuthorIdKind = "s2" | "openalex" | "orcid" | "name";

export interface ParsedAuthorId {
  readonly kind: AuthorIdKind;
  readonly value: string;
}

/** Classify an author argument: S2 author id, OpenAlex A-id, ORCID, or a free-text name. */
export function parseAuthorId(input: string): ParsedAuthorId {
  const raw = input.trim();
  const orcid = raw.match(
    /(?:orcid\.org\/|orcid:\s*)?(\d{4}-\d{4}-\d{4}-\d{3}[\dx])$/i,
  );
  if (orcid?.[1] && (raw.length === orcid[1].length || /orcid/i.test(raw))) {
    return { kind: "orcid", value: orcid[1].toUpperCase() };
  }
  const oa = raw.match(
    /^(?:https?:\/\/(?:api\.)?openalex\.org\/(?:authors\/)?)?(a\d+)$/i,
  );
  if (oa?.[1]) return { kind: "openalex", value: oa[1].toUpperCase() };
  const s2 = raw.match(
    /^(?:s2:|https?:\/\/(?:www\.)?semanticscholar\.org\/author\/(?:[^/]*\/)?)?(\d{3,})$/i,
  );
  if (s2?.[1]) return { kind: "s2", value: s2[1] };
  return { kind: "name", value: raw };
}
