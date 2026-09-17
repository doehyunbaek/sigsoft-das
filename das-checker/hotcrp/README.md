# HotCRP integration PoC

Adds an opt-in DAS checker beside the primary submission PDF on HotCRP's paper view. Uses the shared `core.js`; no additional backend or PDF upload service. This is a source patch plus locally served assets, not an upstream-supported plugin.

## Single-container test with `docker run`

Start Docker Desktop (or Docker Engine). From this repository root:

```sh
# Build once; rebuild after source changes. No published image is required.
docker build -f das-checker/hotcrp/docker/Dockerfile -t hotcrp-das-poc .
docker run -d --name hotcrp-das-poc -p 127.0.0.1:8080:80 \
  -v hotcrp-das-demo:/var/lib/mysql hotcrp-das-poc
docker logs -f hotcrp-das-poc
```

Open **http://localhost:8080** after startup. Sign in with `chair@example.test` / `DAS-demo-local-2026!`, create a submission, upload the example PDF, and use the checker in the normal paper view.

This demo image runs MariaDB and Apache together, with the database in a named volume. It is localhost-only and uses known test credentials; do not deploy it publicly. The image has not been built/run here because Docker's daemon was unavailable.

```sh
docker stop hotcrp-das-poc
docker start hotcrp-das-poc
# Remove the container (keeps data):
docker rm -f hotcrp-das-poc
# Optional destructive reset, after removing the container:
docker volume rm hotcrp-das-demo
```

## Alternative: Docker Compose

For separate database/web containers, from this repository root:

```sh
docker compose -f das-checker/hotcrp/docker/compose.yaml up --build -d
# Wait for web and db to be healthy:
docker compose -f das-checker/hotcrp/docker/compose.yaml ps
```

Open **http://localhost:8080** and sign in:

- Email: `chair@example.test`
- Password: `DAS-demo-local-2026!`

Choose **New submission**, enter a title/author, upload [the example PDF](https://arxiv.org/pdf/2602.10046), and save. Open the normal paper view (not Edit), then click **Check Data-Availability Statement**. Expect DOI `10.6084/m9.figshare.31860751.v3`. DOI requests remain separately opt-in. The chair can configure any additional submission requirements through HotCRP settings.

This builds pinned HotCRP with the patch and same-origin PDF.js assets, starts MariaDB, initializes the schema, and seeds a chair account with submissions open for one year. No host PHP/Node/MySQL installation is needed. Email is disabled; use only synthetic/public test papers. Port 8080 is bound to loopback, the database is not exposed, and DB state persists in a named volume. **Known credentials: never deploy this configuration publicly.**

```sh
# Logs / troubleshooting
docker compose -f das-checker/hotcrp/docker/compose.yaml logs -f web db
# Stop (keep submissions/accounts)
docker compose -f das-checker/hotcrp/docker/compose.yaml down
# Reset: permanently deletes this demo's submissions/accounts
docker compose -f das-checker/hotcrp/docker/compose.yaml down -v
```

Re-run `up --build -d` after changing integration code. The build fetches dependencies from GitHub/npm and requires internet access. Docker Compose configuration was validated, but the image/runtime could not be tested here because the Docker daemon was not running.

## Install on an existing development instance

Inspected against HotCRP commit `71dac06a03ac57dc1578c315473f9c1e1a9897b2`.

```sh
npm ci --prefix das-checker
bash das-checker/hotcrp/install.sh /path/to/hotcrp
```

Add to that instance's `conf/options.php`:

```php
$Opt["dasChecker"] = true;
$Opt["scripts"][] = "scripts/das-checker/loader.js";
```

HotCRP's existing `$Opt["scripts"]` hook loads the classic loader, which imports the integration module. The small `papertable.php` patch adds a mount point **after `can_view_pdf` and `viewable_primary_document` checks**. It supplies the existing document URL rather than guessing paper IDs or creating a new download endpoint. The primary document can be a final version when that is what HotCRP displays.

The installer copies pinned PDF.js assets from the existing npm dependency. Nothing loads from a CDN. Serve `.js`/`.mjs` as JavaScript, and ensure your CSP allows same-origin modules and the PDF.js worker. External checks need `connect-src` permission for DOI destinations/DataCite; blocked requests remain unverified.

## Behavior and privacy

1. An authorized user opens a paper's normal view and clicks **Check Data-Availability Statement**.
2. The browser requests the existing same-origin document endpoint with its HotCRP session; the server still enforces access permissions.
3. PDF text is analyzed locally. The panel shows the DAS body and its directly included/cited-reference DOIs.
4. A separate **Allow external DOI checks** button performs up to 30 resolver/metadata lookups. No automatic external checks, result persistence, submission edits, or review-score changes.

PDFs never leave the HotCRP origin during local analysis. External checks and manually opened DOI links disclose identifiers/IP addresses and may expose author identities. Only enable those under the conference's confidentiality/anonymity policy. The PoC does not bypass HotCRP permissions, provide a compliance verdict, or enforce submission rules.

The PoC intentionally rejects redirected PDF downloads (including object-storage redirects) to avoid silently sending authenticated analysis requests elsewhere. Such deployments need a reviewed same-origin download path. Edit/upload pages, automatic rechecks of unsaved uploads, server-side/background processing, and persistent results are not implemented.

## Validation / manual smoke test

The patch was checked against the commit above; the installer and shared extraction were exercised without a live HotCRP database. **A running authenticated HotCRP deployment has not been tested here.**

On a development instance:

- Upload the example `https://arxiv.org/pdf/2602.10046` as a submission.
- As an authorized author/reviewer, open the paper view and run the check. Expect only `10.6084/m9.figshare.31860751.v3`, via DAS reference `[8]`.
- Inspect browser Network: before optional checks, requests should go only to your HotCRP origin. Clicking the external-check button should issue resolver/DataCite requests.
- Test a PDF without a DAS, a scanned PDF, and a malformed PDF; results should not block ordinary HotCRP actions.
- Test an unauthorized account: no checker mount/button should be rendered, and the document endpoint must refuse direct download.
- Confirm the conference's conflict, final-version, and blind-review permission settings with real roles. The panel follows the PDF HotCRP permits that user to view.

Disable by removing the loader option and setting `$Opt["dasChecker"] = false`. To remove the source hook, apply `git apply -R /path/to/hotcrp.patch` in the HotCRP checkout after checking for local changes.
