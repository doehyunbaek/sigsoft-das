#!/usr/bin/env node
import {readFile} from 'node:fs/promises';
import * as pdfjs from 'pdfjs-dist/legacy/build/pdf.mjs';
import {analyzePDF, doiURL, checkDOI, fetchDOIMetadata, DEFAULT_SECTION_IDS} from './core.js';

const args = process.argv.slice(2);
const input = args.find(arg => !arg.startsWith('--'));
const sectionArg = args.find(arg => arg.startsWith('--sections='));
const validOptions = args.filter(arg => arg.startsWith('--')).every(arg => arg === '--check-links' || arg.startsWith('--sections='));
const sectionIDs = sectionArg ? sectionArg.slice('--sections='.length).split(',').filter(Boolean) : DEFAULT_SECTION_IDS;
if (!input || !validOptions || !sectionIDs.length) {
  console.error(`Usage: node cli.js <paper.pdf | https://…/paper.pdf> [--check-links] [--sections=${DEFAULT_SECTION_IDS.join(',')}]`);
  process.exitCode = 1;
} else {
  try {
    let bytes;
    if (/^https?:\/\//i.test(input)) {
      const response = await fetch(input, {signal:AbortSignal.timeout(60000)});
      if (!response.ok) throw new Error(`PDF download returned HTTP ${response.status}`);
      const chunks = [];
      let size = 0;
      for await (const chunk of response.body) {
        size += chunk.length;
        if (size > 100 * 1024 * 1024) throw new Error('PDF exceeds 100 MB.');
        chunks.push(chunk);
      }
      bytes = Buffer.concat(chunks);
    } else {
      bytes = await readFile(input);
    }
    if (bytes.length > 100 * 1024 * 1024) throw new Error('PDF exceeds 100 MB.');
    // Keep PDF.js diagnostics off the JSON output stream.
    const log = console.log;
    let result;
    try {
      console.log = (...values) => console.error(...values);
      result = await analyzePDF(bytes, {pdfjs, sectionIDs});
    } finally { console.log = log; }
    if (args.includes('--check-links')) {
      for (const record of result.dois.slice(0, 30)) {
        const url = doiURL(record.id);
        record.http = await checkDOI(url);
        try { record.metadata = await fetchDOIMetadata(url); }
        catch (error) { record.metadataError = error.message; }
      }
    }
    console.log(JSON.stringify(result, null, 2));
  } catch (error) {
    console.error(error.message);
    process.exitCode = 1;
  }
}
