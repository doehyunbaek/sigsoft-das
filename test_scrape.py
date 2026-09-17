import unittest

from bs4 import BeautifulSoup
from scrape import clean_url, extract


class ScraperTests(unittest.TestCase):
    def test_url_scope(self):
        self.assertEqual(clean_url('/track/ase-2026/research#Call-for-Papers'),
                         'https://conf.researchr.org/track/ase-2026/research')
        self.assertIsNone(clean_url('https://example.org/cfp'))
        self.assertIsNone(clean_url('/signin?next=home'))

    def test_ase_2018_url(self):
        self.assertEqual(clean_url('https://www.ase2018.com/?p=calls#papers'),
                         'https://www.ase2018.com/?p=calls')
        self.assertIsNone(clean_url('https://www.ase2018.com/?p=program'))

    def test_ase_2018_combined_calls_page(self):
        soup = BeautifulSoup('<main><div id="papers">Call for Papers - Research Track</div>'
                             '<div><p>Research CFP text.</p></div>'
                             '<div id="demonstrations">Call for Tool Demonstrations</div>'
                             '<div><p>Tool call text.</p></div></main>', 'html.parser')
        calls, _ = extract(soup)
        self.assertEqual(len(calls), 1)
        self.assertIn('Research CFP text.', calls[0]['text'])
        self.assertNotIn('Tool call text.', calls[0]['text'])
        self.assertEqual(calls[0]['anchor'], 'papers')

    def test_icse_archive_urls(self):
        self.assertEqual(clean_url('https://2019.icse-conferences.org/'),
                         'https://2019.icse-conferences.org')
        self.assertEqual(clean_url('/track/research', 'https://2019.icse-conferences.org'),
                         'https://2019.icse-conferences.org/track/research')
        self.assertIsNone(clean_url('https://unrelated.example/track/research'))

    def test_fse_archive_urls(self):
        self.assertEqual(clean_url('https://2024.esec-fse.org/track/research'),
                         'https://2024.esec-fse.org/track/research')
        self.assertEqual(clean_url('https://esec-fse19.ut.ee/calls/research-papers/'),
                         'https://esec-fse19.ut.ee/calls/research-papers/')

    def test_independent_fse_article(self):
        soup = BeautifulSoup('<nav><h2>Call navigation</h2></nav><article>'
                             '<h1>Call for Research Papers</h1><p>' + 'Submit original research. ' * 8
                             + '</p></article>', 'html.parser')
        calls, _ = extract(soup)
        self.assertEqual(len(calls), 1)
        self.assertNotIn('navigation', calls[0]['text'])

    def test_call_tab_and_dates(self):
        soup = BeautifulSoup('''<div id="content">
        <div class="tab-pane" id="Call-for-Artifacts"><h2>Call for Artifacts</h2>
        <p>Submit your artifacts.</p></div>
        <table class="important-dates-in-sidebar"><tr><td>1 May 2026</td>
        <td>Submission deadline</td></tr></table></div>''', 'html.parser')
        calls, dates = extract(soup)
        self.assertEqual(len(calls), 1)
        self.assertEqual(calls[0]['heading'], 'Call for Artifacts')
        self.assertIn('Submit your artifacts.', calls[0]['text'])
        self.assertIn('Submission deadline', dates[0])

    def test_unlabelled_submission_call(self):
        soup = BeautifulSoup('<div id="content"><div class="tab-pane" id="Foundations-Track">'
                             '<h1>Foundations Track</h1><p>We invite authors to submit original papers. '
                             + 'Submission instructions and evaluation criteria. ' * 6
                             + '</p></div></div>', 'html.parser')
        calls, _ = extract(soup)
        self.assertEqual(len(calls), 1)
        self.assertEqual(calls[0]['heading'], 'Foundations Track')

    def test_participation_call(self):
        soup = BeautifulSoup('<div class="tab-pane" id="About"><h2>How to Participate</h2><p>'
                             + 'Interested participants can sign up for the symposium. ' * 6
                             + '</p></div>', 'html.parser')
        self.assertEqual(len(extract(soup)[0]), 1)

    def test_article_nested_title_preserves_body(self):
        soup = BeautifulSoup('<article><header><h1>Call for Doctoral Symposium Papers</h1></header>'
                             '<div><h2>Scope</h2><p>Submit your research.</p>'
                             '<h2>Submission</h2><p>Deadline: May 1.</p></div></article>', 'html.parser')
        calls, _ = extract(soup)
        self.assertEqual(len(calls), 1)
        self.assertIn('Deadline: May 1.', calls[0]['text'])

    def test_navigation_is_not_a_call(self):
        soup = BeautifulSoup('<nav><a>Call for Papers</a></nav><div id="content"><h2>Accepted Papers</h2></div>', 'html.parser')
        self.assertEqual(extract(soup), ([], []))

    def test_plain_heading(self):
        soup = BeautifulSoup('<div id="content"><h2>Call for Participation</h2><p>' +
                             'Participate in our annual research event. ' * 5 +
                             '</p><h2>Committee</h2><p>Not call text</p></div>', 'html.parser')
        calls, _ = extract(soup)
        self.assertEqual(len(calls), 1)
        self.assertNotIn('Not call text', calls[0]['text'])


if __name__ == '__main__':
    unittest.main()
