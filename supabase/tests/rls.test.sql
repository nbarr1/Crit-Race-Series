-- Row-level security tests. Each run happens inside one transaction that rolls
-- back, so it's safe to run against a database that already has data.
\set ON_ERROR_STOP on
begin;

-- ---------------------------------------------------------------------------
-- Fixtures (as the table owner)
-- ---------------------------------------------------------------------------
insert into auth.users (id, email, raw_user_meta_data) values
  ('00000000-0000-4000-8000-000000000001', 'rider1@test.local', '{"first_name":"Rita","last_name":"One"}'),
  ('00000000-0000-4000-8000-000000000002', 'rider2@test.local', '{"first_name":"Rory","last_name":"Two"}'),
  ('00000000-0000-4000-8000-000000000003', 'staff@test.local', '{}'),
  ('00000000-0000-4000-8000-000000000004', 'admin@test.local', '{}');

update public.profiles set
  display_name = 'Rory T.', birth_date = '1980-05-01', phone = '555-0102',
  emergency_contact_name = 'Secret Contact', emergency_contact_phone = '555-0199',
  emergency_contact_relationship = 'Partner', team = 'Team Two'
where user_id = '00000000-0000-4000-8000-000000000002';
update public.profiles set role = 'staff' where user_id = '00000000-0000-4000-8000-000000000003';
update public.profiles set role = 'admin' where user_id = '00000000-0000-4000-8000-000000000004';

create temp table fx as
select
  (select id from public.profiles where user_id = '00000000-0000-4000-8000-000000000001') as rider1,
  (select id from public.profiles where user_id = '00000000-0000-4000-8000-000000000002') as rider2,
  (select id from public.profiles where user_id = '00000000-0000-4000-8000-000000000003') as staff,
  (select id from public.profiles where user_id = '00000000-0000-4000-8000-000000000004') as admin,
  gen_random_uuid() as season, gen_random_uuid() as ev, gen_random_uuid() as draft_ev,
  gen_random_uuid() as ec, gen_random_uuid() as waiver;
grant select on fx to anon, authenticated;

insert into public.seasons (id, name, year, is_active, points_rules_id)
select season, 'Test season', 2027, false, (select id from public.points_rules limit 1) from fx;
insert into public.events (id, season_id, venue_id, name, event_date, registration_opens_at, registration_closes_at, status)
select ev, season, (select id from public.venues limit 1), 'Race 1', date '2027-05-12', timestamptz '2027-03-01', timestamptz '2027-05-11', 'published'::public.event_status from fx
union all
select draft_ev, season, (select id from public.venues limit 1), 'Secret draft', date '2027-06-12', timestamptz '2027-03-01', timestamptz '2027-06-11', 'draft'::public.event_status from fx;
insert into public.event_categories (id, event_id, category_id, start_at, duration_minutes)
select ec, ev, (select id from public.categories where name = 'B'), '2027-05-12 22:00+00', 40 from fx;
insert into public.registrations (rider_id, event_category_id, status, bib_number)
select rider1, ec, 'confirmed'::public.registration_status, 101 from fx union all select rider2, ec, 'confirmed', 102 from fx;
insert into public.waiver_versions (id, season_id, version_number, title, body_markdown, effective_date, is_current)
select waiver, season, 1, 'Waiver', 'Body', '2027-01-01', true from fx;
insert into public.waiver_signatures (rider_id, waiver_version_id, typed_full_name, agreed, ip_address)
select rider2, waiver, 'Rory Two', true, '203.0.113.9' from fx;
insert into public.results (event_category_id, rider_id, raw_name, place, points_awarded, is_published)
select ec, rider2, 'Rory Two', 1, 25, true from fx union all
select ec, rider1, 'Rita One', 2, 20, false from fx;
insert into storage.objects (bucket_id, name)
select 'waivers', rider2::text || '/sig.pdf' from fx;

-- ---------------------------------------------------------------------------
-- Rider 1
-- ---------------------------------------------------------------------------
select tests.as_user('00000000-0000-4000-8000-000000000001');

select tests.ok((select count(*) from public.profiles) = 1, 'rider sees only their own profile');
select tests.ok(
  (select count(*) from public.profiles p, fx where p.id = fx.rider2) = 0,
  'rider cannot read another rider''s profile row');
select tests.ok(
  (select count(*) from public.profiles where emergency_contact_name = 'Secret Contact') = 0,
  'rider cannot read another rider''s emergency contact');
select tests.ok(
  tests.affected($$update public.profiles set team = 'hacked' where user_id = '00000000-0000-4000-8000-000000000002'$$) = 0,
  'rider cannot update another rider''s profile');
select tests.ok(
  tests.affected($$update public.profiles set emergency_contact_name = 'Mom', emergency_contact_phone = '555-0000' where user_id = auth.uid()$$) = 1,
  'rider can update their own emergency contact');
select tests.throws($$update public.profiles set role = 'admin' where user_id = auth.uid()$$,
  'rider cannot promote themselves');
select tests.throws($$update public.profiles set email = 'x@y.z' where user_id = auth.uid()$$,
  'rider cannot change their profile email directly');
select tests.throws($$insert into public.profiles (first_name) values ('Fake')$$,
  'rider cannot create profiles');

select tests.throws(
  $$insert into public.results (event_category_id, raw_name, place) select ec, 'Me', 1 from fx$$,
  'rider cannot insert results');
select tests.ok(
  tests.affected($$update public.results set place = 1, points_awarded = 25$$) = 0,
  'rider cannot update results');
select tests.ok(tests.affected($$delete from public.results$$) = 0, 'rider cannot delete results');
select tests.ok((select count(*) from public.results) = 0,
  'rider does not see unpublished results, even their own');

select tests.ok((select count(*) from public.registrations) = 1, 'rider sees only their own registrations');
select tests.throws(
  $$insert into public.registrations (rider_id, event_category_id, status) select rider1, ec, 'confirmed' from fx$$,
  'rider cannot insert a registration directly');
select tests.ok(
  tests.affected($$update public.registrations set checked_in_at = now(), bib_number = 1$$) = 0,
  'rider cannot check themselves in');

select tests.ok((select count(*) from public.waiver_signatures) = 0, 'rider cannot read another rider''s waiver signature');
select tests.throws(
  $$insert into public.waiver_signatures (rider_id, waiver_version_id, typed_full_name, agreed) select rider1, waiver, 'Rita One', true from fx$$,
  'rider cannot insert a waiver signature directly (server records IP and user agent)');
select tests.ok((select count(*) from storage.objects where bucket_id = 'waivers') = 0,
  'rider cannot see another rider''s waiver PDF');

select tests.throws($$insert into public.announcements (title) values ('Fake news')$$, 'rider cannot post announcements');
select tests.throws($$insert into public.sponsors (name) values ('Fake sponsor')$$, 'rider cannot add sponsors');
select tests.ok(tests.affected($$update public.events set name = 'Mine'$$) = 0, 'rider cannot edit events');
select tests.ok(tests.affected($$update public.waiver_versions set is_current = false$$) = 0, 'rider cannot edit waiver versions');
select tests.ok(tests.affected($$update public.app_settings set value = 'false'$$) = 0, 'rider cannot change settings');
select tests.ok((select count(*) from public.audit_log) = 0, 'rider cannot read the audit log');
select tests.throws($$select public.admin_set_role((select rider1 from fx), 'admin')$$, 'rider cannot call admin_set_role');
select tests.ok((select count(*) from public.events where name = 'Secret draft') = 0, 'rider cannot see draft events');

reset role;

-- ---------------------------------------------------------------------------
-- Anonymous visitor
-- ---------------------------------------------------------------------------
select tests.as_anon();
select tests.throws($$select * from public.profiles$$, 'anon cannot read profiles');
select tests.throws($$select * from public.results$$, 'anon cannot read the raw results table');
select tests.throws($$select * from public.registrations$$, 'anon cannot read registrations');
select tests.throws($$select * from public.waiver_signatures$$, 'anon cannot read waiver signatures');
select tests.ok((select count(*) from public.public_results) = 1, 'anon sees only published results');
select tests.ok(
  (select display_name from public.public_results limit 1) = 'Rory T.',
  'public results show the display name');
select tests.ok(
  not exists (
    select 1 from information_schema.columns
    where table_schema = 'public' and table_name in ('public_results', 'public_riders', 'standings')
      and column_name in ('email', 'phone', 'birth_date', 'emergency_contact_name', 'emergency_contact_phone', 'bib', 'finish_time')
  ),
  'public views expose no private columns');
select tests.ok((select count(*) from public.events where name = 'Secret draft') = 0, 'anon cannot see draft events');
select tests.ok((select count(*) from public.events where name = 'Race 1') = 1, 'anon can see published events');
select tests.ok((select total_points from public.standings limit 1) = 25, 'anon can read standings');
select tests.throws($$insert into public.events (season_id, venue_id, name, event_date, registration_opens_at, registration_closes_at) values (gen_random_uuid(), gen_random_uuid(), 'x', now(), now(), now() + interval '1 day')$$,
  'anon cannot create events');
reset role;

-- ---------------------------------------------------------------------------
-- Staff
-- ---------------------------------------------------------------------------
select tests.as_user('00000000-0000-4000-8000-000000000003');
select tests.ok((select count(*) from public.profiles) >= 4, 'staff can read all profiles');
select tests.ok(
  (select emergency_contact_phone from public.profiles where user_id = '00000000-0000-4000-8000-000000000002') = '555-0199',
  'staff can read emergency contacts');
select tests.ok(
  tests.affected($$update public.registrations set checked_in_at = now(), checked_in_by = public.current_profile_id() where bib_number = 101$$) = 1,
  'staff can check a rider in');
select tests.ok(
  tests.affected($$update public.profiles set team = 'Edited by staff' where user_id = '00000000-0000-4000-8000-000000000002'$$) = 1,
  'staff can edit a rider profile');
select tests.ok(
  tests.affected($$update public.events set weather_override_text = 'Turn 3 is wet' where name = 'Race 1'$$) = 1,
  'staff can set a weather override');
select tests.throws($$update public.events set name = 'Renamed' where name = 'Race 1'$$,
  'staff cannot rename events (admin only)');
select tests.throws($$select public.admin_set_role((select rider1 from fx), 'staff')$$, 'staff cannot change roles');
select tests.ok((select count(*) from public.audit_log) = 0, 'staff cannot read the audit log');
select tests.throws($$update public.waiver_signatures set typed_full_name = 'Changed'$$, 'waiver signatures cannot be edited');
select tests.throws($$delete from public.waiver_signatures$$, 'waiver signatures cannot be deleted');
select tests.throws($$insert into public.waiver_signatures (rider_id, waiver_version_id, typed_full_name, agreed, collected_by) select rider1, waiver, 'Rita One', true, rider2 from fx$$,
  'staff must record themselves as the collector of an on-device signature');
select tests.ok(
  tests.affected($$insert into public.waiver_signatures (rider_id, waiver_version_id, typed_full_name, agreed, collected_by) select rider1, waiver, 'Rita One', true, staff from fx$$) = 1,
  'staff can collect a signature on their device');
-- Walk-up rider without an account
select tests.ok(
  tests.affected($$insert into public.profiles (first_name, last_name, email) values ('Walk', 'Up', 'walkup@test.local')$$) = 1,
  'staff can create a walk-up rider profile');
reset role;

-- ---------------------------------------------------------------------------
-- Audit log and admin
-- ---------------------------------------------------------------------------
select tests.as_user('00000000-0000-4000-8000-000000000004');
select tests.ok(
  exists (select 1 from public.audit_log where table_name = 'registrations' and action = 'update'
          and actor_user_id = '00000000-0000-4000-8000-000000000003'
          and before_data ->> 'checked_in_at' is null and after_data ->> 'checked_in_at' is not null),
  'check-in is audited with actor, before, and after');
select tests.ok(
  exists (select 1 from public.audit_log where table_name = 'profiles' and action = 'update'
          and actor_user_id = '00000000-0000-4000-8000-000000000003'),
  'staff profile edit is audited');
select tests.ok(
  not exists (select 1 from public.audit_log where table_name = 'profiles' and action = 'update'
              and actor_user_id = '00000000-0000-4000-8000-000000000001'),
  'a rider editing their own profile is not logged as a staff write');
select tests.throws($$delete from public.audit_log$$, 'audit log entries cannot be deleted');
select tests.throws($$update public.waiver_versions set body_markdown = 'Changed'$$, 'waiver text cannot be edited after publishing');
select public.admin_set_role((select rider1 from fx), 'staff');
select tests.ok((select role from public.profiles p, fx where p.id = fx.rider1) = 'staff', 'admin can grant the staff role');
select tests.throws($$select public.admin_set_role(public.current_profile_id(), 'rider')$$, 'admin cannot demote themselves');
select tests.ok(tests.affected($$update public.events set name = 'Race 1 renamed' where name = 'Race 1'$$) = 1, 'admin can edit events');
reset role;

-- ---------------------------------------------------------------------------
-- Walk-up profile links to an account created later with the same email
-- ---------------------------------------------------------------------------
insert into auth.users (id, email) values ('00000000-0000-4000-8000-000000000005', 'walkup@test.local');
select tests.ok(
  (select count(*) from public.profiles where email = 'walkup@test.local') = 1
  and (select user_id from public.profiles where email = 'walkup@test.local') = '00000000-0000-4000-8000-000000000005',
  'signing in links the existing walk-up profile instead of duplicating it');

rollback;
