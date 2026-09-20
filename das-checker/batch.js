#!/usr/bin/env node
import {mkdir, readdir, readFile, stat, writeFile} from 'node:fs/promises';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {gzip, gunzip} from 'node:zlib';
import {promisify} from 'node:util';
import * as pdfjs from 'pdfjs-dist/legacy/build/pdf.mjs';
import {analyzeExtractedPDF, extractPDF} from './core.js';

const gzipAsync = promisify(gzip), gunzipAsync = promisify(gunzip);

const root = path.resolve(process.argv[2] || '');
const projectRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const output = path.resolve(process.argv[3] || path.join(projectRoot, '.cache/fse-das-counts.json'));
const extractionCache = path.join(projectRoot, '.cache/pdf-extraction-v2');
const concurrency = Math.max(1, Math.min(8, Number(process.argv[4]) || 4));
// Manually reviewed detector hits. Keep these visible for audit, but do not count them.
const falsePositivePapers = new Set([
  '2018/3236024.3236081.pdf',
  '2024/3643764.pdf',
  '2024/3660815.pdf'
]);
// Individually reviewed false-positive sections in papers that also contain valid sections.
const falsePositiveSections = new Map([
  ['2024/3660788.pdf', [{id:'artifact', heading:'artifact.', page:12}]]
]);
// Artifact evidence outside allowed headings. These annotations never affect counts.
const annotationsFile = path.join(projectRoot, 'data/fse-annotations.json');
const manualAnnotations = new Map(Object.entries(JSON.parse(await readFile(annotationsFile, 'utf8'))));
if (!process.argv[2]) {
  console.error('Usage: node batch.js <PDF directory> [output.json] [concurrency]');
  process.exit(1);
}
async function walk(directory) {
  const files = [];
  for (const entry of await readdir(directory, {withFileTypes:true})) {
    const item = path.join(directory, entry.name);
    if (entry.isDirectory()) files.push(...await walk(item));
    else if (entry.isFile() && entry.name.toLowerCase().endsWith('.pdf')) files.push(item);
  }
  return files;
}
const files = await walk(root);
await mkdir(extractionCache, {recursive:true});
const results = {};
let cursor = 0, completed = 0, cacheHits = 0, cacheMisses = 0, lastSave = Date.now();
const originalLog = console.log;
console.log = (...args) => console.error(...args);
async function save() {
  const years = {};
  for (const [file, record] of Object.entries(results)) {
    const year = record.year || 'unknown';
    const summary = years[year] ||= {total:0, checked:0, with_statement:0, with_statement_and_doi:0, without_statement:0, no_text:0, errors:0, papers:[], false_positives:[], annotations:[]};
    summary.total++;
    if (record.status === 'checked') {
      summary.checked++;
      const paperId = path.basename(file, path.extname(file));
      const paper = {
        id:paperId,
        file,
        url:/^\d+(?:\.\d+)?$/.test(paperId) ? `https://doi.org/10.1145/${paperId}` : null,
        sections:record.sections,
        dois:record.doiIDs || []
      };
      const annotation = manualAnnotations.get(file);
      if (annotation) summary.annotations.push({...paper, sections:undefined, dois:undefined, annotation});
      if (record.falsePositiveSections?.length) {
        summary.false_positives.push({...paper, sections:record.falsePositiveSections, dois:[], false_positive:true});
      }
      if (record.statements > 0 && falsePositivePapers.has(file)) {
        summary.false_positives.push({...paper, false_positive:true});
        summary.without_statement++;
      } else if (record.statements > 0) {
        summary.with_statement++;
        if (record.dois > 0) summary.with_statement_and_doi++;
        summary.papers.push(paper);
      } else summary.without_statement++;
    } else if (record.status === 'no_text') summary.no_text++;
    else summary.errors++;
  }
  const generatedAt = new Date().toISOString();
  await writeFile(output, JSON.stringify({generated_at:generatedAt, source:root, detector:'das-checker/core.js findStatements', files:results, years}, null, 2));
  const dataOutput = path.join(projectRoot, 'data/fse.json');
  for (const summary of Object.values(years)) {
    summary.papers.sort((a, b) => a.id.localeCompare(b.id, undefined, {numeric:true}));
    summary.false_positives.sort((a, b) => a.id.localeCompare(b.id, undefined, {numeric:true}));
    summary.annotations.sort((a, b) => a.id.localeCompare(b.id, undefined, {numeric:true}));
  }
  const metadata = {generated_at:generatedAt, conference:'FSE', detector:'das-checker/core.js findStatements'};
  await writeFile(dataOutput, JSON.stringify({...metadata, years}, null, 2));
  lastSave = Date.now();
}
async function cachedExtraction(file, relative) {
  const info = await stat(file);
  const cacheFile = path.join(extractionCache, `${relative}.json.gz`);
  try {
    const cached = JSON.parse(await gunzipAsync(await readFile(cacheFile)));
    if (cached.source === file && cached.size === info.size && cached.mtimeMs === info.mtimeMs) {
      cacheHits++;
      return cached.extracted;
    }
  } catch { /* Missing, stale, or corrupt cache entry. */ }
  cacheMisses++;
  const extracted = await extractPDF(await readFile(file), {pdfjs});
  await mkdir(path.dirname(cacheFile), {recursive:true});
  await writeFile(cacheFile, await gzipAsync(JSON.stringify({source:file, size:info.size, mtimeMs:info.mtimeMs, extracted})));
  return extracted;
}
async function worker() {
  while (cursor < files.length) {
    const file = files[cursor++], relative = path.relative(root, file);
    const year = relative.split(path.sep).find(part => /^(?:19|20)\d{2}$/.test(part)) || null;
    try {
      const analysis = analyzeExtractedPDF(await cachedExtraction(file, relative));
      const sectionRecords = analysis.statements.map(statement => ({id:statement.sectionId, label:statement.sectionLabel, heading:statement.heading, page:statement.page, body:statement.body}));
      const exclusions = falsePositiveSections.get(relative) || [];
      const isExcluded = section => exclusions.some(exclusion => exclusion.id === section.id && exclusion.heading === section.heading && exclusion.page === section.page);
      const sections = sectionRecords.filter(section => !isExcluded(section));
      results[relative] = {
        year,
        status:analysis.hasText ? 'checked' : 'no_text',
        statements:sections.length,
        dois:analysis.dois.length,
        pages:analysis.pages,
        sections,
        falsePositiveSections:sectionRecords.filter(isExcluded),
        doiIDs:analysis.dois.map(record => record.id)
      };
    } catch (error) {
      results[relative] = {year, status:'error', statements:0, dois:0, error:error.message};
    }
    completed++;
    if (completed % 25 === 0) {
      originalLog(`${completed}/${files.length}`);
      await save();
    } else if (Date.now() - lastSave > 60000) await save();
  }
}
await Promise.all(Array.from({length:concurrency}, worker));
await save();
console.log = originalLog;
originalLog(`Processed ${files.length} PDFs (${cacheHits} extraction cache hits, ${cacheMisses} misses); results in ${output}`);
