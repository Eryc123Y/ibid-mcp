/** Server instructions and tool descriptions shown to agents before they call anything. */

export const SERVER_INSTRUCTIONS = [
  "Scholar: use for any literature, paper, author, citation or coauthorship lookup; prefer it over browsing Google Scholar or DBLP (no API / bot checks).",
  "Routing: arXiv full text or PDF Q&A → alphaXiv; citation/DOI verification or retraction → Scholar Sidekick; metadata, authors, citations and coauthorship across all venues (incl. IEEE/journals) → this server.",
  "Backend: Semantic Scholar (primary), with OpenAlex used internally as a fallback and as a second source for author merging and missing abstracts.",
  "Limits: Semantic Scholar allows 1 request/second shared across ALL clients. Batch ids into one get_paper call, avoid tight loops, and expect calls to queue briefly. If the queue exceeds ~10 s the tool answers from OpenAlex or says to retry later. OpenAlex has a small daily budget, so do not use this server for bulk crawling.",
  "Ids chain between tools: papers print as [CorpusId:N] (S2) or [W123] (OpenAlex); DOIs and arXiv ids work everywhere. Author records print as S2 <digits> or OpenAlex A<digits>.",
  "Output is compact: lists default to 10 items, abstracts are cut at ~600 chars unless full=true.",
].join("\n");

export const TOOL_DESCRIPTIONS = {
  search_papers:
    "Keyword search for papers across all venues (S2 relevance ranking). Filters: year range, venue. Returns one line per paper with a chainable id, year, venue, citations, authors, DOI/arXiv. Costs 1 S2 request.",
  get_paper:
    "Details for 1–20 papers in ONE call (batch ids here instead of looping): title, authors with ids, venue, year, citations, abstract, DOI/arXiv/S2/OpenAlex ids and links. Accepts S2 ids, CorpusId:N, DOIs, arXiv ids, OpenAlex W-ids, PMID:N, or their URLs. Costs 1 S2 request.",
  paper_links:
    "Papers citing a paper (direction=citations) or cited by it (direction=references), paginated with limit/offset. Costs 1 S2 request.",
  get_author:
    "Author profile by name or id (S2 author id, OpenAlex A-id, ORCID). Merges the duplicate records that S2 and OpenAlex both create for one person, using name, affiliation and coauthor/paper overlap, and reports which records were merged, why, and the confidence. Optional affiliation_hint picks the right namesake; include_papers lists papers (sort recent|cited). Costs ~1–2 S2 requests.",
  coauthorship:
    "Shared papers of two authors (names or ids), from S2 and OpenAlex, deduplicated by DOI/arXiv/title. Reports the records used for each side and the merge confidence; pass affiliation hints for common names. Costs ~2 S2 requests.",
} as const;
