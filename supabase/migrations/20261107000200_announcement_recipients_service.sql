-- Let trusted server code (the service role, used by the scheduled job) read
-- announcement recipients for announcements whose publish time has arrived.
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
  if coalesce(auth.role(), '') <> 'service_role' then
    perform public.require_staff();
  end if;
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
