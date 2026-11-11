# Offline title-search coverage gate

`npm run test:eval -- path/to/recorded-600.json` replays frozen S2/OpenAlex replies
through the real adapters and `search`. It never falls back to the network.
Exit 0 means at least 540 of 600 titles were found; exit 1 means below 90%; exit 2
means the required recorded snapshot is absent. The machine-readable report is
`.artifacts/coverage-eval.json`.

The reference measurement specifies seed 7, 40 papers from each of 15 venues,
2024 publication years except ICCV 2023 (ICCV runs in odd years). Its reported
arXiv share is approximately 35%; the evaluator recomputes that share from the
sample's `on_arxiv` observations. This is separate from code coverage.

The original repository contains the measurement and collection scripts, but no
600-paper output or S2/OpenAlex title-query recordings were available in this
worktree or that checkout. This build therefore **does not claim 90% real-world
coverage**. Unit tests exercise threshold arithmetic using explicitly synthetic
cases; they are not an acceptance snapshot. No live collection is run by CI.

Expected JSON shape (the real file must contain all 600 unique sampled papers):

```json
{
  "sample": {
    "provenance": {"kind":"recorded","source":"reference measurement URL or archive","seed":7,"recorded_at":"ISO timestamp"},
    "papers": [{"id":"source work ID","title":"actual title","year":2024,"venue":"venue name","on_arxiv":false}]
  },
  "responses": {
    "source work ID": {
      "s2": [{"status":200,"headers":{},"body":{"total":0,"data":[]}}],
      "openalex": [{"status":200,"headers":{},"body":{"meta":{"count":0},"results":[]}}]
    }
  }
}
```

Each response list is the ordered sequence of attempts, including failures and
retries. Preserve missing matches and unsuccessful responses. Strip API keys,
contact addresses and personal account details before committing a snapshot.
The maintainer must supply the original sample and a lawful recorded search
snapshot before the release gate can pass.

Round 2 adds an opt-in resumable collector: `node scripts/record-p5.mjs --record`.
Read [the collection receipt](../docs/p5-round2.md) first for quota, provenance,
local checkpoint paths and the current shortfall. The recorded live quota was
already exhausted, so the 600-paper acceptance result remains unverified.
