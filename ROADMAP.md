# Roadmap

## v0.1.0: first usable release

The work is test-driven, with a target of at least 80% coverage.

| Phase | Work | Estimate |
|---|---|---|
| P0 | Bring in the existing prototype code (5 tools, the S2 limiter, author merging, 75 tests), with personal identifiers removed | 0.5 day |
| P1 | Pairing-code auth: the `PairingStore` Durable Object, the code-entry approval page and the `/admin/*` routes | 1.5 days |
| P2 | CLI: `deploy`, `pair`, `clients`, `revoke`, `status`, `keys` and `destroy`, with the Worker bundled in the npm package | 2 days |
| P3a | A per-source `SourceLimiter`, plus fan-out in `search` with partial-failure reporting | 1 day |
| P3b | arXiv adapter (recent preprints and category listings) | 0.5 day |
| P3c | OpenReview adapter and the `reviews` tool | 1 day |
| P3d | CORE adapter (open-access links and snippets) | 1 day |
| P3e | Venue ranking table and the `venue` tool, after checking that the data may be redistributed | 0.5–1 day |
| P4 | README quickstart, CI, a test deploy on a clean Cloudflare account, and publishing to npm | 1 day |

Still open: whether to support Semantic Scholar without a key. It would be slow,
at 1 request every 3 s.

## v0.2: backlog

- **DBLP pack:** a monthly GitHub Action builds compact shards from the CC0 `dblp.xml.gz` dump. `ibid deploy --with-dblp` loads them into the user's R2 bucket. This adds author disambiguation and complete venue tables of contents.
- **Europe PMC:** full-text search in open-access life-science and chemistry articles, plus preprints.
- Optional OpenAlex `mailto` opt-in, and per-tool output presets.
