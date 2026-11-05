# LitScout as a product

Status: draft, 2026-11-04. Product framing for the design in [design.md](design.md) and the plan in [ROADMAP.md](../ROADMAP.md). Market figures are a snapshot taken on 2026-11-04 from GitHub and npm; check them again before launch.

## In one sentence

A scholarly-search MCP server that each researcher deploys to their own free Cloudflare account in one command, so any MCP client, including claude.ai on a phone, can ask "what are the important papers on this, and are they any good?" across several sources, using only lawful APIs and the researcher's own keys.

## Who it is for

1. **CS and ML researchers who work with an AI agent every day** (the maintainer is the first user). They need the agent to find papers beyond arXiv, judge them, and keep watching a topic.
2. **People who use Claude on the web or on a phone.** A local stdio server does not reach them; a remote connector does.
3. **Students and staff at universities**, who cannot use tools that fetch from Sci-Hub or scrape Google Scholar.

## Jobs to be done

| Job | Today's workaround | What LitScout does |
|---|---|---|
| Find the important papers on a topic, including the newest preprints | Web search, then arXiv, then Semantic Scholar, by hand | One `search` across sources, merged and ranked |
| Judge a paper: venue, venue rank, reviews | Open OpenReview and a ranking list separately | `reviews` and `venue` |
| Follow citations and an author's work | Semantic Scholar's site | `paper_links`, `get_author`, `coauthorship` |
| Find a legal free copy | Unpaywall, CORE, the author's page | `oa` block in `get_paper` |
| See what is new on my topics this week (v0.2) | A daily arXiv digest that misses journals | `watch`, which a digest such as daily-arXiv can read |

## Why arXiv alone is not enough

Measured on 600 random 2024 papers from 15 venues ([daily-arXiv measurement](https://github.com/Eryc123Y/daily-arXiv-ai-enhanced/blob/main/docs/measurements/arxiv-coverage.md)): 62-85% of NeurIPS, CVPR and ICCV papers are on arXiv, but only 38-50% of IEEE TPAMI, TIP and ACM TOG, 28-30% of ICASSP, ICIP and IEEE TVCG, 8-10% of IEEE TCSVT and Elsevier's ML journals, and none of Journal of Vision. A tool that reads arXiv well still misses most journal work, which is where much of applied vision, graphics and perception research appears.

## The market (2026-11-04)

| Project | Stars | What it does | Gap LitScout fills |
|---|---|---|---|
| [openags/paper-search-mcp](https://github.com/openags/paper-search-mcp) | 2,984 | Python; search and download from 20+ sources (arXiv, PubMed, Semantic Scholar, OpenAlex, Crossref, CORE, dblp, OpenReview, Google Scholar, …); stdio, SSE or HTTP with optional OAuth you set up yourself; optional Sci-Hub fallback | No hosted path for non-developers; Sci-Hub and Google Scholar make it hard to recommend at a university; no venue or review judgement |
| [blazickjp/arxiv-mcp-server](https://github.com/blazickjp/arxiv-mcp-server) | 3,253 | Local arXiv search and reading (LaTeX sections, BibTeX) | arXiv only; a complement, not a rival |
| [JackKuo666/Google-Scholar-MCP-Server](https://github.com/JackKuo666/Google-Scholar-MCP-Server) and similar | 430 and less | Google Scholar through scraping | Breaks on bot checks; terms of service |
| [45645678a/Scholar-mcp](https://github.com/45645678a/Scholar-mcp) | 95 | Local, 9 sources, PDF download including Sci-Hub, AI analysis | Same legal problem; local only |
| Single-source servers on npm (Semantic Scholar, OpenAlex: at least a dozen) | small | One API each | The agent has to call and merge several |
| alphaXiv, Hugging Face, Scholar Sidekick connectors | hosted | Reading arXiv papers, trending papers, citation checks | Different jobs; LitScout hands them arXiv IDs and DOIs |

**What this means.** "Multi-source paper search over MCP" is not new, and the leader has four times LitScout's planned sources. LitScout should not compete on the number of sources. It wins on:

1. **Hosted for you, by you.** One command to a free Cloudflare account and a pairing code; it works as a remote connector in claude.ai, on phones and in any remote-MCP client, with no TLS, OAuth issuer or always-on machine to run.
2. **Judgement, not just lists.** Reviews, ratings and decisions from OpenReview and venue ranks next to every result.
3. **Lawful by design.** No Sci-Hub, no scraping, no bot-check bypass; the user's own keys and limits. Safe to recommend in a lab or a course.
4. **Few tools, compact answers.** Merging and de-duplication on the server, so the agent's context stays small.

## Name

The project was first called Ibid and was renamed **LitScout** on 2026-11-04 (package `litscout`, repository `litscout-mcp`), before any release. Reasons against the old name:

- "Ibid" means "the same source as the last citation", the opposite of "many sources".
- APA and other common styles have dropped it, so many younger researchers and non-English speakers do not know it.
- It is hard to find: 91 GitHub repositories have "ibid" in the name, including a long-lived chat bot, and the word appears in millions of footnotes.

Names checked on 2026-11-04 (npm name free; GitHub repositories whose name contains it): LitScout (free, 15 small), CiteScout (free, 4; may suggest citation formatting), Peerscope (free, 8; fits judgement more than search), Scholarmesh (free, 7; descriptive but flat). LitScout says what it does and is easy to say in English and Chinese.

## Success measures

The server keeps no query logs or telemetry ([design.md](design.md) §7), so measures come from public signals and from evals in the repository.

| Measure | How | Target for v0.1 (first 8 weeks after release) |
|---|---|---|
| Time from `npx … deploy` to the first answer in Claude | Timed on a clean Cloudflare account, in CI where possible | under 10 minutes |
| Coverage beyond arXiv | Re-run the 600-paper venue sample: share found by `search` on title | 90% or more, against about 35% on arXiv |
| Duplicate rate in `search` | Labelled sample of 50 queries | under 2% of results |
| Adoption | npm weekly downloads, GitHub stars, issues from people who deployed it | 100 weekly downloads, 3 outside issues |

## Plan

Ranked by ICE (impact, confidence, ease; 1-10 each).

| Stage | Item | I | C | E | ICE |
|---|---|---|---|---|---|
| v0.1 | As in ROADMAP.md P0-P4 (bring in the prototype, pairing-code auth, CLI, per-source limiter, arXiv, OpenReview, CORE, venue table, release) | 9 | 8 | 4 | 2.9 |
| v0.1 | Coverage eval in CI (the venue sample above as a fixture) | 6 | 8 | 7 | 3.4 |
| v0.2 | `watch`: new papers since a date for saved topics, authors or venues; [daily-arXiv](https://github.com/Eryc123Y/daily-arXiv-ai-enhanced) reads it | 8 | 7 | 6 | 3.4 |
| v0.2 | Crossref as a fallback for DOI-only journal works that Semantic Scholar and OpenAlex miss | 5 | 7 | 7 | 2.5 |
| v0.2 | DBLP pack, Europe PMC (already planned) | 5 | 7 | 5 | 1.8 |
| v0.3 | Publisher full text with the user's own entitlements: Elsevier (ScienceDirect, Scopus), IEEE Xplore, Springer Nature; only after each provider's text-and-data-mining terms are checked and allow it; text returned to the agent, never stored | 7 | 4 | 3 | 0.8 |

Publisher full text scores low on confidence because the terms decide it: most providers allow text mining for non-commercial research with a registered key, but limit storing, redistribution and in some cases processing by third-party AI services. It is a real gap no free tool fills, so it stays on the plan, gated on reading the terms.

## Launch

- Before v0.1: reserve the npm name `litscout` (`npm login`, then publish the placeholder).
- At v0.1: a 30-second demo GIF (deploy, pair, a query in claude.ai), listings in the official MCP registry, Smithery, Glama and awesome-mcp-servers; one post each on r/MachineLearning and X; a Chinese write-up on Zhihu or Xiaohongshu.
- Support budget: the maintainer's time is the constraint. Issues are triaged weekly; features beyond the plan wait for v0.3.

## Risks

- **Upstream limits and policy.** Semantic Scholar's 1 request per second per key and OpenAlex's daily credits may change; the per-source limiter and `sources_skipped` keep answers honest.
- **Cloudflare free tier.** Durable Objects, KV and Worker limits must hold for one person's use; confirm on the current pricing page before release.
- **Maintenance load.** It is a side project; keep the scope to the plan above.
- **Timing.** The maintainer's time comes in blocks; v0.1 is planned as one block of about two weeks.

## Open decisions

| # | Decision | Blocking |
|---|---|---|
| 1 | ~~Keep "LitScout" or rename~~ Renamed to LitScout on 2026-11-04; reserve `litscout` on npm next | done |
| 2 | ~~Positioning~~ Decided 2026-11-04: build LitScout as its own product, with openags/paper-search-mcp as the reference; match its coverage and do well what it lacks (hosted, working releases, compact, lawful by default, judgement, watching). See [evaluation-paper-search-mcp.md](evaluation-paper-search-mcp.md) | done |
| 3 | ~~When to build v0.1~~ Decided 2026-11-05: build v0.1 from 2026-11-16 | done |
| 4 | ~~Keep publisher full text (v0.3) on the plan, gated on terms~~ Decided 2026-11-05: keep it, gated on each publisher's text-and-data-mining terms | done |
