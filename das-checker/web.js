import {analyzePDF, checkDOI, fetchDOIMetadata, SECTION_TYPES} from './core.js';

const $ = id => document.getElementById(id);
const PDFJS = 'https://cdnjs.cloudflare.com/ajax/libs/pdf.js/4.10.38';
for (const section of SECTION_TYPES) {
  const label = document.createElement('label');
  const input = document.createElement('input');
  input.type = 'checkbox';
  input.name = 'section-id';
  input.value = section.id;
  input.checked = true;
  label.append(input, ` ${section.label}`);
  $('section-options').append(label);
}

let pdfjsPromise;
function loadPDFJS() {
  return pdfjsPromise ||= import(`${PDFJS}/pdf.min.mjs`).then(pdfjs => {
    pdfjs.GlobalWorkerOptions.workerSrc = `${PDFJS}/pdf.worker.min.mjs`;
    return pdfjs;
  }).catch(error => { pdfjsPromise = null; throw new Error(`Could not load PDF.js. Check your connection and browser support. ${error.message}`); });
}

function node(tag, text) {
  const el = document.createElement(tag);
  el.textContent = text;
  return el;
}
async function showDOIMetadata(url, output) {
  const status = node('p', 'Loading metadata…');
  output.append(status);
  try {
    const meta = await fetchDOIMetadata(url);
    const table = document.createElement('table');
    table.className = 'metadata-table';
    table.setAttribute('aria-label', 'DOI metadata');
    const list = document.createElement('tbody');
    table.append(list);
    const field = (label, value) => {
      if (value === undefined || value === null || !String(value).trim()) return;
      const row = document.createElement('tr');
      const heading = node('th', label);
      heading.scope = 'row';
      const cell = node('td', String(value));
      if (label === 'Registered landing page') {
        try {
          const linkURL = new URL(value);
          if (['https:', 'http:'].includes(linkURL.protocol)) {
            const link = node('a', String(value));
            link.href = linkURL.href;
            link.target = '_blank';
            link.rel = 'noopener noreferrer';
            cell.replaceChildren(link);
          }
        } catch { /* Keep malformed URLs as plain text. */ }
      }
      row.append(heading, cell);
      list.append(row);
    };
    field('Title', meta.titles?.map(t => t.title).filter(Boolean).join('; '));
    field('Creators', meta.creators?.map(c => c.name || [c.givenName, c.familyName].filter(Boolean).join(' ')).filter(Boolean).join('; '));
    field('Publisher / repository', meta.publisher);
    field('Publication year', meta.publicationYear);
    field('Version', meta.version || 'Not explicitly recorded');
    field('Resource type', meta.types?.resourceType || meta.types?.resourceTypeGeneral);
    field('Registered landing page', meta.url);
    field('Rights', meta.rightsList?.map(r => r.rights || r.rightsUri).filter(Boolean).join('; '));
    field('Description', meta.descriptions?.map(d => d.description).filter(Boolean).join('\n').slice(0, 2000));
    status.remove();
    output.append(table);
  } catch (error) {
    status.textContent = `Metadata unavailable: ${error.name === 'AbortError' ? 'request timed out.' : error.message} This does not establish whether the DOI is valid.`;
  }
}
async function requestDOI(url, output) {
  const response = await checkDOI(url);
  if (!response.error) {
    output.replaceChildren();
    if (response.redirected && response.url && response.url !== url) {
      const finalURL = node('a', response.url);
      finalURL.href = response.url;
      finalURL.target = '_blank';
      finalURL.rel = 'noopener noreferrer';
      const destination = node('p', '→ ');
      destination.append(finalURL);
      output.append(destination);
    }
    if (!response.ok) output.append(node('p', `HTTP ${response.status}: request unsuccessful.`));
  } else {
    output.textContent = `Unverified: ${response.error}`;
  }
  await showDOIMetadata(url, output);
}
$('check-form').addEventListener('submit', async event => {
  event.preventDefault();
  const file = $('pdf').files[0];
  const remote = $('pdf-url').value.trim();
  if (!file && !remote) {
    $('error').textContent = 'Choose a PDF file or enter a PDF URL.';
    $('error').hidden = false;
    return;
  }
  const sendRequests = $('request-links').checked;
  const sectionIDs = [...document.querySelectorAll('input[name="section-id"]:checked')].map(input => input.value);
  if (!sectionIDs.length) {
    $('error').textContent = 'Allow at least one section heading.';
    $('error').hidden = false;
    return;
  }
  $('check').disabled = true;
  $('pdf').disabled = true;
  $('pdf-url').disabled = true;
  $('error').hidden = true;
  $('results').hidden = true;
  $('statements').replaceChildren();
  $('dois').replaceChildren();
  $('http-results').replaceChildren();
  $('das-progress').textContent = '⏳';
  $('doi-progress').textContent = '⏳';
  $('http-progress').textContent = '⏳';
  $('http-summary').textContent = 'Waiting for DOI extraction…';
  $('status').textContent = 'Loading PDF.js…';
  try {
    let sourceURL;
    if (!file) {
      sourceURL = new URL(remote);
      if (!['https:', 'http:'].includes(sourceURL.protocol) || sourceURL.username || sourceURL.password) throw new Error('Use an HTTP(S) PDF URL without embedded credentials.');
    }
    const address = new URL(location.href);
    if (sourceURL) address.searchParams.set('pdf', sourceURL.href);
    else address.searchParams.delete('pdf');
    address.searchParams.set('checkLinks', $('request-links').checked ? '1' : '0');
    address.searchParams.set('sections', sectionIDs.join(','));
    history.replaceState(null, '', address);
    const maxSize = 100 * 1024 * 1024;
    let data;
    if (file) {
      if (file.size > maxSize) throw new Error('Please choose a PDF smaller than 100 MB.');
      data = new Uint8Array(await file.arrayBuffer());
    } else {
      $('status').textContent = 'Downloading PDF…';
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), 60000);
      try {
        const response = await fetch(sourceURL.href, {mode:'cors', credentials:'omit', referrerPolicy:'no-referrer', signal:controller.signal});
        if (!response.ok) throw new Error(`HTTP ${response.status}`);
        const reader = response.body.getReader();
        const chunks = [];
        let size = 0;
        while (true) {
          const {done, value} = await reader.read();
          if (done) break;
          size += value.length;
          if (size > maxSize) { controller.abort(); throw new Error('PDF exceeds 100 MB.'); }
          chunks.push(value);
        }
        data = new Uint8Array(size);
        let offset = 0;
        for (const chunk of chunks) { data.set(chunk, offset); offset += chunk.length; }
      } catch (error) {
        throw new Error(`Could not download the PDF (${error.message}). The source may block browser requests (CORS). Download it and use the file upload instead.`);
      } finally { clearTimeout(timer); }
    }
    const pdfjs = await loadPDFJS();
    const analysis = await analyzePDF(data, {pdfjs, sectionIDs, onProgress:({page, total}) => {
      $('status').textContent = `Reading page ${page} of ${total}…`;
    }});
    const {statements, dois:records} = analysis;
    $('das-progress').textContent = statements.length ? '✅' : '⚠️';
    $('das-result').textContent = !analysis.hasText ? 'No extractable text found. This may be a scanned PDF; run OCR and try again. Section presence cannot be determined.' : statements.length ? `${statements.length} candidate artifact section heading(s) detected. Confirm the excerpts and section boundaries below.` : 'No allowed section heading found in extracted text. This is not proof that a statement is absent; inspect the PDF manually.';
    $('das-result').hidden = statements.length > 0;
    for (const statement of statements) {
      const section = document.createElement('section');
      section.append(node('h3', `${statement.sectionLabel} (page ${statement.page})`), node('pre', statement.body || 'No statement text could be extracted.'));
      $('statements').append(section);
    }
    $('doi-progress').textContent = records.length ? '✅' : '⚠️';
    $('doi-summary').hidden = records.length > 0;
    $('doi-summary').textContent = `${records.length} unique artifact-section-linked DOI(s) extracted. ${!records.length ? 'No DOI found in a candidate section or its numbered references. Review manually; author–year citations, other identifiers, or a no-artifacts statement may apply.' : 'Includes only selected sections and their cited numbered references. Confirm these identify specific artifact versions.'}`;
    const jobs = [];
    for (const [index, record] of records.entries()) {
      const item = document.createElement('li');
      const url = `https://doi.org/${record.id.split('/').map(encodeURIComponent).join('/')}`;
      const link = node('a', `https://doi.org/${record.id}`);
      link.href = url;
      link.target = '_blank';
      link.rel = 'noopener noreferrer';
      const output = node('div', !sendRequests ? 'Not requested: HTTP checks disabled.' : index >= 30 ? 'Not requested: 30-DOI limit reached. Open manually.' : 'Queued…');
      item.append(link);
      $('dois').append(item);
      const httpItem = document.createElement('li');
      const progress = node('span', sendRequests && index < 30 ? '⏳ Queued' : '— Skipped');
      progress.hidden = true;
      httpItem.append(link.cloneNode(true), progress, output);
      $('http-results').append(httpItem);
      if (sendRequests && index < 30) jobs.push(async () => {
        progress.textContent = '⏳ Checking…';
        await requestDOI(url, output);
        progress.textContent = '✅ Check finished';
      });
    }
    $('results').hidden = false;
    $('status').textContent = jobs.length ? `Checking ${jobs.length} DOI link(s)…` : 'Analysis complete.';
    // Limit concurrent outbound requests rather than flooding DOI services.
    let next = 0, completed = 0;
    const updateProgress = () => {
      $('http-summary').textContent = jobs.length ? `${completed} of ${jobs.length} HTTP checks finished.${records.length > jobs.length ? ' Remaining links skipped (30-DOI limit).' : ''}` : !sendRequests ? 'HTTP checks disabled.' : 'No DAS-linked DOIs to request.';
      $('http-progress').textContent = !jobs.length ? '—' : completed === jobs.length ? '✅' : '⏳';
    };
    updateProgress();
    await Promise.all(Array.from({length:Math.min(3, jobs.length)}, async () => {
      while (next < jobs.length) {
        await jobs[next++]();
        completed++;
        updateProgress();
      }
    }));
    $('status').textContent = `✅ Done: ${analysis.pages} page(s) analyzed locally. Review all heuristic findings manually.`;
  } catch (error) {
    $('error').textContent = error.name === 'PasswordException' ? 'This PDF requires a password. Choose an unlocked copy.' : `Could not analyze PDF: ${error.message}`;
    $('error').hidden = false;
    $('status').textContent = 'Analysis stopped.';
  } finally {
    $('check').disabled = false;
    $('pdf').disabled = false;
    $('pdf-url').disabled = false;
  }
});
$('pdf').addEventListener('change', () => {
  if ($('pdf').files.length) $('pdf-url').value = '';
});
$('pdf-url').addEventListener('input', () => { $('pdf').value = ''; });
const params = new URLSearchParams(location.search);
if (params.has('checkLinks')) $('request-links').checked = params.get('checkLinks') !== '0';
if (params.has('sections')) {
  const selected = new Set(params.get('sections').split(','));
  for (const input of document.querySelectorAll('input[name="section-id"]')) input.checked = selected.has(input.value);
}
if (params.get('pdf')) {
  $('pdf-url').value = params.get('pdf');
  $('check-form').requestSubmit();
}
