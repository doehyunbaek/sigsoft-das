import assert from 'node:assert/strict';
import test from 'node:test';
import {DEFAULT_SECTION_IDS, collectDOIs, findStatements} from './core.js';

const lines = values => values.map((text, index) => ({text, page:1, boxes:[[0, index * 10, 100, index * 10 + 8]]}));

test('all actual heading forms are enabled by default', () => {
  assert.deepEqual(DEFAULT_SECTION_IDS, [
    'data-availability-and-experiment-replication', 'conclusions-and-data-availability',
    'data-and-code-availability', 'data-availability-and-ethics', 'data-availability', 'data-available',
    'data-availability-statement', 'data-availability-statement-unhyphenated', 'availability-of-data', 'reproducibility',
    'reproducibility-statement', 'replication-package', 'experimental-artifacts',
    'artifact-availability-statement', 'artifact', 'supplementary-material',
    'supplementary-material-and-replication-package'
  ]);
  const found = findStatements(lines([
    'DATA AVAILABILITY AND EXPERIMENT', 'REPLICATION', 'Body',
    '7 Conclusions and Data Availability', 'Body', '12 Data and Code Availability', 'Body',
    'Data Availability and Ethics', 'Body', 'Data Availability', 'Body', 'DATA AVAILABLE', 'Body', 'Data-Availability Statement', 'Body',
    'Data Availability Statement', 'Body', 'Availability of Data', 'Body',
    'Reproducibility', 'Body', 'Reproducibility Statement', 'Body', '10 REPLICATION PACKAGE', 'Body',
    'EXPERIMENTAL ARTIFACTS', 'Body', 'Artifact Availability Statement', 'Body',
    '10 ARTIFACT', 'Body', 'SUPPLEMENTARY MATERIAL', 'Body', 'SUPPLEMENTARY MATERIAL AND',
    'REPLICATION PACKAGE', 'Body', 'ACKNOWLEDGMENTS'
  ]));
  assert.deepEqual(found.map(statement => statement.sectionId), DEFAULT_SECTION_IDS);
});

test('reproducibility-only selection excludes data availability', () => {
  const found = findStatements(lines([
    'A.1 Data Availability', 'Not selected.', 'IV. REPRODUCIBILITY',
    'Artifact: https://doi.org/10.5281/zenodo.3257777', 'ACKNOWLEDGMENTS'
  ]), {sectionIDs:['reproducibility']});
  assert.equal(found.length, 1);
  assert.equal(found[0].sectionId, 'reproducibility');
  assert.equal(found[0].body, 'Artifact: https://doi.org/10.5281/zenodo.3257777');
  assert.deepEqual(collectDOIs(lines([
    'A.1 Data Availability', 'Not selected.', 'IV. REPRODUCIBILITY',
    'Artifact: https://doi.org/10.5281/zenodo.3257777', 'ACKNOWLEDGMENTS'
  ]), [], found).map(record => record.id), ['10.5281/zenodo.3257777']);
});

test('visual heading styles reject body fragments and figure labels', () => {
  const styled = (text, font, size) => ({text, page:1, boxes:[], runs:[{text, start:0, font, size}]});
  assert.equal(findStatements([
    styled('Artifact', 'FigureFont', 6.3), styled('Stage', 'FigureFont', 6.3)
  ]).length, 0);
  assert.equal(findStatements([
    styled('artifact.', 'BodyFont', 9), styled('Good Documentation.', 'BodyFont', 9)
  ]).length, 0);
  assert.equal(findStatements([
    styled('10 ARTIFACT', 'HeadingFont', 11), styled('Our library is available.', 'BodyFont', 9)
  ]).length, 1);
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
    ['DATA-AVAILABILITY', 'data-availability-statement'],
    ['REPRODUCIBILITY', 'reproducibility-statement']
  ]) {
    const found = findStatements(lines([heading, 'STATEMENT', 'Artifact text.', 'REFERENCES']));
    assert.equal(found.length, 1);
    assert.equal(found[0].sectionId, sectionID);
    assert.equal(found[0].body, 'Artifact text.');
  }
});

test('wrapped DOI prefixes are suppressed when a complete DOI is present', () => {
  const document = lines([
    'EXPERIMENTAL ARTIFACTS',
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

test('each actual heading can be selected independently', () => {
  const experimentReplication = findStatements(lines([
    'DATA AVAILABILITY AND EXPERIMENT', 'REPLICATION', 'Replication body.', 'REFERENCES'
  ]), {sectionIDs:['data-availability-and-experiment-replication']});
  assert.equal(experimentReplication.length, 1);
  assert.equal(experimentReplication[0].heading, 'DATA AVAILABILITY AND EXPERIMENT\nREPLICATION');
  assert.equal(experimentReplication[0].body, 'Replication body.');

  for (const [heading, sectionID] of [
    ['7 Conclusions and Data Availability', 'conclusions-and-data-availability'],
    ['12 Data and Code Availability', 'data-and-code-availability'],
    ['Data Availability and Ethics', 'data-availability-and-ethics']
  ]) {
    const found = findStatements(lines([heading, 'Specialized body.', 'REFERENCES']), {sectionIDs:[sectionID]});
    assert.equal(found.length, 1);
    assert.equal(found[0].heading, heading);
    assert.equal(found[0].body, 'Specialized body.');
  }

  const dataAvailable = findStatements(lines([
    'DATA AVAILABLE', 'Available body.', 'REFERENCES'
  ]), {sectionIDs:['data-available']});
  assert.equal(dataAvailable.length, 1);
  assert.equal(dataAvailable[0].heading, 'DATA AVAILABLE');
  assert.equal(dataAvailable[0].body, 'Available body.');

  const hyphenated = findStatements(lines([
    'Data-Availability Statement', 'Hyphenated body.', 'REFERENCES'
  ]), {sectionIDs:['data-availability-statement']});
  assert.equal(hyphenated.length, 1);
  assert.equal(hyphenated[0].body, 'Hyphenated body.');

  const unhyphenated = findStatements(lines([
    'Data Availability Statement', 'Unhyphenated body.', 'REFERENCES'
  ]), {sectionIDs:['data-availability-statement-unhyphenated']});
  assert.equal(unhyphenated.length, 1);
  assert.equal(unhyphenated[0].body, 'Unhyphenated body.');

  const packageSection = findStatements(lines([
    '10 REPLICATION PACKAGE', 'Package body.', 'ACKNOWLEDGMENTS'
  ]), {sectionIDs:['replication-package']});
  assert.equal(packageSection.length, 1);
  assert.equal(packageSection[0].heading, '10 REPLICATION PACKAGE');
  assert.equal(packageSection[0].body, 'Package body.');

  const artifacts = findStatements(lines([
    '6 EXPERIMENTAL ARTIFACTS', 'Artifact body.', '7 CONCLUSION'
  ]), {sectionIDs:['experimental-artifacts']});
  assert.equal(artifacts.length, 1);
  assert.equal(artifacts[0].heading, '6 EXPERIMENTAL ARTIFACTS');
  assert.equal(artifacts[0].body, 'Artifact body.');

  const availabilityStatement = findStatements(lines([
    'Artifact Availability Statement', 'Availability body.', 'ACKNOWLEDGMENTS'
  ]), {sectionIDs:['artifact-availability-statement']});
  assert.equal(availabilityStatement.length, 1);
  assert.equal(availabilityStatement[0].heading, 'Artifact Availability Statement');
  assert.equal(availabilityStatement[0].body, 'Availability body.');

  const artifact = findStatements(lines(['10 ARTIFACT', 'Library body.', 'ACKNOWLEDGMENTS']), {sectionIDs:['artifact']});
  assert.equal(artifact.length, 1);
  assert.equal(artifact[0].heading, '10 ARTIFACT');
  assert.equal(artifact[0].body, 'Library body.');

  const supplementary = findStatements(lines([
    'SUPPLEMENTARY MATERIAL', 'Material body.', 'REFERENCES'
  ]), {sectionIDs:['supplementary-material']});
  assert.equal(supplementary.length, 1);
  assert.equal(supplementary[0].heading, 'SUPPLEMENTARY MATERIAL');
  assert.equal(supplementary[0].body, 'Material body.');

  const replication = findStatements(lines([
    'SUPPLEMENTARY MATERIAL AND', 'REPLICATION PACKAGE', 'Package body.', 'REFERENCES'
  ]), {sectionIDs:['supplementary-material-and-replication-package']});
  assert.equal(replication.length, 1);
  assert.equal(replication[0].heading, 'SUPPLEMENTARY MATERIAL AND\nREPLICATION PACKAGE');
  assert.equal(replication[0].body, 'Package body.');
});
