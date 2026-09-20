export function normalize(text) {
  return text.normalize('NFKC').replace(/[\u2010-\u2015\u2212]/g, '-').replace(/\u00ad/g, '');
}
export function doiIDs(text) {
  const found = normalize(text).match(/\b10\.\d{4,9}\/[A-Z0-9._;()/:+\-]+/gi) || [];
  return found.map(value => {
    value = value.replace(/[.,;:]+$/g, '');
    while (value.endsWith(')') && (value.match(/\)/g) || []).length > (value.match(/\(/g) || []).length) value = value.slice(0, -1);
    return value.replace(/[.,;:]+$/g, '').toLowerCase();
  });
}
export const SECTION_TYPES = Object.freeze([
  Object.freeze({id:'data-availability-and-experiment-replication', label:'Data Availability and Experiment Replication', pattern:'data\\s+availability\\s+and\\s+experiment\\s+replication'}),
  Object.freeze({id:'conclusions-and-data-availability', label:'Conclusions and Data Availability', pattern:'conclusions\\s+and\\s+data\\s+availability'}),
  Object.freeze({id:'data-and-code-availability', label:'Data and Code Availability', pattern:'data\\s+and\\s+code\\s+availability'}),
  Object.freeze({id:'data-availability-and-ethics', label:'Data Availability and Ethics', pattern:'data\\s+availability\\s+and\\s+ethics'}),
  Object.freeze({id:'data-availability', label:'Data Availability', pattern:'data\\s+availability'}),
  Object.freeze({id:'data-available', label:'Data Available', pattern:'data\\s+available'}),
  Object.freeze({id:'data-availability-statement', label:'Data-Availability Statement', pattern:'data\\s*-\\s*availability\\s+statement'}),
  Object.freeze({id:'data-availability-statement-unhyphenated', label:'Data Availability Statement', pattern:'data\\s+availability\\s+statement'}),
  Object.freeze({id:'availability-of-data', label:'Availability of Data', pattern:'availability\\s+of\\s+data'}),
  Object.freeze({id:'reproducibility', label:'Reproducibility', pattern:'reproducibility'}),
  Object.freeze({id:'reproducibility-statement', label:'Reproducibility Statement', pattern:'reproducibility\\s+statement'}),
  Object.freeze({id:'replication-package', label:'Replication Package', pattern:'replication\\s+package'}),
  Object.freeze({id:'experimental-artifacts', label:'Experimental Artifacts', pattern:'experimental\\s+artifacts'}),
  Object.freeze({id:'artifact-availability-statement', label:'Artifact Availability Statement', pattern:'artifact\\s+availability\\s+statement'}),
  Object.freeze({id:'artifact', label:'Artifact', pattern:'artifact'}),
  Object.freeze({id:'supplementary-material', label:'Supplementary Material', pattern:'supplementary\\s+material'}),
  Object.freeze({id:'supplementary-material-and-replication-package', label:'Supplementary Material and Replication Package', pattern:'supplementary\\s+material\\s+and\\s+replication\\s+package'})
]);
export const DEFAULT_SECTION_IDS = Object.freeze(SECTION_TYPES.map(section => section.id));

function dominantStyle(runs, start = 0, end = Infinity) {
  if (!Array.isArray(runs) || !runs.length) return null;
  const weights = new Map();
  let offset = 0;
  for (const run of runs) {
    const runStart = offset, runEnd = offset + run.text.length;
    offset = runEnd;
    const overlap = Math.max(0, Math.min(runEnd, end) - Math.max(runStart, start));
    if (!overlap || !run.text.trim()) continue;
    const key = `${run.font}\u0000${run.size}`;
    const current = weights.get(key) || {font:run.font, size:run.size, weight:0};
    current.weight += overlap;
    weights.set(key, current);
  }
  return [...weights.values()].sort((a, b) => b.weight - a.weight)[0] || null;
}

function visuallyDistinctHeading(lines, start, count, headingLength = Infinity) {
  // Synthetic/reused line inputs without typography retain text-only behavior.
  const heading = dominantStyle(lines[start]?.runs, 0, headingLength);
  if (!heading) return true;
  const pageRuns = lines.filter(line => line.page === lines[start].page).flatMap(line => line.runs || []);
  const pageBody = dominantStyle(pageRuns);
  if (pageBody && heading.size < pageBody.size * 0.9) return false;
  let body = headingLength < Infinity ? dominantStyle(lines[start].runs, headingLength) : null;
  for (let i = start + count; !body && i < Math.min(lines.length, start + count + 4); i++) {
    if (lines[i].page !== lines[start].page) break;
    body = dominantStyle(lines[i].runs);
  }
  if (!body) return true;
  const sizeRatio = heading.size / body.size;
  return sizeRatio >= 0.9 && (heading.font !== body.font || sizeRatio >= 1.08);
}

export function findStatements(lines, {sectionIDs = DEFAULT_SECTION_IDS} = {}) {
  const allowed = new Set(sectionIDs);
  const sections = SECTION_TYPES.filter(section => allowed.has(section.id));
  if (!sections.length) return [];
  // Section identifiers seen in proceedings include 7, 7.1, IV, A, and A.1.
  const prefix = '(?:(?:\\d+(?:\\.\\d+)*|[IVX]+|[A-Z](?:\\.\\d+)*?)[.)]?\\s+)?';
  const patterns = sections.map(section => section.pattern).join('|');
  const heading = new RegExp(`^${prefix}(${patterns})\\s*[:.]?$`, 'i');
  const inlineHeading = new RegExp(`^${prefix}(${patterns})\\s*[:.]\\s+(.+)$`, 'i');
  const boundary = /^(?:(?:\d+(?:\.\d+)*|[IVX]+|[A-Z](?:\.\d+)*?)[.)]?\s+)?(?:references|bibliography|acknowledg(?:e)?ments?|appendi(?:x|ces)|conclusions?|discussion|funding|conflicts? of interest|competing interests|author contributions)\b|^(?:\d+(?:\.\d+)*|[A-Z](?:\.\d+)+)[.)]?\s+[A-Z]/i;
  const statements = [];
  for (let i = 0; i < lines.length; i++) {
    let count = 0, section = null, inlineBody = '', extractedHeading = '';
    const firstLine = normalize(lines[i].text).trim();
    const inlineMatch = firstLine.match(inlineHeading);
    if (inlineMatch) {
      count = 1;
      inlineBody = inlineMatch[2];
      extractedHeading = firstLine.slice(0, firstLine.length - inlineBody.length).trim();
      if (!visuallyDistinctHeading(lines, i, count, extractedHeading.length)) continue;
      section = sections.find(candidate => new RegExp(`^(?:${candidate.pattern})$`, 'i').test(inlineMatch[1]));
    } else {
      // Try the longest candidate first so a split "… / Statement" heading
      // is attributed to its independently selectable Statement form.
      for (let n = Math.min(3, lines.length - i); n >= 1; n--) {
        const title = normalize(lines.slice(i, i + n).map(line => line.text).join(' ')).trim();
        const match = title.match(heading);
        if (match && visuallyDistinctHeading(lines, i, n)) {
          count = n;
          section = sections.find(candidate => new RegExp(`^(?:${candidate.pattern})$`, 'i').test(match[1]));
          extractedHeading = lines.slice(i, i + count).map(line => line.text).join('\n');
          break;
        }
      }
    }
    if (!count) continue;
    let end = i + count;
    // Bound the excerpt if no next heading can be recognized.
    while (end < lines.length && end < i + count + 100 && lines[end].page <= lines[i].page + 1 && !boundary.test(normalize(lines[end].text).trim())) end++;
    const bodyLines = lines.slice(i + count, end).map(line => line.text);
    if (inlineBody) bodyLines.unshift(inlineBody);
    statements.push({sectionId:section.id, sectionLabel:section.label, heading:extractedHeading, start:i, end, page:lines[i].page, text:lines.slice(i, end).map(line => line.text).join('\n'), body:bodyLines.join('\n')});
    i += count - 1;
  }
  return statements;
}
export function collectDOIs(lines, annotations, statements) {
  const selected = new Map(), citations = new Set();
  for (const statement of statements) {
    for (let i = statement.start; i < statement.end; i++) selected.set(i, `${statement.sectionLabel || 'Selected section'} excerpt`);
    for (const match of normalize(statement.text).matchAll(/\[([\d\s,;\-]+)\]/g)) {
      for (const part of match[1].split(/[,;]/)) {
        const range = part.trim().match(/^(\d+)(?:\s*-\s*(\d+))?$/);
        if (!range) continue;
        const first = Number(range[1]), last = Number(range[2] || first);
        if (last - first > 100 || last < first) continue;
        for (let n = first; n <= last; n++) citations.add(n);
      }
    }
  }
  // Only resolve numbered entries after a References/Bibliography heading.
  let bibliography = false, current = null;
  lines.forEach((line, index) => {
    const text = normalize(line.text).trim();
    if (/^(?:\d+[.)]?\s+)?(?:references|bibliography)\s*$/i.test(text)) {
      bibliography = true; current = null; return;
    }
    if (!bibliography) return;
    if (/^(?:[A-Z\d]+[.)]?\s+)?appendi(?:x|ces)\b/i.test(text)) { bibliography = false; current = null; return; }
    const entry = text.match(/^\[\s*(\d+)\s*\]\s*/);
    if (entry) current = Number(entry[1]);
    if (citations.has(current)) selected.set(index, `Reference [${current}] cited by selected section`);
  });
  const records = new Map();
  const add = (id, source) => {
    if (!records.has(id)) records.set(id, {id, sources:new Set()});
    records.get(id).sources.add(source);
  };
  for (const [index, source] of selected) {
    const line = lines[index];
    for (const id of doiIDs(line.text)) add(id, `${source}, p. ${line.page}`);
  }
  for (const annotation of annotations) {
    // Page-level proximity is not sufficient: require overlap with selected text.
    const matches = [...selected].filter(([index]) => {
      const line = lines[index], rect = annotation.rect;
      return line.page === annotation.page && rect && line.boxes?.some(box =>
        Math.min(box[2], rect[2]) > Math.max(box[0], rect[0]) &&
        (box[1] + box[3]) / 2 >= rect[1] && (box[1] + box[3]) / 2 <= rect[3]);
    });
    if (!matches.length) continue;
    try {
      const url = new URL(annotation.url);
      if (!['http:', 'https:'].includes(url.protocol) || !['doi.org', 'dx.doi.org', 'www.doi.org'].includes(url.hostname.toLowerCase())) continue;
      for (const id of doiIDs(decodeURIComponent(url.pathname))) {
        for (const [, source] of matches) add(id, `${source}, PDF link p. ${annotation.page}`);
      }
    } catch { /* Ignore malformed or non-DOI links. */ }
  }
  // PDF line wrapping can leave a valid-looking DOI prefix on one line while
  // an annotation or joined reference supplies the complete identifier.
  const values = [...records.values()];
  return values.filter(record => !values.some(other =>
    other !== record && other.id.length > record.id.length && other.id.startsWith(record.id) && /[._;()/:+\-]/.test(other.id[record.id.length])));
}

export function analyzeExtractedPDF(extracted, {sectionIDs = DEFAULT_SECTION_IDS} = {}) {
  const {pages, lines, annotations = []} = extracted;
  const statements = findStatements(lines, {sectionIDs});
  const dois = collectDOIs(lines, annotations, statements).map(record => ({...record, sources:[...record.sources]}));
  return {pages, hasText:lines.length > 0, statements, dois};
}

export async function extractPDF(data, {pdfjs, onProgress = () => {}} = {}) {
  if (!pdfjs?.getDocument) throw new Error("Provide a PDF.js module via {pdfjs}.");
  const task = pdfjs.getDocument({data:new Uint8Array(data), isEvalSupported:false});
  try {
    const pdf = await task.promise;
    const lines = [], annotations = [];
    for (let pageNumber = 1; pageNumber <= pdf.numPages; pageNumber++) {
      onProgress({page:pageNumber, total:pdf.numPages});
      const page = await pdf.getPage(pageNumber);
      const content = await page.getTextContent();
      let text = '', previousY = null, boxes = [], runs = [];
      const flush = () => {
        if (text.trim()) {
          const leading = text.length - text.trimStart().length;
          const trailing = text.trimEnd().length;
          lines.push({text:text.trim(), page:pageNumber, boxes, runs:runs.map(run => ({...run, text:run.text.slice(Math.max(0, leading - run.start), Math.max(0, trailing - run.start))})).filter(run => run.text)});
        }
        text = ''; boxes = []; runs = [];
      };
      for (const item of content.items) {
        if (typeof item.str !== 'string') continue;
        const y = item.transform[5];
        if (previousY !== null && Math.abs(y - previousY) > 3) flush();
        const separator = text && !/\s$/.test(text) && !/^\s/.test(item.str) ? ' ' : '';
        if (separator) {
          const previous = runs.at(-1);
          runs.push({text:separator, start:text.length, font:previous?.font || item.fontName || '', size:previous?.size || Math.hypot(item.transform[2], item.transform[3])});
          text += separator;
        }
        runs.push({text:item.str, start:text.length, font:item.fontName || '', size:Math.hypot(item.transform[2], item.transform[3])});
        text += item.str;
        const x = item.transform[4], height = Math.abs(item.height) || 10;
        boxes.push([x, y - height * 0.2, x + Math.abs(item.width), y + height * 0.8]);
        previousY = y;
        if (item.hasEOL) { flush(); previousY = null; }
      }
      flush();
      for (const annotation of await page.getAnnotations()) {
        if (annotation.url) annotations.push({url:annotation.url, page:pageNumber, rect:annotation.rect});
      }
      page.cleanup();
    }
    return {pages:pdf.numPages, lines, annotations};
  } finally { await task.destroy(); }
}

export async function analyzePDF(data, {pdfjs, onProgress = () => {}, sectionIDs = DEFAULT_SECTION_IDS} = {}) {
  return analyzeExtractedPDF(await extractPDF(data, {pdfjs, onProgress}), {sectionIDs});
}

export function doiURL(id) {
  return `https://doi.org/${id.split('/').map(encodeURIComponent).join('/')}`;
}

// Injectable fetch supports offline tests and both browser and Node runtimes.
export async function checkDOI(url, {fetchImpl = globalThis.fetch, timeout = 12000} = {}) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeout);
  try {
    const response = await fetchImpl(url, {method:'GET', mode:'cors', redirect:'follow', credentials:'omit', referrerPolicy:'no-referrer', signal:controller.signal});
    const result = {status:response.status, ok:response.ok, url:response.url || url, redirected:response.redirected};
    if (response.body) await response.body.cancel();
    return result;
  } catch (error) {
    return {status:null, ok:false, url, redirected:false, error: error.name === 'AbortError' ? 'Request timed out.' : 'Network or browser policy prevented reading the response.'};
  } finally { clearTimeout(timer); }
}

export async function fetchDOIMetadata(url, {fetchImpl = globalThis.fetch, timeout = 12000} = {}) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeout);
  try {
    const id = decodeURIComponent(new URL(url).pathname.slice(1));
    const response = await fetchImpl(`https://api.datacite.org/dois/${encodeURIComponent(id)}`, {
      credentials:'omit', referrerPolicy:'no-referrer', signal:controller.signal
    });
    if (!response.ok) throw new Error(response.status === 404 ? 'No DataCite record found; this DOI may use another registration agency.' : `Metadata service returned HTTP ${response.status}.`);
    const {data} = await response.json();
    if (!data?.attributes) throw new Error('No metadata returned.');
    return data.attributes;
  } finally { clearTimeout(timer); }
}
