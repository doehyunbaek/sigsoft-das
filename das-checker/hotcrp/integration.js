import {analyzePDF, doiURL, checkDOI, fetchDOIMetadata} from './core.js';

const el = (tag, text) => {
  const element = document.createElement(tag);
  if (text !== undefined) element.textContent = text;
  return element;
};
function link(url) {
  const element = el('a', url);
  element.href = url;
  element.target = '_blank';
  element.rel = 'noopener noreferrer';
  return element;
}
async function download(url) {
  const resolved = new URL(url, location.href);
  if (resolved.origin !== location.origin) throw new Error('Only same-origin HotCRP document downloads are allowed.');
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 60000);
  try {
    // Reuse HotCRP's session and permission-checked document endpoint. No proxy.
    const response = await fetch(resolved, {credentials:'same-origin', redirect:'error', signal:controller.signal});
    if (!response.ok) throw new Error(`PDF download returned HTTP ${response.status}.`);
    const chunks = [];
    let size = 0;
    for await (const chunk of response.body) {
      size += chunk.length;
      if (size > 100 * 1024 * 1024) { controller.abort(); throw new Error('PDF exceeds 100 MB.'); }
      chunks.push(chunk);
    }
    const bytes = new Uint8Array(size);
    let offset = 0;
    for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.length; }
    return bytes;
  } finally { clearTimeout(timer); }
}

export function mount() {
  for (const host of document.querySelectorAll('.das-checker-mount')) {
    if (host.dataset.initialized) continue;
    host.dataset.initialized = 'true';
    const button = el('button', 'Check Data-Availability Statement');
    button.type = 'button';
    button.className = 'btn';
    const status = el('p');
    status.setAttribute('role', 'status');
    const results = el('div');
    host.append(button, status, results);
    button.addEventListener('click', async () => {
      button.disabled = true;
      results.replaceChildren();
      status.textContent = 'Loading PDF locally…';
      try {
        const pdfjs = await import('./pdf.min.mjs');
        pdfjs.GlobalWorkerOptions.workerSrc = new URL('./pdf.worker.min.mjs', import.meta.url).href;
        const bytes = await download(host.dataset.pdfUrl);
        const analysis = await analyzePDF(bytes, {pdfjs, onProgress:({page,total}) => {
          status.textContent = `Reading page ${page} of ${total}…`;
        }});
        results.append(el('h3', 'Data-Availability Statement'));
        for (const statement of analysis.statements) {
          const excerpt = el('p', statement.body);
          excerpt.style.whiteSpace = 'pre-wrap';
          results.append(excerpt);
        }
        if (!analysis.statements.length) results.append(el('p', analysis.hasText ? 'No recognizable DAS heading found. Review the PDF manually.' : 'No extractable text; OCR may be required.'));
        results.append(el('h3', 'DAS-linked DOIs'));
        for (const record of analysis.dois) {
          const row = el('p');
          row.append(link(doiURL(record.id)));
          results.append(row);
        }
        if (!analysis.dois.length) results.append(el('p', 'No DAS-linked DOIs found.'));
        status.textContent = '✅ Local analysis finished. Findings are heuristic, not a submission requirement or review verdict.';
        if (analysis.dois.length) {
          results.append(el('p', 'Optional external checks disclose artifact identifiers and your IP to doi.org, repositories, and DataCite. They may reveal author identities. Do not use if conference confidentiality or anonymity rules prohibit this.'));
          const check = el('button', 'Allow external DOI checks (up to 30)');
          check.type = 'button';
          check.className = 'btn';
          const external = el('div');
          results.append(check, external);
          check.addEventListener('click', async () => {
            check.disabled = true;
            for (const record of analysis.dois.slice(0, 30)) {
              const url = doiURL(record.id);
              const row = el('div');
              row.append(link(url));
              external.append(row);
              const http = await checkDOI(url);
              row.append(el('p', http.error ? `Unverified: ${http.error}` : `HTTP ${http.status} (artifact contents not verified)`));
              if (http.redirected) row.append(link(http.url));
              try {
                const meta = await fetchDOIMetadata(url);
                const table = el('table');
                for (const [label, value] of [
                  ['Title', meta.titles?.map(t => t.title).join('; ')],
                  ['Creators', meta.creators?.map(c => c.name).join('; ')],
                  ['Publisher', meta.publisher], ['Year', meta.publicationYear],
                  ['Version', meta.version], ['Type', meta.types?.resourceTypeGeneral]
                ]) {
                  if (!value) continue;
                  const tr = el('tr'), th = el('th', label);
                  th.scope = 'row';
                  tr.append(th, el('td', String(value)));
                  table.append(tr);
                }
                row.append(table);
              } catch (error) { row.append(el('p', `Metadata unavailable: ${error.message}`)); }
            }
            check.textContent = '✅ External checks finished';
          });
        }
      } catch (error) {
        status.textContent = `DAS check failed: ${error.message}`;
      } finally { button.disabled = false; }
    });
  }
}
