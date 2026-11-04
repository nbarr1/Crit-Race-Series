#!/usr/bin/env bash
# Builds the database for end-to-end tests: shim, migrations, demo seed, and
# then puts "Race 4" on today's date so the check-in screen opens to it.
# Uses the same PG* variables as test-db.sh.
set -euo pipefail
cd "$(dirname "$0")/.."
DB="${E2E_DB_NAME:-crit_race_series_e2e}"
PSQL=(psql -X -q -v ON_ERROR_STOP=1)
export PGOPTIONS="-c client_min_messages=warning"
"${PSQL[@]}" -d postgres -c "drop database if exists $DB with (force)" -c "create database $DB" >/dev/null
"${PSQL[@]}" -d "$DB" -f supabase/tests/_shim/supabase_shim.sql >/dev/null
for f in supabase/migrations/*.sql; do "${PSQL[@]}" -d "$DB" -f "$f" >/dev/null; done
npx tsx scripts/seed.ts --sql | "${PSQL[@]}" -d "$DB" >/dev/null
"${PSQL[@]}" -d "$DB" >/dev/null <<'SQL'
update public.events set event_date = (now() at time zone 'America/New_York')::date,
  registration_opens_at = now() - interval '30 days', registration_closes_at = now() - interval '1 hour',
  status = 'published'
where name = 'Race 4';
update public.event_categories ec set start_at = now() + interval '2 hours'
from public.events e where e.id = ec.event_id and e.name = 'Race 4';
insert into public.announcements (title, body_markdown, priority)
values ('Course change for Race 4', 'Turn 3 is **closed**. Follow the cones.', 'urgent');
update public.events set weather_override_text = 'Course is wet in turn 3.' where name = 'Race 4';
SQL
echo "e2e database $DB ready"
