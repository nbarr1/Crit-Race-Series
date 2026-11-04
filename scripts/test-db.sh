#!/usr/bin/env bash
# Runs the SQL security tests.
#
#   npm run test:db                         # fresh local Postgres database with a Supabase shim
#   DATABASE_URL=postgres://... npm run test:db -- --existing
#                                           # an existing Supabase database (migrations already applied)
#
# Local mode needs a Postgres 15+ server reachable through the standard PG*
# environment variables (PGHOST, PGUSER, PGPASSWORD, PGPORT), as a superuser.
set -euo pipefail
cd "$(dirname "$0")/.."

PSQL=(psql -X -q -t -A -v ON_ERROR_STOP=1)

if [[ "${1:-}" == "--existing" ]]; then
  : "${DATABASE_URL:?Set DATABASE_URL to run against an existing database}"
  "${PSQL[@]}" "$DATABASE_URL" -f supabase/tests/_helpers.sql
  for f in supabase/tests/*.test.sql; do
    echo "# $f"
    "${PSQL[@]}" "$DATABASE_URL" -f "$f" 2>&1 | sed 's/^psql:[^ ]* NOTICE:  /  /'
  done
  exit 0
fi

DB="${TEST_DB_NAME:-crit_race_series_test}"
PGOPTIONS="-c client_min_messages=warning" "${PSQL[@]}" -d postgres -c "drop database if exists $DB" -c "create database $DB" >/dev/null
PGOPTIONS="-c client_min_messages=warning" "${PSQL[@]}" -d "$DB" -f supabase/tests/_shim/supabase_shim.sql >/dev/null
for f in supabase/migrations/*.sql; do
  PGOPTIONS="-c client_min_messages=warning" "${PSQL[@]}" -d "$DB" -f "$f" >/dev/null
done
"${PSQL[@]}" -d "$DB" -f supabase/tests/_helpers.sql >/dev/null

status=0
for f in supabase/tests/*.test.sql; do
  echo "# $f"
  if ! "${PSQL[@]}" -d "$DB" -f "$f" 2>&1 | grep -Ev '^\s*$' | sed -E 's/^psql:[^ ]+ (NOTICE|ERROR):  /  /'; then
    status=1
  fi
done
# The demo seed must load cleanly against every constraint and trigger.
echo "# seed data"
if npx tsx scripts/seed.ts --sql | PGOPTIONS="-c client_min_messages=warning" "${PSQL[@]}" -d "$DB" >/dev/null; then
  counts=$("${PSQL[@]}" -d "$DB" -c "select (select count(*) from public.profiles) || ' profiles, ' || (select count(*) from public.events) || ' events, ' || (select count(*) from public.registrations) || ' registrations, ' || (select count(*) from public.results) || ' results'")
  echo "  ok - seed loads ($counts)"
else
  echo "  not ok - seed failed to load"
  status=1
fi
exit $status
