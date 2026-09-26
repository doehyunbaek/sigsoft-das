import assert from 'node:assert/strict';
import test from 'node:test';
import {DEFAULT_SECTION_IDS, collectDOIs, collectRepositoryLinks, findStatements} from './core.js';

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

test('three-digit list item does not truncate a data availability statement', () => {
  const document = lines([
    'Data Availability',
    'We release our replication package including (1)',
    '497 Linux kernel bug reports with metadata and 1,509 genuine reports;',
    'and (2) scripts. The package is available at',
    'https://github.com/tianjiashuo/False-Positive-from-Linux-Kernel.',
    'Acknowledgments'
  ]);
  const statement = findStatements(document)[0];
  assert.match(statement.body, /497 Linux kernel bug reports/);
  assert.deepEqual(collectRepositoryLinks(document, [], [statement]).map(record => record.url), [
    'https://github.com/tianjiashuo/False-Positive-from-Linux-Kernel'
  ]);
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

test('numbered bibliography styles resolve only cited entries, including DOI links', () => {
  for (const entryStyle of ['[23]', '23.']) {
    const document = lines([
      'Data Availability Statement', 'Supplementary material [23].', 'REFERENCES',
      `${entryStyle} Authors: supplementary data. DOI: 10.5281/zenodo.18244158`,
      'DOI: 10.5281/zenodo.18244159',
      ...(entryStyle === '[23]' ? ['2022. A wrapped year, not a new reference.', 'DOI: 10.5281/zenodo.18244160'] : []),
      entryStyle === '23.' ? '24. Other authors: unrelated data.' : '[24] Other authors: unrelated data.',
      'DOI: 10.5281/zenodo.99999999'
    ]);
    const statements = findStatements(document);
    assert.deepEqual(collectDOIs(document, [], statements).map(record => record.id), [
      '10.5281/zenodo.18244158', '10.5281/zenodo.18244159',
      ...(entryStyle === '[23]' ? ['10.5281/zenodo.18244160'] : [])
    ]);
    const linked = lines([
      'Data Availability Statement', 'Supplementary material [23].', 'REFERENCES',
      `${entryStyle} Authors: supplementary data.`, 'Repository link',
      entryStyle === '23.' ? '24. Other authors: unrelated data.' : '[24] Other authors: unrelated data.',
      'Another repository link'
    ]);
    const annotations = [
      {url:'https://doi.org/10.5281/zenodo.18244158', page:1, rect:[0, 40, 100, 48]},
      {url:'https://doi.org/10.5281/zenodo.99999999', page:1, rect:[0, 60, 100, 68]}
    ];
    assert.deepEqual(collectDOIs(linked, annotations, findStatements(linked)).map(record => record.id), [
      '10.5281/zenodo.18244158'
    ]);
  }
});

test('numbered references are recovered when a two-column PDF drops the bibliography heading', () => {
  const document = lines([
    '[24] A citation in the body.', 'Data Availability', 'Artifact [3].',
    '[1] First entry.', '[2] Second entry.', '[3] Artifact link.',
    'DOI: 10.5281/zenodo.7900059', '[4] Unrelated.', 'DOI: 10.5281/zenodo.99999999'
  ]);
  for (const line of document.slice(3)) line.page = 3;
  assert.deepEqual(collectDOIs(document, [], findStatements(document)).map(record => record.id), ['10.5281/zenodo.7900059']);
});

test('unique author-year references resolve DOIs without including adjacent entries', () => {
  const document = lines([
    'Data Availability Statement', 'Materials [Kim et al. 2024] and [Paramitha et al. 2025a,b].',
    'REFERENCES',
    'Tae Eun Kim, et al. 2024. Artifact.', 'https://doi.org/10.5281/zenodo.10669580',
    'Other Author. 2024. Unrelated.', 'https://doi.org/10.5281/zenodo.99999999',
    'Ranindya Paramitha, et al. 2025a. Part one.', 'https://doi.org/10.5281/zenodo.8207883',
    'Ranindya Paramitha, et al. 2025b. Part two.', 'https://doi.org/10.5281/zenodo.10960662'
  ]);
  assert.deepEqual(collectDOIs(document, [], findStatements(document)).map(record => record.id), [
    '10.5281/zenodo.10669580', '10.5281/zenodo.8207883', '10.5281/zenodo.10960662'
  ]);
});

test('two-author bibliography entries resolve by first surname, including initials', () => {
  const document = lines([
    'Data Availability', 'Artifacts [Jin and Lin 2024] and benchmarks [Carmel and Katz 2024].',
    'REFERENCES', '2024. CodeXGLUE. https://microsoft.github.io/CodeXGLUE/',
    'Xin Jin and Zhiqiang Lin. 2024. SimLLM artifact. https://doi.org/10.5281/zenodo.11095396',
    'O. M. Carmel and G. Katz. 2024. Code and benchmarks.',
    'https://github.com/ophircarmel/Reducing-Undesirable-Behaviour',
    'Unrelated Person. 2024. https://github.com/unrelated/repo'
  ]);
  const statements = findStatements(document);
  assert.deepEqual(collectDOIs(document, [], statements).map(record => record.id), ['10.5281/zenodo.11095396']);
  assert.deepEqual(collectRepositoryLinks(document, [], statements).map(record => record.url), [
    'https://github.com/ophircarmel/Reducing-Undesirable-Behaviour'
  ]);
});

test('author–year citation resolves a bibliography author list wrapped before and Author', () => {
  const document = lines([
    'Data Availability', 'OSG data [Yan et al. 2024].', 'REFERENCES',
    'Songyang Yan, Xiaodong Zhang, Kunkun Hao, Jun Sun, ,',
    'and Zijiang Yang. 2024. OSG DATA at FSE 25. https://doi.org/10.5281/zenodo.13621782',
    'Wei Zhan and Colleague. 2024. Unrelated https://doi.org/10.5281/zenodo.99999999'
  ]);
  assert.deepEqual(collectDOIs(document, [], findStatements(document)).map(record => record.id), [
    '10.5281/zenodo.13621782'
  ]);
});

test('an author reference with a wrapped next author does not absorb an unrelated DOI', () => {
  const document = lines([
    'Data Availability', 'Package [Imtiaz et al. 2024].', 'REFERENCES',
    'Sayem Imtiaz and Hridesh Rajan. 2024. Data at https://huggingface.co/datasets/example',
    'Ziwei Ji, Nayeon Lee, and Pascale Fung.',
    '2023. Other work. doi:10.1145/3571730'
  ]);
  assert.deepEqual(collectDOIs(document, [], findStatements(document)), []);
});

test('repository links are whitelisted, deduplicated, and tied to the DAS or its cited references', () => {
  const document = lines([
    'Data Availability Statement', 'Code at https://github.com/team/tool and Zenodo https://zenodo.org/records/123 [7].',
    'https://evil.example/github.com/team/tool', 'REFERENCES',
    '7. Dataset at https://figshare.com/s/abc.', 'https://github.com/team/tool',
    '8. Unrelated https://github.com/other/repo'
  ]);
  const annotations = [
    {url:'https://github.com/team/tool', page:1, rect:[0, 50, 100, 58]},
    {url:'https://github.com/other/repo', page:1, rect:[0, 60, 100, 68]},
    {url:'https://github.com/unrelated', page:2, rect:[0, 10, 100, 18]}
  ];
  assert.deepEqual(collectRepositoryLinks(document, annotations, findStatements(document)).map(record => record.url), [
    'https://github.com/team/tool', 'https://zenodo.org/records/123', 'https://figshare.com/s/abc'
  ]);
  assert.deepEqual(collectDOIs(document, annotations, findStatements(document)), []);
});

test('wrapped repository URLs join within one reference, not across entries', () => {
  const document = lines([
    'Data Availability Statement', 'The artifact is in [57].', 'REFERENCES',
    '[57] AMCDroid, https://zenodo.org/record/', '7886463#.ZFEPjHZByUk.',
    '[58] Unrelated https://github.com/other/', 'repository'
  ]);
  assert.deepEqual(collectRepositoryLinks(document, [], findStatements(document)).map(record => record.url), [
    'https://zenodo.org/record/7886463#.ZFEPjHZByUk'
  ]);
  const unselected = lines(['Data Availability Statement', 'See https://github.com/team/', 'Unrelated text', 'REFERENCES']);
  assert.deepEqual(collectRepositoryLinks(unselected, [], findStatements(unselected)).map(record => record.url), [
    'https://github.com/team/'
  ]);
});

test('repository URL wrapped immediately after scheme joins its hostname', () => {
  const document = lines([
    'Data Availability Statement', 'Package [5].', 'REFERENCES',
    '[5] State field coverage implementation and replication package. https://',
    'zenodo.org/records/17255287, 2025.',
    '[6] Unrelated https://github.com/other/repo'
  ]);
  assert.deepEqual(collectRepositoryLinks(document, [], findStatements(document)).map(record => record.url), [
    'https://zenodo.org/records/17255287'
  ]);
});

test('scheme split after colon is joined only within the same selected excerpt and page', () => {
  const document = lines([
    'Data Availability', 'Artifact at https:', '//github.com/team/package.',
    'See [5].', 'REFERENCES', '[5] Archive https:', '//zenodo.org/records/12345.',
    '[6] Unrelated https:', '//github.com/other/project'
  ]);
  assert.deepEqual(collectRepositoryLinks(document, [], findStatements(document)).map(record => record.url), [
    'https://github.com/team/package', 'https://zenodo.org/records/12345'
  ]);
  const boundary = lines(['Data Availability', 'See https:', 'REFERENCES', '//github.com/unrelated/project']);
  assert.deepEqual(collectRepositoryLinks(boundary, [], findStatements(boundary)), []);
  const pages = lines(['Data Availability', 'See https:', '//github.com/unrelated/project']);
  pages[2].page = 2;
  assert.deepEqual(collectRepositoryLinks(pages, [], findStatements(pages)), []);
});

test('bare DAS footnote markers resolve numbered URL footnotes, not other footnotes', () => {
  const document = lines([
    '1 https://github.com/irrelevant/tool',
    'Data Availability', 'Our artifact is available on Zenodo 3 and GitHub 4.',
    '3 https://doi.org/10.5281/zenodo.13371822',
    '4 https://github.com/kupl/NPETestArtifact',
    '5 https://github.com/unrelated/project', 'References',
    '[3] Unrelated https://github.com/unrelated/reference'
  ]);
  assert.deepEqual(collectDOIs(document, [], findStatements(document)).map(record => record.id), ['10.5281/zenodo.13371822']);
  assert.deepEqual(collectRepositoryLinks(document, [], findStatements(document)).map(record => record.url), ['https://github.com/kupl/NPETestArtifact']);
});

test('bare footnote marker may occupy its own extracted line and URL may wrap', () => {
  const document = lines([
    'Data Availability', 'Our replication package', '1', 'is publicly available.',
    '1 https://github.com/example/replication-', 'package',
    '2 https://github.com/unrelated/tool'
  ]);
  assert.deepEqual(collectRepositoryLinks(document, [], findStatements(document)).map(record => record.url), [
    'https://github.com/example/replication-package'
  ]);
});

test('bare DAS marker resolves a linked footnote label', () => {
  const document = lines(['Data Availability', 'Replication package on GitHub 18.', '18 Replication package']);
  document[2].boxes = [[0, 0, 100, 10]];
  const annotations = [{page:1, rect:[5, 0, 70, 10], url:'https://github.com/example/package'}];
  assert.deepEqual(collectRepositoryLinks(document, annotations, findStatements(document)).map(record => record.url), ['https://github.com/example/package']);
});

test('wrapped DOI URLs are reconstructed from selected reference lines', () => {
  const document = lines([
    'Data Availability Statement', 'Package [7].', 'REFERENCES',
    '[7] Package https://doi.org/10.5281/', 'zenodo.18244158.',
    '[8] Unrelated https://doi.org/10.5281/zenodo.99999999'
  ]);
  assert.deepEqual(collectDOIs(document, [], findStatements(document)).map(record => record.id), [
    '10.5281/zenodo.18244158'
  ]);
});

test('paper-specific hosts are excluded, including in cited references', () => {
  const document = lines([
    'Data Availability Statement', 'Projects and data are available in [15].', 'REFERENCES',
    '15. Project materials.', 'Project link', '16. Other materials.', 'Other link'
  ]);
  const annotations = [
    {url:'https://gitlab.nibbler.fh-swf.de/publications/sesl-feasibility', page:1, rect:[0, 10, 100, 18]},
    {url:'https://ilink.cybershare.utep.edu/project-details-is-cuco.html', page:1, rect:[0, 40, 100, 48]},
    {url:'https://github.com.evil.example/repo', page:1, rect:[0, 10, 100, 18]}
  ];
  assert.deepEqual(collectRepositoryLinks(document, annotations, findStatements(document)), []);
});

test('artifact-location whitelist accepts subdomains but rejects lookalikes and unrelated Google hosts', () => {
  const document = lines(['Data Availability Statement', 'Artifact locations:', 'REFERENCES']);
  const hosts = ['zenodo.org', 'figshare.com', 'github.com', 'gitlab.com',
    'sites.google.com', 'github.io', 'anonymous.4open.science'];
  const annotations = hosts.flatMap(domain => [
    {url:`https://sub.${domain}/project`, page:1, rect:[0, 10, 100, 18]},
    {url:`https://${domain}.evil.example/project`, page:1, rect:[0, 10, 100, 18]}
  ]).concat([
    {url:'https://google.com/project', page:1, rect:[0, 10, 100, 18]},
    {url:'https://drive.google.com/project', page:1, rect:[0, 10, 100, 18]}
  ]);
  assert.deepEqual(collectRepositoryLinks(document, annotations, findStatements(document)).map(record => record.url),
    hosts.map(domain => `https://sub.${domain}/project`));
});

test('root URLs on allowed hosts are artifact-location signals', () => {
  const document = lines([
    'Data Availability',
    'Project website https://mr-adopt.github.io/ and https://github.com/ and https://gitlab.com/',
    'Additional location https://zenodo.org/.'
  ]);
  assert.deepEqual(collectRepositoryLinks(document, [], findStatements(document)).map(record => record.url), [
    'https://mr-adopt.github.io/', 'https://github.com/', 'https://gitlab.com/', 'https://zenodo.org/'
  ]);
});

test('DAS, cited reference, and footnote can link to artifact websites', () => {
  const document = lines([
    'Data Availability', 'Materials at https://sites.google.com/view/research and [3]. Also see website 2.',
    '2 https://anonymous.4open.science/r/package-A123', 'REFERENCES',
    '[3] Source at https://team.github.io/project/',
    '[4] Unrelated https://sites.google.com/view/unrelated'
  ]);
  assert.deepEqual(collectRepositoryLinks(document, [], findStatements(document)).map(record => record.url), [
    'https://sites.google.com/view/research', 'https://anonymous.4open.science/r/package-A123',
    'https://team.github.io/project/'
  ]);
});

test('split Zenodo DOI digits are suppressed only within the same selected reference', () => {
  const document = lines([
    'Data Availability Statement', 'Packages [Paramitha et al. 2025a,b].', 'REFERENCES',
    'Ranindya Paramitha. 2025a. Part one. https://doi.org/10.5281/zenodo.10966',
    '117', 'Ranindya Paramitha. 2025b. Part two. https://doi.org/10.5281/zenodo.10967'
  ]);
  const annotations = [{url:'https://doi.org/10.5281/zenodo.10966117', page:1, rect:[0,30,100,38]}];
  assert.deepEqual(collectDOIs(document, annotations, findStatements(document)).map(record => record.id).sort(), [
    '10.5281/zenodo.10966117', '10.5281/zenodo.10967'
  ].sort());
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
