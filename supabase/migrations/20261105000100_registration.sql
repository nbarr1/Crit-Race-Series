-- Phase 2: registration, capacity, waitlist, waivers, and season passes.
-- Rider-facing writes go through the SECURITY DEFINER functions here, so the
-- rules (window, waiver, capacity, waitlist order) hold no matter which client
-- calls them. See DECISIONS.md D-021 and D-050 onward.

-- ---------------------------------------------------------------------------
-- Columns
-- ---------------------------------------------------------------------------
alter table public.registrations
  add column pending_expires_at timestamptz,
  add column checkout_session_id text,
  add column eligibility_warnings text[] not null default '{}',
  add column canceled_at timestamptz,
  add column promoted_at timestamptz,
  add column promotion_notified_at timestamptz,
  add column confirmation_sent_at timestamptz,
  add column season_pass_id uuid references public.season_passes (id);
create index registrations_checkout_session on public.registrations (checkout_session_id) where checkout_session_id is not null;
create index registrations_pending_expiry on public.registrations (pending_expires_at) where status = 'pending_payment';

alter table public.season_passes
  add column checkout_session_id text,
  add column amount_paid_cents integer check (amount_paid_cents >= 0),
  add column activated_at timestamptz;
create unique index season_passes_one_active
  on public.season_passes (rider_id, season_id) where status in ('pending_payment', 'active');

alter table public.waiver_signatures
  add column email_sent_at timestamptz;

-- The waiver signature trigger allows attaching the PDF once. It also needs to
-- allow recording when the emailed copy went out (also once).
create or replace function public.waiver_signatures_append_only()
returns trigger
language plpgsql
set search_path = ''
as $$
declare
  changed_keys text[];
begin
  if tg_op = 'DELETE' then
    raise exception 'waiver signatures are append-only' using errcode = '42501';
  end if;
  select array_agg(n.key order by n.key) into changed_keys
  from jsonb_each(to_jsonb(new)) n
  join jsonb_each(to_jsonb(old)) o on o.key = n.key
  where n.value is distinct from o.value and n.key <> 'updated_at';

  if changed_keys is null then
    return new;
  end if;
  if changed_keys <@ array['pdf_path', 'email_sent_at']
     and (old.pdf_path is null or new.pdf_path is not distinct from old.pdf_path)
     and (old.email_sent_at is null or new.email_sent_at is not distinct from old.email_sent_at) then
    return new;
  end if;
  raise exception 'waiver signatures are append-only' using errcode = '42501';
end;
$$;

-- Masters minimum age lives on categories.min_age (one source of truth).
delete from public.app_settings where key = 'masters_min_age';

insert into public.app_settings (key, value, description, is_public) values
  ('pending_payment_minutes', '35', 'Minutes an unpaid online registration holds a spot before it is released. Stripe Checkout sessions expire after 30 minutes.', true),
  ('waitlist_offer_hours', '24', 'Hours a rider promoted from the waitlist has to pay before the spot goes to the next rider.', true)
on conflict (key) do nothing;

-- ---------------------------------------------------------------------------
-- Settings helpers
-- ---------------------------------------------------------------------------
create or replace function public.setting(p_key text)
returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  select value from public.app_settings where key = p_key;
$$;

create or replace function public.setting_bool(p_key text, p_default boolean)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select coalesce((select (value #>> '{}')::boolean from public.app_settings where key = p_key), p_default);
$$;

create or replace function public.setting_int(p_key text, p_default integer)
returns integer
language sql
stable
security definer
set search_path = ''
as $$
  select coalesce((select (value #>> '{}')::integer from public.app_settings where key = p_key), p_default);
$$;

-- ---------------------------------------------------------------------------
-- Capacity. A spot is held by a confirmed registration, or by an unpaid one
-- that hasn't expired.
-- ---------------------------------------------------------------------------
create or replace function public.spots_taken(p_event_category_id uuid)
returns integer
language sql
stable
security definer
set search_path = ''
as $$
  select count(*)::integer
  from public.registrations r
  where r.event_category_id = p_event_category_id
    and (r.status = 'confirmed'
         or (r.status = 'pending_payment' and (r.pending_expires_at is null or r.pending_expires_at > now())));
$$;

create or replace view public.event_category_availability as
  select
    ec.id as event_category_id,
    ec.event_id,
    ec.capacity,
    public.spots_taken(ec.id) as registered_count,
    (select count(*)::integer from public.registrations r
      where r.event_category_id = ec.id and r.status = 'waitlisted') as waitlist_count,
    greatest(ec.capacity - public.spots_taken(ec.id), 0) as spots_left
  from public.event_categories ec
  join public.events e on e.id = ec.event_id
  where e.status <> 'draft' and e.deleted_at is null;

-- ---------------------------------------------------------------------------
-- Waivers
-- ---------------------------------------------------------------------------
create or replace function public.current_waiver_id(p_season_id uuid)
returns uuid
language sql
stable
security definer
set search_path = ''
as $$
  select w.id from public.waiver_versions w where w.season_id = p_season_id and w.is_current limit 1;
$$;

create or replace function public.has_signed_current_waiver(p_profile_id uuid, p_season_id uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1 from public.waiver_signatures s
    where s.rider_id = p_profile_id
      and s.waiver_version_id = public.current_waiver_id(p_season_id)
  );
$$;

-- Admins publish a new numbered version. The previous version stays as it was.
create or replace function public.publish_waiver_version(
  p_season_id uuid,
  p_title text,
  p_body_markdown text,
  p_effective_date date,
  p_external_waiver_url text default null
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  next_version integer;
  new_id uuid;
begin
  if not public.is_admin() then
    raise exception 'only admins can publish waivers' using errcode = '42501';
  end if;
  if coalesce(trim(p_title), '') = '' or coalesce(trim(p_body_markdown), '') = '' then
    raise exception 'waiver title and text are required' using errcode = '22023';
  end if;
  perform 1 from public.seasons where id = p_season_id for update;
  select coalesce(max(version_number), 0) + 1 into next_version
  from public.waiver_versions where season_id = p_season_id;

  update public.waiver_versions set is_current = false where season_id = p_season_id and is_current;
  insert into public.waiver_versions (season_id, version_number, title, body_markdown, effective_date, is_current, external_waiver_url)
  values (p_season_id, next_version, trim(p_title), p_body_markdown, p_effective_date, true, nullif(trim(p_external_waiver_url), ''))
  returning id into new_id;
  return new_id;
end;
$$;

-- ---------------------------------------------------------------------------
-- Eligibility. Warnings only (section 5.2). Returns machine-readable codes;
-- the app turns them into sentences.
-- ---------------------------------------------------------------------------
create or replace function public.eligibility_warnings(p_profile_id uuid, p_event_category_id uuid)
returns text[]
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  p public.profiles;
  c public.categories;
  season_year integer;
  event_day date;
  warnings text[] := '{}';
begin
  select * into p from public.profiles where id = p_profile_id;
  select cat.* into c
  from public.event_categories ec join public.categories cat on cat.id = ec.category_id
  where ec.id = p_event_category_id;
  select s.year, e.event_date into season_year, event_day
  from public.event_categories ec
  join public.events e on e.id = ec.event_id
  join public.seasons s on s.id = e.season_id
  where ec.id = p_event_category_id;

  if c.min_age is not null then
    if p.birth_date is null then
      warnings := warnings || 'min_age_unknown';
    elsif season_year - extract(year from p.birth_date)::integer < c.min_age then
      -- Racing age: the age the rider turns by December 31 of the season year.
      warnings := warnings || ('min_age:' || c.min_age);
    end if;
  end if;

  if c.requires_gender is not null then
    if p.gender is null or p.gender = 'prefer_not_to_say' then
      warnings := warnings || ('gender_unspecified:' || c.requires_gender::text);
    elsif p.gender <> c.requires_gender then
      warnings := warnings || ('gender:' || c.requires_gender::text);
    end if;
  end if;

  if p.usac_license_expiry is not null and p.usac_license_expiry < event_day then
    warnings := warnings || 'license_expired';
  end if;
  return warnings;
end;
$$;

-- Hard requirements (not warnings). Raised as errors with stable codes.
create or replace function public.assert_can_register(p_profile_id uuid, p_event_category_id uuid)
returns void
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  p public.profiles;
  e public.events;
begin
  select * into p from public.profiles where id = p_profile_id and deleted_at is null;
  if p.id is null then
    raise exception 'profile_missing' using errcode = 'P0001';
  end if;
  if coalesce(p.first_name, '') = '' or coalesce(p.last_name, '') = '' or p.phone is null or p.birth_date is null
     or p.emergency_contact_name is null or p.emergency_contact_phone is null or p.emergency_contact_relationship is null then
    raise exception 'profile_incomplete' using errcode = 'P0001';
  end if;

  select ev.* into e
  from public.events ev join public.event_categories ec on ec.event_id = ev.id
  where ec.id = p_event_category_id;
  if e.id is null or e.deleted_at is not null or e.status <> 'published' then
    raise exception 'event_not_open' using errcode = 'P0001';
  end if;

  if public.current_waiver_id(e.season_id) is null then
    raise exception 'no_current_waiver' using errcode = 'P0001';
  end if;
  if not public.has_signed_current_waiver(p.id, e.season_id) then
    raise exception 'waiver_required' using errcode = 'P0001';
  end if;

  if public.setting_bool('usac_license_required', false) and coalesce(p.usac_license_number, '') = '' then
    raise exception 'license_required' using errcode = 'P0001';
  end if;

  if not public.setting_bool('minors_allowed', true)
     and p.birth_date > (e.event_date - interval '18 years')::date then
    raise exception 'minors_not_allowed' using errcode = 'P0001';
  end if;
end;
$$;

-- ---------------------------------------------------------------------------
-- Waitlist promotion. Fills open spots in waitlist order. When payment is
-- needed, the promoted rider gets a time-limited offer (pending_payment).
-- Returns the promoted registration IDs so the app can email them.
-- ---------------------------------------------------------------------------
create or replace function public.promote_waitlist(p_event_category_id uuid)
returns setof uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  ec public.event_categories;
  needs_payment boolean;
  next_reg uuid;
begin
  select * into ec from public.event_categories where id = p_event_category_id for update;
  needs_payment := public.setting_bool('payments_enabled', true) and ec.price_cents > 0;

  loop
    exit when public.spots_taken(ec.id) >= ec.capacity;
    select r.id into next_reg
    from public.registrations r
    where r.event_category_id = ec.id and r.status = 'waitlisted'
    order by r.waitlist_position nulls last, r.created_at
    limit 1
    for update skip locked;
    exit when next_reg is null;

    update public.registrations set
      status = case when needs_payment then 'pending_payment'::public.registration_status else 'confirmed'::public.registration_status end,
      pending_expires_at = case when needs_payment
        then now() + make_interval(hours => public.setting_int('waitlist_offer_hours', 24)) end,
      waitlist_position = null,
      promoted_at = now()
    where id = next_reg;
    return next next_reg;
    next_reg := null;
  end loop;
end;
$$;

-- Releases unpaid holds that ran out and refills from the waitlist.
-- Called by the scheduled job and before each registration.
create or replace function public.expire_pending_registrations(p_event_category_id uuid default null)
returns setof uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  ec_id uuid;
begin
  for ec_id in
    update public.registrations set status = 'canceled', canceled_at = now(),
      notes = trim(notes || ' Unpaid hold expired.')
    where status = 'pending_payment' and pending_expires_at is not null and pending_expires_at <= now()
      and (p_event_category_id is null or event_category_id = p_event_category_id)
    returning event_category_id
  loop
    return query select public.promote_waitlist(ec_id);
  end loop;
end;
$$;

-- ---------------------------------------------------------------------------
-- Rider registration. All selections succeed or none do.
-- ---------------------------------------------------------------------------
create or replace function public.register_for_event_categories(
  p_event_category_ids uuid[],
  p_acknowledged_warnings boolean default false
)
returns table (
  registration_id uuid,
  event_category_id uuid,
  status public.registration_status,
  price_cents integer,
  warnings text[]
)
language plpgsql
security definer
set search_path = ''
as $$
#variable_conflict use_column
declare
  me uuid := public.current_profile_id();
  ec public.event_categories;
  ev public.events;
  pass_id uuid;
  w text[];
  needs_payment boolean;
  new_status public.registration_status;
  new_id uuid;
  hold_minutes integer := public.setting_int('pending_payment_minutes', 35);
  payments_on boolean := public.setting_bool('payments_enabled', true);
begin
  if me is null then
    raise exception 'not_signed_in' using errcode = '42501';
  end if;
  if p_event_category_ids is null or cardinality(p_event_category_ids) = 0 then
    raise exception 'nothing_selected' using errcode = 'P0001';
  end if;
  if cardinality(p_event_category_ids) > 20 then
    raise exception 'too_many_selected' using errcode = 'P0001';
  end if;

  -- Lock in a stable order so concurrent registrations can't deadlock.
  for ec in
    select * from public.event_categories x
    where x.id = any (p_event_category_ids)
    order by x.id
    for update
  loop
    perform public.assert_can_register(me, ec.id);
    select * into ev from public.events where id = ec.event_id;
    if now() < ev.registration_opens_at or now() >= ev.registration_closes_at then
      raise exception 'registration_closed' using errcode = 'P0001';
    end if;
    if exists (select 1 from public.registrations r where r.rider_id = me and r.event_category_id = ec.id
               and r.status not in ('canceled', 'refunded')) then
      raise exception 'already_registered' using errcode = 'P0001';
    end if;

    w := public.eligibility_warnings(me, ec.id);
    if cardinality(w) > 0 and not p_acknowledged_warnings then
      raise exception 'eligibility_warnings' using errcode = 'P0001';
    end if;

    perform public.expire_pending_registrations(ec.id);

    select sp.id into pass_id from public.season_passes sp
    where sp.rider_id = me and sp.season_id = ev.season_id and sp.status = 'active' and ec.category_id = any (sp.category_ids)
    limit 1;

    needs_payment := payments_on and ec.price_cents > 0 and pass_id is null;
    if pass_id is not null then
      new_status := 'confirmed';
    elsif public.spots_taken(ec.id) >= ec.capacity then
      new_status := 'waitlisted';
    elsif needs_payment then
      new_status := 'pending_payment';
    else
      new_status := 'confirmed';
    end if;

    insert into public.registrations (
      rider_id, event_category_id, status, source, payment_method, eligibility_warnings,
      pending_expires_at, waitlist_position, season_pass_id
    ) values (
      me, ec.id, new_status,
      case when pass_id is not null then 'season_pass'::public.registration_source else 'online'::public.registration_source end,
      case when pass_id is not null then 'season_pass'::public.payment_method else 'none'::public.payment_method end,
      w,
      case when new_status = 'pending_payment' then now() + make_interval(mins => hold_minutes) end,
      case when new_status = 'waitlisted' then
        (select coalesce(max(r.waitlist_position), 0) + 1 from public.registrations r
         where r.event_category_id = ec.id and r.status = 'waitlisted') end,
      pass_id
    ) returning id into new_id;

    registration_id := new_id;
    event_category_id := ec.id;
    status := new_status;
    price_cents := case when needs_payment then ec.price_cents else 0 end;
    warnings := w;
    return next;
  end loop;

  if not found then
    raise exception 'event_not_open' using errcode = 'P0001';
  end if;
  if (select count(*) from public.event_categories x where x.id = any (p_event_category_ids)) <> cardinality(p_event_category_ids) then
    raise exception 'event_not_open' using errcode = 'P0001';
  end if;
end;
$$;

-- Riders cancel their own registration before registration closes. Returns
-- what the app needs to apply the refund policy and email promoted riders.
create or replace function public.cancel_my_registration(p_registration_id uuid)
returns table (
  registration_id uuid,
  previous_status public.registration_status,
  payment_method public.payment_method,
  payment_reference text,
  amount_paid_cents integer,
  promoted_ids uuid[]
)
language plpgsql
security definer
set search_path = ''
as $$
#variable_conflict use_column
declare
  me uuid := public.current_profile_id();
  r public.registrations;
  closes timestamptz;
begin
  select * into r from public.registrations x where x.id = p_registration_id for update;
  if r.id is null or r.rider_id is distinct from me then
    raise exception 'not_found' using errcode = 'P0002';
  end if;
  if r.status not in ('confirmed', 'pending_payment', 'waitlisted') then
    raise exception 'not_cancelable' using errcode = 'P0001';
  end if;
  if r.checked_in_at is not null then
    raise exception 'already_checked_in' using errcode = 'P0001';
  end if;
  select e.registration_closes_at into closes from public.events e where e.id = r.event_id;
  if now() >= closes then
    raise exception 'registration_closed' using errcode = 'P0001';
  end if;

  update public.registrations set status = 'canceled', canceled_at = now(), waitlist_position = null,
    pending_expires_at = null
  where id = r.id;

  registration_id := r.id;
  previous_status := r.status;
  payment_method := r.payment_method;
  payment_reference := r.payment_reference;
  amount_paid_cents := r.amount_paid_cents;
  promoted_ids := array(select public.promote_waitlist(r.event_category_id));
  return next;
end;
$$;

-- ---------------------------------------------------------------------------
-- Payments (service role only). Called by the Stripe webhook and by the
-- confirmation page after it verifies the Checkout Session with Stripe.
-- Idempotent: confirming twice is a no-op.
-- ---------------------------------------------------------------------------
create or replace function public.confirm_paid_registrations(
  p_checkout_session_id text,
  p_payment_reference text,
  p_amounts jsonb  -- {"<registration id>": <cents>, ...}
)
returns table (registration_id uuid, outcome text)
language plpgsql
security definer
set search_path = ''
as $$
#variable_conflict use_column
declare
  r public.registrations;
  ec public.event_categories;
begin
  for r in
    select * from public.registrations x
    where x.checkout_session_id = p_checkout_session_id
    order by x.event_category_id
    for update
  loop
    registration_id := r.id;
    if r.status = 'confirmed' and r.payment_method = 'stripe' then
      outcome := 'already_confirmed';
    elsif r.status = 'pending_payment' then
      update public.registrations set status = 'confirmed', payment_method = 'stripe',
        payment_reference = p_payment_reference,
        amount_paid_cents = coalesce((p_amounts ->> r.id::text)::integer, amount_paid_cents),
        pending_expires_at = null
      where id = r.id;
      outcome := 'confirmed';
    elsif r.status = 'canceled' then
      -- The hold expired before payment arrived. Take the spot back if one is
      -- free; otherwise staff refund by hand.
      select * into ec from public.event_categories where id = r.event_category_id for update;
      if public.spots_taken(ec.id) < ec.capacity
         and not exists (select 1 from public.registrations x where x.rider_id = r.rider_id
                         and x.event_category_id = r.event_category_id and x.status not in ('canceled', 'refunded')) then
        update public.registrations set status = 'confirmed', payment_method = 'stripe',
          payment_reference = p_payment_reference,
          amount_paid_cents = coalesce((p_amounts ->> r.id::text)::integer, amount_paid_cents),
          pending_expires_at = null, canceled_at = null,
          notes = trim(notes || ' Paid after hold expired; spot restored.')
        where id = r.id;
        outcome := 'confirmed_after_expiry';
      else
        update public.registrations set payment_reference = p_payment_reference,
          amount_paid_cents = coalesce((p_amounts ->> r.id::text)::integer, amount_paid_cents),
          notes = trim(notes || ' Paid after hold expired and the category filled. Needs a refund.')
        where id = r.id;
        outcome := 'needs_refund';
      end if;
    else
      outcome := 'ignored_' || r.status::text;
    end if;
    return next;
  end loop;
end;
$$;

create or replace function public.release_checkout(p_checkout_session_id text)
returns setof uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  ec_id uuid;
begin
  for ec_id in
    update public.registrations set status = 'canceled', canceled_at = now(), pending_expires_at = null,
      notes = trim(notes || ' Checkout expired.')
    where checkout_session_id = p_checkout_session_id and status = 'pending_payment'
    returning event_category_id
  loop
    return query select public.promote_waitlist(ec_id);
  end loop;
end;
$$;

-- ---------------------------------------------------------------------------
-- Season passes
-- ---------------------------------------------------------------------------
create or replace function public.start_season_pass(p_season_id uuid, p_category_ids uuid[])
returns table (season_pass_id uuid, price_cents integer)
language plpgsql
security definer
set search_path = ''
as $$
declare
  me uuid := public.current_profile_id();
  s public.seasons;
  new_id uuid;
begin
  if me is null then raise exception 'not_signed_in' using errcode = '42501'; end if;
  select * into s from public.seasons where id = p_season_id;
  if s.id is null or not s.is_active then raise exception 'season_not_open' using errcode = 'P0001'; end if;
  if s.season_pass_price_cents is null then raise exception 'season_pass_unavailable' using errcode = 'P0001'; end if;
  if not public.setting_bool('payments_enabled', true) then
    raise exception 'season_pass_unavailable' using errcode = 'P0001';
  end if;
  if p_category_ids is null or cardinality(p_category_ids) = 0
     or exists (select 1 from unnest(p_category_ids) c where not exists (select 1 from public.categories x where x.id = c)) then
    raise exception 'nothing_selected' using errcode = 'P0001';
  end if;
  if public.current_waiver_id(s.id) is null or not public.has_signed_current_waiver(me, s.id) then
    raise exception 'waiver_required' using errcode = 'P0001';
  end if;
  if exists (select 1 from public.season_passes sp where sp.rider_id = me and sp.season_id = s.id and sp.status = 'active') then
    raise exception 'already_registered' using errcode = 'P0001';
  end if;
  -- Replace an abandoned unpaid pass instead of blocking on it.
  update public.season_passes set status = 'canceled'
  where rider_id = me and season_id = s.id and status = 'pending_payment';

  insert into public.season_passes (rider_id, season_id, category_ids, status)
  values (me, s.id, p_category_ids, 'pending_payment')
  returning id into new_id;
  season_pass_id := new_id;
  price_cents := s.season_pass_price_cents * cardinality(p_category_ids);
  return next;
end;
$$;

-- Registers an active pass holder for every open event in their categories.
-- Pass holders are guaranteed a spot, so capacity doesn't apply (D-053).
create or replace function public.apply_season_pass(p_season_pass_id uuid, p_event_id uuid default null)
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  sp public.season_passes;
  n integer;
begin
  select * into sp from public.season_passes where id = p_season_pass_id;
  if sp.status <> 'active' then return 0; end if;

  insert into public.registrations (rider_id, event_category_id, status, source, payment_method, season_pass_id, eligibility_warnings)
  select sp.rider_id, ec.id, 'confirmed', 'season_pass', 'season_pass', sp.id, public.eligibility_warnings(sp.rider_id, ec.id)
  from public.event_categories ec
  join public.events e on e.id = ec.event_id
  where e.season_id = sp.season_id
    and e.status = 'published' and e.deleted_at is null
    and e.event_date >= (now() at time zone 'America/New_York')::date
    and ec.category_id = any (sp.category_ids)
    and (p_event_id is null or e.id = p_event_id)
    and not exists (
      select 1 from public.registrations r
      where r.rider_id = sp.rider_id and r.event_category_id = ec.id and r.status not in ('canceled', 'refunded')
    );
  get diagnostics n = row_count;
  return n;
end;
$$;

create or replace function public.activate_season_pass(p_season_pass_id uuid, p_payment_reference text, p_amount_cents integer)
returns integer
language plpgsql
security definer
set search_path = ''
as $$
begin
  update public.season_passes set status = 'active', payment_reference = p_payment_reference,
    amount_paid_cents = p_amount_cents, activated_at = coalesce(activated_at, now())
  where id = p_season_pass_id and status in ('pending_payment', 'active');
  return public.apply_season_pass(p_season_pass_id);
end;
$$;

-- When an event is published (or gets a new category), register pass holders.
create or replace function public.events_apply_season_passes()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  sp_id uuid;
  ev_id uuid;
  season uuid;
begin
  if tg_table_name = 'events' then ev_id := new.id; else ev_id := new.event_id; end if;
  select e.season_id into season from public.events e where e.id = ev_id and e.status = 'published';
  if season is null then return new; end if;
  for sp_id in select id from public.season_passes where season_id = season and status = 'active' loop
    perform public.apply_season_pass(sp_id, ev_id);
  end loop;
  return new;
end;
$$;

create trigger events_apply_season_passes
  after update of status on public.events
  for each row when (new.status = 'published' and old.status is distinct from 'published')
  execute function public.events_apply_season_passes();
create trigger event_categories_apply_season_passes
  after insert on public.event_categories
  for each row execute function public.events_apply_season_passes();

-- ---------------------------------------------------------------------------
-- Grants. Rider-callable functions run as the caller's identity checks above.
-- Service-only functions are callable by service_role, never by API users.
-- ---------------------------------------------------------------------------
revoke execute on function
  public.setting(text), public.setting_bool(text, boolean), public.setting_int(text, integer),
  public.spots_taken(uuid), public.current_waiver_id(uuid), public.has_signed_current_waiver(uuid, uuid),
  public.publish_waiver_version(uuid, text, text, date, text),
  public.eligibility_warnings(uuid, uuid), public.assert_can_register(uuid, uuid),
  public.promote_waitlist(uuid), public.expire_pending_registrations(uuid),
  public.register_for_event_categories(uuid[], boolean), public.cancel_my_registration(uuid),
  public.confirm_paid_registrations(text, text, jsonb), public.release_checkout(text),
  public.start_season_pass(uuid, uuid[]), public.apply_season_pass(uuid, uuid),
  public.activate_season_pass(uuid, text, integer)
from public, anon, authenticated;

grant execute on function public.spots_taken(uuid) to anon, authenticated;
grant execute on function public.register_for_event_categories(uuid[], boolean) to authenticated;
grant execute on function public.cancel_my_registration(uuid) to authenticated;
grant execute on function public.start_season_pass(uuid, uuid[]) to authenticated;
grant execute on function public.publish_waiver_version(uuid, text, text, date, text) to authenticated;

-- Riders can check their own warnings and waiver status before registering.
create or replace function public.my_eligibility_warnings(p_event_category_ids uuid[])
returns table (event_category_id uuid, warnings text[])
language sql
stable
security definer
set search_path = ''
as $$
  select x, public.eligibility_warnings(public.current_profile_id(), x)
  from unnest(p_event_category_ids) x
  where public.current_profile_id() is not null;
$$;
create or replace function public.my_waiver_status(p_season_id uuid)
returns table (current_waiver_id uuid, signed boolean)
language sql
stable
security definer
set search_path = ''
as $$
  select public.current_waiver_id(p_season_id),
         public.has_signed_current_waiver(public.current_profile_id(), p_season_id);
$$;
revoke execute on function public.my_eligibility_warnings(uuid[]), public.my_waiver_status(uuid) from public, anon;
grant execute on function public.my_eligibility_warnings(uuid[]), public.my_waiver_status(uuid) to authenticated;

grant execute on all functions in schema public to service_role;
