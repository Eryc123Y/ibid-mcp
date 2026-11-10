# v0.1 implementation log

## P0

- Imported the read-only prototype tests first. The first meaningful run failed in eight suites because implementation and the configuration template were absent.
- Imported the five tools, source clients, author merging, cache/retry and S2 limiter; removed GitHub authentication and fail closed pending P1.
- Removed personal account configuration and contact defaults. Source-document links containing the personal handle were replaced by repository-discovery links to satisfy the scrub rule; requirements are unchanged. The existing MIT copyright notice is retained as legally required attribution.
- Validation: 74 tests passed (prototype allowlist tests removed; scrub regression added), strict typecheck and ESLint passed. No live tests run.
- Every phase commit is preceded by the prescribed identifier scan, including staged files.

## P1

- Added failing tests for pairing persistence, concurrent consumption, expiry, attempt exhaustion, admin credentials, escaped consent and OAuth completion, then implemented them.
- Pairing and immediate client revocation live in a transactional Durable Object. WebCrypto HMAC verification compares secrets; only pairing hashes persist. Browser-bound OAuth consent is checked before consuming attempts, and remembered consent is signed but never bypasses pairing.
- Validation: 84 tests, strict typecheck and ESLint. OAuth provider dependencies run locally with a Durable Object base-class double; no account operations.

## P2

- Wrote six CLI tests first (missing module failure), then implemented deploy, pair, clients, revoke, status, keys and destroy with an injected Wrangler runner.
- Deployment state/config use mode 0600 in a mode-0700 directory. Source secrets exist only in temporary mode-0600 files, cleaned even after upload failure. Incomplete deployment state is retained for retry; destroy requires an explicit typed confirmation.
- Built the Worker and executable CLI with esbuild and verified the built CLI help. All Wrangler commands, including login/deploy/delete, were mocked; none were executed.
- Validation: 90 tests, strict typecheck, ESLint and local bundle build passed.

## P3a

- Failing regressions covered persistent per-source scheduling, keyless/keyed intervals, quota warnings at 20%, fan-out, partial failure, title/year deduplication, title lookup and recommendation pagination.
- Replaced the S2-only object with SourceLimiter instances named by source. Search combines S2 and OpenAlex, fills missing metadata, and trims abstracts to 300 characters. Every executed tool reports source successes/failures; upstream error bodies are not returned.
- Long Retry-After values now postpone the shared source instead of retrying prematurely; bounded retries use jitter. Added title lookup and recommendation pagination required by the seven-tool specification.
- Validation: 98 tests, typecheck, lint and bundle build passed. No upstream API calls.

## P3b

- Tests first covered Atom parsing, category-only queries, empty/error feeds, and concurrent slow connections. Implemented arXiv search for recent/category requests with IDs, DOI, dates, authors and abstract.
- The arXiv connection itself runs inside a serialized Durable Object operation, preventing overlap even when a response takes longer than three seconds.
- Validation: 101 tests, typecheck, lint and bundle build passed; documentation was read, no arXiv API request was made.

## P3c

- Wrote failing tests for forum/title/arXiv resolution, official-review filtering, rating summaries, compact/full output and missing ratings, then added OpenReview API v2 and the reviews tool.
- Ambiguous title matches require a forum ID instead of silently selecting one. Only public official reviews contribute to statistics; meta reviews are excluded. Pagination reports truncation.
- Validation: 105 tests, typecheck, lint and bundle build passed. Read the official OpenReview client/documentation only.

## P3d

- Added failing tests for CORE authorization, keyless skip, unrelated-hit rejection and search/get_paper integration, then implemented the adapter.
- get_paper now returns structured paper rows with an oa block. CORE snippets are bounded and identify whether they come from full text or an abstract. No full-text response caching or PDF downloading occurs.
- Validation: 109 tests, typecheck, lint and bundle build passed. CORE documentation endpoint returned 403; fixtures model the documented v3 fields, with live compatibility explicitly unverified.

## P3e

- Read CCF's official copyright/directory notice and ICORE's four-page public usage guidance. No clear redistribution grant was found; recorded links and the conservative decision in venue-data-licence.md.
- Added failing tests for exact/fuzzy lookup, rank provenance, CSV/PDF parsing and download integration. Added the seventh tool and a deploy-time downloader; only synthetic rank records are tracked.
- Inspected official documents outside tests: local parsing extracted 558 CCF rows (552 with DBLP links) and 987 ICORE rows. These downloads and parsed data remain ignored local inspection artifacts, not package contents. PDF extraction of wrapped cells still needs maintainer spot checks before release.
- Validation: 113 tests, typecheck, lint and bundle build passed. No deployment or account changes.

## P5

- Tests first covered sample cardinality/uniqueness, 15-by-40 stratification, year checks, the 90% threshold and the arXiv baseline. Added a deterministic replay runner through real search/adapters, with a hard network-free path.
- Four evaluation-harness tests pass, including replay of 600 explicitly synthetic unit-test cases. This is not the requested empirical acceptance result.
- Blocker: the referenced checkout contains the measurement report and sampling scripts but not the original 600-paper output or recorded title-search responses. Asked for an existing snapshot location. `npm run test:eval` exits 2 and writes `status: unverified`; it does not invent a passing dataset. No live tests or collection ran.
- The original measurement uses ICCV 2023, unlike the roadmap's shorthand “2024 papers”; the validator preserves this explicit original-method exception.

## CI and README

- Added Node 22/24 CI for strict typechecking, ESLint, formatting, 80%-minimum coverage, local Worker execution, package inspection and offline evaluation reporting. Real title-coverage regressions fail CI; an absent snapshot is visibly unverified, and the explicit manual acceptance run fails when it is absent.
- Replaced the placeholder README with source-build setup, key handling, commands, all seven tools, licence findings and precise verification limits. Added consistent formatting; implementation files remain under 400 lines.
- Added real MCP transport calls for all seven tools and an OAuth registration/PKCE/pairing/token/revocation round trip. Fixed the additional three-to-six-author requirement, malformed-JSON caching, transitive deduplication, final-attempt rate-limit penalties, recent sorting/year filtering, Wrangler executable resolution and deployment URL parsing, each after a failing regression.
- Validation: 154 tests passed; statements 93.56%, branches 83.25%, functions 95.37%, lines 94.59%. Strict typecheck, lint, format check, build and local workerd smoke passed. The smoke blocks all outbound network requests.
- Package dry-run contained only seven expected runtime/documentation files (approximately 331 KB packed); no fixtures, credentials, generated account configuration or real ranking table. Official venue documents used for local inspection were removed after the check.
- CI was configured but not run on GitHub. No login, deployment, publishing, push or live upstream test occurred.
