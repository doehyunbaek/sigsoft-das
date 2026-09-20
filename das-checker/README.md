# Paper DAS checker

Client-side PDF inspection, with a shared DOM-free module for browsers and Node.js.

- `index.html`: browser page; shared site styles/theme live one directory above.
- `web.js`: file/URL input, progress, and result rendering.
- `core.js`: Data Availability/Reproducibility section detection, cited-reference DOI extraction, PDF.js extraction, HTTP checks, DataCite metadata.
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

Without `--check-links`, the CLI only extracts; it does not contact DOI services.
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

In a browser, import a PDF.js browser build and configure its `GlobalWorkerOptions.workerSrc` before passing it to `analyzePDF`. The shared module imports no Node or DOM APIs. `analyzePDF` accepts a Uint8Array/ArrayBuffer, copies bytes for PDF.js, cleans up the document, and returns `{pages, hasText, statements, dois}` with JSON-serializable provenance.

`checkDOI` returns `{status, ok, url, redirected, error?}`; network failures have `status: null`. Both HTTP helpers accept `{fetchImpl, timeout}` for testing/custom runtimes. Extraction-only helpers (`normalize`, `doiIDs`, `findStatements`, `collectDOIs`) are also exported; `collectDOIs` internally returns provenance Sets.

`batch.js` stores gzip-compressed PDF.js text and annotation extraction under `.cache/pdf-extraction-v2/`, keyed by conference, source path, size, and modification time. Detector changes can therefore rescan cached extraction without reopening unchanged PDFs. The corpus directory name selects the conference and generated dataset (`fse` → `data/fse.json`, `ase` → `data/ase.json`); an optional fifth argument limits the minimum year, for example `node batch.js ~/private/papers/ase ../.cache/ase-das-counts-current.json 8 2018`. Manually reviewed FSE artifact evidence outside supported headings is maintained in `data/fse-annotations.json` and merged into generated `data/fse.json`.

Extraction is heuristic, not compliance certification. OCR and author–year citation resolution are not included. Successful HTTP responses and registry metadata do not verify artifact contents or archival availability. Browser request failures can be CORS rather than broken links.
