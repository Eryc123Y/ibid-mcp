# Round 2 venue parser spot-check

Checked 2026-11-11 local time. **40 rows checked: 36 passed before the fix;
40 passed after it.** This is a targeted extraction check, not an exhaustive
accuracy estimate or a licence to redistribute the tables.

## Sources and method

Downloaded again from the [CCF directory](https://www.ccf.org.cn/Academic_Evaluation/By_category/)
and the [official ICORE2026 CSV export](https://portal.core.edu.au/conf-ranks/?search=&by=all&source=ICORE2026&sort=atitle&page=1&do=Export).
Both returned HTTP 200. The CCF PDF was discovered through the directory link;
no DBLP endpoint was queried.

- CCF PDF SHA-256: `271b630b576bf8a4f802e767f5694caded93680e22b3a19bef7902591c45c1d3`.
- ICORE CSV SHA-256: `607cb795bfadb47dbeab7db6ab91f96e5a5aef0c76fef1ec0d221926d7402242`.
- Parsed with the shipped `parseCcfPdf` and `parseIcore`: **558 CCF rows and
  987 ICORE rows** before and after. CCF still has 552 DBLP stream keys.
- Compared title, acronym, rank, edition and DBLP presence/key against source
  cells for 30 CCF rows and 10 ICORE rows. PDF text was extracted independently
  with Poppler; complex layouts on pages 5, 45, 49 and 69 were also rendered and
  visually inspected. CSV cells were checked directly, including quoted commas,
  historic names and an entry marked inactive in the source.
- Titles and acronyms were compared ignoring whitespace between PDF fragments;
  punctuation, historic-name text and substantive words were retained. Blank
  acronyms and missing DBLP links were checked explicitly.

Files and complete audit expectations remain only in the ignored
`.artifacts/round2/` directory: `source-1.pdf`, `source-2.csv`, `downloads.json`,
`ccf-fixed.json`, `icore.json`, `audit.mjs`, `audit40.json`, and rendered pages.
None of these downloads, parsed tables or real ranking fixtures are committed.

## What failed and changed

The old parser estimated column boundaries from header text positions. Centered
publisher names can start left of those positions; long acronyms can extend
right of them. This polluted titles or moved an acronym's closing parenthesis
into the title.

The PDF reader now obtains the actual cell rectangles from drawing operations,
transforms them into text coordinates, and uses the header cells' column edges.
The previous text-only fallback remains for documents without usable cell bounds.
Small invented fixtures cover publisher fragments, a three-line renamed title,
a long former acronym and the PDF coordinate transform; the first regression
failed before the implementation and passed afterwards.

Within the 40-row audit, corrected entries were ACM SIGOPS ATC, CVMJ, Briefings
in Bioinformatics and EITEE. A whole-file before/after comparison changed the
name/acronym fields of **26 CCF records** while preserving row counts, ranks,
editions and DBLP keys. The additional changed rows were not all independently
labelled as part of the 40-row audit; that count is a parser-diff observation,
not an extra accuracy claim. ICORE required no parser change.

## Audit locations

CCF pages are 1-based PDF pages (including the cover); rows are printed table
row numbers. ICORE locations are CSV record numbers, followed by source record
IDs. This log identifies audited records without reproducing ranking cells.
“Fixed” means failed before, passed after; “Pass” means passed both times.

| Source location | Entry | Result |
|---|---|---|
| CCF p2 row1 | TOCS | Pass |
| CCF p2 row2 | TOS | Pass |
| CCF p2 row3 | TCAD | Pass; wrapped title |
| CCF p2 row4 | TC | Pass |
| CCF p2 row5 | TPDS | Pass |
| CCF p2 row6 | TACO | Pass |
| CCF p3 row1 | TAAS | Pass |
| CCF p3 row5 | TVLSI | Pass; wrapped title |
| CCF p3 row8 | Parallel Computing | Pass; blank acronym |
| CCF p3 row9 | Performance Evaluation | Pass; blank acronym |
| CCF p5 row1 | PPoPP | Pass; wrapped title |
| CCF p5 row4 | HPCA | Pass; wrapped title |
| CCF p5 row9 | ACM SIGOPS ATC, formerly USENIX ATC | Fixed; acronym punctuation |
| CCF p5 row11 | HPDC | Pass; wrapped title |
| CCF p19 row9 | HCC | Pass; no DBLP stream link |
| CCF p34 row4 | Discover Computing, formerly IR | Pass; renamed journal |
| CCF p45 row1 | TOMM | Pass; wrapped title/link |
| CCF p45 row5 | TCSVT | Pass; wrapped title/link |
| CCF p45 row6 | JASA | Pass; no DBLP stream link |
| CCF p45 row9 | CVMJ | Fixed; former publisher excluded |
| CCF p49 row2 | CASAXR, formerly CASA | Pass; renamed conference |
| CCF p49 row7 | CAD/Graphics | Pass; wrapped title/link |
| CCF p68 row1 | Briefings in Bioinformatics | Fixed; publisher excluded |
| CCF p68 row2 | Cognition | Pass; no DBLP stream link |
| CCF p68 row15 | BCRA | Pass; DBLP search URL is not a stream key |
| CCF p69 row6 | IET Intelligent Transport Systems | Pass; no DBLP stream link |
| CCF p69 row12 | EITEE, formerly FITEE | Fixed; publisher fragment excluded |
| CCF p69 row14 | IEEE Transactions on Reliability | Pass; blank acronym |
| CCF p69 row15 | HEALTH | Pass; wrapped link |
| CCF p69 row16 | ACM DLT | Pass; long title/wrapped link |
| ICORE record882 / id1629 | AAAI | Pass |
| ICORE record4 / id2354 | AIES | Pass; quoted comma |
| ICORE record107 / id196 | ACL | Pass |
| ICORE record265 / id604 | CVPR | Pass |
| ICORE record617 / id1121 | ICML | Pass |
| ICORE record76 / id98 | NeurIPS, formerly NIPS | Pass; historic name preserved |
| ICORE record953 / id1838 | USENIX | Pass; source historic name preserved |
| ICORE record36 / id38 | SIGGRAPH | Pass |
| ICORE record31 / id32 | ISCA | Pass |
| ICORE record3 / id2264 | HCOMP | Pass |

All six CCF records without direct DBLP stream URLs were checked. The source
contains publisher links or a DBLP search URL; the parser correctly leaves their
stream keys unknown. No links were invented. ICORE's CSV has no DBLP field.
Differences between CCF's renamed venues and ICORE's older names remain separate
records unless full names agree; this audit does not add an alias database.
The redistribution decision in [venue-data-licence.md](venue-data-licence.md)
remains unchanged.
