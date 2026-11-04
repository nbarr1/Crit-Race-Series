-- Phase 6: admin screens.
--
-- Every admin write goes through a function here so a multi-row change (an
-- event and its categories, or switching the active season) happens in one
-- transaction, and so the app gets short error codes it can turn into plain
-- text. The functions run with the caller's rights (security invoker), so
-- row-level security and the audit trigger still see the admin as the actor
-- (D-024). See DECISIONS.md D-110 to D-121.

create or replace function public.require_admin()
returns uuid
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  me uuid := public.current_profile_id();
begin
  if me is null or not public.is_admin() then
    raise exception 'admin_only' using errcode = '42501';
  end if;
  return me;
end;
$$;

-- ---------------------------------------------------------------------------
-- Seasons
-- ---------------------------------------------------------------------------
create or replace function public.admin_save_season(
  p_id uuid,
  p_name text,
  p_year integer,
  p_season_pass_price_cents integer,
  p_points_rules_id uuid
)
returns uuid
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_id uuid;
begin
  perform public.require_admin();
  if char_length(trim(coalesce(p_name, ''))) < 2 then raise exception 'name_required' using errcode = '22023'; end if;
  if p_year is null or p_year not between 2000 and 2100 then raise exception 'year_invalid' using errcode = '22023'; end if;
  if p_season_pass_price_cents is not null and p_season_pass_price_cents < 0 then
    raise exception 'price_invalid' using errcode = '22023';
  end if;
  if p_points_rules_id is not null and not exists (select 1 from public.points_rules where id = p_points_rules_id) then
    raise exception 'points_rules_not_found' using errcode = '22023';
  end if;

  if p_id is null then
    insert into public.seasons (name, year, season_pass_price_cents, points_rules_id)
    values (trim(p_name), p_year, p_season_pass_price_cents,
            coalesce(p_points_rules_id, (select id from public.points_rules order by created_at limit 1)))
    returning id into v_id;
  else
    update public.seasons
       set name = trim(p_name), year = p_year,
           season_pass_price_cents = p_season_pass_price_cents, points_rules_id = p_points_rules_id
     where id = p_id
    returning id into v_id;
    if v_id is null then raise exception 'not_found' using errcode = 'P0002'; end if;
  end if;
  return v_id;
end;
$$;

-- One season is active at a time (a unique index enforces it). Switching
-- turns the old one off first, in the same transaction.
create or replace function public.admin_activate_season(p_id uuid)
returns void
language plpgsql
security invoker
set search_path = ''
as $$
begin
  perform public.require_admin();
  if not exists (select 1 from public.seasons where id = p_id) then
    raise exception 'not_found' using errcode = 'P0002';
  end if;
  update public.seasons set is_active = false where is_active and id <> p_id;
  update public.seasons set is_active = true where id = p_id and not is_active;
end;
$$;

-- ---------------------------------------------------------------------------
-- Events and their categories
-- ---------------------------------------------------------------------------

-- Saves an event and its full list of categories. p_event is
-- {id?, season_id, venue_id, name, event_date, registration_opens_at,
--  registration_closes_at, status, notes,
--  categories: [{id?, category_id, start_at, duration_minutes, laps,
--                capacity, price_cents, walk_up_price_cents}]}.
-- Categories missing from the list are removed, unless riders have
-- registered for them or results exist.
create or replace function public.admin_save_event(p_event jsonb)
returns uuid
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_id uuid := nullif(p_event ->> 'id', '')::uuid;
  v_status public.event_status := coalesce(nullif(p_event ->> 'status', ''), 'draft')::public.event_status;
  v_opens timestamptz := (p_event ->> 'registration_opens_at')::timestamptz;
  v_closes timestamptz := (p_event ->> 'registration_closes_at')::timestamptz;
  cats jsonb := coalesce(p_event -> 'categories', '[]'::jsonb);
  c jsonb;
  ec_id uuid;
  keep uuid[] := '{}';
  old_cat uuid;
begin
  perform public.require_admin();
  if char_length(trim(coalesce(p_event ->> 'name', ''))) < 2 then raise exception 'name_required' using errcode = '22023'; end if;
  if (p_event ->> 'event_date') is null then raise exception 'date_required' using errcode = '22023'; end if;
  if v_opens is null or v_closes is null or v_closes <= v_opens then
    raise exception 'registration_window' using errcode = '22023';
  end if;
  if jsonb_typeof(cats) <> 'array' then raise exception 'categories_invalid' using errcode = '22023'; end if;
  if v_status = 'published' and jsonb_array_length(cats) = 0 then
    raise exception 'no_categories' using errcode = '22023';
  end if;
  if (select count(*) from jsonb_array_elements(cats) x) <>
     (select count(distinct x ->> 'category_id') from jsonb_array_elements(cats) x) then
    raise exception 'duplicate_category' using errcode = '22023';
  end if;

  if v_id is null then
    insert into public.events (season_id, venue_id, name, event_date, registration_opens_at, registration_closes_at, status, notes)
    values (
      (p_event ->> 'season_id')::uuid, (p_event ->> 'venue_id')::uuid, trim(p_event ->> 'name'),
      (p_event ->> 'event_date')::date, v_opens, v_closes, v_status, coalesce(p_event ->> 'notes', '')
    )
    returning id into v_id;
  else
    update public.events
       set season_id = (p_event ->> 'season_id')::uuid,
           venue_id = (p_event ->> 'venue_id')::uuid,
           name = trim(p_event ->> 'name'),
           event_date = (p_event ->> 'event_date')::date,
           registration_opens_at = v_opens,
           registration_closes_at = v_closes,
           notes = coalesce(p_event ->> 'notes', notes)
     where id = v_id and deleted_at is null;
    if not found then raise exception 'not_found' using errcode = 'P0002'; end if;
  end if;

  -- Remove categories that are no longer listed, if nothing depends on them.
  for ec_id in
    select ec.id from public.event_categories ec
    where ec.event_id = v_id
      and ec.id::text not in (select coalesce(x ->> 'id', '') from jsonb_array_elements(cats) x)
  loop
    if exists (select 1 from public.registrations r where r.event_category_id = ec_id)
       or exists (select 1 from public.results r where r.event_category_id = ec_id) then
      raise exception 'category_in_use' using errcode = '23503';
    end if;
    delete from public.event_categories where id = ec_id;
  end loop;

  for c in select * from jsonb_array_elements(cats) loop
    if (c ->> 'start_at') is null or coalesce((c ->> 'duration_minutes')::integer, 0) <= 0 then
      raise exception 'category_times' using errcode = '22023';
    end if;
    ec_id := nullif(c ->> 'id', '')::uuid;
    if ec_id is null then
      insert into public.event_categories
        (event_id, category_id, start_at, duration_minutes, laps, capacity, price_cents, walk_up_price_cents)
      values (
        v_id, (c ->> 'category_id')::uuid, (c ->> 'start_at')::timestamptz, (c ->> 'duration_minutes')::integer,
        nullif(c ->> 'laps', '')::integer, coalesce((c ->> 'capacity')::integer, coalesce((select (value #>> '{}')::integer from public.app_settings where key = 'default_category_capacity'), 60)),
        coalesce((c ->> 'price_cents')::integer, 0), coalesce((c ->> 'walk_up_price_cents')::integer, 0)
      )
      returning id into ec_id;
    else
      select category_id into old_cat from public.event_categories where id = ec_id and event_id = v_id;
      if not found then raise exception 'not_found' using errcode = 'P0002'; end if;
      if old_cat <> (c ->> 'category_id')::uuid
         and exists (select 1 from public.registrations r where r.event_category_id = ec_id) then
        raise exception 'category_in_use' using errcode = '23503';
      end if;
      update public.event_categories
         set category_id = (c ->> 'category_id')::uuid,
             start_at = (c ->> 'start_at')::timestamptz,
             duration_minutes = (c ->> 'duration_minutes')::integer,
             laps = nullif(c ->> 'laps', '')::integer,
             capacity = (c ->> 'capacity')::integer,
             price_cents = (c ->> 'price_cents')::integer,
             walk_up_price_cents = (c ->> 'walk_up_price_cents')::integer
       where id = ec_id;
    end if;
    keep := keep || ec_id;
  end loop;

  -- Status last, so publishing (which registers season pass holders) sees
  -- the final list of categories.
  update public.events set status = v_status where id = v_id and status is distinct from v_status;
  return v_id;
exception
  when unique_violation then
    raise exception 'duplicate_category' using errcode = '23505';
  when check_violation then
    raise exception 'value_out_of_range' using errcode = '23514';
end;
$$;

-- Copies an event to a new date as a draft: same venue, categories, prices,
-- and capacities. Start times and the registration window keep the same
-- local (Eastern) clock times, shifted by the number of days between dates.
create or replace function public.admin_copy_event(p_source_id uuid, p_name text, p_event_date date)
returns uuid
language plpgsql
security invoker
set search_path = ''
as $$
declare
  src public.events;
  v_id uuid;
  shift interval;
  tz constant text := 'America/New_York';
begin
  perform public.require_admin();
  select * into src from public.events where id = p_source_id and deleted_at is null;
  if not found then raise exception 'not_found' using errcode = 'P0002'; end if;
  if char_length(trim(coalesce(p_name, ''))) < 2 then raise exception 'name_required' using errcode = '22023'; end if;
  if p_event_date is null then raise exception 'date_required' using errcode = '22023'; end if;
  shift := make_interval(days => p_event_date - src.event_date);

  insert into public.events (season_id, venue_id, name, event_date, registration_opens_at, registration_closes_at, status)
  values (
    src.season_id, src.venue_id, trim(p_name), p_event_date,
    ((src.registration_opens_at at time zone tz) + shift) at time zone tz,
    ((src.registration_closes_at at time zone tz) + shift) at time zone tz,
    'draft'
  )
  returning id into v_id;

  insert into public.event_categories
    (event_id, category_id, start_at, duration_minutes, laps, capacity, price_cents, walk_up_price_cents)
  select v_id, ec.category_id, ((ec.start_at at time zone tz) + shift) at time zone tz,
         ec.duration_minutes, ec.laps, ec.capacity, ec.price_cents, ec.walk_up_price_cents
  from public.event_categories ec
  where ec.event_id = p_source_id;
  return v_id;
end;
$$;

-- Removes an event from the app (soft delete). Only events nobody has
-- registered for and with no results. Otherwise, cancel the event instead.
create or replace function public.admin_delete_event(p_id uuid)
returns void
language plpgsql
security invoker
set search_path = ''
as $$
begin
  perform public.require_admin();
  if exists (select 1 from public.registrations r where r.event_id = p_id and r.status not in ('canceled', 'refunded'))
     or exists (select 1 from public.results r join public.event_categories ec on ec.id = r.event_category_id where ec.event_id = p_id) then
    raise exception 'event_in_use' using errcode = '23503';
  end if;
  update public.events set deleted_at = now() where id = p_id and deleted_at is null;
  if not found then raise exception 'not_found' using errcode = 'P0002'; end if;
end;
$$;

-- ---------------------------------------------------------------------------
-- Categories, points tables, venues, settings
-- ---------------------------------------------------------------------------
create or replace function public.admin_save_category(
  p_id uuid,
  p_name text,
  p_description text,
  p_eligibility_notes text,
  p_min_age integer,
  p_requires_gender public.gender,
  p_sort_order integer
)
returns uuid
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_id uuid;
begin
  perform public.require_admin();
  if char_length(trim(coalesce(p_name, ''))) < 1 then raise exception 'name_required' using errcode = '22023'; end if;
  if p_min_age is not null and p_min_age not between 0 and 120 then raise exception 'value_out_of_range' using errcode = '22023'; end if;
  if p_id is null then
    insert into public.categories (name, description, eligibility_notes, min_age, requires_gender, sort_order)
    values (trim(p_name), coalesce(p_description, ''), coalesce(p_eligibility_notes, ''), p_min_age, p_requires_gender, coalesce(p_sort_order, 0))
    returning id into v_id;
  else
    update public.categories
       set name = trim(p_name), description = coalesce(p_description, ''),
           eligibility_notes = coalesce(p_eligibility_notes, ''), min_age = p_min_age,
           requires_gender = p_requires_gender, sort_order = coalesce(p_sort_order, sort_order)
     where id = p_id
    returning id into v_id;
    if v_id is null then raise exception 'not_found' using errcode = 'P0002'; end if;
  end if;
  return v_id;
exception
  when unique_violation then
    raise exception 'duplicate_name' using errcode = '23505';
end;
$$;

-- p_points is {"1": 25, "2": 20, ...}: whole-number places from 1, each
-- worth a whole number of points from 0 to 1000. Saving a changed table
-- rescores results in the seasons that use it (D-107).
create or replace function public.admin_save_points_rules(p_id uuid, p_name text, p_points jsonb, p_drop_worst_n integer)
returns uuid
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_id uuid;
begin
  perform public.require_admin();
  if char_length(trim(coalesce(p_name, ''))) < 2 then raise exception 'name_required' using errcode = '22023'; end if;
  if p_points is null or jsonb_typeof(p_points) <> 'object' or p_points = '{}'::jsonb
     or exists (
       select 1 from jsonb_each(p_points) kv
       where kv.key !~ '^[1-9][0-9]{0,2}$'
          or jsonb_typeof(kv.value) <> 'number'
          or (kv.value)::numeric <> floor((kv.value)::numeric)
          or (kv.value)::numeric not between 0 and 1000
     ) then
    raise exception 'points_invalid' using errcode = '22023';
  end if;
  if p_drop_worst_n is null or p_drop_worst_n not between 0 and 20 then
    raise exception 'value_out_of_range' using errcode = '22023';
  end if;
  if p_id is null then
    insert into public.points_rules (name, points_by_place, drop_worst_n)
    values (trim(p_name), p_points, p_drop_worst_n)
    returning id into v_id;
  else
    update public.points_rules
       set name = trim(p_name), points_by_place = p_points, drop_worst_n = p_drop_worst_n
     where id = p_id
    returning id into v_id;
    if v_id is null then raise exception 'not_found' using errcode = 'P0002'; end if;
  end if;
  return v_id;
end;
$$;

create or replace function public.admin_save_venue(
  p_id uuid,
  p_name text,
  p_address text,
  p_latitude double precision,
  p_longitude double precision,
  p_coordinates_confirmed boolean,
  p_parking_notes text,
  p_map_embed_url text
)
returns uuid
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_id uuid;
begin
  perform public.require_admin();
  if char_length(trim(coalesce(p_name, ''))) < 2 then raise exception 'name_required' using errcode = '22023'; end if;
  if p_latitude is null or p_latitude not between -90 and 90 or p_longitude is null or p_longitude not between -180 and 180 then
    raise exception 'coordinates_invalid' using errcode = '22023';
  end if;
  if p_map_embed_url is not null and p_map_embed_url !~ '^https://' then
    raise exception 'url_invalid' using errcode = '22023';
  end if;
  if p_id is null then
    insert into public.venues (name, address, latitude, longitude, coordinates_confirmed, parking_notes, map_embed_url)
    values (trim(p_name), coalesce(p_address, ''), p_latitude, p_longitude, coalesce(p_coordinates_confirmed, false),
            coalesce(p_parking_notes, ''), p_map_embed_url)
    returning id into v_id;
  else
    update public.venues
       set name = trim(p_name), address = coalesce(p_address, ''), latitude = p_latitude, longitude = p_longitude,
           coordinates_confirmed = coalesce(p_coordinates_confirmed, false),
           parking_notes = coalesce(p_parking_notes, ''), map_embed_url = p_map_embed_url
     where id = p_id
    returning id into v_id;
    if v_id is null then raise exception 'not_found' using errcode = 'P0002'; end if;
  end if;
  return v_id;
end;
$$;

-- Updates existing settings from {"key": value, ...}. Each new value must
-- have the same JSON type as the old one (a null on either side is allowed,
-- for optional values such as the external waiver link). Unknown keys are
-- rejected, so a typo can't create a setting nothing reads.
create or replace function public.admin_save_settings(p_values jsonb)
returns integer
language plpgsql
security invoker
set search_path = ''
as $$
declare
  kv record;
  old_value jsonb;
  n integer := 0;
begin
  perform public.require_admin();
  if p_values is null or jsonb_typeof(p_values) <> 'object' then raise exception 'settings_invalid' using errcode = '22023'; end if;
  for kv in select * from jsonb_each(p_values) loop
    select value into old_value from public.app_settings where key = kv.key;
    if not found then raise exception 'unknown_setting' using errcode = '22023'; end if;
    if jsonb_typeof(old_value) <> 'null' and jsonb_typeof(kv.value) <> 'null'
       and jsonb_typeof(old_value) <> jsonb_typeof(kv.value) then
      raise exception 'setting_type' using errcode = '22023';
    end if;
    if kv.key = 'refund_policy' and kv.value #>> '{}' not in ('no_automatic_refunds', 'full_refund_before_close') then
      raise exception 'setting_type' using errcode = '22023';
    end if;
    if jsonb_typeof(kv.value) = 'number' and (kv.value)::numeric < 0 then
      raise exception 'value_out_of_range' using errcode = '22023';
    end if;
    if old_value is distinct from kv.value then
      update public.app_settings set value = kv.value where key = kv.key;
      n := n + 1;
    end if;
  end loop;
  return n;
end;
$$;

-- ---------------------------------------------------------------------------
-- People
-- ---------------------------------------------------------------------------

-- Search for anyone by name or email, with their role, so an admin can make
-- them staff. Also lists every staff member and admin when p_query is empty.
create or replace function public.admin_find_people(p_query text)
returns table (profile_id uuid, first_name text, last_name text, email text, role public.app_role, has_account boolean)
language plpgsql
stable
security invoker
set search_path = ''
as $$
declare
  term text := trim(coalesce(p_query, ''));
  q text := '%' || replace(replace(term, '%', ''), '_', '') || '%';
begin
  perform public.require_admin();
  return query
  select p.id, p.first_name, p.last_name, p.email::text, p.role, p.user_id is not null
  from public.profiles p
  where p.deleted_at is null
    and (
      (term = '' and p.role in ('staff', 'admin'))
      or (char_length(term) >= 2
          and (p.first_name || ' ' || p.last_name ilike q or p.email::text ilike q or p.display_name ilike q))
    )
  order by (p.role = 'rider'), p.last_name, p.first_name
  limit 50;
end;
$$;

-- ---------------------------------------------------------------------------
-- Dashboard
-- ---------------------------------------------------------------------------

-- One season at a glance: per-event registration counts and money taken,
-- plus season totals and setup items still at their placeholders.
create or replace function public.admin_dashboard(p_season_id uuid)
returns jsonb
language plpgsql
stable
security invoker
set search_path = ''
as $$
declare
  out jsonb;
  current_waiver uuid;
begin
  perform public.require_admin();
  select id into current_waiver from public.waiver_versions where season_id = p_season_id and is_current;

  select jsonb_build_object(
    'events', coalesce((
      select jsonb_agg(row_to_json(x) order by x.event_date, x.name)
      from (
        select e.id, e.name, e.event_date, e.status,
          (select coalesce(sum(ec.capacity), 0) from public.event_categories ec where ec.event_id = e.id)::integer as capacity,
          (select count(*) from public.event_categories ec where ec.event_id = e.id)::integer as categories,
          count(r.id) filter (where r.status = 'confirmed')::integer as confirmed,
          count(r.id) filter (where r.status = 'pending_payment')::integer as pending_payment,
          count(r.id) filter (where r.status = 'waitlisted')::integer as waitlisted,
          count(r.id) filter (where r.checked_in_at is not null and r.status = 'confirmed')::integer as checked_in,
          coalesce(sum(r.amount_paid_cents) filter (where r.status = 'confirmed'), 0)::integer as revenue_cents
        from public.events e
        left join public.registrations r on r.event_id = e.id
        where e.season_id = p_season_id and e.deleted_at is null
        group by e.id
      ) x
    ), '[]'::jsonb),
    'riders', (
      select count(distinct r.rider_id) from public.registrations r join public.events e on e.id = r.event_id
      where e.season_id = p_season_id and e.deleted_at is null and r.status in ('confirmed', 'pending_payment')
    ),
    'waiver_version', (select version_number from public.waiver_versions where id = current_waiver),
    'waiver_signers', (
      select count(distinct ws.rider_id) from public.waiver_signatures ws where ws.waiver_version_id = current_waiver
    ),
    'season_passes', (select count(*) from public.season_passes sp where sp.season_id = p_season_id and sp.status = 'active'),
    'season_pass_revenue_cents', (
      select coalesce(sum(sp.amount_paid_cents), 0) from public.season_passes sp where sp.season_id = p_season_id and sp.status = 'active'
    ),
    'staff', (select count(*) from public.profiles where role in ('staff', 'admin') and deleted_at is null),
    'unconfirmed_venues', (select count(*) from public.venues where not coordinates_confirmed),
    'placeholder_prices', (
      select count(*) from public.event_categories ec join public.events e on e.id = ec.event_id
      where e.season_id = p_season_id and e.deleted_at is null
        and ec.price_cents = (select (value #>> '{}')::integer from public.app_settings where key = 'default_price_cents')
        and ec.walk_up_price_cents = (select (value #>> '{}')::integer from public.app_settings where key = 'default_walk_up_price_cents')
    )
  ) into out;
  return out;
end;
$$;

-- Registrations per category of one event, any status. A category with any
-- registration on file can't be removed from the event (D-113).
create or replace function public.admin_dashboard_event_counts(p_event_id uuid)
returns table (event_category_id uuid, registrations integer)
language plpgsql
stable
security invoker
set search_path = ''
as $$
begin
  perform public.require_admin();
  return query
  select ec.id, count(r.id)::integer
  from public.event_categories ec
  left join public.registrations r on r.event_category_id = ec.id
  where ec.event_id = p_event_id
  group by ec.id;
end;
$$;

-- ---------------------------------------------------------------------------
-- Grants
-- ---------------------------------------------------------------------------
revoke execute on function
  public.require_admin(),
  public.admin_save_season(uuid, text, integer, integer, uuid),
  public.admin_activate_season(uuid),
  public.admin_save_event(jsonb),
  public.admin_copy_event(uuid, text, date),
  public.admin_delete_event(uuid),
  public.admin_save_category(uuid, text, text, text, integer, public.gender, integer),
  public.admin_save_points_rules(uuid, text, jsonb, integer),
  public.admin_save_venue(uuid, text, text, double precision, double precision, boolean, text, text),
  public.admin_save_settings(jsonb),
  public.admin_find_people(text),
  public.admin_dashboard(uuid),
  public.admin_dashboard_event_counts(uuid)
from public, anon;
grant execute on function
  public.require_admin(),
  public.admin_save_season(uuid, text, integer, integer, uuid),
  public.admin_activate_season(uuid),
  public.admin_save_event(jsonb),
  public.admin_copy_event(uuid, text, date),
  public.admin_delete_event(uuid),
  public.admin_save_category(uuid, text, text, text, integer, public.gender, integer),
  public.admin_save_points_rules(uuid, text, jsonb, integer),
  public.admin_save_venue(uuid, text, text, double precision, double precision, boolean, text, text),
  public.admin_save_settings(jsonb),
  public.admin_find_people(text),
  public.admin_dashboard(uuid),
  public.admin_dashboard_event_counts(uuid)
to authenticated;
grant execute on all functions in schema public to service_role;

-- The dashboard and the default settings now read these values.
update public.app_settings
   set description = 'Placeholder season pass price per category for a new season. Each season has its own price.'
 where key = 'season_pass_price_cents';
update public.app_settings
   set description = 'Not used yet. Hours before the first start time to send a race-day reminder email.'
 where key = 'reminder_hours_before';
