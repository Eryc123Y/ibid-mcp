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
