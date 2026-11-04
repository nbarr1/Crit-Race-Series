-- Phase 6: admin screens (seasons, events, categories, points, venues,
-- settings, people, dashboard).
\set ON_ERROR_STOP on
begin;

insert into auth.users (id, email) values
  ('60000000-0000-4000-8000-000000000001', 'admin@adm.test'),
  ('60000000-0000-4000-8000-000000000002', 'staff@adm.test'),
  ('60000000-0000-4000-8000-000000000003', 'rider@adm.test');
update public.profiles set first_name = split_part(email::text, '@', 1), last_name = 'Admintest' where email::text like '%@adm.test';
update public.profiles set role = 'admin' where email = 'admin@adm.test';
update public.profiles set role = 'staff' where email = 'staff@adm.test';

create temp table f (k text primary key, v uuid);
grant all on f to anon, authenticated;
insert into f values
  ('admin', (select id from public.profiles where email = 'admin@adm.test')),
  ('staff', (select id from public.profiles where email = 'staff@adm.test')),
  ('rider', (select id from public.profiles where email = 'rider@adm.test')),
  ('venue', (select id from public.venues limit 1)),
  ('cat_a', (select id from public.categories where name = 'A')),
  ('cat_b', (select id from public.categories where name = 'B')),
  ('rules', (select id from public.points_rules order by created_at limit 1));
create or replace function pg_temp.v(key text) returns uuid language sql as $$ select v from f where k = key $$;

-- Only admins can call the admin functions.
select tests.as_anon();
select tests.throws($$select public.admin_save_season(null, 'Anon season', 2028, null, null)$$, 'anon cannot create a season');
reset role;
select tests.as_user('60000000-0000-4000-8000-000000000002');
select tests.throws_like($$select public.admin_save_season(null, 'Staff season', 2028, null, null)$$, 'admin_only', 'staff cannot create a season');
select tests.throws_like($$select public.admin_dashboard(gen_random_uuid())$$, 'admin_only', 'staff cannot read the dashboard');
select tests.throws_like($$select public.admin_save_settings('{"payments_enabled": false}')$$, 'admin_only', 'staff cannot change settings');
select tests.throws_like($$select * from public.admin_find_people('')$$, 'admin_only', 'staff cannot list people');
reset role;
select tests.as_user('60000000-0000-4000-8000-000000000003');
select tests.throws_like($$select public.admin_save_category(null, 'Juniors', '', '', null, null, 50)$$, 'admin_only', 'riders cannot add categories');
reset role;

-- Seasons
select tests.as_user('60000000-0000-4000-8000-000000000001');
insert into f values ('s1', public.admin_save_season(null, '2028 Series', 2028, 18000, null));
select tests.ok((select points_rules_id from public.seasons where id = pg_temp.v('s1')) = pg_temp.v('rules'), 'a new season gets the default points table');
select tests.ok((select not is_active from public.seasons where id = pg_temp.v('s1')), 'a new season starts inactive');
select tests.throws_like($$select public.admin_save_season(null, 'X', 2028, null, null)$$, 'name_required', 'a season needs a name');
select tests.throws_like($$select public.admin_save_season(null, 'Bad year', 1800, null, null)$$, 'year_invalid', 'a season year must be sensible');
select tests.throws_like($$select public.admin_save_season(null, 'Bad price', 2028, -1, null)$$, 'price_invalid', 'a season pass price cannot be negative');
do $$ begin perform public.admin_save_season(pg_temp.v('s1'), '2028 Connestee Series', 2028, 15000, pg_temp.v('rules')); end $$;
select tests.ok((select name = '2028 Connestee Series' and season_pass_price_cents = 15000 from public.seasons where id = pg_temp.v('s1')), 'an admin edits a season');

insert into f values ('s0', (select id from public.seasons where is_active));
do $$ begin perform public.admin_activate_season(pg_temp.v('s1')); end $$;
select tests.ok((select array_agg(id) from public.seasons where is_active) = array[pg_temp.v('s1')], 'activating a season turns the old one off');
do $$ begin perform public.admin_activate_season(pg_temp.v('s1')); end $$;
select tests.ok((select count(*) from public.seasons where is_active) = 1, 'activating the active season again is harmless');
select tests.throws_like($$select public.admin_activate_season(gen_random_uuid())$$, 'not_found', 'activating a missing season fails');

-- Events with categories
insert into f values ('e1', public.admin_save_event(jsonb_build_object(
  'season_id', pg_temp.v('s1'), 'venue_id', pg_temp.v('venue'), 'name', 'Opener', 'event_date', '2028-05-10',
  'registration_opens_at', '2028-04-01T12:00:00Z', 'registration_closes_at', '2028-05-10T20:00:00Z', 'status', 'draft',
  'categories', jsonb_build_array(
    jsonb_build_object('category_id', pg_temp.v('cat_a'), 'start_at', '2028-05-10T23:35:00Z', 'duration_minutes', 45, 'laps', null,
      'capacity', 50, 'price_cents', 2500, 'walk_up_price_cents', 3000),
    jsonb_build_object('category_id', pg_temp.v('cat_b'), 'start_at', '2028-05-10T21:15:00Z', 'duration_minutes', 30, 'laps', 15,
      'capacity', 40, 'price_cents', 2000, 'walk_up_price_cents', 2500)
  )
)));
select tests.ok((select count(*) from public.event_categories where event_id = pg_temp.v('e1')) = 2, 'an admin creates an event with its categories');
select tests.ok((select status = 'draft' from public.events where id = pg_temp.v('e1')), 'the event starts as a draft');
select tests.ok((select price_cents = 2000 and laps = 15 from public.event_categories where event_id = pg_temp.v('e1') and category_id = pg_temp.v('cat_b')),
  'category prices and laps are stored');

select tests.throws_like($$select public.admin_save_event(jsonb_build_object(
  'season_id', pg_temp.v('s1'), 'venue_id', pg_temp.v('venue'), 'name', 'Backwards', 'event_date', '2028-05-17',
  'registration_opens_at', '2028-05-17T12:00:00Z', 'registration_closes_at', '2028-05-01T12:00:00Z', 'categories', '[]'::jsonb))$$,
  'registration_window', 'registration must close after it opens');
select tests.throws_like($$select public.admin_save_event(jsonb_build_object(
  'season_id', pg_temp.v('s1'), 'venue_id', pg_temp.v('venue'), 'name', 'Empty', 'event_date', '2028-05-17', 'status', 'published',
  'registration_opens_at', '2028-05-01T12:00:00Z', 'registration_closes_at', '2028-05-17T12:00:00Z', 'categories', '[]'::jsonb))$$,
  'no_categories', 'a published event needs at least one category');
select tests.throws_like($$select public.admin_save_event(jsonb_build_object(
  'season_id', pg_temp.v('s1'), 'venue_id', pg_temp.v('venue'), 'name', 'Twice', 'event_date', '2028-05-17',
  'registration_opens_at', '2028-05-01T12:00:00Z', 'registration_closes_at', '2028-05-17T12:00:00Z',
  'categories', jsonb_build_array(
    jsonb_build_object('category_id', pg_temp.v('cat_a'), 'start_at', '2028-05-17T23:00:00Z', 'duration_minutes', 30, 'capacity', 10, 'price_cents', 0, 'walk_up_price_cents', 0),
    jsonb_build_object('category_id', pg_temp.v('cat_a'), 'start_at', '2028-05-17T23:30:00Z', 'duration_minutes', 30, 'capacity', 10, 'price_cents', 0, 'walk_up_price_cents', 0))))$$,
  'duplicate_category', 'a category appears once per event');
select tests.ok((select count(*) from public.events where season_id = pg_temp.v('s1')) = 1, 'failed saves leave nothing behind');

-- Copy the event a week later. Daylight saving doesn't change in May, so
-- the shift is exactly seven days.
insert into f values ('e2', public.admin_copy_event(pg_temp.v('e1'), 'Race 2', date '2028-05-17'));
select tests.ok((select status = 'draft' and event_date = date '2028-05-17' from public.events where id = pg_temp.v('e2')), 'a copied event is a draft on the new date');
select tests.ok((select array_agg(start_at order by start_at) from public.event_categories where event_id = pg_temp.v('e2'))
  = array[timestamptz '2028-05-17T21:15:00Z', timestamptz '2028-05-17T23:35:00Z'], 'copied start times move with the date');
select tests.ok((select registration_closes_at = timestamptz '2028-05-17T20:00:00Z' from public.events where id = pg_temp.v('e2')), 'the registration window moves with the date');
-- Across the November clock change, local start times stay the same.
insert into f values ('e3', public.admin_copy_event(pg_temp.v('e1'), 'Late race', date '2028-11-08'));
select tests.ok((select min(start_at) from public.event_categories where event_id = pg_temp.v('e3')) = timestamptz '2028-11-08T22:15:00Z',
  'a copy across the clock change keeps the 5:15 PM local start');

-- Edit: publish with one category removed and one price changed.
do $$ begin perform public.admin_save_event(jsonb_build_object(
  'id', pg_temp.v('e1'), 'season_id', pg_temp.v('s1'), 'venue_id', pg_temp.v('venue'), 'name', 'Opener', 'event_date', '2028-05-10',
  'registration_opens_at', '2028-04-01T12:00:00Z', 'registration_closes_at', '2028-05-10T20:00:00Z', 'status', 'published', 'notes', 'Bring lights.',
  'categories', jsonb_build_array(jsonb_build_object(
    'id', (select id from public.event_categories where event_id = pg_temp.v('e1') and category_id = pg_temp.v('cat_a')),
    'category_id', pg_temp.v('cat_a'), 'start_at', '2028-05-10T23:35:00Z', 'duration_minutes', 45, 'capacity', 1, 'price_cents', 3000, 'walk_up_price_cents', 3500)))); end $$;
select tests.ok((select status = 'published' and notes = 'Bring lights.' from public.events where id = pg_temp.v('e1')), 'an admin publishes and edits an event');
select tests.ok((select array_agg(price_cents) from public.event_categories where event_id = pg_temp.v('e1')) = array[3000], 'removed categories are deleted and prices update');
reset role;

-- A rider registers, so the category can't be removed and the event can't be deleted.
insert into public.waiver_versions (season_id, version_number, title, body_markdown, effective_date, is_current)
values (pg_temp.v('s1'), 1, 'W', repeat('w', 60), date '2028-01-01', true);
insert into public.waiver_signatures (rider_id, waiver_version_id, typed_full_name, agreed)
select pg_temp.v('rider'), id, 'rider Admintest', true from public.waiver_versions where season_id = pg_temp.v('s1');
update public.events set registration_opens_at = now() - interval '1 day', registration_closes_at = now() + interval '1 day' where id = pg_temp.v('e1');
update public.profiles set phone = '828-555-0100', birth_date = '1990-01-01', emergency_contact_name = 'E', emergency_contact_relationship = 'Friend',
  emergency_contact_phone = '828-555-0101' where id = pg_temp.v('rider');
insert into public.registrations (rider_id, event_category_id, status, payment_method, amount_paid_cents)
select pg_temp.v('rider'), id, 'confirmed', 'cash', 3000 from public.event_categories where event_id = pg_temp.v('e1');

select tests.as_user('60000000-0000-4000-8000-000000000001');
select tests.throws_like($$select public.admin_save_event(jsonb_build_object(
  'id', pg_temp.v('e1'), 'season_id', pg_temp.v('s1'), 'venue_id', pg_temp.v('venue'), 'name', 'Opener', 'event_date', '2028-05-10',
  'registration_opens_at', '2028-04-01T12:00:00Z', 'registration_closes_at', '2028-05-10T20:00:00Z', 'status', 'draft', 'categories', '[]'::jsonb))$$,
  'category_in_use', 'a category with registrations cannot be removed');
select tests.throws_like($$select public.admin_delete_event(pg_temp.v('e1'))$$, 'event_in_use', 'an event with registrations cannot be deleted');
do $$ begin perform public.admin_delete_event(pg_temp.v('e3')); end $$;
select tests.ok((select deleted_at is not null from public.events where id = pg_temp.v('e3')), 'an unused event is deleted (soft)');

-- Dashboard
select tests.ok((public.admin_dashboard(pg_temp.v('s1')) -> 'events' -> 0 ->> 'confirmed')::integer = 1, 'the dashboard counts confirmed riders');
select tests.ok((public.admin_dashboard(pg_temp.v('s1')) -> 'events' -> 0 ->> 'revenue_cents')::integer = 3000, 'the dashboard sums money taken');
select tests.ok(jsonb_array_length(public.admin_dashboard(pg_temp.v('s1')) -> 'events') = 2, 'the dashboard leaves out deleted events');
select tests.ok((public.admin_dashboard(pg_temp.v('s1')) ->> 'waiver_signers')::integer = 1, 'the dashboard counts current waiver signers');

-- Categories
insert into f values ('juniors', public.admin_save_category(null, 'Juniors', 'Under 18.', '', null, null, 50));
select tests.throws_like($$select public.admin_save_category(null, 'A', '', '', null, null, 5)$$, 'duplicate_name', 'category names are unique');
do $$ begin perform public.admin_save_category((select id from public.categories where name = 'Masters'), 'Masters', 'Riders 45 and older.', '', 45, null, 40); end $$;
select tests.ok((select min_age from public.categories where name = 'Masters') = 45, 'an admin changes the Masters minimum age');

-- Points tables: editing rescores published results (D-107).
select tests.throws_like($$select public.admin_save_points_rules(null, 'Bad', '{"0": 5}', 0)$$, 'points_invalid', 'places start at 1');
select tests.throws_like($$select public.admin_save_points_rules(null, 'Bad', '{"1": 2.5}', 0)$$, 'points_invalid', 'points are whole numbers');
select tests.throws_like($$select public.admin_save_points_rules(null, 'Bad', '{"1": -1}', 0)$$, 'points_invalid', 'points cannot be negative');
select tests.throws_like($$select public.admin_save_points_rules(null, 'Bad', '{"1": 5}', -1)$$, 'value_out_of_range', 'dropped races cannot be negative');
reset role;
insert into public.results (event_category_id, rider_id, raw_name, place, status, points_awarded, is_published)
select id, pg_temp.v('rider'), 'rider Admintest', 1, 'finished', 25, true from public.event_categories where event_id = pg_temp.v('e1');
select tests.as_user('60000000-0000-4000-8000-000000000001');
do $$ begin perform public.admin_save_points_rules(pg_temp.v('rules'), 'Default series points', '{"1": 30, "2": 20}', 1); end $$;
select tests.ok((select points_awarded from public.results where rider_id = pg_temp.v('rider')) = 30, 'saving a points table rescores results');
select tests.ok((select drop_worst_n from public.points_rules where id = pg_temp.v('rules')) = 1, 'an admin sets dropped races');

-- Venues
do $$ begin perform public.admin_save_venue(pg_temp.v('venue'), 'Connestee Nature Park', '1 Park Rd', 35.2, -82.7, true, 'Park on the grass.', null); end $$;
select tests.ok((select coordinates_confirmed and address = '1 Park Rd' from public.venues where id = pg_temp.v('venue')), 'an admin confirms the venue');
select tests.throws_like($$select public.admin_save_venue(null, 'Nowhere', '', 95, 0, false, '', null)$$, 'coordinates_invalid', 'latitude must be on Earth');
select tests.throws_like($$select public.admin_save_venue(null, 'Somewhere', '', 35, -82, false, '', 'javascript:alert(1)')$$, 'url_invalid', 'map links must be https');

-- Settings
select tests.ok(public.admin_save_settings('{"payments_enabled": false, "default_category_capacity": 45, "external_waiver_url": "https://example.org/w"}') = 3, 'an admin saves settings');
select tests.ok((select value from public.app_settings where key = 'payments_enabled') = 'false'::jsonb, 'the payments switch is saved');
do $$ begin perform public.admin_save_settings('{"external_waiver_url": null}'); end $$;
select tests.ok((select value from public.app_settings where key = 'external_waiver_url') = 'null'::jsonb, 'an optional setting can be cleared');
select tests.throws_like($$select public.admin_save_settings('{"no_such_key": 1}')$$, 'unknown_setting', 'unknown settings are rejected');
select tests.throws_like($$select public.admin_save_settings('{"payments_enabled": "yes"}')$$, 'setting_type', 'a setting keeps its type');
select tests.throws_like($$select public.admin_save_settings('{"refund_policy": "always"}')$$, 'setting_type', 'the refund policy must be a known value');
select tests.throws_like($$select public.admin_save_settings('{"default_category_capacity": -5}')$$, 'value_out_of_range', 'numbers cannot be negative');

-- People and roles
select tests.ok((select count(*) from public.admin_find_people('') where profile_id in (pg_temp.v('admin'), pg_temp.v('staff'))) = 2, 'with no search, the list shows staff and admins');
select tests.ok(not exists (select 1 from public.admin_find_people('') where role = 'rider'), 'with no search, riders are left out');
select tests.ok((select role from public.admin_find_people('rider@adm') limit 1) = 'rider', 'an admin finds a rider by email');
do $$ begin perform public.admin_set_role(pg_temp.v('rider'), 'staff'); end $$;
select tests.ok((select role from public.profiles where id = pg_temp.v('rider')) = 'staff', 'an admin makes a rider staff');
reset role;

-- Every admin change is audited with the admin as the actor.
select tests.ok((select count(distinct table_name) from public.audit_log where actor_profile_id = pg_temp.v('admin')
  and table_name in ('seasons', 'events', 'event_categories', 'categories', 'points_rules', 'venues', 'app_settings', 'profiles')) = 8,
  'admin changes are audited with the admin as the actor');

rollback;
