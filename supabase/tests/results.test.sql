-- Results upload, publishing, points, and standings.
\set ON_ERROR_STOP on
begin;

insert into auth.users (id, email) values
  ('50000000-0000-4000-8000-000000000001', 'staff@res.test'),
  ('50000000-0000-4000-8000-000000000002', 'rider1@res.test'),
  ('50000000-0000-4000-8000-000000000003', 'rider2@res.test'),
  ('50000000-0000-4000-8000-000000000004', 'rider3@res.test');
update public.profiles set first_name = split_part(email::text, '@', 1), last_name = 'Test' where email::text like '%@res.test';
update public.profiles set role = 'staff' where email = 'staff@res.test';

create temp table f as select gen_random_uuid() season, gen_random_uuid() rules,
  gen_random_uuid() ev1, gen_random_uuid() ev2, gen_random_uuid() ev3,
  gen_random_uuid() ec1, gen_random_uuid() ec2, gen_random_uuid() ec3,
  (select id from public.profiles where email = 'rider1@res.test') r1,
  (select id from public.profiles where email = 'rider2@res.test') r2,
  (select id from public.profiles where email = 'rider3@res.test') r3,
  (select id from public.categories where name = 'A') cat;
grant select on f to anon, authenticated;

insert into public.points_rules (id, name, points_by_place, drop_worst_n)
select rules, 'Test rules', '{"1":10,"2":6,"3":3}', 1 from f;
update public.seasons set is_active = false where is_active;
insert into public.seasons (id, name, year, is_active, points_rules_id) select season, 'RES', 2027, true, rules from f;
insert into public.events (id, season_id, venue_id, name, event_date, registration_opens_at, registration_closes_at, status)
select ev1, season, (select id from public.venues limit 1), 'R1', date '2027-06-01', now() - interval '60 days', now() - interval '50 days', 'published'::public.event_status from f
union all select ev2, season, (select id from public.venues limit 1), 'R2', date '2027-06-08', now() - interval '60 days', now() - interval '50 days', 'published' from f
union all select ev3, season, (select id from public.venues limit 1), 'R3', date '2027-06-15', now() - interval '60 days', now() - interval '50 days', 'published' from f;
insert into public.event_categories (id, event_id, category_id, start_at, duration_minutes)
select ec1, ev1, cat, timestamptz '2027-06-01 22:00Z', 40 from f
union all select ec2, ev2, cat, timestamptz '2027-06-08 22:00Z', 40 from f
union all select ec3, ev3, cat, timestamptz '2027-06-15 22:00Z', 40 from f;

-- Riders and signed-out visitors can't save or publish results.
select tests.as_anon();
select tests.throws($$select public.save_results((select ec1 from f), '{"rows":[]}')$$, 'anon cannot save results');
reset role;
select tests.as_user('50000000-0000-4000-8000-000000000002');
select tests.throws_like($$select public.save_results((select ec1 from f), '{"rows":[]}')$$, 'staff_only', 'riders cannot save results');
select tests.throws_like($$select public.publish_results((select ec1 from f), true)$$, 'staff_only', 'riders cannot publish results');
reset role;

select tests.as_user('50000000-0000-4000-8000-000000000001');
-- Race 1: r1 wins, r2 second, r3 DNF.
select tests.ok(public.save_results((select ec1 from f), jsonb_build_object('rows', jsonb_build_array(
  jsonb_build_object('place', 1, 'status', 'finished', 'rider_id', (select r1 from f), 'raw_name', 'Rider One', 'bib', 101, 'laps', 20, 'finish_time', '00:41:02.5'),
  jsonb_build_object('place', 2, 'status', 'finished', 'rider_id', (select r2 from f), 'raw_name', 'Rider Two'),
  jsonb_build_object('status', 'DNF', 'rider_id', (select r3 from f), 'raw_name', 'Rider Three', 'place', 3),
  jsonb_build_object('place', 3, 'status', 'finished', 'raw_name', 'Unregistered Guest')
))) = 4, 'staff save a category''s results');
select tests.ok((select array_agg(points_awarded order by raw_name) from public.results where event_category_id = (select ec1 from f))
  = array[10, 0, 6, 3], 'points come from the season''s table; DNF scores zero; place ignored on a DNF');
select tests.ok((select place from public.results where raw_name = 'Rider Three') is null, 'a DNF has no place');
select tests.ok((select bool_and(not is_published) from public.results where event_category_id = (select ec1 from f)), 'saved results start as a draft');
select tests.ok((select finish_time from public.results where raw_name = 'Rider One') = interval '41 minutes 2.5 seconds', 'finish time is stored');

select tests.throws_like($$select public.save_results((select ec1 from f), jsonb_build_object('rows', jsonb_build_array(
  jsonb_build_object('place', 1, 'raw_name', 'A'), jsonb_build_object('place', 1, 'raw_name', 'B'))))$$,
  'duplicate_place', 'two riders cannot share a place');
select tests.throws_like($$select public.save_results((select ec1 from f), jsonb_build_object('rows', jsonb_build_array(
  jsonb_build_object('place', 1, 'rider_id', (select r1 from f), 'raw_name', 'A'), jsonb_build_object('place', 2, 'rider_id', (select r1 from f), 'raw_name', 'B'))))$$,
  'duplicate_rider', 'a rider cannot have two results in one category');
select tests.throws_like($$select public.save_results((select ec1 from f), '{"rows":[{"status":"finished","raw_name":"A"}]}')$$,
  'place_required', 'a finisher needs a place');
select tests.throws_like($$select public.save_results((select ec1 from f), '{"rows":[{"place":1,"status":"OTL","raw_name":"A"}]}')$$,
  'status_invalid', 'unknown statuses are rejected');
select tests.throws_like($$select public.save_results((select ec1 from f), '{"rows":[{"place":1}]}')$$,
  'name_required', 'an unmatched row needs a name');
select tests.ok((select count(*) from public.results where event_category_id = (select ec1 from f)) = 4, 'a failed save leaves the earlier rows in place');
reset role;
select tests.ok((select count(*) from public.audit_log where table_name = 'results' and action = 'insert'
  and actor_profile_id = (select id from public.profiles where email = 'staff@res.test')) >= 4,
  'result writes are audited with the staff member');

-- Drafts are hidden from the public and from the rider.
select tests.as_anon();
select tests.ok((select count(*) from public.public_results where event_category_id = (select ec1 from f)) = 0, 'the public cannot see draft results');
reset role;
select tests.as_user('50000000-0000-4000-8000-000000000002');
select tests.ok((select count(*) from public.results) = 0, 'a rider cannot see their own draft result');
reset role;

select tests.as_user('50000000-0000-4000-8000-000000000001');
select tests.ok(public.publish_results((select ec1 from f), true) = 4, 'staff publish results');
-- Race 2: r2 wins, r1 third. Race 3: r1 wins, r2 second.
select from public.save_results((select ec2 from f), jsonb_build_object('rows', jsonb_build_array(
  jsonb_build_object('place', 1, 'rider_id', (select r2 from f), 'raw_name', 'Rider Two'),
  jsonb_build_object('place', 3, 'rider_id', (select r1 from f), 'raw_name', 'Rider One'))));
select from public.save_results((select ec3 from f), jsonb_build_object('rows', jsonb_build_array(
  jsonb_build_object('place', 1, 'rider_id', (select r1 from f), 'raw_name', 'Rider One'),
  jsonb_build_object('place', 2, 'rider_id', (select r2 from f), 'raw_name', 'Rider Two'))));
select from public.publish_results((select ec2 from f), true);
select from public.publish_results((select ec3 from f), true);
reset role;

select tests.as_anon();
select tests.ok((select count(*) from public.public_results where event_category_id = (select ec1 from f)) = 4, 'the public sees published results');
select tests.ok((select display_name from public.public_results where event_category_id = (select ec1 from f) and place = 3) = 'Unregistered Guest',
  'an unmatched row shows the name from the sheet');
-- Drop 1 of 3 events: r1 has 10, 3, 10 -> 20. r2 has 6, 10, 6 -> 16. r3 has 0 -> 0.
select tests.ok((select total_points from public.standings where rider_id = (select r1 from f)) = 20, 'drop-worst-1 drops the lowest score');
select tests.ok((select raw_points from public.standings where rider_id = (select r1 from f)) = 23, 'raw points include the dropped race');
select tests.ok((select total_points from public.standings where rider_id = (select r2 from f)) = 16, 'second rider''s total drops their worst race');
select tests.ok((select wins from public.standings where rider_id = (select r1 from f)) = 2, 'wins are counted');
select tests.ok((select total_points from public.standings where rider_id = (select r3 from f)) = 0, 'a rider with only a DNF has zero, not null');
reset role;

-- Unpublishing hides a race again.
select tests.as_user('50000000-0000-4000-8000-000000000001');
select tests.ok(public.publish_results((select ec3 from f), false) = 2, 'staff can unpublish');
reset role;
select tests.as_anon();
-- Two events scored, drop 1: one counts. r1: 10, 3 -> 10. r2: 6, 10 -> 10.
select tests.ok((select total_points from public.standings where rider_id = (select r1 from f)) = 10, 'unpublished races leave the standings');
reset role;

-- Early season: with one event and one drop, the best result still counts.
select tests.as_user('50000000-0000-4000-8000-000000000001');
select from public.publish_results((select ec2 from f), false);
reset role;
select tests.ok((select total_points from public.standings where rider_id = (select r1 from f)) = 10,
  'with no more events than drops, each rider''s best result counts');

-- An admin changing the points table rescores results.
update public.points_rules set points_by_place = '{"1":50,"2":30,"3":20}' where id = (select rules from f);
select tests.ok((select points_awarded from public.results where event_category_id = (select ec1 from f) and rider_id = (select r1 from f)) = 50,
  'editing the points table rescores existing results');
select tests.ok((select points_awarded from public.results where event_category_id = (select ec1 from f) and rider_id = (select r3 from f)) = 0,
  'a rescored DNF still scores zero');

select tests.ok(public.points_for_place('{"1":25}', 1, 'finished') = 25 and public.points_for_place('{"1":25}', 2, 'finished') = 0
  and public.points_for_place('{"1":25}', 1, 'DQ') = 0, 'points_for_place follows the table and statuses');

rollback;
