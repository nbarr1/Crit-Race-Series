-- Phase 4: event information. Course maps managed by staff, announcement
-- email audiences, and the recipient lists for them.

-- Staff (not only admins) manage course maps (section 2), so the staff edit
-- guard on events now also allows course_map_id.
create or replace function public.events_guard_staff_update()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if current_user in ('postgres', 'service_role', 'supabase_admin') or public.is_admin() then
    return new;
  end if;
  if (to_jsonb(new) - array['weather_override_text', 'notes', 'course_map_id', 'updated_at'])
     is distinct from (to_jsonb(old) - array['weather_override_text', 'notes', 'course_map_id', 'updated_at']) then
    raise exception 'staff can only change the weather override, notes, and course map on an event'
      using errcode = '42501';
  end if;
  return new;
end;
$$;

alter table public.announcements
  add column email_audience text check (email_audience in ('event_registrants', 'season')),
  add column email_recipient_count integer;

-- The email audience must match the announcement: event registrants need an event.
alter table public.announcements
  add constraint announcements_email_audience_event
  check (email_audience is distinct from 'event_registrants' or event_id is not null);

-- Who gets an announcement email. Staff only.
--   event_registrants: riders with an active registration for the event
--   season:            riders with an active registration or pass in the event's
--                      season (or the active season when there's no event)
create or replace function public.announcement_recipients(p_announcement_id uuid)
returns table (email text, first_name text)
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  a public.announcements;
  season uuid;
begin
  perform public.require_staff();
  select * into a from public.announcements where id = p_announcement_id and deleted_at is null;
  if a.id is null then raise exception 'not_found' using errcode = 'P0002'; end if;

  if a.email_audience = 'event_registrants' then
    return query
    select distinct on (lower(p.email::text)) p.email::text, p.first_name
    from public.registrations r join public.profiles p on p.id = r.rider_id
    where r.event_id = a.event_id and r.status in ('confirmed', 'pending_payment', 'waitlisted')
      and p.email is not null and p.deleted_at is null
    order by lower(p.email::text);
    return;
  end if;

  if a.email_audience = 'season' then
    select coalesce((select e.season_id from public.events e where e.id = a.event_id),
                    (select s.id from public.seasons s where s.is_active limit 1)) into season;
    return query
    select distinct on (lower(p.email::text)) p.email::text, p.first_name
    from public.profiles p
    where p.email is not null and p.deleted_at is null
      and (exists (select 1 from public.registrations r join public.events e on e.id = r.event_id
                   where r.rider_id = p.id and e.season_id = season and r.status in ('confirmed', 'pending_payment', 'waitlisted'))
        or exists (select 1 from public.season_passes sp where sp.rider_id = p.id and sp.season_id = season and sp.status = 'active'))
    order by lower(p.email::text);
  end if;
end;
$$;

revoke execute on function public.announcement_recipients(uuid) from public, anon;
grant execute on function public.announcement_recipients(uuid) to authenticated, service_role;

-- The Masters note pointed at the removed masters_min_age setting (D-063).
update public.categories
set eligibility_notes = 'Riders who turn 40 or older this year. Warning only; staff confirm at check-in.'
where name = 'Masters' and eligibility_notes like 'Minimum age set in admin settings%';
