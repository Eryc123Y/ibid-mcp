# Contributing

Ibid is pre-alpha. Issues and design feedback are welcome now; please open an
issue before starting a large pull request.

## Ground rules

- **Respect upstream terms.** Never add code that bypasses bot checks or CAPTCHAs, or that scrapes sites that have no API.
- **No shared keys.** Tests and examples must never contain API keys. Live tests read keys from environment variables and are opt-in.
- **Keep the tool surface small.** Before adding a new tool, show that extending an existing tool won't do.
- **Every new source** needs a rate limiter entry, a terms-of-use note in `docs/design.md`, and tests that cover the case where the source is skipped.

## Development (once the code lands)

```bash
npm install
npm run typecheck
npm test            # unit tests, no network access
npm run test:live   # opt-in; needs your own keys in the environment
```

Commit messages follow `<type>: <description>`, where type is one of `feat`, `fix`, `refactor`, `docs`, `test`, `chore`, `perf` or `ci`.
