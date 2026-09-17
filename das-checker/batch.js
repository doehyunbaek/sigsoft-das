#!/usr/bin/env node
import {readdir, readFile, writeFile} from 'node:fs/promises';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import * as pdfjs from 'pdfjs-dist/legacy/build/pdf.mjs';
import {analyzePDF} from './core.js';

const root = path.resolve(process.argv[2] || '');
const projectRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const output = path.resolve(process.argv[3] || path.join(projectRoot, '.cache/fse-das-counts.json')); 
const concurrency = Math.max(1, Math.min(8, Number(process.argv[4]) || 4));
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
let previous = {};
try { previous = JSON.parse(await readFile(output, 'utf8')).files || {}; } catch { /* New run. */ }
const results = {...previous};
let cursor = 0, completed = Object.values(previous).filter(record => Number.isInteger(record.dois)).length, lastSave = Date.now();
const originalLog = console.log;
console.log = (...args) => console.error(...args);
async function save() {
  const years = {};
  for (const record of Object.values(results)) {
    const year = record.year || 'unknown';
    const summary = years[year] ||= {total:0, checked:0, with_statement:0, with_statement_and_doi:0, without_statement:0, no_text:0, errors:0};
    summary.total++;
    if (record.status === 'checked') {
      summary.checked++;
      if (record.statements > 0) {
        summary.with_statement++;
        if (record.dois > 0) summary.with_statement_and_doi++;
      } else summary.without_statement++; 
    } else if (record.status === 'no_text') summary.no_text++;
    else summary.errors++;
  }
  const generatedAt = new Date().toISOString();
  await writeFile(output, JSON.stringify({generated_at:generatedAt, source:root, detector:'das-checker/core.js findStatements', files:results, years}, null, 2));
  const summaryOutput = path.join(projectRoot, 'data/fse-das-summary.json');
  await writeFile(summaryOutput, JSON.stringify({generated_at:generatedAt, conference:'FSE', detector:'das-checker/core.js findStatements', years}, null, 2));
  lastSave = Date.now();
}
async function worker() {
  while (cursor < files.length) {
    const file = files[cursor++], relative = path.relative(root, file);
    if (Number.isInteger(results[relative]?.dois)) continue;
    const year = relative.split(path.sep).find(part => /^(?:19|20)\d{2}$/.test(part)) || null;
    try {
      const analysis = await analyzePDF(await readFile(file), {pdfjs});
      results[relative] = {year, status:analysis.hasText ? 'checked' : 'no_text', statements:analysis.statements.length, dois:analysis.dois.length, pages:analysis.pages};
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
originalLog(`Processed ${files.length} PDFs; results in ${output}`);
