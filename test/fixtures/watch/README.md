# `litscout watch` source recordings

Captured on 2026-11-11 UTC without accounts, API keys, cookies or contact
email, with the User-Agent `litscout-watch/0.1 (https://github.com/Eryc123Y/litscout-mcp)`.
They are offline inputs for `test/watch-*.test.ts`; no test touches the network.
Every abstract was replaced with synthetic text (abstracts are not republished);
titles, author names, identifiers, dates and links are as recorded. Bodies are
trimmed to a few records.

- `acl-*.xml`: `data/xml/<year>.<venue>.xml` from acl-org/acl-anthology on
  raw.githubusercontent.com. `acl-2026.tacl.after.xml` is the file at commit
  bdcb7cf (2026-11-06) and `acl-2026.tacl.before.xml` at a75fcdc (2026-10-12),
  each cut to papers 1, 2, 112 (before) and 1, 2, 112, 113, 114 (after); the
  real diff was papers 113 to 118. `acl-2026.acl.xml` keeps two long papers and
  one paper each from the short, demo and student research volumes.
- `github-commits-*.json`: GitHub's commits API for `data/xml/2026.tacl.xml`
  (`since` and `until` 2026-10-20, `per_page=1`), projected to sha, committer
  date and the message's first line.
- `pmlr-proceedings.yaml`: entries of https://proceedings.mlr.press/proceedings.yaml.
  `pmlr-v336-citeproc.yaml`: the first two entries (preface and a paper) of
  COLT 2026's `assets/bib/citeproc.yaml`.
- `datacite-itp.json`: DataCite `GET /dois?query=id:10.4230/lipics.itp.* AND
  created:[2026-06-01 TO *]`, four records (volume, front matter, two papers)
  projected to the fields watch reads. `doi-ra-10.4230.json`: `doi.org/ra/10.4230`.
- `jmlr.xml`: the first four items of https://www.jmlr.org/jmlr.xml.
- OpenReview: the API answered with `ChallengeRequiredError` (403) and no
  challenge was attempted, so `test/watch-openreview.test.ts` uses synthetic
  notes in the API v2 shape.
