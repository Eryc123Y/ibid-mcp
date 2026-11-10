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

Local state and generated configuration live in `~/.config/litscout/`, with mode
0700 for the directory and 0600 for state/config files. The management token is
stored locally; source keys remain only in Worker secrets after upload. The
temporary secret file is mode 0600 and removed even when upload fails. Treat the
local state file as a password. Keep it until a failed deployment or deletion is
successfully retried.

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
