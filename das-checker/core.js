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
  Object.freeze({id:'data-availability', label:'Data Availability', pattern:'data\\s+availability'}),
  Object.freeze({id:'data-availability-statement', label:'Data-Availability Statement', pattern:'data\\s*-\\s*availability\\s+statement'}),
  Object.freeze({id:'data-availability-statement-unhyphenated', label:'Data Availability Statement', pattern:'data\\s+availability\\s+statement'})
]);
export const DEFAULT_SECTION_IDS = Object.freeze(SECTION_TYPES.map(section => section.id));

// Allowed artifact-location hosts; a link is a proxy, not proof of an artifact.
const ARTIFACT_HOSTS = [
  'zenodo.org',
  'figshare.com',
  'github.com',
  'gitlab.com',
  'sites.google.com',
  'github.io',
  'anonymous.4open.science'
];

// IEEE PDFs often encode small-cap words as "D ATA A VAILABILITY". Collapse
// those visual-word fragments only while matching headings; output retains the
// exact text extracted from the PDF.
function headingText(text) {
  return normalize(text).replace(/\b([A-Z])\s+([A-Z]{2,})\b/g, '$1$2');
}

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

// TODO: Reject body-text sentence endings that look like headings. ASE 2025/11334384.pdf
// has "... higher / data availability." in ordinary paragraph font; the next
// line starts "C. System demonstration", not a Data Availability section.
// Compare heading style/position with preceding body lines rather than relying
// on an exact heading-text match alone.
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
  const boundary = /^(?:(?:\d+(?:\.\d+)*|[IVX]+|[A-Z](?:\.\d+)*?)[.)]?\s+)?(?:references|bibliography|acknowledg(?:e)?ments?|appendi(?:x|ces)|conclusions?|discussion|funding|conflicts? of interest|competing interests|author contributions)\b|^(?:\d{1,2}(?:\.\d+)*|[A-Z](?:\.\d+)+)[.)]?\s+[A-Z]/i;
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
        const extractedTitle = normalize(lines.slice(i, i + n).map(line => line.text).join(' ')).trim();
        const title = headingText(extractedTitle);
        const match = title.match(heading);
        const smallCaps = title !== extractedTitle;
        if (match && (smallCaps || visuallyDistinctHeading(lines, i, n))) {
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
    while (end < lines.length && end < i + count + 100 && lines[end].page <= lines[i].page + 1 && !boundary.test(headingText(lines[end].text).trim())) end++;
    const bodyLines = lines.slice(i + count, end).map(line => line.text);
    if (inlineBody) bodyLines.unshift(inlineBody);
    statements.push({sectionId:section.id, sectionLabel:section.label, heading:extractedHeading, start:i, end, page:lines[i].page, text:lines.slice(i, end).map(line => line.text).join('\n'), body:bodyLines.join('\n')});
    i += count - 1;
  }
  return statements;
}
function authorYearCitations(text) {
  const found = new Set();
  for (const match of normalize(text).matchAll(/\[\s*([A-ZÀ-ÖØ-öø-ÿ][A-Za-zÀ-ÖØ-öø-ÿ'’\-]+)\s+(?:et\s+al\s*\.?|and\s+[A-ZÀ-ÖØ-öø-ÿ][A-Za-zÀ-ÖØ-öø-ÿ'’\-]+)?\s*\.?\s*,?\s*((?:19|20)\d{2})([a-z](?:\s*,\s*[a-z])*)?\s*\]/gi)) {
    const surname = match[1].toLowerCase(), year = match[2];
    const suffixes = match[3] ? match[3].split(/\s*,\s*/) : [''];
    for (const suffix of suffixes) found.add(`${surname}:${year}${suffix}`);
  }
  return found;
}

function selectedLines(lines, statements, annotations = []) {
  const selected = new Map(), citations = new Set(), authorYears = new Set();
  for (const statement of statements) {
    for (let i = statement.start; i < statement.end; i++) selected.set(i, `${statement.sectionLabel || 'Selected section'} excerpt`);
    // Truncated extracts can absorb the next section and its unrelated citations.
    const citationText = statement.body.split(/\b(?:acknowledg(?:e)?ments?|related work|motivation|references)\b/i)[0];
    for (const citation of authorYearCitations(citationText)) authorYears.add(citation);
    for (const match of normalize(citationText).matchAll(/\[([\d\s,;\-]+)\]/g)) {
      for (const part of match[1].split(/[,;]/)) {
        const range = part.trim().match(/^(\d+)(?:\s*-\s*(\d+))?$/);
        if (!range) continue;
        const first = Number(range[1]), last = Number(range[2] || first);
        if (last - first > 100 || last < first) continue;
        for (let n = first; n <= last; n++) citations.add(n);
      }
    }
  }
  // Resolve bare numeric markers only to numbered URL footnotes (or a linked
  // footnote label), never to arbitrary URLs or numbered bibliography entries.
  for (const statement of statements) {
    const text = statement.body.split(/\b(?:acknowledg(?:e)?ments?|related work|motivation|references)\b|Proc\. ACM Softw\. Eng\./i)[0];
    const markers = [...text.matchAll(/(?:^|[\s,.;])(\d{1,2})(?=\s*(?:[,.;]|$|and\b|as\b|for\b|in\b|is\b|II\b))/g)].map(match => Number(match[1]));
    for (const marker of new Set(markers)) {
      const candidates = lines.flatMap((line, index) => {
        if (!new RegExp(`^${marker}\\s+`).test(line.text) ||
          (line.runs?.length && (line.runs.length < 3 ||
            line.runs[0].size >= line.runs.find(run => run.start > String(marker).length)?.size))) return [];
        if (!new RegExp(`^${marker}\\s+(?:https?:\\/\\/|[^\\n]{1,45}?\\s+https?:\\/\\/)`, 'i').test(line.text) &&
          !annotations.some(annotation => annotation.page === line.page && annotation.rect && line.boxes?.some(box =>
            Math.min(box[2], annotation.rect[2]) > Math.max(box[0], annotation.rect[0]) &&
            (box[1] + box[3]) / 2 >= annotation.rect[1] && (box[1] + box[3]) / 2 <= annotation.rect[3] &&
            /^https?:\/\//i.test(annotation.url)))) return [];
        return [{index, distance:Math.abs(line.page - statement.page)}];
      });
      const closest = Math.min(...candidates.map(candidate => candidate.distance));
      const matches = candidates.filter(candidate => candidate.distance === closest);
      if (matches.length !== 1) continue;
      const {index} = matches[0], source = `Footnote ${marker} cited by selected section`;
      selected.set(index, source);
      // Permit wrapped URLs on the immediately following line of that footnote.
      if (lines[index + 1]?.page === lines[index].page &&
        !/^\s*(?:\d+\s+|\[\d+\])/.test(lines[index + 1].text) &&
        /https?:\/\/[^\s]*[/-]\s*$/.test(lines[index].text)) selected.set(index + 1, source);
    }
  }
  // Some two-column PDFs omit the References heading from extracted text.
  // In that case, use a consecutive run of bracket-numbered entries after
  // the DAS, rather than selecting isolated citation markers in the body.
  const hasBibliographyHeading = lines.some(line => /^(?:\d+[.)]?\s+)?(?:references|bibliography)\s*$/i.test(normalize(line.text).trim()));
  const fallbackStarts = !hasBibliographyHeading && citations.size ? lines.flatMap((line, index) => {
    const match = normalize(line.text).trim().match(/^\[\s*(\d+)\s*\]\s+/);
    return match ? [{index, number:Number(match[1])}] : [];
  }) : [];
  const firstReference = fallbackStarts.findIndex((entry, position) => entry.number === 1 &&
    fallbackStarts.slice(position, position + 3).map(next => next.number).join(',') === '1,2,3' &&
    entry.index >= Math.max(...statements.map(statement => statement.end)));
  const fallbackReferences = firstReference < 0 ? Infinity : fallbackStarts[firstReference].index;
  let bibliography = false, current = null, entryStyle = null;
  const authorEntries = [], authorMatches = new Map();
  lines.forEach((line, index) => {
    const text = normalize(line.text).trim();
    if (/^(?:\d+[.)]?\s+)?(?:references|bibliography)\s*$/i.test(text)) {
      bibliography = true; current = null; entryStyle = null; return;
    }
    if (index >= fallbackReferences) bibliography = true;
    if (!bibliography) return;
    if (/^(?:[A-Z\d]+[.)]?\s+)?appendi(?:x|ces)\b/i.test(text)) { bibliography = false; current = null; return; }
    // Use one entry style per bibliography so a wrapped reference line beginning
    // with a year (e.g., "2022.") cannot interrupt bracket-numbered entries.
    const bracketed = text.match(/^\[\s*(\d+)\s*\]\s+/);
    // Four-digit publication years in unnumbered ACM bibliographies are not
    // dotted reference numbers (e.g., "2024. CodeXGLUE").
    const dotted = text.match(/^(\d{1,3})\.\s+/);
    if (!entryStyle && (bracketed || dotted)) entryStyle = bracketed ? 'bracketed' : 'dotted';
    const entry = entryStyle === 'bracketed' ? bracketed : entryStyle === 'dotted' ? dotted : null;
    if (entry) current = Number(entry[1]);
    if (citations.has(current)) selected.set(index, `Reference [${current}] cited by selected section`);
    // Unnumbered ACM-style references begin with a first author followed by
    // a publication year. Preserve entry boundaries before resolving citations.
    if (authorYears.size && !entryStyle) {
      let ref = text.match(/^(.{4,180}?)\.\s+((?:19|20)\d{2})([a-z]?)\.\s+/i);
      if (/^and\s+/i.test(text) && /,\s*$/.test(lines[index - 1]?.text.trim() || '')) ref = null;
      // Long author lists can wrap before the final "and Author. YEAR."
      // Only join an immediately following line on the same page.
      if (!ref && !/^and\s+/i.test(text) && /,\s*$/.test(text) && lines[index + 1]?.page === line.page &&
        /^and\s+.{3,100}\.\s+(?:19|20)\d{2}[a-z]?\.\s+/i.test(normalize(lines[index + 1].text).trim())) {
        ref = `${text} ${normalize(lines[index + 1].text).trim()}`.match(/^(.{4,350}?)\.\s+((?:19|20)\d{2})([a-z]?)\.\s+/i);
      }
      if (ref) {
        // The first author may be followed by "and" rather than a comma
        // (e.g., "Xin Jin and Zhiqiang Lin" or "O. M. Carmel and G. Katz").
        const firstAuthor = ref[1].split(/,|\s+and\s+/i)[0].trim();
        const surname = firstAuthor.match(/([A-Za-zÀ-ÖØ-öø-ÿ'’\-]+)$/)?.[1]?.toLowerCase();
        if (surname) {
          const key = `${surname}:${ref[2]}${ref[3].toLowerCase()}`;
          authorEntries.push({key, start:index, end:lines.length});
          authorMatches.set(key, (authorMatches.get(key) || 0) + 1);
          if (authorEntries.length > 1) authorEntries.at(-2).end = index;
        }
      }
    }
  });
  // Ambiguous surname/year matches are deliberately left unresolved.
  for (const {key, start, end} of authorEntries) {
    if (authorYears.has(key) && authorMatches.get(key) === 1) {
      // A subsequent author can start on one line and put the year on the
      // next; do not absorb that entry's DOI into the cited reference.
      for (let i = start; i < Math.min(end, start + 3); i++) {
        if (i > start && /,.*\.$/.test(lines[i].text.trim()) &&
          /^(?:19|20)\d{2}[a-z]?\./i.test(lines[i + 1]?.text.trim() || '')) break;
        selected.set(i, `Reference [${key}] cited by selected section`);
      }
    }
  }
  return selected;
}

function wrappedURLs(lines, selected) {
  const urls = [];
  for (const [index, source] of selected) {
    const line = lines[index];
    const next = lines[index + 1];
    // Some PDFs break the scheme after its colon: "https:" / "//host/path".
    // Require the scheme to end the line and the continuation to begin the
    // next line in the same selected excerpt on the same page.
    const splitScheme = line.text.match(/\b(https?):\s*$/i);
    if (splitScheme && next?.page === line.page && selected.get(index + 1) === source) {
      const continuation = next.text.trim().match(/^(\/\/[A-Za-z0-9.-]+\.[A-Za-z]{2,}(?:[^\s<>"']*)?)/);
      if (continuation) urls.push({url:`${splitScheme[1]}:${continuation[1].replace(/[.,;:]+$/g, '')}`,
        fragment:`${splitScheme[1]}:`, index, source, page:line.page});
    }
    for (const match of line.text.matchAll(/https?:\/\/[^\s<>"']*/gi)) {
      const fragment = match[0];
      const continuation = next?.text.trim().match(/^([A-Za-z0-9._~!$&'*+,;=:@%/?#-]+)/);
      // Only join adjacent lines in one selected excerpt, not the next entry.
      if (/[/-]$/.test(fragment) && match.index + fragment.length === line.text.trimEnd().length &&
        next?.page === line.page && selected.get(index + 1) === source && continuation &&
        (/[0-9]/.test(continuation[1]) || next.text.trim() === continuation[1]) &&
        !/^https?:\/\//i.test(continuation[1]) && !continuation[1].includes('://') &&
        !/^\(?[A-Z][a-z]+\)?[.,;:]?$/.test(continuation[1])) {
        urls.push({url:fragment + continuation[1].replace(/[.,;:]+$/g, ''), fragment, index, source, page:line.page});
      }
    }
  }
  return urls;
}

function linkedSelections(lines, annotations, selected, accept) {
  const links = [];
  for (const annotation of annotations) {
    const matches = [...selected].filter(([index]) => {
      const line = lines[index], rect = annotation.rect;
      return line.page === annotation.page && rect && line.boxes?.some(box =>
        Math.min(box[2], rect[2]) > Math.max(box[0], rect[0]) &&
        (box[1] + box[3]) / 2 >= rect[1] && (box[1] + box[3]) / 2 <= rect[3]);
    });
    if (matches.length && accept(annotation.url)) {
      for (const [, source] of matches) links.push({url:annotation.url, source:`${source}, PDF link p. ${annotation.page}`});
    }
  }
  return links;
}

export function collectDOIs(lines, annotations, statements) {
  const selected = selectedLines(lines, statements, annotations);
  const records = new Map();
  const add = (id, source) => {
    if (!records.has(id)) records.set(id, {id, sources:new Set()});
    records.get(id).sources.add(source);
  };
  for (const [index, source] of selected) {
    const line = lines[index];
    for (const id of doiIDs(line.text)) add(id, `${source}, p. ${line.page}`);
  }
  for (const {url, source, page} of wrappedURLs(lines, selected)) {
    for (const id of doiIDs(url)) add(id, `${source}, wrapped URL p. ${page}`);
  }
  for (const {url, source} of linkedSelections(lines, annotations, selected, value => {
    try {
      const parsed = new URL(value);
      return ['http:', 'https:'].includes(parsed.protocol) && ['doi.org', 'dx.doi.org', 'www.doi.org'].includes(parsed.hostname.toLowerCase());
    } catch { return false; }
  })) {
    try {
      for (const id of doiIDs(decodeURIComponent(new URL(url).pathname))) add(id, source);
    } catch { /* Ignore malformed DOI links. */ }
  }
  // PDF line wrapping can leave a valid-looking DOI prefix on one line while
  // an annotation or joined reference supplies the complete identifier.
  const values = [...records.values()];
  return values.filter(record => !values.some(other =>
    other !== record && other.id.length > record.id.length && other.id.startsWith(record.id) &&
    (/[._;()/:+\-]/.test(other.id[record.id.length]) ||
      /^10\.5281\/zenodo\.\d+$/.test(record.id) && /^10\.5281\/zenodo\.\d+$/.test(other.id) &&
      [...record.sources].some(source => source.startsWith('Reference ') &&
        [...other.sources].some(otherSource => otherSource.startsWith(source.split(' cited by selected section')[0]))))));
}

// Only artifact-location hosts on this whitelist are reported; these are not DOI records.
function repositoryURL(value) {
  try {
    const url = new URL(value);
    if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password || url.port) return null;
    const host = url.hostname.toLowerCase();
    if (!ARTIFACT_HOSTS.some(domain => host === domain || host.endsWith(`.${domain}`))) return null;
    if (((host === 'zenodo.org' || host.endsWith('.zenodo.org')) && /^\/(?:record|records)\/?$/i.test(url.pathname)) ||
      ((host === 'figshare.com' || host.endsWith('.figshare.com')) && /^\/s\/?$/i.test(url.pathname))) return null;
    return url.href;
  } catch { return null; }
}

export function collectRepositoryLinks(lines, annotations, statements) {
  const selected = selectedLines(lines, statements, annotations), records = new Map();
  const add = (url, source) => {
    if (!records.has(url)) records.set(url, {url, sources:new Set()});
    records.get(url).sources.add(source);
  };
  const wrapped = wrappedURLs(lines, selected);
  for (const [index, source] of selected) {
    const line = lines[index];
    for (const match of line.text.matchAll(/https?:\/\/[^\s<>"']*/gi)) {
      const fragment = match[0];
      if (wrapped.some(item => item.index === index && item.fragment === fragment && repositoryURL(item.url))) continue;
      const url = repositoryURL(fragment.replace(/[.,;:]+$/g, ''));
      if (url) add(url, `${source}, p. ${line.page}`);
    }
  }
  for (const {url, source, page} of wrapped) {
    const parsed = repositoryURL(url);
    if (parsed) add(parsed, `${source}, wrapped URL p. ${page}`);
  }
  for (const {url, source} of linkedSelections(lines, annotations, selected, value => !!repositoryURL(value))) {
    add(repositoryURL(url), source);
  }
  return [...records.values()].map(record => ({...record, sources:[...record.sources]}));
}

export function analyzeExtractedPDF(extracted, {sectionIDs = DEFAULT_SECTION_IDS} = {}) {
  const {pages, lines, annotations = []} = extracted;
  const statements = findStatements(lines, {sectionIDs});
  const dois = collectDOIs(lines, annotations, statements).map(record => ({...record, sources:[...record.sources]}));
  const repositoryLinks = collectRepositoryLinks(lines, annotations, statements);
  return {pages, hasText:lines.length > 0, statements, dois, repositoryLinks};
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
