# Round 2 public API recordings

Captured on 2026-11-10 UTC (2026-11-11 local time), without accounts, API keys,
cookies or contact email. Requests were sequential, at least 3.1 seconds apart.
These fixtures are offline regression inputs, not network tests. `url` records
only the public request URL. Bodies are projections, not full wire captures.

- S2: search, batch and author search returned 429; references returned 200,
  with `data[].citedPaper`, extra `citingPaperInfo`, `next`, null PDF metadata
  and both external and top-level corpus IDs. Unused citing-paper metadata
  was removed. The batch POST used `ARXIV:1706.03762` and an invented nonexistent
  DOI (`DOI:10.0000/nonexistent`). No request headers were retained.
- OpenAlex: search, filtered DOI lookup and author search all returned 429,
  limit 1,000, remaining 0; search required 10 credits and filtered lookup 1.
  The bodies were projected to result fields and are empty; error handling
  uses the recorded status and allowlisted quota headers. The initial collector
  made the two additional endpoint probes before acting on the first response's
  long Retry-After; this was a collection mistake. No further OpenAlex requests
  were made. `/rate-limit` separately returned 401 without a key (not committed).
- arXiv: a known ID and a recent cs.CV category query returned 200 Atom feeds.
  Abstract and comment text was removed; namespace/layout, identifiers, titles,
  author names, dates and links remain. Single-entry and repeated-entry parsing
  both work.
- OpenReview: public title search returned 200 with `content.*.value` wrappers
  and unrelated candidate titles. Both forum probes returned 403; the second
  explicitly reported `ChallengeRequiredError`. No challenge was attempted.
  Only note identifiers, invitations, title/venue/ratings/decision fields remain;
  challenge request identifiers and redirect details were removed. Rate headers
  showed ample capacity (search limit 20; notes limit 180).
- CORE was not called because it requires a key.

Successful recorded shapes require no adapter changes. S2 search/batch/author,
OpenAlex successful payloads and OpenReview forum/review payloads remain live
compatibility gaps; synthetic tests do not close these gaps.
