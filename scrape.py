"""Collect published calls from conference editions linked by Researchr series."""
import argparse
import csv
import hashlib
import json
import re
import time
from collections import deque
from datetime import datetime, timezone
from pathlib import Path
from urllib.parse import urljoin, urlsplit, urlunsplit

import httpx
from bs4 import BeautifulSoup

BASE = 'https://conf.researchr.org'
SERIES = ['icse', 'fse', 'ase']
ARCHIVE_HOSTS = (
    {f'{year}.icse-conferences.org' for year in (2019, 2020, 2021)}
    | {f'{year}.esec-fse.org' for year in range(2020, 2025)}
    | {'2018.fseconference.org', 'esec-fse19.ut.ee', '2019.aseconf.org', 'www.ase2018.com'}
)
CALL = re.compile(r'\bcalls?\s+for\b|\bcf[paxs]\b', re.I)


def clean_url(href, base=BASE):
    p = urlsplit(urljoin(base, href))
    ase_2018 = p.hostname == 'www.ase2018.com' and p.path == '/' and p.query == 'p=calls'
    if p.hostname not in {'conf.researchr.org', *ARCHIVE_HOSTS} or (p.query and not ase_2018) or '@' in p.path or p.scheme not in ('http', 'https'):
        return None
    path = p.path if p.hostname in ('esec-fse19.ut.ee', 'www.ase2018.com') else p.path.rstrip('/')
    return urlunsplit(('https', p.netloc, path, p.query if ase_2018 else '', ''))


CALL_URLS = {
    'https://2019.icse-conferences.org/track/icse-2019-Technical-Papers': 'https://2019.icse-conferences.org/track/icse-2019-Technical-Papers?#Call-for-Papers',
    f'{BASE}/track/icse-2018/icse-2018-Technical-Papers': f'{BASE}/track/icse-2018/icse-2018-Technical-Papers#Technical-track-submissions',
    f'{BASE}/track/icse-2026/icse-2026-research-track': f'{BASE}/track/icse-2026/icse-2026-research-track?#Call-for-Papers',
    f'{BASE}/track/icse-2025/icse-2025-research-track': f'{BASE}/track/icse-2025/icse-2025-research-track?#Call-for-Papers',
    f'{BASE}/track/icse-2024/icse-2024-research-track': f'{BASE}/track/icse-2024/icse-2024-research-track#Call-for-papers',
    f'{BASE}/track/icse-2023/icse-2023-technical-track': f'{BASE}/track/icse-2023/icse-2023-technical-track?#About',
    f'{BASE}/track/icse-2022/icse-2022-papers': f'{BASE}/track/icse-2022/icse-2022-papers?#Call-for-Papers',
    'https://2021.icse-conferences.org/track/icse-2021-papers': 'https://2021.icse-conferences.org/track/icse-2021-papers#Call-for-Papers',
    'https://2020.icse-conferences.org/track/icse-2020-papers': 'https://2020.icse-conferences.org/track/icse-2020-papers?#Call-for-Papers',
}


def is_research_title(title):
    return any(part.strip().lower() in {'research papers', 'research track', 'technical papers', 'technical track'}
               for part in re.split(r'\s+[–—-]\s+', title)) or title.strip() == 'ASE 2018'


def research_sections(sections):
    explicit = [s for s in sections if CALL.search(s['heading'] or '')]
    if explicit:
        return explicit
    # Older editions publish their research CFP under a submission heading.
    return [s for s in sections if (s['heading'] or '').lower() in
            {'how to submit', 'technical track submissions'}]


def text(node):
    return '\n'.join(line.strip() for line in node.get_text('\n', strip=True).splitlines() if line.strip())


def extract(soup):
    content = soup.select_one('article') or soup.select_one('#content') or soup
    sections = []
    # ASE 2018 publishes several calls on one page, delimited by anchored titles.
    papers = content.select_one('#papers')
    if papers:
        parts = [text(papers)]
        for sibling in papers.next_siblings:
            if getattr(sibling, 'get', lambda *_: None)('id') == 'demonstrations':
                break
            if hasattr(sibling, 'get_text'):
                parts.append(text(sibling))
        sections.append({'heading': text(papers), 'text': '\n'.join(filter(None, parts)), 'anchor': 'papers'})
        return sections, []
    # Independent archive pages may wrap the title and body in separate nodes.
    # Keep the whole article rather than stopping at its first subsection.
    if content.name == 'article':
        heading = content.find(['h1', 'h2', 'h3'])
        if heading and CALL.search(heading.get_text(' ', strip=True)):
            sections.append({'heading': heading.get_text(' ', strip=True), 'text': text(content)})
            return sections, []
    for pane in content.select('.tab-pane'):
        heading = pane.find(['h1', 'h2', 'h3', 'h4'])
        pane_text = text(pane)
        # Some tracks publish the call under About, Foundations Track, etc.
        submission_call = (
            pane.get('id', '').lower() not in ('program', 'event-overview')
            and re.search(r'\b(?:we invite|are invited|solicits?|welcome submissions|call for)\b', pane_text, re.I)
            and re.search(r'\b(?:submit|submission|submissions)\b', pane_text, re.I)
            and len(pane_text) > 200
        )
        participation_call = (
            pane.get('id', '').lower() not in ('program', 'event-overview')
            and len(pane_text) > 200
            and re.search(r'how to participate|application deadline|workshop proposal guidelines', pane_text, re.I)
            and re.search(r'sign up|apply|proposals? should|proposals? must', pane_text, re.I)
        )
        if CALL.search(pane.get('id', '').replace('-', ' ')) or (heading and CALL.search(heading.get_text(' ', strip=True))) or submission_call or participation_call:
            sections.append({'heading': heading.get_text(' ', strip=True) if heading else pane.get('id'), 'text': text(pane), 'anchor': pane.get('id', '')})
    if not sections:
        for heading in content.find_all(['h1', 'h2', 'h3', 'h4']):
            if not CALL.search(heading.get_text(' ', strip=True)):
                continue
            parts = [heading.get_text(' ', strip=True)]
            for sibling in heading.next_siblings:
                if getattr(sibling, 'name', '') in ('h1', 'h2'):
                    break
                if hasattr(sibling, 'get_text'):
                    parts.append(text(sibling))
            if len('\n'.join(parts)) > 80:
                sections.append({'heading': parts[0], 'text': '\n'.join(parts)})
    dates = [text(row) for row in content.select('table.important-dates-in-sidebar tr')]
    return sections, dates


class Fetcher:
    def __init__(self, cache):
        self.cache = cache
        cache.mkdir(parents=True, exist_ok=True)
        self.client = httpx.Client(timeout=45, headers={'User-Agent': 'sigsoft-cfx/0.1 (public conference call research)'})
        self.last = 0
        self.policies = {}
        self.load_policy(BASE)

    def load_policy(self, origin):
        if origin in self.policies:
            self.rules, self.delay = self.policies[origin]
            return
        time.sleep(max(0, 2 - (time.monotonic() - self.last)))
        # Researchr robots.txt uses wildcard rules unsupported by urllib.robotparser.
        r = self.client.get(origin + '/robots.txt')
        if r.status_code != 404:
            r.raise_for_status()
        self.rules = []
        self.delay = 2.0
        active = False
        for line in (r.text.splitlines() if r.status_code != 404 else []):
            key, _, value = line.partition(':')
            value = value.strip()
            if key.lower() == 'user-agent':
                active = value == '*'
            elif active and key.lower() == 'disallow' and value:
                self.rules.append(re.compile('^' + re.escape(value).replace(r'\*', '.*')))
            elif active and key.lower() == 'crawl-delay':
                self.delay = max(2.0, float(value))
        self.policies[origin] = (self.rules, self.delay)
        self.last = time.monotonic()

    def get(self, url, visited=None):
        visited = set() if visited is None else visited
        if url in visited or len(visited) >= 10:
            raise ValueError('Redirect loop or limit exceeded')
        visited.add(url)
        parsed = urlsplit(url)
        self.load_policy(f'{parsed.scheme}://{parsed.netloc}')
        if any(rule.search(urlsplit(url).path) for rule in self.rules):
            raise ValueError('robots.txt disallows URL')
        path = self.cache / (hashlib.sha256(url.encode()).hexdigest() + '.html')
        if path.exists():
            return BeautifulSoup(path.read_text(), 'html.parser')
        for attempt in range(3):
            time.sleep(max(0, self.delay - (time.monotonic() - self.last)))
            self.last = time.monotonic()
            r = self.client.get(url)
            if r.is_redirect:
                target = clean_url(r.headers['location'], url)
                if not target or target == url:
                    raise ValueError('External or cyclic redirect: ' + r.headers['location'])
                return self.get(target, visited)
            if r.status_code == 429 or r.status_code >= 500:
                time.sleep(5 * (attempt + 1))
                continue
            r.raise_for_status()
            if 'html' not in r.headers.get('content-type', ''):
                raise ValueError('Not HTML')
            soup = BeautifulSoup(r.text, 'html.parser')
            if soup.title and 'not found' in soup.title.get_text().lower():
                raise ValueError('Page not found')
            path.write_text(r.text)
            return soup
        raise ValueError(f'HTTP {r.status_code} after retries')


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--series', nargs='+', choices=SERIES, default=SERIES)
    parser.add_argument('--years', nargs='+', type=int, help='Default: all linked editions')
    parser.add_argument('--output', type=Path, default=Path('data'))
    args = parser.parse_args()
    args.output.mkdir(parents=True, exist_ok=True)
    fetch = Fetcher(Path('.cache'))
    records, editions, errors = [], [], []
    snapshots = {}
    for snapshot_file in Path('data').glob('*wayback-browser.json'):
        snapshots.update({r['url']: r['snapshot_url'] for r in json.loads(snapshot_file.read_text()) if r.get('snapshot_url')})
    started = datetime.now(timezone.utc).isoformat()

    def get(url):
        try:
            print(url, flush=True)
            return fetch.get(url)
        except (httpx.HTTPError, ValueError) as exc:
            errors.append({'url': url, 'error': str(exc)})
            return None

    def save():
        report = {'started_at': started, 'updated_at': datetime.now(timezone.utc).isoformat(), 'series': args.series, 'years': args.years, 'editions': editions, 'calls': records, 'errors': errors}
        tmp = args.output / 'calls.json.tmp'
        tmp.write_text(json.dumps(report, ensure_ascii=False, indent=2))
        tmp.replace(args.output / 'calls.json')
        with (args.output / 'calls.csv').open('w', newline='') as f:
            fields = ['series', 'edition', 'year', 'url', 'call_url', 'snapshot_url', 'title', 'heading', 'text', 'important_dates']
            writer = csv.DictWriter(f, fieldnames=fields)
            writer.writeheader()
            for record in records:
                writer.writerow({**record, 'important_dates': '\n'.join(record['important_dates'])})

    for series in args.series:
        soup = get(f'{BASE}/series/{series}')
        if soup is None:
            save()
            continue
        rows = soup.select('.edition-row')
        if series == 'fse':
            # The Researchr series list omits the independently hosted 2019 edition.
            extra = BeautifulSoup('<tr class="edition-row"><td><h3><a href="https://esec-fse19.ut.ee">ESEC/FSE 2019</a></h3></td></tr>', 'html.parser')
            rows.append(extra.tr)
        elif series == 'ase':
            # ASE 2018 is available on its independently hosted calls page.
            extra = BeautifulSoup('<tr class="edition-row"><td><h3><a href="https://www.ase2018.com/?p=calls">ASE 2018</a></h3></td></tr>', 'html.parser')
            rows.append(extra.tr)
        for row in rows:
            a = row.select_one('h3 a')
            href = a.get('href') if a else row.get('href', '')
            label = row.select_one('h3')
            label = label.get_text(' ', strip=True) if label else href
            year_match = re.search(r'\b(19|20)\d{2}\b', label)
            year = int(year_match.group()) if year_match else None
            if year is None:
                continue
            if args.years and year not in args.years:
                continue
            home = clean_url(href)
            # Series pages can advertise archive domains even when Researchr
            # still serves the same edition. Prefer the verified internal home.
            if series == 'icse' and year in (2020, 2021):
                candidate = f'{BASE}/home/icse-{year}'
                probe = get(candidate)
                if probe is not None and probe.title and re.search(rf'ICSE\s*{year}', probe.title.get_text(), re.I):
                    home = candidate
            edition = {'series': series, 'edition': label, 'year': year, 'url': href, 'status': 'pending' if home else 'external_not_crawled'}
            editions.append(edition)
            if not home:
                continue
            parts = urlsplit(home).path.strip('/').split('/')
            archive_root = urlsplit(home).hostname in ARCHIVE_HOSTS and not urlsplit(home).path.strip('/')
            edition['crawl_url'] = home
            if not archive_root and (len(parts) < 2 or parts[0] not in ('home', 'track')):
                edition['status'] = 'unsupported_url'
                continue
            scope = parts[1:]
            queue, seen = deque([home]), set()
            before = len(records)
            while queue:
                url = queue.popleft()
                if url in seen:
                    continue
                seen.add(url)
                page = get(url)
                if page is None:
                    continue
                sections, dates = extract(page)
                title = page.title.get_text(' ', strip=True) if page.title else label
                sections = research_sections(sections) if is_research_title(title) else []
                for section in sections:
                    if any(r['series'] == series and r['year'] == year and r['text'] == section['text'] for r in records):
                        continue
                    anchor = section.get('anchor', '')
                    call_url = CALL_URLS.get(url, url + ('#' + anchor if anchor else ''))
                    records.append({'series': series, 'edition': label, 'year': year, 'url': url, 'call_url': call_url, 'snapshot_url': snapshots.get(url, ''), 'title': title, 'heading': section['heading'], 'text': section['text'], 'important_dates': dates})
                for link in page.select('a[href]'):
                    target = clean_url(link['href'], url)
                    if not target:
                        continue
                    p = urlsplit(target).path.strip('/').split('/')
                    if parts[0] == 'track' and target != home:
                        continue
                    if archive_root and urlsplit(target).hostname != urlsplit(home).hostname:
                        continue
                    edition_archive = series == 'icse' and urlsplit(target).hostname == f'{year}.icse-conferences.org'
                    if not archive_root and not edition_archive and p[1:1 + len(scope)] != scope:
                        continue
                    # Visit tracks, co-located workshop homes, and custom call pages;
                    # never programs, people, papers, committees or login actions.
                    if p[0] in ('track', 'home') or (urlsplit(target).hostname == 'esec-fse19.ut.ee' and p[0] == 'calls') or (p[0] == 'info' and CALL.search(link.get_text(' ', strip=True) + ' ' + target.replace('-', ' '))):
                        if target not in seen:
                            queue.append(target)
                save()
            edition.update(status='crawled', pages=len(seen), calls=len(records) - before)
            save()
    save()
    print(f'Saved {len(records)} calls; {len(errors)} errors to {args.output}', flush=True)


if __name__ == '__main__':
    main()
