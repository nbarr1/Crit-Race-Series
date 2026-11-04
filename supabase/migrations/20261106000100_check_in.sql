-- Phase 3: race-day check-in, desk payments, walk-ups, and the offline
-- sync log. Staff devices queue operations while offline and replay them;
-- every function here is idempotent by the operation's ID.

-- ---------------------------------------------------------------------------
-- Check-in log. One row per check-in attempt from any device, so conflicting
-- offline check-ins are all kept (section 5.4: keep the earliest, log both).
-- ---------------------------------------------------------------------------
create table public.check_in_events (
  id uuid primary key default gen_random_uuid(),
  op_id uuid not null unique,
  registration_id uuid not null references public.registrations (id),
  staff_profile_id uuid references public.profiles (id),
  device_id text,
  client_checked_in_at timestamptz not null,
  bib_number integer,
  outcome text not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index check_in_events_registration on public.check_in_events (registration_id, created_at);
create trigger check_in_events_updated_at before update on public.check_in_events
  for each row execute function public.set_updated_at();
create trigger check_in_events_immutable before update or delete on public.check_in_events
  for each row execute function public.audit_log_immutable();

alter table public.check_in_events enable row level security;
grant select on public.check_in_events to authenticated;
create policy check_in_events_staff_read on public.check_in_events
  for select to authenticated using (public.is_staff());

-- Generic idempotency log for the other queued operations.
create table public.staff_operations (
  op_id uuid primary key,
  op_type text not null,
  staff_profile_id uuid references public.profiles (id),
  device_id text,
  result jsonb not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create trigger staff_operations_updated_at before update on public.staff_operations
  for each row execute function public.set_updated_at();
alter table public.staff_operations enable row level security;
grant select on public.staff_operations to authenticated;
create policy staff_operations_staff_read on public.staff_operations
  for select to authenticated using (public.is_staff());

-- ---------------------------------------------------------------------------
-- Helpers
-- ---------------------------------------------------------------------------
create or replace function public.require_staff()
returns uuid
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  me uuid := public.current_profile_id();
begin
  if me is null or not public.is_staff() then
    raise exception 'staff_only' using errcode = '42501';
  end if;
  return me;
end;
$$;

-- A client timestamp from an offline device: never in the future, and never
-- more than two days old (a clock that's badly wrong).
create or replace function public.clamp_client_time(p_at timestamptz)
returns timestamptz
language sql
stable
set search_path = ''
as $$
  select case
    when p_at is null or p_at > now() then now()
    when p_at < now() - interval '2 days' then now()
    else p_at
  end;
$$;

-- ---------------------------------------------------------------------------
-- Check in. Assigns or confirms the bib. When two devices check in the same
-- rider, the earliest time (and that device's bib) wins, and both attempts
-- stay in check_in_events.
-- ---------------------------------------------------------------------------
create or replace function public.staff_check_in(
  p_op_id uuid,
  p_registration_id uuid,
  p_bib integer,
  p_checked_in_at timestamptz,
  p_device_id text default null
)
returns table (outcome text, checked_in_at timestamptz, bib_number integer)
language plpgsql
security definer
set search_path = ''
as $$
#variable_conflict use_column
declare
  me uuid := public.require_staff();
  r public.registrations;
  ev public.events;
  at_time timestamptz := public.clamp_client_time(p_checked_in_at);
  result text;
  prior record;
begin
  select e.outcome, reg.checked_in_at, reg.bib_number into prior
  from public.check_in_events e join public.registrations reg on reg.id = e.registration_id
  where e.op_id = p_op_id;
  if found then
    outcome := 'duplicate';
    checked_in_at := prior.checked_in_at;
    bib_number := prior.bib_number;
    return next;
    return;
  end if;

  select * into r from public.registrations where id = p_registration_id for update;
  if r.id is null then
    raise exception 'not_found' using errcode = 'P0002';
  end if;
  select * into ev from public.events where id = r.event_id;
  if r.status <> 'confirmed' then
    raise exception 'not_confirmed' using errcode = 'P0001';
  end if;
  if not public.has_signed_current_waiver(r.rider_id, ev.season_id) then
    raise exception 'waiver_required' using errcode = 'P0001';
  end if;
  if p_bib is not null and (p_bib < 1 or p_bib > 99999) then
    raise exception 'bib_invalid' using errcode = 'P0001';
  end if;
  if p_bib is null and r.bib_number is null then
    raise exception 'bib_required' using errcode = 'P0001';
  end if;

  begin
    if r.checked_in_at is null then
      update public.registrations set checked_in_at = at_time, checked_in_by = me,
        bib_number = coalesce(p_bib, bib_number)
      where id = r.id;
      result := 'checked_in';
    elsif at_time < r.checked_in_at then
      update public.registrations set checked_in_at = at_time, checked_in_by = me,
        bib_number = coalesce(p_bib, bib_number)
      where id = r.id;
      result := 'earlier_time_kept';
    elsif p_bib is not null and r.bib_number is distinct from p_bib then
      result := 'already_checked_in_bib_kept';
    else
      result := 'already_checked_in';
    end if;
  exception when unique_violation then
    raise exception 'bib_taken' using errcode = 'P0001';
  end;

  insert into public.check_in_events (op_id, registration_id, staff_profile_id, device_id, client_checked_in_at, bib_number, outcome)
  values (p_op_id, r.id, me, left(p_device_id, 100), at_time, p_bib, result);

  select reg.checked_in_at, reg.bib_number into checked_in_at, bib_number
  from public.registrations reg where reg.id = r.id;
  outcome := result;
  return next;
end;
$$;

create or replace function public.staff_undo_check_in(p_registration_id uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  me uuid := public.require_staff();
begin
  update public.registrations set checked_in_at = null, checked_in_by = null
  where id = p_registration_id and checked_in_at is not null;
  if not found then
    raise exception 'not_checked_in' using errcode = 'P0001';
  end if;
  insert into public.check_in_events (op_id, registration_id, staff_profile_id, client_checked_in_at, outcome)
  values (gen_random_uuid(), p_registration_id, me, now(), 'undone');
end;
$$;

-- ---------------------------------------------------------------------------
-- Desk payment. Confirms an unpaid, waitlisted, or pay-at-desk registration.
-- Staff may confirm over capacity (their call at the desk).
-- ---------------------------------------------------------------------------
create or replace function public.staff_record_payment(
  p_op_id uuid,
  p_registration_id uuid,
  p_payment_method public.payment_method,
  p_amount_cents integer,
  p_device_id text default null
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  me uuid := public.require_staff();
  r public.registrations;
  res jsonb;
begin
  select result into res from public.staff_operations where op_id = p_op_id;
  if found then return res || '{"duplicate": true}'; end if;

  if p_payment_method not in ('cash', 'card_at_desk', 'stripe_link', 'comp') then
    raise exception 'payment_method_invalid' using errcode = 'P0001';
  end if;
  if p_amount_cents is null or p_amount_cents < 0 or p_amount_cents > 100000 then
    raise exception 'amount_invalid' using errcode = 'P0001';
  end if;

  select * into r from public.registrations where id = p_registration_id for update;
  if r.id is null then raise exception 'not_found' using errcode = 'P0002'; end if;
  if r.status in ('canceled', 'refunded') then raise exception 'not_cancelable' using errcode = 'P0001'; end if;
  if r.payment_method in ('stripe', 'season_pass') and r.status = 'confirmed' then
    raise exception 'already_paid' using errcode = 'P0001';
  end if;

  update public.registrations set status = 'confirmed', payment_method = p_payment_method,
    amount_paid_cents = case when p_payment_method = 'comp' then 0 else p_amount_cents end,
    payment_reference = 'desk:' || p_payment_method::text,
    pending_expires_at = null, waitlist_position = null
  where id = r.id;

  res := jsonb_build_object('outcome', 'paid', 'registration_id', r.id, 'previous_status', r.status);
  insert into public.staff_operations (op_id, op_type, staff_profile_id, device_id, result)
  values (p_op_id, 'record_payment', me, left(p_device_id, 100), res);
  return res;
end;
$$;

-- ---------------------------------------------------------------------------
-- Eligibility override (section 5.2: warnings that staff can override).
-- ---------------------------------------------------------------------------
create or replace function public.staff_override_eligibility(
  p_op_id uuid,
  p_registration_id uuid,
  p_reason text,
  p_device_id text default null
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  me uuid := public.require_staff();
  res jsonb;
begin
  select result into res from public.staff_operations where op_id = p_op_id;
  if found then return res || '{"duplicate": true}'; end if;
  if coalesce(trim(p_reason), '') = '' then raise exception 'reason_required' using errcode = 'P0001'; end if;

  update public.registrations set eligibility_override_by = me, eligibility_override_reason = left(trim(p_reason), 500)
  where id = p_registration_id;
  if not found then raise exception 'not_found' using errcode = 'P0002'; end if;

  res := jsonb_build_object('outcome', 'overridden', 'registration_id', p_registration_id);
  insert into public.staff_operations (op_id, op_type, staff_profile_id, device_id, result)
  values (p_op_id, 'override_eligibility', me, left(p_device_id, 100), res);
  return res;
end;
$$;

-- ---------------------------------------------------------------------------
-- On-device waiver ("hand to rider"). Signed on a staff device, possibly
-- offline; the device's time is kept (clamped).
-- ---------------------------------------------------------------------------
create or replace function public.staff_collect_waiver(
  p_op_id uuid,
  p_rider_id uuid,
  p_waiver_version_id uuid,
  p_typed_full_name text,
  p_signed_at timestamptz,
  p_user_agent text,
  p_guardian_name text default null,
  p_guardian_relationship text default null,
  p_guardian_typed_signature text default null,
  p_device_id text default null
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  me uuid := public.require_staff();
  res jsonb;
  new_id uuid;
  p public.profiles;
begin
  select result into res from public.staff_operations where op_id = p_op_id;
  if found then return res || '{"duplicate": true}'; end if;

  select * into p from public.profiles where id = p_rider_id;
  if p.id is null then raise exception 'not_found' using errcode = 'P0002'; end if;
  if not exists (select 1 from public.waiver_versions w where w.id = p_waiver_version_id and w.is_current) then
    raise exception 'waiver_changed' using errcode = 'P0001';
  end if;
  if p.birth_date is not null and p.birth_date > (now() - interval '18 years')::date
     and (coalesce(trim(p_guardian_name), '') = '' or coalesce(trim(p_guardian_typed_signature), '') = '') then
    raise exception 'guardian_required' using errcode = 'P0001';
  end if;

  select s.id into new_id from public.waiver_signatures s
  where s.rider_id = p.id and s.waiver_version_id = p_waiver_version_id limit 1;
  if new_id is null then
    insert into public.waiver_signatures (
      rider_id, waiver_version_id, typed_full_name, agreed, signed_at, user_agent,
      guardian_name, guardian_relationship, guardian_typed_signature, collected_by
    ) values (
      p.id, p_waiver_version_id, trim(p_typed_full_name), true, public.clamp_client_time(p_signed_at), left(p_user_agent, 500),
      nullif(trim(p_guardian_name), ''), nullif(trim(p_guardian_relationship), ''), nullif(trim(p_guardian_typed_signature), ''), me
    ) returning id into new_id;
    res := jsonb_build_object('outcome', 'signed', 'signature_id', new_id);
  else
    res := jsonb_build_object('outcome', 'already_signed', 'signature_id', new_id);
  end if;

  insert into public.staff_operations (op_id, op_type, staff_profile_id, device_id, result)
  values (p_op_id, 'collect_waiver', me, left(p_device_id, 100), res);
  return res;
end;
$$;

-- ---------------------------------------------------------------------------
-- Walk-up registration. Creates the rider if needed, then a confirmed
-- registration with the desk payment. Ignores the online close time and
-- capacity (staff decide at the desk).
-- ---------------------------------------------------------------------------
create or replace function public.staff_walk_up(
  p_op_id uuid,
  p_existing_rider_id uuid,
  p_rider jsonb,  -- first_name, last_name, email, phone, birth_date, gender, team, emergency_contact_*
  p_event_category_id uuid,
  p_payment_method public.payment_method,
  p_amount_cents integer,
  p_device_id text default null
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  me uuid := public.require_staff();
  res jsonb;
  rider uuid := p_existing_rider_id;
  reg uuid;
  ev public.events;
  email_text text := nullif(lower(trim(p_rider ->> 'email')), '');
begin
  select result into res from public.staff_operations where op_id = p_op_id;
  if found then return res || '{"duplicate": true}'; end if;

  if p_payment_method not in ('cash', 'card_at_desk', 'stripe_link', 'comp') then
    raise exception 'payment_method_invalid' using errcode = 'P0001';
  end if;
  select e.* into ev from public.events e join public.event_categories ec on ec.event_id = e.id where ec.id = p_event_category_id;
  if ev.id is null or ev.status not in ('published', 'completed') or ev.deleted_at is not null then
    raise exception 'event_not_open' using errcode = 'P0001';
  end if;

  if rider is null then
    if email_text is not null then
      select id into rider from public.profiles where email = email_text::extensions.citext and deleted_at is null;
    end if;
    if rider is null then
      if coalesce(trim(p_rider ->> 'first_name'), '') = '' or coalesce(trim(p_rider ->> 'last_name'), '') = ''
         or nullif(p_rider ->> 'birth_date', '') is null
         or coalesce(trim(p_rider ->> 'emergency_contact_name'), '') = ''
         or coalesce(trim(p_rider ->> 'emergency_contact_phone'), '') = '' then
        raise exception 'walk_up_details_required' using errcode = 'P0001';
      end if;
      insert into public.profiles (
        first_name, last_name, display_name, email, phone, birth_date, gender, team,
        emergency_contact_name, emergency_contact_relationship, emergency_contact_phone, onboarded_at
      ) values (
        trim(p_rider ->> 'first_name'), trim(p_rider ->> 'last_name'),
        trim(p_rider ->> 'first_name') || ' ' || left(trim(p_rider ->> 'last_name'), 1) || '.',
        email_text, nullif(trim(p_rider ->> 'phone'), ''), (p_rider ->> 'birth_date')::date,
        nullif(p_rider ->> 'gender', '')::public.gender, nullif(trim(p_rider ->> 'team'), ''),
        trim(p_rider ->> 'emergency_contact_name'), coalesce(nullif(trim(p_rider ->> 'emergency_contact_relationship'), ''), 'Not given'),
        trim(p_rider ->> 'emergency_contact_phone'), now()
      ) returning id into rider;
    end if;
  end if;

  if exists (select 1 from public.registrations r where r.rider_id = rider and r.event_category_id = p_event_category_id
             and r.status not in ('canceled', 'refunded')) then
    raise exception 'already_registered' using errcode = 'P0001';
  end if;

  insert into public.registrations (rider_id, event_category_id, status, source, payment_method, amount_paid_cents,
    payment_reference, eligibility_warnings)
  values (rider, p_event_category_id, 'confirmed', 'walk_up', p_payment_method,
    case when p_payment_method = 'comp' then 0 else greatest(coalesce(p_amount_cents, 0), 0) end,
    'desk:' || p_payment_method::text, public.eligibility_warnings(rider, p_event_category_id))
  returning id into reg;

  res := jsonb_build_object('outcome', 'registered', 'registration_id', reg, 'rider_id', rider,
    'waiver_signed', public.has_signed_current_waiver(rider, ev.season_id));
  insert into public.staff_operations (op_id, op_type, staff_profile_id, device_id, result)
  values (p_op_id, 'walk_up', me, left(p_device_id, 100), res);
  return res;
end;
$$;

-- ---------------------------------------------------------------------------
-- Roster for one event (staff only). One row per active registration with
-- what the desk needs. Emergency contacts are deliberately left out because
-- the roster is cached on staff devices (D-074).
-- ---------------------------------------------------------------------------
create or replace function public.staff_roster(p_event_id uuid)
returns table (
  registration_id uuid,
  rider_id uuid,
  first_name text,
  last_name text,
  display_name text,
  team text,
  birth_date date,
  event_category_id uuid,
  category_name text,
  category_sort integer,
  status public.registration_status,
  source public.registration_source,
  payment_method public.payment_method,
  amount_paid_cents integer,
  price_cents integer,
  walk_up_price_cents integer,
  bib_number integer,
  checked_in_at timestamptz,
  waitlist_position integer,
  waiver_signed boolean,
  has_license boolean,
  license_expiry date,
  eligibility_warnings text[],
  eligibility_overridden boolean
)
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  season uuid;
begin
  perform public.require_staff();
  select e.season_id into season from public.events e where e.id = p_event_id;
  return query
  select r.id, p.id, p.first_name, p.last_name,
    coalesce(nullif(p.display_name, ''), p.first_name || ' ' || left(p.last_name, 1) || '.'),
    p.team, p.birth_date, ec.id, c.name, c.sort_order, r.status, r.source, r.payment_method,
    r.amount_paid_cents, ec.price_cents, ec.walk_up_price_cents, r.bib_number, r.checked_in_at, r.waitlist_position,
    public.has_signed_current_waiver(p.id, season),
    coalesce(p.usac_license_number, '') <> '', p.usac_license_expiry,
    r.eligibility_warnings, r.eligibility_override_by is not null
  from public.registrations r
  join public.profiles p on p.id = r.rider_id
  join public.event_categories ec on ec.id = r.event_category_id
  join public.categories c on c.id = ec.category_id
  where r.event_id = p_event_id and r.status in ('confirmed', 'pending_payment', 'waitlisted')
  order by c.sort_order, p.last_name, p.first_name;
end;
$$;

-- Riders already in the system, for the walk-up form. Staff only.
create or replace function public.staff_find_riders(p_query text)
returns table (rider_id uuid, first_name text, last_name text, email text, team text, birth_year integer)
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  q text := '%' || replace(replace(trim(coalesce(p_query, '')), '%', ''), '_', '') || '%';
begin
  perform public.require_staff();
  if char_length(trim(coalesce(p_query, ''))) < 2 then return; end if;
  return query
  select p.id, p.first_name, p.last_name, p.email::text, p.team, extract(year from p.birth_date)::integer
  from public.profiles p
  where p.deleted_at is null
    and (p.first_name || ' ' || p.last_name ilike q or p.email::text ilike q or p.display_name ilike q)
  order by p.last_name, p.first_name
  limit 20;
end;
$$;

-- ---------------------------------------------------------------------------
-- Grants
-- ---------------------------------------------------------------------------
revoke execute on function
  public.require_staff(), public.clamp_client_time(timestamptz),
  public.staff_check_in(uuid, uuid, integer, timestamptz, text), public.staff_undo_check_in(uuid),
  public.staff_record_payment(uuid, uuid, public.payment_method, integer, text),
  public.staff_override_eligibility(uuid, uuid, text, text),
  public.staff_collect_waiver(uuid, uuid, uuid, text, timestamptz, text, text, text, text, text),
  public.staff_walk_up(uuid, uuid, jsonb, uuid, public.payment_method, integer, text),
  public.staff_roster(uuid), public.staff_find_riders(text)
from public, anon;
grant execute on function
  public.staff_check_in(uuid, uuid, integer, timestamptz, text), public.staff_undo_check_in(uuid),
  public.staff_record_payment(uuid, uuid, public.payment_method, integer, text),
  public.staff_override_eligibility(uuid, uuid, text, text),
  public.staff_collect_waiver(uuid, uuid, uuid, text, timestamptz, text, text, text, text, text),
  public.staff_walk_up(uuid, uuid, jsonb, uuid, public.payment_method, integer, text),
  public.staff_roster(uuid), public.staff_find_riders(text)
to authenticated;
grant all on public.check_in_events, public.staff_operations to service_role;
grant execute on all functions in schema public to service_role;
