-- Registration, waitlist, waiver, payment, and season pass rules.
\set ON_ERROR_STOP on
begin;

-- ---------------------------------------------------------------------------
-- Fixtures
-- ---------------------------------------------------------------------------
insert into auth.users (id, email) values
  ('10000000-0000-4000-8000-000000000001', 'ann@test.local'),
  ('10000000-0000-4000-8000-000000000002', 'bo@test.local'),
  ('10000000-0000-4000-8000-000000000003', 'cy@test.local'),
  ('10000000-0000-4000-8000-000000000004', 'kid@test.local'),
  ('10000000-0000-4000-8000-000000000005', 'new@test.local'),
  ('10000000-0000-4000-8000-000000000009', 'admin2@test.local');

update public.profiles set first_name = split_part(email::text, '@', 1), last_name = 'Rider', phone = '828-555-0100',
  birth_date = '1990-01-01', gender = 'man', emergency_contact_name = 'EC', emergency_contact_phone = '828-555-0199',
  emergency_contact_relationship = 'Friend'
where email::text like '%@test.local' and email::text <> 'new@test.local';
update public.profiles set birth_date = (now() - interval '16 years')::date where email = 'kid@test.local';
update public.profiles set role = 'admin' where email = 'admin2@test.local';

create temp table f as select
  (select id from public.profiles where email = 'ann@test.local') ann,
  (select id from public.profiles where email = 'bo@test.local') bo,
  (select id from public.profiles where email = 'cy@test.local') cy,
  (select id from public.profiles where email = 'kid@test.local') kid,
  gen_random_uuid() season, gen_random_uuid() ev, gen_random_uuid() closed_ev, gen_random_uuid() later_ev,
  gen_random_uuid() paid_ec, gen_random_uuid() free_ec, gen_random_uuid() masters_ec, gen_random_uuid() closed_ec,
  gen_random_uuid() waiver;
grant select on f to anon, authenticated;

update public.seasons set is_active = false where is_active;
insert into public.seasons (id, name, year, is_active, season_pass_price_cents)
select season, 'Reg test', extract(year from now())::integer, true, 15000 from f;
insert into public.events (id, season_id, venue_id, name, event_date, registration_opens_at, registration_closes_at, status)
select ev, season, (select id from public.venues limit 1), 'Open race', (now() + interval '10 days')::date,
  now() - interval '1 day', now() + interval '9 days', 'published'::public.event_status from f
union all
select closed_ev, season, (select id from public.venues limit 1), 'Closed race', (now() + interval '1 day')::date,
  now() - interval '10 days', now() - interval '1 hour', 'published' from f
union all
select later_ev, season, (select id from public.venues limit 1), 'Later race', (now() + interval '30 days')::date,
  now() - interval '1 day', now() + interval '29 days', 'draft' from f;

insert into public.event_categories (id, event_id, category_id, start_at, duration_minutes, capacity, price_cents)
select paid_ec, ev, (select id from public.categories where name = 'A'), now() + interval '10 days', 45, 60, 2500 from f
union all select free_ec, ev, (select id from public.categories where name = 'B'), now() + interval '10 days', 35, 1, 0 from f
union all select masters_ec, ev, (select id from public.categories where name = 'Masters'), now() + interval '10 days', 40, 60, 0 from f
union all select closed_ec, closed_ev, (select id from public.categories where name = 'B'), now() + interval '1 day', 35, 60, 0 from f;

insert into public.waiver_versions (id, season_id, version_number, title, body_markdown, effective_date, is_current)
select waiver, season, 1, 'Waiver', 'Text', current_date, true from f;
-- Ann, Bo, and the kid have signed. Cy hasn't.
insert into public.waiver_signatures (rider_id, waiver_version_id, typed_full_name, agreed)
select ann, waiver, 'ann Rider', true from f union all
select bo, waiver, 'bo Rider', true from f union all
select kid, waiver, 'kid Rider', true from f;

-- ---------------------------------------------------------------------------
-- Hard requirements
-- ---------------------------------------------------------------------------
select tests.as_user('10000000-0000-4000-8000-000000000005');
select tests.throws_like($$select * from public.register_for_event_categories(array[(select free_ec from f)])$$,
  'profile_incomplete', 'a rider with an incomplete profile cannot register');
reset role;

select tests.as_user('10000000-0000-4000-8000-000000000003');
select tests.throws_like($$select * from public.register_for_event_categories(array[(select free_ec from f)])$$,
  'waiver_required', 'a rider without a current waiver signature cannot register');
select tests.ok((select signed from public.my_waiver_status((select season from f))) = false,
  'my_waiver_status reports the missing signature');
reset role;

select tests.as_user('10000000-0000-4000-8000-000000000001');
select tests.throws_like($$select * from public.register_for_event_categories(array[(select closed_ec from f)])$$,
  'registration_closed', 'registration is refused after the close time');
select tests.throws_like($$select * from public.register_for_event_categories(array[gen_random_uuid()])$$,
  'event_not_open', 'an unknown event category is refused');

-- ---------------------------------------------------------------------------
-- Payment holds, duplicates, capacity, and the waitlist
-- ---------------------------------------------------------------------------
create temp table ann_paid as
  select * from public.register_for_event_categories(array[(select paid_ec from f)]);
select tests.ok((select status from ann_paid) = 'pending_payment' and (select price_cents from ann_paid) = 2500,
  'a priced category starts as pending payment when payments are on');
select tests.ok(
  (select pending_expires_at between now() + interval '30 minutes' and now() + interval '40 minutes'
   from public.registrations where id = (select registration_id from ann_paid)),
  'an unpaid hold expires after the configured minutes');
select tests.throws_like($$select * from public.register_for_event_categories(array[(select paid_ec from f)])$$,
  'already_registered', 'a rider cannot register twice for the same category');

create temp table ann_free as
  select * from public.register_for_event_categories(array[(select free_ec from f)]);
select tests.ok((select status from ann_free) = 'confirmed', 'a free category confirms immediately');
reset role;

select tests.as_user('10000000-0000-4000-8000-000000000002');
create temp table bo_free as
  select * from public.register_for_event_categories(array[(select free_ec from f)]);
select tests.ok((select status from bo_free) = 'waitlisted', 'a full category sends the next registrant to the waitlist');
select tests.ok(
  (select waitlist_position from public.registrations where id = (select registration_id from bo_free)) = 1,
  'the first waitlisted rider is position 1');
select tests.throws_like($$select * from public.cancel_my_registration((select registration_id from ann_free))$$,
  'not_found', 'a rider cannot cancel another rider''s registration');
reset role;

select tests.as_user('10000000-0000-4000-8000-000000000001');
create temp table ann_cancel as select * from public.cancel_my_registration((select registration_id from ann_free));
select tests.ok((select promoted_ids from ann_cancel) = array[(select registration_id from bo_free)],
  'canceling frees the spot for the next waitlisted rider');
select tests.ok((select status from public.registrations where id = (select registration_id from ann_free)) = 'canceled',
  'the canceled registration is marked canceled');
select tests.throws($$select public.promote_waitlist((select free_ec from f))$$, 'riders cannot call promote_waitlist');
select tests.throws($$select * from public.confirm_paid_registrations('cs_x', 'pi_x', '{}')$$,
  'riders cannot confirm payments');
reset role;
select tests.ok((select status from public.registrations where id = (select registration_id from bo_free)) = 'confirmed',
  'a promoted rider in a free category is confirmed');
select tests.ok((select promoted_at is not null and promotion_notified_at is null from public.registrations
  where id = (select registration_id from bo_free)), 'a promotion is queued for an email');

-- ---------------------------------------------------------------------------
-- Eligibility warnings
-- ---------------------------------------------------------------------------
select tests.as_user('10000000-0000-4000-8000-000000000002');
select tests.ok((select warnings from public.my_eligibility_warnings(array[(select masters_ec from f)])) = array['min_age:40'],
  'a rider under the Masters age gets a warning');
select tests.throws_like($$select * from public.register_for_event_categories(array[(select masters_ec from f)])$$,
  'eligibility_warnings', 'registration with a warning needs the rider''s acknowledgment');
create temp table bo_masters as
  select * from public.register_for_event_categories(array[(select masters_ec from f)], true);
select tests.ok((select status from bo_masters) = 'confirmed', 'an acknowledged warning does not block registration');
select tests.ok((select eligibility_warnings from public.registrations where id = (select registration_id from bo_masters))
  = array['min_age:40'], 'the warning is recorded on the registration for staff');
reset role;

-- ---------------------------------------------------------------------------
-- Expired holds and Stripe confirmation
-- ---------------------------------------------------------------------------
update public.registrations set checkout_session_id = 'cs_test_1' where id = (select registration_id from ann_paid);
create temp table confirmed as
  select * from public.confirm_paid_registrations('cs_test_1', 'pi_test_1', jsonb_build_object((select registration_id from ann_paid)::text, 2500));
select tests.ok((select outcome from confirmed) = 'confirmed', 'a paid checkout confirms its registrations');
select tests.ok((select status = 'confirmed' and payment_method = 'stripe' and amount_paid_cents = 2500 and payment_reference = 'pi_test_1'
  from public.registrations where id = (select registration_id from ann_paid)), 'payment details are recorded');
select tests.ok(
  (select outcome from public.confirm_paid_registrations('cs_test_1', 'pi_test_1', '{}')) = 'already_confirmed',
  'confirming the same checkout twice is a no-op');

-- Cy signs, registers for the paid race, and lets the hold expire.
insert into public.waiver_signatures (rider_id, waiver_version_id, typed_full_name, agreed)
select cy, waiver, 'cy Rider', true from f;
select tests.as_user('10000000-0000-4000-8000-000000000003');
create temp table cy_paid as select * from public.register_for_event_categories(array[(select paid_ec from f)]);
reset role;
update public.registrations set pending_expires_at = now() - interval '1 minute', checkout_session_id = 'cs_test_2'
where id = (select registration_id from cy_paid);
select tests.ok((select registered_count from public.event_category_availability where event_category_id = (select paid_ec from f)) = 1,
  'an expired hold no longer counts toward capacity');
do $$ begin perform public.expire_pending_registrations(); end $$;
select tests.ok((select status from public.registrations where id = (select registration_id from cy_paid)) = 'canceled',
  'expiring releases the unpaid hold');
select tests.ok(
  (select outcome from public.confirm_paid_registrations('cs_test_2', 'pi_test_2', '{}')) = 'confirmed_after_expiry',
  'a payment that lands after the hold expired restores the spot when one is free');

-- ---------------------------------------------------------------------------
-- Payments off
-- ---------------------------------------------------------------------------
update public.app_settings set value = 'false' where key = 'payments_enabled';
select tests.as_user('10000000-0000-4000-8000-000000000002');
select tests.ok(
  (select status from public.register_for_event_categories(array[(select paid_ec from f)])) = 'confirmed',
  'with payments off, a priced category confirms and is paid at the desk');
select tests.throws_like($$select * from public.start_season_pass((select season from f), array[(select id from public.categories where name = 'A')])$$,
  'season_pass_unavailable', 'season passes need online payments');
reset role;
update public.app_settings set value = 'true' where key = 'payments_enabled';

-- ---------------------------------------------------------------------------
-- Minors
-- ---------------------------------------------------------------------------
update public.app_settings set value = 'false' where key = 'minors_allowed';
select tests.as_user('10000000-0000-4000-8000-000000000004');
select tests.throws_like($$select * from public.register_for_event_categories(array[(select masters_ec from f)], true)$$,
  'minors_not_allowed', 'riders under 18 are refused when the setting says so');
reset role;
update public.app_settings set value = 'true' where key = 'minors_allowed';

-- ---------------------------------------------------------------------------
-- Season pass
-- ---------------------------------------------------------------------------
select tests.as_user('10000000-0000-4000-8000-000000000004');
create temp table kid_pass as
  select * from public.start_season_pass((select season from f), array[(select id from public.categories where name = 'B')]);
select tests.ok((select price_cents from kid_pass) = 15000, 'the season pass price comes from the season');
reset role;
select tests.ok(public.activate_season_pass((select season_pass_id from kid_pass), 'pi_pass', 15000) = 2,
  'activating a pass registers the rider for every upcoming event in the category, even full or closed ones');
select tests.ok((select status = 'confirmed' and source = 'season_pass' from public.registrations
  where rider_id = (select kid from f) and event_category_id = (select free_ec from f)), 'pass registrations are confirmed');
insert into public.event_categories (event_id, category_id, start_at, duration_minutes)
select later_ev, (select id from public.categories where name = 'B'), now() + interval '30 days', 35 from f;
update public.events set status = 'published' where id = (select later_ev from f);
select tests.ok(exists (select 1 from public.registrations r join public.event_categories ec on ec.id = r.event_category_id
  where r.rider_id = (select kid from f) and ec.event_id = (select later_ev from f)),
  'publishing a new event registers pass holders automatically');

-- ---------------------------------------------------------------------------
-- New waiver versions
-- ---------------------------------------------------------------------------
select tests.as_user('10000000-0000-4000-8000-000000000001');
select tests.throws($$select public.publish_waiver_version((select season from f), 'v2', 'New text', current_date)$$,
  'riders cannot publish waivers');
reset role;
select tests.as_user('10000000-0000-4000-8000-000000000009');
do $$ begin perform public.publish_waiver_version((select season from f), 'Waiver v2', 'New text', current_date); end $$;
reset role;
select tests.ok((select count(*) from public.waiver_versions where season_id = (select season from f) and is_current) = 1
  and (select version_number from public.waiver_versions where season_id = (select season from f) and is_current) = 2,
  'publishing creates version 2 and makes it the only current version');
select tests.ok((select body_markdown from public.waiver_versions where id = (select waiver from f)) = 'Text',
  'the old version is kept unchanged');
select tests.as_user('10000000-0000-4000-8000-000000000001');
select tests.throws_like($$select * from public.register_for_event_categories(array[(select masters_ec from f)])$$,
  'waiver_required', 'after a new version, riders must re-sign before registering');
reset role;

-- Signature bookkeeping: PDF path and email time can be set once.
select tests.ok(tests.affected($$update public.waiver_signatures set pdf_path = 'a/b.pdf', email_sent_at = now()
  where rider_id = (select ann from f)$$) = 1, 'the PDF path and email time can be recorded once');
select tests.throws($$update public.waiver_signatures set email_sent_at = now() + interval '1 day' where rider_id = (select ann from f)$$,
  'the email time cannot be changed after it is set');
select tests.throws($$update public.waiver_signatures set typed_full_name = 'Forged' where rider_id = (select ann from f)$$,
  'the signed name can never change');

rollback;
