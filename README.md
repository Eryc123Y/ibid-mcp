# LitScout

LitScout is a self-hosted MCP server for scholarly literature search. Deploy your
own Cloudflare Worker, pair a remote MCP client, and search Semantic Scholar,
OpenAlex, arXiv, public OpenReview and CORE through seven tools.

**v0.1 implementation is locally tested; no release or Cloudflare deployment has
been performed.** The previously published placeholder, if present, does not
contain this implementation. The 600-paper empirical coverage target remains
unverified because its recorded snapshot is unavailable. See the
[build report](docs/v0.1-build-report.md).

## Quickstart from this checkout

Requirements: Node.js **22.13 or newer**, npm, and your own Cloudflare account
with Workers, Durable Objects and KV available. Free-tier suitability has not
been verified by a clean-account deployment.

```sh
npm ci
npm run build
node dist/cli/index.js deploy
node dist/cli/index.js pair
```

`deploy` checks Wrangler authentication and opens its login flow if needed. It
asks privately for optional source keys, creates the OAuth KV namespace,
downloads venue tables for your deployment, uploads secrets and deploys the
bundled Worker. It binds OAuth to the resulting public URL in a second deployment.
`pair` prints the connector URL and an eight-character code.

Add that URL as a custom remote MCP connector in your client, then enter the code
on the approval page. The code expires after ten minutes, permits five attempts,
and authorizes one connection. A failed browser approval must be restarted from
the client. Generate a fresh code for each new authorization.

After a maintainer publishes the functional package, the equivalent commands
will be `npx litscout deploy` and `npx litscout pair`.

## Source keys

| Source | Setup | Without a key |
|---|---|---|
| Semantic Scholar | [Request an API key](https://www.semanticscholar.org/product/api), enter `S2_API_KEY` | Supported at one request every three seconds; expected queue waits above ten seconds are skipped |
| OpenAlex | [API documentation](https://docs.openalex.org/), enter `OPENALEX_API_KEY` if available | Keyless requests; actual quota is read from response headers |
| CORE | [Register for an API key](https://core.ac.uk/services/api), enter `CORE_API_KEY` | CORE is skipped with an explicit reason |
| arXiv / OpenReview | No key | Public metadata and public reviews only |

Keys are never accepted as command arguments or printed. Blank answers preserve
existing keys when rotating. No contact email is sent upstream by default.

## Commands

Run `node dist/cli/index.js <command>` from a source build, or `litscout <command>`
after installing a functional release.

| Command | Result |
|---|---|
| `deploy` | Create or update your deployment; retry incomplete setup using saved state |
| `pair` | Show the connector URL and a one-use pairing code |
| `clients` | List approved client records |
| `revoke <id>` | Immediately deny that client and revoke its OAuth grants/tokens |
| `status` | Show endpoint, configured sources and last observed OpenAlex quota |
| `keys` | Privately prompt for replacement source keys |
| `destroy` | After a typed `yes`, remove the Worker and its OAuth KV namespace |
| `watch --since YYYY-MM-DD --venues <file>` | Print new journal (and, with `--kinds`, conference) papers as JSON Lines; runs locally, no deployment needed |
| `abstracts < items.jsonl` | Fill missing abstracts for feed papers (JSON Lines in and out); runs locally |

Local state and generated configuration live in `~/.config/litscout/`, with mode
0700 for the directory and 0600 for state/config files. The management token is
stored locally; source keys remain only in Worker secrets after upload. The
temporary secret file is mode 0600 and removed even when upload fails. Treat the
local state file as a password. Keep it until a failed deployment or deletion is
successfully retried.

## Feeding LitScout Daily

`litscout watch` is the feed command that
[LitScout Daily](https://github.com/Eryc123Y/daily-arXiv-ai-enhanced) runs to put
journal and conference papers beside its arXiv papers. It runs locally (no Worker,
no deployment) and prints one JSON object per line on stdout, in the shape
`summaries/feed.py` reads; progress, skipped venues and warnings go to stderr.

```sh
npm ci --ignore-scripts && npm run build
node dist/cli/index.js watch --since 2026-11-10 --venues summaries/watchlist.json
```

Set this in LitScout Daily's environment (the pipeline appends `--since` and
`--venues` itself):

```sh
FEED_COMMAND='["node", "/absolute/path/to/litscout-mcp/dist/cli/index.js", "watch"]'
```

| Option | Meaning |
|---|---|
| `--since YYYY-MM-DD` | Papers the source first listed on or after this day (required) |
| `--venues <file>` | The watch list, `{"venues": [{"name", "kind", "issn"?, "openalex_source"?, "acl_anthology"?, "pmlr"?, "doi_prefix"?, "openreview"?, "jmlr"?, "openreview_venues"?, "sources"?}]}`; other fields are ignored (required) |
| `--kinds journal,conference` | Which venues to read; default `journal` |
| `--until YYYY-MM-DD` | Last listing day to include |

- **Journals** (venues with `issn`): Crossref works whose DOI was registered in
  the window (`from-created-date`), paged with a cursor. Crossref lists a paper
  the day its DOI is registered and has no quota. With `OPENALEX_API_KEY` set,
  the DOIs are then looked up in OpenAlex, 50 per request, for the abstract,
  open-access link and arXiv ID. Without the key, or when OpenAlex fails or its
  quota is spent, the Crossref records still go out (with Crossref's abstract
  when it has one) and stderr says why. `source` is `crossref`; `published` is
  the Crossref publication date when it has a day, else the day the DOI was
  registered (IEEE gives only a year).
- **Not papers**: Crossref types other than `journal-article` and
  `proceedings-article` (issues, components, peer reviews), and titles such as
  editorials, errata, corrections ("Correction to ..."), retractions, front and
  back matter, covers, tables of contents, issue or publication information,
  information for authors, indexes, reviewer lists, obituaries, calls for
  papers and prefaces. OpenAlex conference works of type paratext, erratum, editorial,
  retraction, peer-review or supplementary materials are dropped the same way.
- **Conferences** (`--kinds conference`, venues with `openalex_source`): OpenAlex
  works published since a year before `--since` whose OpenAlex `created_date` is
  in the window, with `source` `openalex`. Proceedings arrive in yearly batches,
  so one run can return hundreds of papers, and each run pages through the
  venue's last year (a few OpenAlex requests per venue). Run it weekly, for
  example with a second `FEED_COMMAND` ending in `"watch", "--kinds", "conference"`;
  LitScout Daily caps what it publishes per run (`FEED_MAX_PER_RUN`).
- **Sources beyond Crossref and OpenAlex.** A venue may name one of these
  fields; when it names several, the most precise wins, in this order:
  `jmlr`, `acl_anthology`, `pmlr`, `doi_prefix`, `openreview`, then `issn`
  (journals) or `openalex_source` (conferences). `--kinds` still decides which
  venues a run reads.

  | Field | Value | Source and dating |
  |---|---|---|
  | `acl_anthology` | `acl`, `emnlp`, `naacl`, `eacl`, `conll`, `tacl`, `cl` or `mol` | The ACL Anthology's XML metadata in [acl-org/acl-anthology](https://github.com/acl-org/acl-anthology) (`data/xml/<year>.<venue>.xml`). Main volumes only: long, short and main papers for the conferences (no Findings, workshops, demos, tutorials, industry or student research workshop), every paper of TACL and CL, the main volume of CoNLL and MoL (no shared tasks such as BabyLM). A paper is new when it is in the file at the last commit in the window but not at the last commit before `--since`, so the growing TACL and CL volumes report each paper once. Dated by the volume's ingestion date when it falls in the window, else by that commit's day; for TACL and CL that is the volume's latest ingestion. `source` is `acl-anthology`; `url` is the Anthology page, `oa_url` its PDF. With `OPENALEX_API_KEY`, DOIs are looked up in OpenAlex for arXiv IDs. |
  | `pmlr` | A PMLR series as PMLR names it, e.g. `COLT`, `ALT`, `AISTATS`, `UAI`, `CoLLAs` | PMLR's volume index (`proceedings.mlr.press/proceedings.yaml`, "Proceedings of COLT 2026") and each volume's citeproc export (`assets/bib/citeproc.yaml`), with abstracts. Volumes from the year before `--since` to the year after the window are read; papers are dated by the volume's publication date. `source` is `pmlr`; no DOI. |
  | `doi_prefix` | A DOI prefix, e.g. `10.4230/LIPIcs.ITP`, `10.4230/LIPIcs.ICALP` | The registration agency from doi.org's handle API. DataCite DOIs (all of LIPIcs) are searched by DOI and creation date (`source` `datacite`); Crossref DOIs by registrant prefix and `from-created-date`, keeping DOIs under the prefix (`source` `crossref`). Other agencies are skipped. OpenAlex then enriches by DOI, as for journals. |
  | `openreview` | An OpenReview venue id or a list; `{year}` runs from the year before `--since` to the year after the window | Accepted papers (notes whose `content.venueid` is the id), dated by publication time. Examples: `TMLR`, `colmweb.org/COLM/{year}/Conference`, `rl-conference.cc/RLC/{year}/Conference`, `lifelong-ml.cc/CoLLAs/{year}/Conference`. The API answers anonymous scripts with a browser challenge, so this needs `OPENREVIEW_TOKEN`, or `OPENREVIEW_USERNAME` and `OPENREVIEW_PASSWORD` for a login (sent only to OpenReview's login endpoint). Without them the venue falls back to its `issn` or `openalex_source`, or is skipped with one stderr line. `source` is `openreview`. |
  | `jmlr` | `true` | JMLR's own RSS feed (`https://www.jmlr.org/jmlr.xml`: the current volume with abstracts). JMLR has no DOIs, OpenAlex has almost none of its recent papers, DBLP answers scripts with a bot challenge, and the feed and BibTeX carry only a year, so watch keeps a ledger of the papers it has seen (`watch-jmlr.json` in `LITSCOUT_STATE_DIR`, default `~/.config/litscout`) and dates each paper by the UTC day it first appeared. The first run records the current feed and reports nothing. A ledger that cannot be read skips the venue rather than resetting it. `source` is `jmlr`. |

  PMLR and JMLR papers, and Anthology papers without a DOI (Mathematics of
  Language), carry no DOI, arXiv ID or OpenReview ID; their `url` is stable.
  `openreview_venues` is still informational only: a venue with nothing else is
  skipped with one stderr line. ECCV, which has no OpenAlex source or ISSN of
  its own, is skipped too.
- **Environment.** `OPENALEX_API_KEY` (enrichment), `GITHUB_TOKEN` (optional:
  raises GitHub's limit of 60 commit lookups an hour; the Anthology check makes
  one to three per venue and year), `OPENREVIEW_TOKEN` or
  `OPENREVIEW_USERNAME` and `OPENREVIEW_PASSWORD`, and `LITSCOUT_STATE_DIR`.
  Requests carry the User-Agent `litscout-watch/0.1` and the repository URL,
  are spaced per host, and are retried a bounded number of times. Days are UTC,
  as in LitScout Daily.
- `UNPAYWALL_EMAIL`, when set, is sent to Crossref as the polite-pool `mailto`;
  nothing else is sent by default. Keys come from the environment only and are
  never printed.
- Exit status: 0 when anything could be fetched (even no papers); 2 for bad
  arguments or an unreadable venue file; 1 when every source request failed.
  A venue whose source fails is reported on its own stderr line and does not
  stop the others. The last stderr line is the one-line reason. The last line
  of a successful run counts papers, abstracts, open-access links and requests
  per source.

### Filling missing abstracts

IEEE and Springer do not deposit abstracts in Crossref, and OpenAlex and
Semantic Scholar can lag by weeks, so some feed papers arrive without one.
`litscout abstracts` looks them up, from official APIs only.

```sh
printf '%s\n' '{"id": "p1", "doi": "10.1109/tpami.2026.3750433"}' \
  | node dist/cli/index.js abstracts
```

- **stdin:** JSON Lines, at most 200, each
  `{"id": string, "doi"?: string, "arxiv"?: string, "title"?: string}`. `id`
  is opaque and echoed back; `null` counts as absent; blank lines are ignored.
  A DOI or arXiv ID that cannot be recognised (or a DOI over 300 characters, a
  title over 1,000) is ignored rather than rejected; an arXiv DOI
  (`10.48550/arXiv.<id>`) also counts as the arXiv ID.
- **stdout:** exactly one line per input line, in input order:
  `{"id": string, "abstract": string | null, "source": "openalex" | "s2" | "arxiv" | "crossref" | "europepmc" | "ieee" | "springer" | "elsevier" | null}`.
  Nothing else is written to stdout.
- **Order** (each item stops at the first hit):
  1. OpenAlex, `GET /works/doi:<doi>` per DOI (this also finds journal versions
     merged into their arXiv preprint, which a `doi:` filter misses); the
     abstract is rebuilt from `abstract_inverted_index`, and an arXiv ID in its
     locations is kept for step 3.
  2. Semantic Scholar, one `POST /graph/v1/paper/batch` with every remaining DOI
     (`fields=abstract,externalIds`; `S2_API_KEY` when set). A 429 waits and is
     retried once, then S2 is skipped. `externalIds.ArXiv` is kept for step 3.
  3. arXiv export API, by ID (input, OpenAlex or S2) in one `id_list` request;
     without an ID, by exact title (`ti:"..."`), accepted only when the titles
     are equal after case, accents, punctuation and spacing are ignored. One
     request every three seconds, as arXiv asks.
  4. Crossref, `GET /works/<doi>`, field `abstract`.
  5. Europe PMC, `search?query=DOI:"<doi>"&resultType=core`, field `abstractText`
     (PLOS, eLife, neuroscience journals).
  6. Publisher APIs, only with their key set (otherwise skipped without a word):
     IEEE Xplore Metadata API (`IEEE_API_KEY`) for `10.1109/` DOIs, Springer
     Nature Meta API v2 (`SPRINGER_API_KEY`) for `10.1007/`, Elsevier Abstract
     Retrieval (`ELSEVIER_API_KEY`, sent as a header) for `10.1016/`.
- **Text:** plain text, with JATS and HTML tags stripped, entities decoded,
  whitespace collapsed, and a leading "Abstract" heading and publisher
  copyright lines removed. Anything under 100 characters, or a placeholder such
  as "No abstract available", is discarded and the next source is tried.
- **Failures:** a request that fails (timeout, 429, 5xx, unreadable data) skips
  that source for that item, and later sources still try. "Not found" is not a
  failure. After three failures in a row a source is left alone for the rest
  of the run, and its remaining lookups count as skipped. Items that repeat a
  DOI share one request. A run stops making requests after 15 minutes and
  still answers every item (the summary then ends with "time budget spent").
  Requests that carry a publisher key refuse redirects. stderr gets one
  summary line: items, how many were filled from each source, and the number
  of skipped requests. It never contains URLs, keys or exception text.
- **Exit status:** 0 whenever the run completes, even if nothing is found; 2
  for bad input (invalid JSON, a line that is not an object with a string
  `id`, more than 200 lines, more than 1 MB) or any argument other than
  `--help`; 1 only for an internal error, with nothing on stdout.
- **Cost:** OpenAlex and Crossref get one request per DOI still missing,
  Europe PMC one per DOI left after Crossref, S2 one in all, arXiv one per 50
  IDs plus one per title search (three seconds each, so 30 title searches take
  about a minute and a half). `OPENALEX_API_KEY` and `UNPAYWALL_EMAIL` are used
  as in `watch`.

## Tools

| Tool | Input and behavior |
|---|---|
| `search` | `query`, optional `year_from`, `year_to`, `venue`, `recent`, `category`, `open_access`, `limit`, `offset`, `full`; combines S2/OpenAlex and adds arXiv or CORE as requested. Category-only queries may omit `query`. |
| `get_paper` | `ids`: one DOI, arXiv ID, S2 ID, OpenAlex ID or title, or an array of up to 20; includes a CORE `oa` block when available. `full` retains the full metadata abstract. |
| `paper_links` | `id`, `direction`: `citations`, `references` or `recommendations`; `limit`/`offset` paginate. Recommendations require an S2-addressable identifier and are bounded to 500 results. |
| `get_author` | `name_or_id`, optional `affiliation_hint`, `include_papers`, `sort`, `limit`; merges compatible records and includes known ORCID identifiers. |
| `coauthorship` | `authors`: two to six names/IDs; alternatively `author_a`, `author_b` and affiliation hints. Prolific-author paper lists can be partial. |
| `reviews` | `query`: title, forum ID/URL or arXiv ID; returns decision, mean, population standard deviation, range and one-line summaries. Full review content requires `full: true`. |
| `venue` | `query`: name/acronym; returns CCF/ICORE ranks with edition year and source, DBLP stream keys where available, and fuzzy matches. |

Successful tool calls and handled execution errors return JSON in MCP text
content, including `sources_used` and `sources_skipped` with reasons. Partial
results are useful but are not evidence that every source was searched. Lists
default to ten items and metadata abstracts to about 300 characters. The `oa`
block identifies whether its bounded snippet came from an abstract or full text.

```json
{
  "result": {"papers": []},
  "notices": [],
  "sources_used": ["openalex"],
  "sources_skipped": [{"source":"s2","reason":"s2 queue is full (expected wait 12s exceeds 10s); retry later."}]
}
```

Venue tables are **not distributed with LitScout**. Deployment downloads CCF's
official PDF and ICORE's public CSV export into your own deployment. If download
or parsing fails, the CLI reports it and `venue` reports missing data. Rankings
are guidance about venues, not a judgement of individual papers. Read the
[licence findings and remaining checks](docs/venue-data-licence.md).

## Development and verification

```sh
npm ci --ignore-scripts
npm test                 # all upstream requests mocked; network disabled
npm run test:coverage    # at least 80% statements, branches, functions and lines
npm run typecheck        # strict TypeScript
npm run lint
npm run build            # local esbuild bundles; no Wrangler deployment
npm run test:worker      # local workerd smoke; all outbound requests blocked
npm pack --dry-run --ignore-scripts
```

Tests use synthetic, protocol-shaped fixtures; none are presented as live
upstream measurements. An opt-in `npm run test:live` configuration exists and is
excluded from unit tests and CI. It was not run for this build.

### Coverage evaluation

The reference is the [600-paper arXiv measurement](https://github.com/Eryc123Y/daily-arXiv-ai-enhanced/blob/main/docs/measurements/arxiv-coverage.md):
40 papers per venue, seed 7, 2024 except ICCV 2023. The original sample and recorded
S2/OpenAlex title-query replies are needed to evaluate LitScout's 90% target.

```sh
npm run test:eval -- path/to/recorded-600.json
```

This command replays recorded replies through the actual search adapters without
network access. Missing data produces `unverified` and exit code 2, never an
invented passing score. CI records that state as a visible warning for ordinary
code changes; a manual CI run with `require_evaluation: true` fails until the real
snapshot is present and the threshold passes. See [snapshot format](eval/README.md).

## Scope and privacy

OAuth uses PKCE and browser-bound, signed consent; pairing attempt counts and
immediate revocation are stored in a Durable Object. Each source has its own
limiter. arXiv connections are serialized with at least three seconds between
starts. Retry-After is honored and cache keys exclude API secrets. Quota status
is the last observed value, not a fresh quota request.

LitScout adds no query logging or telemetry; Cloudflare still provides its normal
request metrics. It does not access Sci-Hub, scrape Google Scholar, bypass bot
checks, log in to OpenReview, or fetch publisher PDFs. DBLP links are metadata
from the venue table; DBLP's live API is not called.

## Project and acknowledgements

- [Repository](https://github.com/Eryc123Y/litscout-mcp), [roadmap](ROADMAP.md), [design](docs/design.md).
- Pairing-code setup is inspired by [moodle-cli](https://www.npmjs.com/package/moodle-cli).
- Sources: [Semantic Scholar](https://www.semanticscholar.org/product/api), [OpenAlex](https://openalex.org), [arXiv](https://info.arxiv.org/help/api/), [OpenReview](https://openreview.net), [CORE](https://core.ac.uk).
- Thank you to arXiv for use of its open access interoperability.

[MIT](LICENSE) for code; third-party data retains its own terms.
