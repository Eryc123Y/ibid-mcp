# Contributing

Read [the design](docs/design.md), [product scope](docs/product.md) and
[build brief](docs/v0.1-build-brief.md) before changing behavior.

- Write a failing test before implementing a change.
- Unit tests must not call upstream networks. Keep live checks in the separate opt-in configuration.
- Never commit keys, contact addresses or account configuration. The CLI generates its configuration locally.
- Every source needs bounded retries, a source limiter, explicit failure reporting and fixture tests.
- Do not bypass bot checks or add unofficial paper scraping. Venue data must follow the documented licence decision.
- Keep the tool surface small. Explain why an existing tool cannot support a proposed addition.

```sh
npm ci --ignore-scripts
npm test
npm run test:coverage
npm run typecheck
npm run lint
npm run build
```

The coverage threshold is 80% for statements, branches, functions and lines.
Empirical title-search coverage is a separate recorded-snapshot gate described in
[eval/README.md](eval/README.md).

Use conventional commits such as `feat: ...`, `fix: ...`, `test: ...` and
`docs: ...`. Publishing and account operations require explicit maintainer action.
