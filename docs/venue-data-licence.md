# Venue data licence review

Checked 2026-11-11. **Do not redistribute the ranking tables in the repository or npm package.** No clear redistribution permission was found in the official material reviewed. The MIT licence covers LitScout's code, not CCF/ICORE data.

## CCF

Read the [official directory introduction](https://www.ccf.org.cn/Academic_Evaluation/By_category/) and its linked [seventh-edition announcement](https://www.ccf.org.cn/Academic_Evaluation/By_category/2026-03-31/870181.shtml). The directory footer reserves copyright to CCF. The introduction describes the list as guidance for publication venues and cautions against treating venue rank as the quality of an individual paper. It does not grant a licence to redistribute the table.

The introduction links an official downloadable 2026 PDF. The downloader discovers that link on the official page and uses that PDF, not third-party copies. The category HTML pages still carry an older publication date; they must not be silently labelled as the 2026 edition.

## ICORE

Read the [official portal](https://portal.core.edu.au/conf-ranks/) and its linked [Advice on use of the CORE conference rankings, August 2021](https://drive.google.com/file/d/1Wsn_rKeQeAxBJj-Y9IWPNwDNv1J0cuK1). The four-page PDF discusses appropriate research uses and cautions against simplistic evaluation using ranks. It provides no explicit permission to redistribute the database. The portal reserves copyright and provides a public Export button; availability of an export is not itself a redistribution licence.

The downloader uses that public CSV export, with the source edition selected explicitly. No login, bot-check bypass or private endpoint is involved.

## Implementation decision and limits

`litscout deploy` invokes the downloader, writes the parsed table only into the user's private configuration directory, and uploads it to that user's Worker KV namespace. The authenticated venue tool reads that table. No table is bundled, and tests contain only invented venues. Each rank retains its source URL and edition year; downloading a table does not change its edition year.

This follows the build brief's personal-deployment fallback, not a finding that redistribution or every possible use is authorised. If a source cannot be downloaded or parsed, deployment reports the problem, and the venue tool reports missing data. The maintainer must recheck terms and the download format before release, and seek explicit permission before distributing tables.
