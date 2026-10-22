# Ibid

> *ibidem*, Latin for "in the same place".

**Ibid is a self-hosted MCP server that lets an AI agent search the scholarly
literature through one compact, rate-limit-aware interface.** Each person deploys
their own copy to their own free Cloudflare account with one command, using their
own API keys.

> **Status: pre-alpha. Nothing is runnable yet.** This repository holds the design
> documents and roadmap. The npm package `ibid` is a placeholder until v0.1.0.
> Follow the [roadmap](ROADMAP.md) for progress.

## Why

General web search does a poor job on scholarly metadata. Tools that read arXiv
full text don't answer the questions researchers ask most:

- What are the important papers on this topic, including the very latest preprints?
- Who cites this paper, and what does it build on?
- Who is this researcher, and who do they work with?
- **Is this paper any good?** Where was it published, how highly ranked is the
  venue, and what did the reviewers say?
- Is there a legal open-access copy?

Ibid answers these questions from several sources with **few tools**. The server
fans each query out to the relevant sources, merges and de-duplicates the
results, and returns one compact list. The agent therefore spends fewer tokens
than it would calling several separate source-specific tools.

## Planned features (v0.1)

| Tool | What it answers | Sources |
|---|---|---|
| `search` | Papers on a topic, with filters for year, venue, open access and recency | Semantic Scholar, OpenAlex, arXiv, CORE |
| `get_paper` | Metadata for one paper or a batch, including open-access links | Semantic Scholar, OpenAlex, CORE |
| `paper_links` | Citations, references and related papers | Semantic Scholar |
| `get_author` | A researcher's profile, merging author records that the sources have split | Semantic Scholar, OpenAlex |
| `coauthorship` | Shared papers between researchers | Semantic Scholar, OpenAlex |
| `reviews` | Peer reviews, ratings and decisions | OpenReview |
| `venue` | How a venue is ranked (CCF, ICORE) | Bundled table |

Ibid works alongside other MCP servers rather than replacing them. For example:

- **Reading arXiv full text:** use a paper-reading server. Ibid returns arXiv IDs you can pass to it.
- **Citation formatting, verification and retraction checks:** use a citation server.

## How setup will work

```bash
npx ibid deploy   # deploys to your own Cloudflare account (free tier) and asks for your API keys
npx ibid pair     # prints the connector URL and a one-time pairing code
```

Then add the URL as a custom connector in Claude, or in any client that supports
remote MCP, and enter the pairing code when asked. You don't need a GitHub OAuth
app or a shared server, and your keys stay in your own account.

## Design principles

1. **Self-hosted, with your own keys.** Upstream rate limits (Semantic Scholar allows 1 request per second per key) belong to each user, never to a shared pool.
2. **Few tools, compact output.** Merging happens on the server, not in the agent's context window.
3. **Respect upstream rules.** There is one rate limiter per source, and Ibid never bypasses bot checks or scrapes sites that have no API.
4. **Degrade gracefully.** A slow or rate-limited source is skipped and reported, without failing the whole call.

See [docs/design.md](docs/design.md) for the architecture.

## Acknowledgements

- The pairing-code setup flow is modelled on [moodle-cli](https://www.npmjs.com/package/moodle-cli) (MIT).
- Data comes from [Semantic Scholar](https://www.semanticscholar.org/product/api), [OpenAlex](https://openalex.org), [arXiv](https://info.arxiv.org/help/api/) ("Thank you to arXiv for use of its open access interoperability"), [OpenReview](https://openreview.net) and [CORE](https://core.ac.uk).

## License

[MIT](LICENSE)
