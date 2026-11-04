# Evaluation: openags/paper-search-mcp (2026-11-04)

Question: does [openags/paper-search-mcp](https://github.com/openags/paper-search-mcp) (MIT, 2,984 stars, 30 contributors, last commit 2026-10-02) already do what LitScout plans? Tested from GitHub `main` at commit `cab1b5cc276a` with `uvx`, no keys, Sci-Hub off.

## What it does well

- **Coverage.** 75 papers drawn from the 15-venue sample (5 per venue; 46 of them have no arXiv version) were searched by title with its `fast` source set (OpenAlex, Crossref, arXiv, PubMed, Europe PMC): **74 found**, including 45 of the 46 that are not on arXiv. One answer takes about 4 s and reports `sources_used`, per-source counts and errors.
- **Sources.** 25 connectors: arXiv, PubMed, bioRxiv, medRxiv, Semantic Scholar, Crossref, OpenAlex, PMC, CORE, Europe PMC, dblp, OpenAIRE, CiteSeerX, DOAJ, BASE, Zenodo, HAL, SSRN, OpenReview (papers), Unpaywall, Google Scholar, ACM (through Crossref), and with the user's own keys IEEE Xplore (metadata), Scopus, ScienceDirect full text and Web of Science (the last four not validated against live institutional entitlements, by its own README).
- **Active project:** dozens of fixes in September and October 2026.

## Where it falls short

| Need | State |
|---|---|
| Install from the package index | PyPI has 0.1.4 (2026-07-02), which lacks the documented CLI commands and fails to start under `mcp` 2.x (issue #152); a working setup has to install from GitHub `main` |
| Security | A path traversal in `download_arxiv` is fixed on `main` only partly and in no release; a CVE has been requested (issue #155) |
| Use from claude.ai or a phone | Runs locally (stdio) or over HTTP that you host yourself with TLS and an external OAuth issuer; no hosted path |
| Context cost | 71 tools with about 63,000 characters of schemas, loaded by clients that do not defer tools |
| Lawful by default | Sci-Hub is now opt-in (it was the default until issue #103), but the default `all` source set includes Google Scholar scraping |
| Judgement | OpenReview papers only, reviews and ratings excluded; no venue ranks |
| Watching topics | Searches can sort by date; no saved topics or "new since" |

## What it means for LitScout

Rebuilding a multi-source search engine would duplicate this project. LitScout's plan narrows to what is missing: a hosted remote server for claude.ai and phones, a compact tool set, judgement (reviews, ratings, venue ranks) and `watch`, backed directly by OpenAlex, Semantic Scholar and Crossref. Alternatively, some of this (reviews, venue ranks) could be contributed upstream. Decision for the maintainer.
