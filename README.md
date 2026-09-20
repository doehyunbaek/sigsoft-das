# SIGSOFT Conference Calls

Collect only main research-paper CFPs from [conf.researchr.org](https://conf.researchr.org) and supported conference sites for ICSE, FSE, and ASE. Workshop, industry, artifact, student, journal-first, and participation calls are excluded. Duplicate copies with identical text are removed.

## Usage

Requires [uv](https://docs.astral.sh/uv/) and Python 3.11+.

```sh
# Collect calls from all linked editions
uv run python scrape.py

# Limit the conferences and years
uv run python scrape.py --series ase fse icse --years 2026
```

Results are saved to `data/calls.json` and `data/calls.csv`, including source URLs, call text, and published important dates. The JSON also records edition coverage and fetch errors.

The scraper respects per-host robots rules and crawl delays and caches pages in `.cache/`. It supports `conf.researchr.org` and the ICSE 2019–2021 archive domains (`2019.icse-conferences.org`, `2020.icse-conferences.org`, and `2021.icse-conferences.org`). For ICSE 2020–2021, it checks the Researchr home pages and follows their archive-hosted track links. FSE archives for 2020–2024 (`YYYY.esec-fse.org`), 2018 (`2018.fseconference.org`), and 2019 (`esec-fse19.ut.ee`) are also supported. The independently hosted 2019 edition is an explicit seed because Researchr's series page omits it. Other external domains remain excluded. It detects calls from page headings, tabs, and submission invitations; coverage depends on available links and page structure. Remove `.cache/` to refresh previously fetched pages.

## View the data

Run a local server from this directory:

```sh
uv run python -m http.server 8000
```

Open [http://localhost:8000](http://localhost:8000) to browse `index.html`. Filter by conference, edition year, and track (inferred from page titles when no explicit track is available), search call text and deadlines, and expand results to read full calls. No frontend dependencies or build step are needed.

Serve the page over HTTP; the viewer loads `data/calls.json` automatically. Selected filters are saved in local storage. “View source” uses each record's Wayback snapshot and preserves the CFP section anchor.

### Author counts

Open `authors.html` for searchable, sortable per-author FSE paper and availability-section counts, with a year filter. `data/fse-authors.json` is a compact snapshot of the local FSE accepted-paper metadata (year, DOI suffix, and author names). Availability combines `data/fse.json` with artifact-URL and artifact-evidence entries in `data/fse-annotations.json`, matched by year and DOI suffix and deduplicated per paper. This includes inline listings and unsupported headings; review-only annotations do not add positive counts. Refreshing either source updates the counts automatically. Update the author snapshot when adding papers. Names are grouped exactly; section detection does not verify artifact accessibility, and papers without results still contribute to total papers.

## Wayback snapshots

All 28 current CFP records have `snapshot_url` values reported by Internet Archive's Save Page Now service. To request captures for newly scraped records in a visible browser:

```sh
uv run --with playwright python -m playwright install chromium
uv run --with playwright python archive_browser.py
```

The browser workflow is rate-limited, waits for capture completion, and stops rather than bypassing login or human-verification challenges. Check playback links gently with:

```sh
uv run --with playwright python archive_browser.py --verify
```

## Related resource

- [Artifact Evaluation Calls](https://benhermann.eu/artifact-survey/calls/index.html)

## License

[MIT](LICENSE)
