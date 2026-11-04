-- Test helpers. Loaded before each test file. Works on plain Postgres (with the
-- shim) and on a Supabase database (psql "$DATABASE_URL" -f ...).
create schema if not exists tests;
grant usage on schema tests to anon, authenticated, service_role;

create or replace function tests.ok(condition boolean, description text) returns void
language plpgsql as $$
begin
  if condition is not true then
    raise exception 'not ok - %', description;
  end if;
  raise notice 'ok - %', description;
end $$;

-- Asserts that the statement fails (permission error, RLS violation, or a
-- guard trigger). Statements that silently affect zero rows count as failures
-- of the test, so check row counts with tests.affected() for UPDATE/DELETE.
create or replace function tests.throws(statement text, description text) returns void
language plpgsql as $$
begin
  begin
    execute statement;
  exception when others then
    raise notice 'ok - % (%: %)', description, sqlstate, sqlerrm;
    return;
  end;
  raise exception 'not ok - % (statement succeeded: %)', description, statement;
end $$;

-- Runs an UPDATE/DELETE and returns the number of rows it touched.
create or replace function tests.affected(statement text) returns integer
language plpgsql as $$
declare n integer;
begin
  execute statement;
  get diagnostics n = row_count;
  return n;
end $$;

create or replace function tests.as_user(uid uuid) returns void
language plpgsql as $$
begin
  perform set_config('request.jwt.claims', json_build_object('sub', uid, 'role', 'authenticated')::text, true);
  execute 'set local role authenticated';
end $$;

create or replace function tests.as_anon() returns void
language plpgsql as $$
begin
  perform set_config('request.jwt.claims', json_build_object('role', 'anon')::text, true);
  execute 'set local role anon';
end $$;

grant execute on all functions in schema tests to anon, authenticated, service_role;
