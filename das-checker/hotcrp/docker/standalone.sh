#!/usr/bin/env bash
# Local demo only: supervise MariaDB and Apache in one container.
set -euo pipefail
mkdir -p /run/mysqld /var/lib/mysql
chown mysql:mysql /run/mysqld /var/lib/mysql
if [[ ! -d /var/lib/mysql/mysql ]]; then
  mariadb-install-db --user=mysql --datadir=/var/lib/mysql --auth-root-authentication-method=socket --skip-test-db >/dev/null
fi
mariadbd --user=mysql --datadir=/var/lib/mysql --bind-address=127.0.0.1 --max-allowed-packet=128M &
db_pid=$!
web_pid=
cleanup() {
  trap - TERM INT EXIT
  [[ -z "$web_pid" ]] || kill -TERM "$web_pid" 2>/dev/null || true
  kill -TERM "$db_pid" 2>/dev/null || true
  [[ -z "$web_pid" ]] || wait "$web_pid" 2>/dev/null || true
  wait "$db_pid" 2>/dev/null || true
}
trap cleanup TERM INT EXIT
ready=0
for ((i=0; i<60; i++)); do
  if mariadb-admin --protocol=socket -u root ping --silent >/dev/null 2>&1; then ready=1; break; fi
  kill -0 "$db_pid" 2>/dev/null || { echo 'MariaDB exited during startup' >&2; exit 1; }
  sleep 1
done
[[ "$ready" == 1 ]] || { echo 'MariaDB startup timed out' >&2; exit 1; }
mariadb --protocol=socket -u root <<'SQL'
CREATE DATABASE IF NOT EXISTS hotcrp;
CREATE USER IF NOT EXISTS 'hotcrp'@'127.0.0.1' IDENTIFIED BY 'local-test-only';
CREATE USER IF NOT EXISTS 'hotcrp'@'localhost' IDENTIFIED BY 'local-test-only';
GRANT ALL ON hotcrp.* TO 'hotcrp'@'127.0.0.1';
GRANT ALL ON hotcrp.* TO 'hotcrp'@'localhost';
SQL
bash /opt/das-checker/hotcrp/docker/entrypoint.sh "$@" &
web_pid=$!
# Stop the other service if either exits; signal handling also shuts both down.
set +e
wait -n "$db_pid" "$web_pid"
status=$?
exit "$status"
