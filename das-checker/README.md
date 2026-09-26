# Paper DAS checker

Client-side PDF inspection, with a shared DOM-free module for browsers and Node.js.

- `index.html`: browser page; shared site styles/theme live one directory above.
- `web.js`: file/URL input, progress, and result rendering.
- `core.js`: Data Availability section detection, cited-reference DOI and whitelisted artifact-location link extraction, PDF.js extraction, HTTP checks, DataCite metadata.
- `cli.js`: optional Node CLI; outputs JSON.

## HotCRP integration PoC

See [hotcrp/README.md](hotcrp/README.md) for an opt-in, permission-aware paper-view integration and development-instance installation instructions.

## Browser

Serve the repository root with any static HTTP server; visit `das-checker/`.
PDF.js loads from its pinned CDN version. No build or npm install is needed.
URLs such as `das-checker/?pdf=https%3A%2F%2Farxiv.org%2Fpdf%2F2602.10046` reload automatically.

## Node (22+)

```sh
cd das-checker
npm install
node cli.js paper.pdf
node cli.js paper.pdf --sections=data-availability-statement,reproducibility-statement
node cli.js https://arxiv.org/pdf/2602.10046 --check-links
```

Without `--check-links`, the CLI only extracts; it does not contact DOI services. The `repositoryLinks` array (retained for compatibility) lists links to Zenodo, Figshare, GitHub, GitLab.com, sites.google.com, github.io, and anonymous.4open.science (including subdomains) found in selected sections, resolved references, or footnotes. Root URLs on allowed hosts are also reported (for example, a project-specific `*.github.io/` homepage); these are artifact-location signals, not DOI records or verified replication packages.
With it, up to 30 extracted DOIs are requested and enriched with DataCite metadata.
Remote PDF input always requires a download. Browser CORS restrictions do not apply in Node.

## Reuse

```js
import * as pdfjs from 'pdfjs-dist/legacy/build/pdf.mjs'; // Node
import {analyzePDF, doiURL, checkDOI, fetchDOIMetadata} from './core.js';

const result = await analyzePDF(pdfBytes, {
  pdfjs,
  // Omit sectionIDs to allow all displayed heading forms.
  sectionIDs: ['data-availability-statement', 'data-availability-statement-unhyphenated'],
  onProgress: ({page, total}) => console.error(`${page}/${total}`)
});
for (const record of result.dois) {
  const url = doiURL(record.id);
  const http = await checkDOI(url);
  const metadata = await fetchDOIMetadata(url); // Throws if unavailable
}
```

In a browser, import a PDF.js browser build and configure its `GlobalWorkerOptions.workerSrc` before passing it to `analyzePDF`. The shared module imports no Node or DOM APIs. `analyzePDF` accepts a Uint8Array/ArrayBuffer, copies bytes for PDF.js, cleans up the document, and returns `{pages, hasText, statements, dois, repositoryLinks}` with JSON-serializable provenance.

`checkDOI` returns `{status, ok, url, redirected, error?}`; network failures have `status: null`. Both HTTP helpers accept `{fetchImpl, timeout}` for testing/custom runtimes. Extraction-only helpers (`normalize`, `doiIDs`, `findStatements`, `collectDOIs`, `collectRepositoryLinks`) are also exported; `collectDOIs` internally returns provenance Sets.

`batch.js` stores gzip-compressed PDF.js text and annotation extraction under `.cache/pdf-extraction-v2/`, keyed by conference, source path, size, and modification time. Detector changes can therefore rescan cached extraction without reopening unchanged PDFs. The corpus directory name selects the conference and generated dataset (`fse` → `data/fse.json`, `ase` → `data/ase.json`); an optional fifth argument limits the minimum year, for example `node batch.js ~/private/papers/ase ../.cache/ase-das-counts-current.json 8 2018`. Manually reviewed annotations are maintained in `data/fse-annotations.json` and `data/ase-annotations.json` and merged into the corresponding generated datasets. An annotation with `count_as_artifact: true` and a URL counts toward “With Artifact” only when the paper has a detected DAS, including reviewed links on hosts outside the automatic whitelist; it is still marked as manual evidence and never adds a DOI or a detected URL to the checker output. Other annotations do not affect counts.

Extraction is heuristic, not compliance certification. Bare numeric DAS markers are resolved to uniquely matched numbered URL footnotes (including PDF hyperlink labels); unrelated footnotes and non-whitelisted hosts are excluded. OCR is not included; author–year citations are resolved only when a unique surname/year (and optional year suffix) matches an unnumbered reference. Successful HTTP responses and registry metadata do not verify artifact contents or archival availability. Browser request failures can be CORS rather than broken links.
