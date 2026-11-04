-- Course maps, announcements, and email audiences.
\set ON_ERROR_STOP on
begin;

insert into auth.users (id, email) values
  ('30000000-0000-4000-8000-000000000001', 'staff@ei.test'),
  ('30000000-0000-4000-8000-000000000002', 'in-event@ei.test'),
  ('30000000-0000-4000-8000-000000000003', 'other-event@ei.test'),
  ('30000000-0000-4000-8000-000000000004', 'canceled@ei.test'),
  ('30000000-0000-4000-8000-000000000005', 'nobody@ei.test');
update public.profiles set first_name = split_part(email::text, '@', 1) where email::text like '%@ei.test';
update public.profiles set role = 'staff' where email = 'staff@ei.test';

create temp table f as select gen_random_uuid() season, gen_random_uuid() ev1, gen_random_uuid() ev2,
  gen_random_uuid() ec1, gen_random_uuid() ec2, gen_random_uuid() media;
grant select on f to anon, authenticated;
update public.seasons set is_active = false where is_active;
insert into public.seasons (id, name, year, is_active) select season, 'EI', 2027, true from f;
insert into public.events (id, season_id, venue_id, name, event_date, registration_opens_at, registration_closes_at, status)
select ev1, season, (select id from public.venues limit 1), 'E1', current_date + 5, now() - interval '1 day', now() + interval '4 days', 'published'::public.event_status from f
union all select ev2, season, (select id from public.venues limit 1), 'E2', current_date + 12, now() - interval '1 day', now() + interval '11 days', 'published' from f;
insert into public.event_categories (id, event_id, category_id, start_at, duration_minutes)
select ec1, ev1, (select id from public.categories where name = 'A'), now() + interval '5 days', 40 from f
union all select ec2, ev2, (select id from public.categories where name = 'A'), now() + interval '12 days', 40 from f;
insert into public.registrations (rider_id, event_category_id, status)
select (select id from public.profiles where email = 'in-event@ei.test'), ec1, 'confirmed'::public.registration_status from f
union all select (select id from public.profiles where email = 'other-event@ei.test'), ec2, 'confirmed' from f
union all select (select id from public.profiles where email = 'canceled@ei.test'), ec1, 'canceled' from f;
insert into public.media (id, type, storage_path, event_id) select media, 'course_map', 'maps/e1.png', ev1 from f;

select tests.as_user('30000000-0000-4000-8000-000000000001');
select tests.ok(tests.affected($$update public.events set course_map_id = (select media from f) where id = (select ev1 from f)$$) = 1,
  'staff can set an event''s course map');
select tests.throws($$update public.events set event_date = current_date where id = (select ev1 from f)$$,
  'staff still cannot change the event date');

insert into public.announcements (id, title, event_id, send_email, email_audience, created_by)
select '30000000-0000-4000-8000-0000000000a1', 'Event note', ev1, true, 'event_registrants', public.current_profile_id() from f;
insert into public.announcements (id, title, send_email, email_audience, created_by)
values ('30000000-0000-4000-8000-0000000000a2', 'Season note', true, 'season', public.current_profile_id());
select tests.throws($$insert into public.announcements (title, email_audience) values ('x', 'event_registrants')$$,
  'an event-registrants email needs an event');

select tests.ok(
  (select array_agg(email order by email) from public.announcement_recipients('30000000-0000-4000-8000-0000000000a1')) = array['in-event@ei.test'],
  'event emails go only to riders actively registered for that event');
select tests.ok(
  (select array_agg(email order by email) from public.announcement_recipients('30000000-0000-4000-8000-0000000000a2'))
    = array['in-event@ei.test', 'other-event@ei.test'],
  'season emails go to everyone registered in the season, not canceled riders or bystanders');
reset role;

select tests.as_user('30000000-0000-4000-8000-000000000002');
select tests.throws_like($$select * from public.announcement_recipients('30000000-0000-4000-8000-0000000000a2')$$,
  'staff_only', 'riders cannot read the recipient list');
select tests.ok(tests.affected($$update public.events set course_map_id = null$$) = 0, 'riders cannot change course maps');
reset role;

-- The scheduled job (service role) can read recipients to send due emails.
select set_config('request.jwt.claims', '{"role":"service_role"}', true);
set local role service_role;
select tests.ok((select count(*) from public.announcement_recipients('30000000-0000-4000-8000-0000000000a2')) = 2,
  'the scheduled job can read recipients for a due announcement');
reset role;

select tests.as_anon();
select tests.ok((select count(*) from public.announcements where title in ('Event note', 'Season note')) = 2,
  'published announcements are public');
select tests.ok((select count(*) from public.media where id = (select media from f)) = 1, 'course maps are public');
reset role;

rollback;
