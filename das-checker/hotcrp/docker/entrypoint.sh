#!/usr/bin/env bash
set -euo pipefail
cd /var/www/html
# The DB healthcheck gates startup; initialize a fresh volume exactly once.
if ! mariadb -h "${DB_HOST:-db}" -u hotcrp hotcrp -e 'SELECT 1 FROM Settings LIMIT 1' >/dev/null 2>&1; then
  mariadb -h "${DB_HOST:-db}" -u hotcrp hotcrp < src/schema.sql
fi
php /opt/das-checker/hotcrp/docker/seed.php
exec docker-php-entrypoint "$@"
