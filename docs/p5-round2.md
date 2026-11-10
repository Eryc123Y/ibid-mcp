# Round 2 P5 collection receipt

2026-11-11 local date (2026-11-10 UTC). **Unverified: no sample or title score
was obtained.** This is a collection blocker, not a measured 0% search result.
The evaluator and title matcher have not been changed or tuned.

## Budget checked before collection

The current [OpenAlex pricing example](https://help.openalex.org/access/example-costs/)
says search costs 10 credits, list/filter costs 1, and the keyless allowance is
$0.10 = 1,000 credits/day. Thus title searches alone need 6,000 credits; sample
source discovery adds up to 110 and 15 draws add 15. Strictly below 80% permits
at most 79 searches on an otherwise unused day, before sampling costs.

Actual compatibility replies reported `x-ratelimit-limit: 1000`, remaining `0`,
search credits required `10`, and a reset at approximately
2026-11-11T00:00:00Z. The separate quota-status endpoint requires a key (401).
No key, contact email, login or alternate IP was used. The P5 collector consumed
**zero additional requests or credits**, respecting the recorded Retry-After.
The exhausted shared-IP allowance predates P5; its cause is not known.

## Provenance and differences

Read the reference checkout's `docs/measurements/arxiv-coverage.md`, `venues.py`
and `verify.py` without editing them. No saved 600-paper output exists there.
The collector records SHA-256 hashes of those three inputs locally.

The supplied reconstruction uses the same venue source selection (sort the first
five source search hits by works count, prefer the original 25-character title
prefix), fixed source IDs, 40-paper OpenAlex draws, seed 7, and years (ICCV 2023;
others 2024). ICML, ICLR and JMLR stay excluded. It rejects incomplete, untitled,
wrong-year or duplicate draws; it never silently replaces a paper.

Differences that must accompany any later result:

- A new OpenAlex database draw cannot be proven identical to the unavailable
  original output, even with the same seed. It records the current draw and
  source IDs, never labels it the original sample.
- arXiv verification executes the read-only original verifier in batches by venue,
  changing only HTTP to HTTPS. Original title normalization, first twelve words,
  `SequenceMatcher > 0.9`, retries and three-second spacing are retained. Unknown
  checks stay unknown and block a valid acceptance sample.
- Title-query collection interleaves venues and can span days because of quota.
  It replays the production adapters' actual queries and retry sequences, strips
  abstracts from stored search results, and retains statuses and quota headers.
  The original measurement did not record these S2/OpenAlex search replies.
- This run stopped before any draw; consequently **600 sample papers, 600 arXiv
  observations and all 1,200 source/title query sequences remain missing**.

## Per-venue score

| Venue | Required year | Sampled / required | Title score |
|---|---:|---:|---|
| CVPR | 2024 | 0 / 40 | Not measured |
| NeurIPS | 2024 | 0 / 40 | Not measured |
| ACL | 2024 | 0 / 40 | Not measured |
| TPAMI | 2024 | 0 / 40 | Not measured |
| TIP | 2024 | 0 / 40 | Not measured |
| TCSVT | 2024 | 0 / 40 | Not measured |
| TVCG | 2024 | 0 / 40 | Not measured |
| ACM TOG | 2024 | 0 / 40 | Not measured |
| Pattern Recognition | 2024 | 0 / 40 | Not measured |
| Neurocomputing | 2024 | 0 / 40 | Not measured |
| Neural Networks | 2024 | 0 / 40 | Not measured |
| ICASSP | 2024 | 0 / 40 | Not measured |
| ICIP | 2024 | 0 / 40 | Not measured |
| Journal of Vision | 2024 | 0 / 40 | Not measured |
| ICCV | 2023 | 0 / 40 | Not measured |
| **Overall** | | **0 / 600** | **Not measured; 90% target unverified** |

## Local artifacts and resuming

Ignored, outside git but inside this worktree: `.artifacts/p5/state.json`,
`reference-hashes.json`, `recorded-600.json` and `collection-status.json`.
The snapshot is a truthful incomplete checkpoint (empty papers/responses), not
an acceptance fixture. No full snapshot was committed.

`npm run test:eval -- .artifacts/p5/recorded-600.json` was run and exited **1**
at `Expected 600 sampled papers`, before scoring. This existing validation-error
path does not write an evaluation report. It must not be confused with exit 1
for an actually scored snapshot below 90%. No score was manufactured to satisfy
that gate.

After the provider reset, from this worktree:

```sh
node scripts/record-p5.mjs --record
npm run test:eval -- .artifacts/p5/recorded-600.json
```

Without `--record`, the command only prints its plan. It checkpoints every draw
and response, uses no keys/email, serializes each source, limits OpenAlex usage
strictly below 80% and stops when the shared IP has too little quota. Resume on
later UTC days as necessary. Three consecutive S2 title queries that exhaust
retries also stop the run. Existing completed attempts are retained as observed;
responses are never invented for missing calls. Review `collection-status.json`
and all per-venue counts before reporting coverage. Only commit a complete,
scrubbed snapshot if it is below approximately 5 MB; otherwise retain it here.

Validation so far covers budget boundaries, source selection and draw rejection
with invented data, plus the real recorded quota-stop path. The successful live
end-to-end collection path remains unexercised because of quota.
