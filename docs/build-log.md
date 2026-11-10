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
