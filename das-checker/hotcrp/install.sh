#!/usr/bin/env bash
set -euo pipefail
source_dir="$(cd "$(dirname "$0")" && pwd)"
hotcrp="${1:?Usage: bash install.sh /path/to/hotcrp}"
[[ -f "$hotcrp/src/papertable.php" ]] || { echo 'Not a HotCRP checkout' >&2; exit 1; }
[[ -f "$source_dir/../node_modules/pdfjs-dist/build/pdf.min.mjs" ]] || {
  echo 'First run: npm ci --prefix das-checker' >&2; exit 1;
}
# Refuse incompatible source trees before copying any assets.
if git -C "$hotcrp" apply --reverse --check "$source_dir/hotcrp.patch" 2>/dev/null; then
  echo 'Hook already installed.'
else
  git -C "$hotcrp" apply --check "$source_dir/hotcrp.patch"
  git -C "$hotcrp" apply "$source_dir/hotcrp.patch"
fi
mkdir -p "$hotcrp/scripts/das-checker"
cp "$source_dir/loader.js" "$source_dir/integration.js" "$source_dir/../core.js" "$hotcrp/scripts/das-checker/"
cp "$source_dir/../node_modules/pdfjs-dist/build/"{pdf.min.mjs,pdf.worker.min.mjs} "$hotcrp/scripts/das-checker/"
echo 'Installed. Enable dasChecker and the loader in conf/options.php as described in README.md.'
