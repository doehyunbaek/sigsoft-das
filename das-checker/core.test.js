import assert from 'node:assert/strict';
import test from 'node:test';
import {DEFAULT_SECTION_IDS, collectDOIs, findStatements} from './core.js';

const lines = values => values.map((text, index) => ({text, page:1, boxes:[[0, index * 10, 100, index * 10 + 8]]}));

test('all supported heading forms are enabled by default', () => {
  assert.deepEqual(DEFAULT_SECTION_IDS, [
    'data-availability', 'data-availability-statement',
    'data-availability-statement-unhyphenated'
  ]);
  const found = findStatements(lines([
    'Data Availability', 'Body', 'Data-Availability Statement', 'Body',
    'Data Availability Statement', 'Body', 'ACKNOWLEDGMENTS'
  ]));
  assert.deepEqual(found.map(statement => statement.sectionId), DEFAULT_SECTION_IDS);
});

test('removed headings are not recognized', () => {
  const found = findStatements(lines([
    'Reproducibility', 'Body', 'Artifact', 'Body', 'Experimental Artifacts', 'Body',
    'Supplementary Material', 'Body', 'Artifact Availability Statement', 'Body',
    'Conclusions and Data Availability', 'Body', 'Data and Code Availability', 'Body',
    'Data Availability and Ethics', 'Body', 'Data Availability and Experiment Replication', 'Body',
    'Data Available', 'Body', 'Supplementary Material and Replication Package', 'Body',
    'Availability of Data', 'Body', 'Reproducibility Statement', 'Body',
    'Replication Package', 'Body'
  ]));
  assert.equal(found.length, 0);
});

test('visual heading styles reject body fragments and figure labels', () => {
  const styled = (text, font, size) => ({text, page:1, boxes:[], runs:[{text, start:0, font, size}]});
  assert.equal(findStatements([
    styled('Data Availability', 'FigureFont', 6.3), styled('Stage', 'FigureFont', 6.3)
  ]).length, 0);
  assert.equal(findStatements([
    styled('Data Availability', 'BodyFont', 9), styled('Good Documentation.', 'BodyFont', 9)
  ]).length, 0);
  assert.equal(findStatements([
    styled('Data Availability', 'HeadingFont', 11), styled('Our library is available.', 'BodyFont', 9)
  ]).length, 1);
});

test('IEEE spaced-small-cap headings are matched but preserved exactly', () => {
  const found = findStatements(lines([
    'VIII. D ATA A VAILABILITY', 'Artifact text.', 'A CKNOWLEDGMENTS'
  ]));
  assert.equal(found.length, 1);
  assert.equal(found[0].sectionId, 'data-availability');
  assert.equal(found[0].heading, 'VIII. D ATA A VAILABILITY');
  assert.equal(found[0].body, 'Artifact text.');
});

test('an inline heading and body are separated', () => {
  const found = findStatements(lines([
    'Data Availability Statement. All benchmark tasks are available in our package.',
    'More package details.', 'REFERENCES'
  ]));
  assert.equal(found.length, 1);
  assert.equal(found[0].sectionId, 'data-availability-statement-unhyphenated');
  assert.equal(found[0].heading, 'Data Availability Statement.');
  assert.equal(found[0].body, 'All benchmark tasks are available in our package.\nMore package details.');
});

test('a heading split before Statement is consumed as one heading', () => {
  for (const [heading, sectionID] of [
    ['DATA-AVAILABILITY', 'data-availability-statement']
  ]) {
    const found = findStatements(lines([heading, 'STATEMENT', 'Artifact text.', 'REFERENCES']));
    assert.equal(found.length, 1);
    assert.equal(found[0].sectionId, sectionID);
    assert.equal(found[0].body, 'Artifact text.');
  }
});

test('wrapped DOI prefixes are suppressed when a complete DOI is present', () => {
  const document = lines([
    'Data Availability Statement',
    'First: https://doi.org/10.6084/m9.figshare.7731629',
    'Wrapped: https://doi.org/10.6084/m9.',
    'figshare.7732268',
    'Complete link: https://doi.org/10.6084/m9.figshare.7732268',
    'CONCLUSION'
  ]);
  const statements = findStatements(document);
  assert.deepEqual(collectDOIs(document, [], statements).map(record => record.id), [
    '10.6084/m9.figshare.7731629', '10.6084/m9.figshare.7732268'
  ]);
});

test('each supported heading can be selected independently', () => {
  for (const [heading, sectionID] of [
    ['Data Availability', 'data-availability'],
    ['Data-Availability Statement', 'data-availability-statement'],
    ['Data Availability Statement', 'data-availability-statement-unhyphenated']
  ]) {
    const found = findStatements(lines([heading, 'Section body.', 'REFERENCES']), {sectionIDs:[sectionID]});
    assert.equal(found.length, 1);
    assert.equal(found[0].heading, heading);
    assert.equal(found[0].body, 'Section body.');
  }
});
