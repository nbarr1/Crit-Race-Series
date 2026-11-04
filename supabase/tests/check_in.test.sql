-- Race-day check-in, offline replay, desk payments, waivers, and walk-ups.
\set ON_ERROR_STOP on
begin;

insert into auth.users (id, email) values
  ('20000000-0000-4000-8000-000000000001', 'staff1@test.local'),
  ('20000000-0000-4000-8000-000000000002', 'staff2@test.local'),
  ('20000000-0000-4000-8000-000000000003', 'rider1@test.local'),
  ('20000000-0000-4000-8000-000000000004', 'rider2@test.local'),
  ('20000000-0000-4000-8000-000000000005', 'rider3@test.local');
update public.profiles set first_name = split_part(email::text, '@', 1), last_name = 'Test', phone = '1', birth_date = '1990-01-01',
  emergency_contact_name = 'EC', emergency_contact_phone = '2', emergency_contact_relationship = 'Friend'
where email::text like '%@test.local';
update public.profiles set role = 'staff' where email::text like 'staff%@test.local';

create temp table f as select
  (select id from public.profiles where email = 'rider1@test.local') r1,
  (select id from public.profiles where email = 'rider2@test.local') r2,
  (select id from public.profiles where email = 'rider3@test.local') r3,
  gen_random_uuid() season, gen_random_uuid() ev, gen_random_uuid() ec, gen_random_uuid() waiver,
  gen_random_uuid() reg1, gen_random_uuid() reg2, gen_random_uuid() reg3,
  gen_random_uuid() op_a, gen_random_uuid() op_b, gen_random_uuid() op_pay, gen_random_uuid() op_sign,
  gen_random_uuid() op_walk, gen_random_uuid() op_walk2, gen_random_uuid() op_over;
grant select on f to anon, authenticated;

update public.seasons set is_active = false where is_active;
insert into public.seasons (id, name, year, is_active) select season, 'Check-in test', 2027, true from f;
insert into public.events (id, season_id, venue_id, name, event_date, registration_opens_at, registration_closes_at, status)
select ev, season, (select id from public.venues limit 1), 'Race day', current_date, now() - interval '10 days', now() - interval '1 day', 'published' from f;
insert into public.event_categories (id, event_id, category_id, start_at, duration_minutes, capacity, price_cents, walk_up_price_cents)
select ec, ev, (select id from public.categories where name = 'B'), now() + interval '2 hours', 35, 60, 2500, 3000 from f;
insert into public.waiver_versions (id, season_id, version_number, title, body_markdown, effective_date, is_current)
select waiver, season, 1, 'Waiver', 'Text', current_date, true from f;
insert into public.waiver_signatures (rider_id, waiver_version_id, typed_full_name, agreed)
select r1, waiver, 'rider1 Test', true from f union all select r3, waiver, 'rider3 Test', true from f;
insert into public.registrations (id, rider_id, event_category_id, status, payment_method, bib_number)
select reg1, r1, ec, 'confirmed'::public.registration_status, 'stripe'::public.payment_method, null::integer from f union all
select reg2, r2, ec, 'confirmed', 'stripe', null from f union all
select reg3, r3, ec, 'pending_payment', 'none', null from f;

-- ---------------------------------------------------------------------------
-- Riders can't use any staff function
-- ---------------------------------------------------------------------------
select tests.as_user('20000000-0000-4000-8000-000000000003');
select tests.throws_like($$select * from public.staff_check_in(gen_random_uuid(), (select reg1 from f), 5, now())$$,
  'staff_only', 'riders cannot check themselves in');
select tests.throws_like($$select * from public.staff_roster((select ev from f))$$, 'staff_only', 'riders cannot read the roster');
select tests.throws_like($$select public.staff_record_payment(gen_random_uuid(), (select reg1 from f), 'comp', 0)$$,
  'staff_only', 'riders cannot mark themselves paid');
select tests.throws_like($$select * from public.staff_find_riders('rider')$$, 'staff_only', 'riders cannot search riders');
select tests.ok((select count(*) from public.check_in_events) = 0, 'riders cannot read the check-in log');
reset role;

-- ---------------------------------------------------------------------------
-- Offline conflict: two devices check in rider 1. Device B's check-in
-- happened first but syncs second. The earliest time and its bib win.
-- ---------------------------------------------------------------------------
select tests.as_user('20000000-0000-4000-8000-000000000001');
select tests.throws_like($$select * from public.staff_check_in(gen_random_uuid(), (select reg1 from f), null, now())$$,
  'bib_required', 'checking in a rider without a bib needs one');
select tests.ok(
  (select outcome from public.staff_check_in((select op_a from f), (select reg1 from f), 101, now() - interval '10 minutes', 'device-a')) = 'checked_in',
  'device A checks rider 1 in with bib 101');
select tests.ok(
  (select outcome from public.staff_check_in((select op_a from f), (select reg1 from f), 101, now() - interval '10 minutes', 'device-a')) = 'duplicate',
  'replaying the same queued operation is a no-op');
reset role;

select tests.as_user('20000000-0000-4000-8000-000000000002');
create temp table b as select * from public.staff_check_in((select op_b from f), (select reg1 from f), 150, now() - interval '20 minutes', 'device-b');
select tests.ok((select outcome from b) = 'earlier_time_kept', 'a later sync with an earlier check-in time replaces the time');
select tests.ok((select bib_number from b) = 150, 'the earliest check-in''s bib wins');
select tests.ok(
  (select checked_in_by from public.registrations where id = (select reg1 from f))
    = (select id from public.profiles where email = 'staff2@test.local'),
  'the earliest check-in''s staff member is recorded');
select tests.ok((select count(*) from public.check_in_events where registration_id = (select reg1 from f)) = 2,
  'both check-ins are logged');
select tests.ok(
  (select outcome from public.staff_check_in(gen_random_uuid(), (select reg1 from f), 999, now(), 'device-b')) = 'already_checked_in_bib_kept',
  'a later check-in with a different bib keeps the existing bib');

select tests.throws_like($$select * from public.staff_check_in(gen_random_uuid(), (select reg2 from f), 160, now())$$,
  'waiver_required', 'a rider without the current waiver cannot be checked in');

-- ---------------------------------------------------------------------------
-- Hand-to-rider waiver, then check-in
-- ---------------------------------------------------------------------------
select tests.ok(
  (select public.staff_collect_waiver((select op_sign from f), (select r2 from f), (select waiver from f), 'rider2 Test',
    now() + interval '3 hours', 'Staff iPad') ->> 'outcome') = 'signed',
  'staff collect a waiver on their device');
select tests.ok(
  (select public.staff_collect_waiver((select op_sign from f), (select r2 from f), (select waiver from f), 'rider2 Test',
    now(), 'Staff iPad') ->> 'duplicate') = 'true',
  'a replayed waiver operation is a no-op');
select tests.ok(
  (select collected_by = (select id from public.profiles where email = 'staff2@test.local') and signed_at <= now()
   from public.waiver_signatures where rider_id = (select r2 from f)),
  'the collecting staff member is recorded, and a future device time is clamped');
-- Bibs are unique per event.
select tests.throws_like($$select * from public.staff_check_in(gen_random_uuid(), (select reg2 from f), 150, now())$$,
  'bib_taken', 'a bib already used at this event is refused');
select tests.throws_like($$select * from public.staff_check_in(gen_random_uuid(), (select reg2 from f), 0, now())$$,
  'bib_invalid', 'bib numbers must be positive');

select tests.ok(
  (select outcome from public.staff_check_in(gen_random_uuid(), (select reg2 from f), 160, now() + interval '1 hour')) = 'checked_in',
  'after signing, the rider checks in');
select tests.ok((select checked_in_at <= now() from public.registrations where id = (select reg2 from f)),
  'a check-in time in the future (a wrong device clock) is clamped to now');

-- ---------------------------------------------------------------------------
-- Desk payment
-- ---------------------------------------------------------------------------
select tests.throws_like($$select * from public.staff_check_in(gen_random_uuid(), (select reg3 from f), 170, now())$$,
  'not_confirmed', 'an unpaid registration cannot be checked in');
select tests.throws_like($$select public.staff_record_payment(gen_random_uuid(), (select reg3 from f), 'stripe', 2500)$$,
  'payment_method_invalid', 'staff record only desk payment methods');
select tests.ok(
  (select public.staff_record_payment((select op_pay from f), (select reg3 from f), 'cash', 2500) ->> 'outcome') = 'paid',
  'staff record a cash payment');
select tests.ok((select status = 'confirmed' and payment_method = 'cash' and amount_paid_cents = 2500
  from public.registrations where id = (select reg3 from f)), 'the registration is confirmed as paid in cash');
select tests.throws_like($$select public.staff_record_payment(gen_random_uuid(), (select reg1 from f), 'cash', 2500)$$,
  'already_paid', 'a registration paid online cannot be charged again at the desk');
select tests.ok((select outcome from public.staff_check_in(gen_random_uuid(), (select reg3 from f), 170, now())) = 'checked_in',
  'the paid rider checks in');

-- ---------------------------------------------------------------------------
-- Eligibility override
-- ---------------------------------------------------------------------------
select tests.throws_like($$select public.staff_override_eligibility(gen_random_uuid(), (select reg3 from f), ' ')$$,
  'reason_required', 'an override needs a reason');
select tests.ok(
  (select public.staff_override_eligibility((select op_over from f), (select reg3 from f), 'Checked license: 41') ->> 'outcome') = 'overridden',
  'staff record an eligibility override');
select tests.ok((select eligibility_override_reason = 'Checked license: 41' and eligibility_override_by is not null
  from public.registrations where id = (select reg3 from f)), 'the override records who and why');

-- ---------------------------------------------------------------------------
-- Walk-ups
-- ---------------------------------------------------------------------------
select tests.throws_like($$select public.staff_walk_up(gen_random_uuid(), null, '{"first_name":"New"}', (select ec from f), 'cash', 3000)$$,
  'walk_up_details_required', 'a new walk-up rider needs name, birth date, and an emergency contact');
create temp table walk as select public.staff_walk_up((select op_walk from f), null,
  '{"first_name":"Walk","last_name":"Up","email":"Walk.Up@Test.Local","birth_date":"1985-02-03","emergency_contact_name":"Kim","emergency_contact_phone":"555"}',
  (select ec from f), 'cash', 3000) as res;
select tests.ok((select res ->> 'outcome' from walk) = 'registered' and (select (res ->> 'waiver_signed')::boolean from walk) = false,
  'a walk-up creates the rider and a confirmed registration, and reports the missing waiver');
select tests.ok((select status = 'confirmed' and source = 'walk_up' and amount_paid_cents = 3000 from public.registrations
  where id = ((select res from walk) ->> 'registration_id')::uuid), 'the walk-up is confirmed with the desk payment');
select tests.ok((select user_id is null and email = 'walk.up@test.local' from public.profiles
  where id = ((select res from walk) ->> 'rider_id')::uuid), 'the walk-up rider has no account until they sign in');
select tests.throws_like($$select public.staff_walk_up(gen_random_uuid(), null, '{"email":"walk.up@test.local"}', (select ec from f), 'cash', 3000)$$,
  'already_registered', 'a walk-up matching an existing email finds that rider instead of duplicating them');
select tests.ok((select count(*) from public.staff_find_riders('walk')) = 1, 'staff can find riders by name');

-- ---------------------------------------------------------------------------
-- Roster
-- ---------------------------------------------------------------------------
select tests.ok((select count(*) from public.staff_roster((select ev from f))) = 4, 'the roster lists every active registration');
select tests.ok(
  (select waiver_signed and bib_number = 150 and checked_in_at is not null from public.staff_roster((select ev from f))
   where registration_id = (select reg1 from f)), 'the roster shows waiver, bib, and check-in status');
select tests.ok(
  not exists (select 1 from pg_proc p, unnest(p.proargnames) a where p.proname = 'staff_roster' and a like 'emergency%'),
  'the cached roster leaves out emergency contacts');

-- Undo
do $$ begin perform public.staff_undo_check_in((select reg3 from f)); end $$;
select tests.ok((select checked_in_at is null from public.registrations where id = (select reg3 from f)), 'staff can undo a check-in');
select tests.ok(exists (select 1 from public.check_in_events where registration_id = (select reg3 from f) and outcome = 'undone'),
  'undoing is logged');
reset role;

-- Everything staff did is in the audit log with the actor.
select tests.ok(
  (select count(*) from public.audit_log where table_name = 'registrations' and action = 'update'
   and actor_user_id in ('20000000-0000-4000-8000-000000000001', '20000000-0000-4000-8000-000000000002')) >= 5,
  'staff check-ins and payments are audited with the staff member as actor');
select tests.throws($$delete from public.check_in_events$$, 'the check-in log is append-only');

rollback;
