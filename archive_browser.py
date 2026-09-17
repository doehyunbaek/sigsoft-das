"""Archive CFP sources with Wayback's headful Save Page Now form.

Stops on errors or human-interaction requirements rather than bypassing them.
Run: uv run --with playwright python archive_browser.py
"""
import argparse
import csv
import hashlib
import json
import re
import time
from datetime import datetime, timezone
from pathlib import Path

import httpx
from bs4 import BeautifulSoup
from playwright.sync_api import sync_playwright, Error

from scrape import CALL, CALL_URLS


def sync_dataset(output):
    results = json.loads(output.read_text()) if output.exists() else []
    snapshots = {row['url']: row['snapshot_url'] for row in results if row.get('snapshot_url')}
    path = Path('data/calls.json')
    data = json.loads(path.read_text())
    for record in data['calls']:
        url = record['url']
        record['call_url'] = CALL_URLS.get(url, record.get('call_url', url))
        cache = Path('.cache') / (hashlib.sha256(url.encode()).hexdigest() + '.html')
        if '#' not in record['call_url'] and cache.exists():
            soup = BeautifulSoup(cache.read_text(), 'html.parser')
            for pane in soup.select('.tab-pane[id]'):
                heading = pane.find(['h1', 'h2', 'h3', 'h4'])
                if (heading and heading.get_text(' ', strip=True) == record['heading']) or CALL.search(pane['id'].replace('-', ' ')):
                    record['call_url'] = url + '#' + pane['id']
                    break
        if url in snapshots:
            record['snapshot_url'] = snapshots[url]
    path.write_text(json.dumps(data, ensure_ascii=False, indent=2))
    with Path('data/calls.csv').open('w', newline='') as stream:
        fields = ['series', 'edition', 'year', 'url', 'call_url', 'snapshot_url', 'title', 'heading', 'text', 'important_dates']
        writer = csv.DictWriter(stream, fieldnames=fields)
        writer.writeheader()
        for record in data['calls']:
            writer.writerow({**record, 'important_dates': '\n'.join(record['important_dates'])})


def verify_snapshots(delay):
    calls = json.loads(Path('data/calls.json').read_text())['calls']
    failures = []
    with httpx.Client(follow_redirects=True, timeout=90, headers={'User-Agent': 'sigsoft-cfp snapshot verifier/0.1'}) as client:
        for index, call in enumerate(calls):
            if index:
                time.sleep(delay)
            url = call.get('snapshot_url', '')
            response = None
            try:
                response = client.get(url) if url.startswith('https://web.archive.org/web/') else None
                ok = response is not None and response.status_code == 200 and httpx.URL(call['url']).host in response.text
            except httpx.HTTPError as exc:
                ok = False
                print(f"{call['series'].upper()} {call['year']}: {exc}", flush=True)
            print(f"{call['series'].upper()} {call['year']}: {'OK' if ok else 'FAILED'}", flush=True)
            if not ok:
                failures.append((call['series'], call['year']))
            if response is not None and response.status_code == 429:
                print('Rate limited; stopping verification.', flush=True)
                break
    if failures:
        raise SystemExit(f'Playback verification failures: {failures}')


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--series', nargs='+', choices=['icse', 'fse', 'ase'], default=['icse', 'fse', 'ase'])
    parser.add_argument('--output', type=Path, default=Path('data/wayback-browser.json'))
    parser.add_argument('--force', action='store_true', help='Request new captures even when the dataset already has snapshots')
    parser.add_argument('--verify', action='store_true', help='Gently verify playback after syncing')
    parser.add_argument('--verify-delay', type=float, default=6.0)
    args = parser.parse_args()
    output = args.output
    output.parent.mkdir(parents=True, exist_ok=True)
    results = json.loads(output.read_text()) if output.exists() else []
    done = {r['url'] for r in results if r.get('snapshot_url')}
    calls = json.loads(Path('data/calls.json').read_text())['calls']
    if not args.force:
        done.update(call['url'] for call in calls if call.get('snapshot_url'))
    with sync_playwright() as p:
        browser = p.chromium.launch(headless=False)
        page = browser.new_page()
        for call in calls:
            if call['series'] not in args.series or call['url'] in done:
                continue
            url = call['url']
            row = {'url': url, 'attempted_at': datetime.now(timezone.utc).isoformat()}
            try:
                page.goto('https://web.archive.org/save', wait_until='domcontentloaded', timeout=60000)
                page.locator('#web-save-url-input').fill(url)
                # Never archive an error page as a successful CFP capture.
                page.locator('#capture_all').uncheck()
                page.locator('#web-save-form input[type=submit]').click()
                row['status'] = 'unconfirmed'
                for _ in range(200):
                    page.wait_for_timeout(3000)
                    body = page.locator('body').inner_text()
                    links = page.locator('a[href]').evaluate_all('(nodes) => nodes.map(n => n.href)')
                    snapshots = [u for u in [page.url, *links] if re.match(r'https://web\.archive\.org/web/\d{14}/https?://', u) and url in u]
                    if snapshots:
                        row.update(status='snapshot_reported', snapshot_url=snapshots[0])
                        break
                    if re.search(r'captcha|verify you are human|too many requests|rate limit|access denied|save error|failed to save|error:|please log in to', body, re.I):
                        row.update(status='needs_review', detail=body[-5000:])
                        break
                if not row.get('snapshot_url'):
                    row['detail'] = page.locator('body').inner_text()[-5000:]
                    page.screenshot(path='data/wayback-browser-status.png', full_page=True)
            except Error as exc:
                row.update(status='failed', detail=str(exc))
            results.append(row)
            output.write_text(json.dumps(results, indent=2))
            print(json.dumps(row), flush=True)
            if not row.get('snapshot_url'):
                print('Stopped; no challenges are automated. Inspect data/wayback-browser-status.png.', flush=True)
                break
            page.wait_for_timeout(15000)
        browser.close()
    sync_dataset(output)
    if args.verify:
        verify_snapshots(args.verify_delay)


if __name__ == '__main__':
    main()
