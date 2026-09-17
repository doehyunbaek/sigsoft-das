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
export function findStatements(lines) {
  const heading = /^(?:(?:\d+(?:\.\d+)*|[IVX]+|[A-Z])[.)]?\s+)?(?:data[\s-]+availability(?:[\s-]+statement)?|availability\s+of\s+data)\s*[:.]?$/i;
  const boundary = /^(?:(?:\d+(?:\.\d+)*|[IVX]+|[A-Z])[.)]?\s+)?(?:references|bibliography|acknowledg(?:e)?ments?|appendi(?:x|ces)|conclusions?|discussion|funding|conflicts? of interest|competing interests|author contributions)\b|^\d+(?:\.\d+)*[.)]?\s+[A-Z]/i;
  const statements = [];
  for (let i = 0; i < lines.length; i++) {
    let count = 0;
    for (let n = 1; n <= 3 && i + n <= lines.length; n++) {
      const title = normalize(lines.slice(i, i + n).map(line => line.text).join(' ')).trim();
      if (heading.test(title)) {
        count = n;
        // Prefer a following "Statement" line over the shorter variant.
        if (/availability[\s-]*$/i.test(title) && /^statement\s*[:.]?$/i.test(lines[i + n]?.text.trim() || '')) count++;
        break;
      }
    }
    if (!count) continue;
    let end = i + count;
    // Bound the excerpt if no next heading can be recognized.
    while (end < lines.length && end < i + count + 100 && lines[end].page <= lines[i].page + 1 && !boundary.test(normalize(lines[end].text).trim())) end++;
    statements.push({start:i, end, page:lines[i].page, text:lines.slice(i, end).map(line => line.text).join('\n'), body:lines.slice(i + count, end).map(line => line.text).join('\n')});
    i += count - 1;
  }
  return statements;
}
export function collectDOIs(lines, annotations, statements) {
  const selected = new Map(), citations = new Set();
  for (const statement of statements) {
    for (let i = statement.start; i < statement.end; i++) selected.set(i, 'DAS excerpt');
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
    if (citations.has(current)) selected.set(index, `Reference [${current}] cited by DAS`);
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
  return [...records.values()];
}

export async function analyzePDF(data, {pdfjs, onProgress = () => {}} = {}) {
  if (!pdfjs?.getDocument) throw new Error("Provide a PDF.js module via {pdfjs}.");
  const task = pdfjs.getDocument({data:new Uint8Array(data), isEvalSupported:false});
  try {
    const pdf = await task.promise;
    const lines = [], annotations = [];
    for (let pageNumber = 1; pageNumber <= pdf.numPages; pageNumber++) {
      onProgress({page:pageNumber, total:pdf.numPages});
      const page = await pdf.getPage(pageNumber);
      const content = await page.getTextContent();
      let text = '', previousY = null, boxes = [];
      const flush = () => { if (text.trim()) lines.push({text:text.trim(), page:pageNumber, boxes}); text = ''; boxes = []; };
      for (const item of content.items) {
        if (typeof item.str !== 'string') continue;
        const y = item.transform[5];
        if (previousY !== null && Math.abs(y - previousY) > 3) flush();
        text += (text && !/\s$/.test(text) && !/^\s/.test(item.str) ? ' ' : '') + item.str;
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

    const statements = findStatements(lines);
    const dois = collectDOIs(lines, annotations, statements).map(record => ({...record, sources:[...record.sources]}));
    return {pages:pdf.numPages, hasText:lines.length > 0, statements, dois};
  } finally { await task.destroy(); }
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
