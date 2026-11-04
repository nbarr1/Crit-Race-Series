-- Phase 5: results upload, publishing, and points.
--
-- Staff save a category's results as a draft (replacing what was there), then
-- publish them. Points come from the season's points table and are computed
-- here, never trusted from the client. Standings rank riders in the app's
-- points engine (src/lib/points.ts); the standings view applies the same drop
-- rule. See DECISIONS.md D-100 to D-107.

-- One result per rider per category.
create unique index results_one_per_rider on public.results (event_category_id, rider_id) where rider_id is not null;

-- Points for one place under a points table. DNF, DNS, and DQ score zero.
create or replace function public.points_for_place(p_table jsonb, p_place integer, p_status public.result_status)
returns integer
language sql
immutable
set search_path = ''
as $$
  select case
    when p_status <> 'finished' or p_place is null or p_place < 1 then 0
    when jsonb_typeof(p_table -> p_place::text) = 'number' then greatest(floor((p_table ->> p_place::text)::numeric), 0)::integer
    else 0
  end;
$$;

-- The points table that applies to an event category (its season's rules, or
-- the first rules row when the season has none).
create or replace function public.points_table_for(p_event_category_id uuid)
returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  select coalesce(
    (select pr.points_by_place
       from public.event_categories ec
       join public.events e on e.id = ec.event_id
       join public.seasons s on s.id = e.season_id
       join public.points_rules pr on pr.id = s.points_rules_id
      where ec.id = p_event_category_id),
    (select points_by_place from public.points_rules order by created_at limit 1),
    '{}'::jsonb
  );
$$;

-- Saves a category's results, replacing any rows already there, as an
-- unpublished draft. p_sheet is {"rows": [{place, status, bib, raw_name,
-- rider_id, laps, finish_time}, ...]}. Returns the number of rows saved.
create or replace function public.save_results(p_event_category_id uuid, p_sheet jsonb)
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  me uuid := public.require_staff();
  tbl jsonb;
  rows jsonb := p_sheet -> 'rows';
  r jsonb;
  st public.result_status;
  pl integer;
  rid uuid;
  places integer[] := '{}';
  riders uuid[] := '{}';
  n integer := 0;
begin
  if not exists (
    select 1 from public.event_categories ec join public.events e on e.id = ec.event_id
    where ec.id = p_event_category_id and e.deleted_at is null
  ) then
    raise exception 'not_found' using errcode = 'P0002';
  end if;
  if rows is null or jsonb_typeof(rows) <> 'array' then
    raise exception 'rows_required' using errcode = '22023';
  end if;
  if jsonb_array_length(rows) > 500 then
    raise exception 'too_many_rows' using errcode = '22023';
  end if;
  tbl := public.points_table_for(p_event_category_id);

  -- Advisory lock per category so two staff saving at once don't interleave.
  perform pg_advisory_xact_lock(hashtextextended(p_event_category_id::text, 0));
  delete from public.results where event_category_id = p_event_category_id;

  for r in select * from jsonb_array_elements(rows) loop
    begin
      st := coalesce(nullif(r ->> 'status', ''), 'finished')::public.result_status;
    exception when invalid_text_representation then
      raise exception 'status_invalid' using errcode = '22023';
    end;
    pl := case when st = 'finished' then (r ->> 'place')::integer end;
    if st = 'finished' and (pl is null or pl < 1) then
      raise exception 'place_required' using errcode = '22023';
    end if;
    if pl is not null then
      if pl = any(places) then
        raise exception 'duplicate_place' using errcode = '22023';
      end if;
      places := places || pl;
    end if;
    rid := nullif(r ->> 'rider_id', '')::uuid;
    if rid is not null then
      if rid = any(riders) then
        raise exception 'duplicate_rider' using errcode = '22023';
      end if;
      if not exists (select 1 from public.profiles where id = rid and deleted_at is null) then
        raise exception 'rider_not_found' using errcode = '22023';
      end if;
      riders := riders || rid;
    end if;
    if rid is null and coalesce(btrim(r ->> 'raw_name'), '') = '' then
      raise exception 'name_required' using errcode = '22023';
    end if;

    insert into public.results (event_category_id, rider_id, raw_name, bib, place, status, laps, finish_time, points_awarded, is_published)
    values (
      p_event_category_id,
      rid,
      left(coalesce(btrim(r ->> 'raw_name'), ''), 200),
      nullif(r ->> 'bib', '')::integer,
      pl,
      st,
      nullif(r ->> 'laps', '')::integer,
      nullif(r ->> 'finish_time', '')::interval,
      public.points_for_place(tbl, pl, st),
      false
    );
    n := n + 1;
  end loop;
  return n;
end $$;

-- Publishes or unpublishes a category's results. Publishing recomputes points
-- from the current points table. Returns the number of rows changed.
create or replace function public.publish_results(p_event_category_id uuid, p_publish boolean)
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  me uuid := public.require_staff();
  tbl jsonb := public.points_table_for(p_event_category_id);
  n integer;
begin
  if p_publish then
    update public.results
       set is_published = true,
           published_at = now(),
           points_awarded = public.points_for_place(tbl, place, status),
           updated_at = now()
     where event_category_id = p_event_category_id and not is_published;
  else
    update public.results
       set is_published = false, published_at = null, updated_at = now()
     where event_category_id = p_event_category_id and is_published;
  end if;
  get diagnostics n = row_count;
  return n;
end $$;

-- When an admin edits a points table, rescore every result in the seasons
-- that use it, so standings follow the new table.
create or replace function public.rescore_results_for_rules()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  update public.results r
     set points_awarded = public.points_for_place(new.points_by_place, r.place, r.status), updated_at = now()
    from public.event_categories ec, public.events e, public.seasons s
   where ec.id = r.event_category_id and e.id = ec.event_id and s.id = e.season_id
     and s.points_rules_id = new.id
     and r.points_awarded <> public.points_for_place(new.points_by_place, r.place, r.status);
  return new;
end $$;

create trigger points_rules_rescore
  after update of points_by_place on public.points_rules
  for each row when (old.points_by_place is distinct from new.points_by_place)
  execute function public.rescore_results_for_rules();

-- Standings view: same columns as before. Early in the season, when a
-- category has held no more events than the number of drops, each rider's best
-- result counts (D-101), and totals are never null.
create or replace view public.standings as
  with scored as (
    select
      e.season_id, ec.category_id, r.rider_id, e.id as event_id, e.event_date,
      r.points_awarded, r.place, r.status
    from public.results r
    join public.event_categories ec on ec.id = r.event_category_id
    join public.events e on e.id = ec.event_id
    where r.is_published and r.rider_id is not null
      and e.deleted_at is null and e.status not in ('canceled', 'draft')
  ),
  events_scored as (
    select season_id, category_id, count(distinct event_id) as n_events
    from scored group by season_id, category_id
  ),
  ranked as (
    select s.*,
      row_number() over (
        partition by s.season_id, s.category_id, s.rider_id
        order by s.points_awarded desc, s.event_date desc, s.event_id
      ) as rn
    from scored s
  )
  select
    rk.season_id,
    rk.category_id,
    rk.rider_id,
    pr.display_name,
    pr.team,
    coalesce(sum(rk.points_awarded) filter (
      where coalesce(pt.drop_worst_n, 0) = 0
         or rk.rn <= greatest(es.n_events - pt.drop_worst_n, 1)
    ), 0)::integer as total_points,
    sum(rk.points_awarded)::integer as raw_points,
    count(*)::integer as races,
    count(*) filter (where rk.place = 1 and rk.status = 'finished')::integer as wins
  from ranked rk
  join events_scored es on es.season_id = rk.season_id and es.category_id = rk.category_id
  join public.seasons se on se.id = rk.season_id
  left join public.points_rules pt on pt.id = se.points_rules_id
  join public.public_riders pr on pr.id = rk.rider_id
  group by rk.season_id, rk.category_id, rk.rider_id, pr.display_name, pr.team;

grant select on public.standings to anon, authenticated;

revoke execute on function public.save_results(uuid, jsonb), public.publish_results(uuid, boolean),
  public.points_table_for(uuid), public.rescore_results_for_rules() from public, anon;
grant execute on function public.save_results(uuid, jsonb), public.publish_results(uuid, boolean) to authenticated;
grant execute on function public.points_for_place(jsonb, integer, public.result_status) to anon, authenticated;
grant execute on all functions in schema public to service_role;
