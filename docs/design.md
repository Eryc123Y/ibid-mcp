# Ibid design

Status: draft for v0.1. Decisions may still change during implementation.

## 1. Overview

```
MCP client (Claude, …)
   │  OAuth 2.1 + PKCE; approval by pairing code
   ▼
Cloudflare Worker (one per user)
   ├─ OAuth provider (workers-oauth-provider) ── KV: clients, grants, tokens
   ├─ PairingStore (Durable Object): pairing-code hash, expiry, attempt count
   ├─ /admin/*  (Bearer MGMT_TOKEN): pair, clients, revoke
   ├─ /mcp      (McpAgent): 7 tools
   │     └─ source adapters ── SourceLimiter (one Durable Object per source)
   │                        └─ fetch with retry, backoff and cache
   └─ bundled data: venue ranking table
```

## 2. Authentication: pairing code

| Step | What happens |
|---|---|
| `ibid deploy` | The CLI generates a random management token. It stores the token locally (file mode 0600) and uploads it as the Worker secret `MGMT_TOKEN`. |
| `ibid pair` | The CLI sends `POST /admin/pair` with `Authorization: Bearer <MGMT_TOKEN>`. The Worker creates an 8-character code from an alphabet without look-alike characters, and stores only a hash of it. The code expires after **10 minutes** and allows at most **5 attempts**. The CLI prints the connector URL and the code. |
| Adding the connector | The client runs standard MCP OAuth. The `/authorize` page asks for the pairing code. A correct code approves this client and closes the pairing window. |
| `ibid clients` / `ibid revoke` | `GET /admin/clients` lists clients and `POST /admin/revoke` revokes them. |

Security notes:
- **Keep pairing state in a Durable Object, not KV.** KV is eventually consistent, so parallel guesses could get past the attempt counter.
- Compare the management token and the pairing code in constant time.
- The consent cookie is signed with `CONSENT_SECRET`.

## 3. CLI

| Command | Purpose |
|---|---|
| `deploy` | Check the user is logged in (`wrangler whoami`; run `wrangler login` if not). Create the KV namespace. Write a generated `wrangler.jsonc` into `~/.config/ibid/`. Prompt for keys. Upload secrets with `wrangler secret bulk` from a temporary file with mode 0600, so keys never appear on the command line. Deploy the Worker bundle that ships in the npm package. |
| `pair` | Print the connector URL and a pairing code. |
| `clients`, `revoke [id]` | Manage authorised clients. |
| `status` | Show the endpoint, the configured sources, and the remaining OpenAlex quota. |
| `keys` | Rotate the source keys. |
| `destroy` | Remove the Worker and its KV namespace. |

## 4. Sources

Notes from live checks in October 2026.

| Source | Role | Auth | Limits | Version |
|---|---|---|---|---|
| Semantic Scholar Graph v1 | Main index: search, citations, references, recommendations, author profiles | User's key (recommended) | 1 request per second per key | v0.1 |
| OpenAlex | Institutions, abstract fill-in, works missing from S2, ORCID iDs | Optional free key | Keyless: 1000 credits a day and 10 requests a second. A key raises this 10× | v0.1 |
| arXiv API | Newest preprints and daily category listings | None | 1 request every 3 s, one connection at a time | v0.1 |
| OpenReview API v2 | Reviews, ratings and decisions | None | `x-ratelimit-*` headers (limit 20) | v0.1 |
| CORE v3 | Open-access full text outside arXiv | Free key | `x-ratelimit-*` headers | v0.1 |
| Venue table | Maps venue acronyms to DBLP stream keys and to CCF and ICORE ranks | None, bundled | None | v0.1, after a licence check |
| DBLP pack | Curated author disambiguation and complete venue tables of contents, built from the monthly CC0 dump into shards in the user's R2 | None | None | v0.2 |
| Europe PMC | Full-text search in OA life-science and chemistry articles, plus preprints | None | Polite use | v0.2 |

Not included:
- **DBLP's live API:** it sits behind a bot challenge, and Ibid does not bypass it.
- **alphaXiv:** it has no public API. Ibid returns arXiv IDs and links instead.
- **Crossref, Unpaywall:** covered by citation-focused servers.
- **Google Scholar:** has no API.

## 5. Tools

| Tool | Behaviour |
|---|---|
| `search` | Query Semantic Scholar first and fill gaps from OpenAlex. Add arXiv for `recent: true` or a `category`. Add CORE for `open_access: true`. De-duplicate by DOI, then arXiv ID, then normalised title plus year. Return compact rows: `limit` defaults to 10, and abstracts are cut to about 300 characters unless `full: true`. |
| `get_paper` | Look up one paper or a batch of up to 20 by DOI, arXiv ID, S2 ID or title. Include an `oa` block with a link and snippet from CORE. |
| `paper_links` | Return citations, references or recommendations, paginated. |
| `get_author` | Look up a researcher by name or ID. Merge records that the sources have split. Include the ORCID iD when known. |
| `coauthorship` | Return the papers two or more researchers share. |
| `reviews` | Find the OpenReview forum by title, forum ID or arXiv ID. Return the venue, the decision, the mean and spread of ratings, and one-line review summaries. Return the full text only when `full: true`. |
| `venue` | Look up a venue name or acronym. Return its CCF and ICORE ranks, the source and year of each ranking, and fuzzy matches. |

Every response includes `sources_used` and `sources_skipped` (with a reason), so
partial results are always marked as such.

## 6. Rate limiting and caching

- `SourceLimiter` is one Durable Object instance per source (`idFromName(source)`). Each instance has its own interval and burst.
- Semantic Scholar allows 1 request per second with a key, or 1 request every 3 s without one. If the expected wait is more than about 10 s, the source is skipped.
- OpenAlex: track daily credit use from the `X-RateLimit-*` headers, and warn when 20% remains.
- On `429` and `5xx` responses, honour `Retry-After` and back off with jitter.
- Responses are cached with the Cache API, keyed by normalised request.

## 7. Privacy

- Ibid sends no contact email upstream by default. The OpenAlex `mailto` is opt-in.
- Keys are stored only as Worker secrets in the user's own account.
- The server keeps no query logs beyond Cloudflare's default request metrics.
