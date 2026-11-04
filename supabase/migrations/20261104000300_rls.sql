-- Row-level security, grants, public-safe views, and storage buckets.
-- Policy summary (see DECISIONS.md for the reasoning):
--   anon           -> published, non-sensitive data only
--   authenticated  -> own rows; staff/admin rows through is_staff()/is_admin()
--   service_role   -> bypasses RLS (webhooks, PDF generation, trusted server code)

-- ---------------------------------------------------------------------------
-- Enable RLS everywhere
-- ---------------------------------------------------------------------------
do $$
declare
  t text;
begin
  foreach t in array array[
    'app_settings', 'profiles', 'points_rules', 'seasons', 'venues', 'media', 'events',
    'categories', 'event_categories', 'registrations', 'season_passes', 'waiver_versions',
    'waiver_signatures', 'results', 'announcements', 'sponsors', 'audit_log'
  ] loop
    execute format('alter table public.%I enable row level security', t);
  end loop;
end;
$$;

-- ---------------------------------------------------------------------------
-- Grants. Start from nothing and add back what each role needs.
-- ---------------------------------------------------------------------------
revoke all on all tables in schema public from anon, authenticated;
alter default privileges in schema public revoke all on tables from anon, authenticated;

grant usage on schema public to anon, authenticated;

-- Public-readable tables
grant select on public.app_settings, public.points_rules, public.seasons, public.venues,
  public.media, public.events, public.categories, public.event_categories,
  public.waiver_versions, public.announcements, public.sponsors
  to anon, authenticated;

-- Signed-in users (RLS narrows each of these)
grant select on public.profiles, public.registrations, public.season_passes,
  public.waiver_signatures, public.results, public.audit_log
  to authenticated;

grant insert, update, delete on public.app_settings, public.points_rules, public.seasons,
  public.venues, public.media, public.events, public.categories, public.event_categories,
  public.announcements, public.sponsors, public.results
  to authenticated;
grant insert, update on public.registrations, public.season_passes, public.waiver_versions
  to authenticated;
grant insert on public.waiver_signatures to authenticated;

-- Profiles: column-level grants keep role, user_id, and email out of reach.
grant update (
  first_name, last_name, display_name, phone, birth_date, gender, team,
  usac_license_number, usac_license_expiry,
  emergency_contact_name, emergency_contact_relationship, emergency_contact_phone,
  onboarded_at
) on public.profiles to authenticated;
grant insert (
  first_name, last_name, display_name, email, phone, birth_date, gender, team,
  usac_license_number, usac_license_expiry,
  emergency_contact_name, emergency_contact_relationship, emergency_contact_phone,
  onboarded_at
) on public.profiles to authenticated;

-- Helper functions callable from policies and the app
grant execute on function public.current_profile_id() to anon, authenticated;
grant execute on function public.current_app_role() to anon, authenticated;
grant execute on function public.is_staff() to anon, authenticated;
grant execute on function public.is_admin() to anon, authenticated;
revoke execute on function public.admin_set_role(uuid, public.app_role) from public, anon;
grant execute on function public.admin_set_role(uuid, public.app_role) to authenticated;

-- ---------------------------------------------------------------------------
-- app_settings
-- ---------------------------------------------------------------------------
create policy app_settings_read on public.app_settings
  for select using (is_public or public.is_admin());
create policy app_settings_admin_write on public.app_settings
  for all to authenticated using (public.is_admin()) with check (public.is_admin());

-- ---------------------------------------------------------------------------
-- profiles: owner or staff can read. Owner or staff can update (staff edits
-- are audited). Only staff insert (walk-ups); riders get a profile from the
-- auth trigger. No one deletes through the API.
-- ---------------------------------------------------------------------------
create policy profiles_read_own_or_staff on public.profiles
  for select to authenticated
  using (user_id = auth.uid() or public.is_staff());
create policy profiles_update_own on public.profiles
  for update to authenticated
  using (user_id = auth.uid() and deleted_at is null)
  with check (user_id = auth.uid());
create policy profiles_update_staff on public.profiles
  for update to authenticated
  using (public.is_staff())
  with check (public.is_staff());
create policy profiles_insert_staff on public.profiles
  for insert to authenticated
  with check (public.is_staff());

-- ---------------------------------------------------------------------------
-- Admin-owned reference data: public read, admin write
-- ---------------------------------------------------------------------------
create policy points_rules_read on public.points_rules for select using (true);
create policy points_rules_admin on public.points_rules
  for all to authenticated using (public.is_admin()) with check (public.is_admin());

create policy seasons_read on public.seasons for select using (true);
create policy seasons_admin on public.seasons
  for all to authenticated using (public.is_admin()) with check (public.is_admin());

create policy venues_read on public.venues for select using (true);
create policy venues_admin on public.venues
  for all to authenticated using (public.is_admin()) with check (public.is_admin());

create policy categories_read on public.categories for select using (true);
create policy categories_admin on public.categories
  for all to authenticated using (public.is_admin()) with check (public.is_admin());

-- ---------------------------------------------------------------------------
-- events: drafts and soft-deleted events are staff-only.
-- Staff may update (a trigger limits non-admins to weather override and notes).
-- ---------------------------------------------------------------------------
create policy events_read on public.events
  for select using ((status <> 'draft' and deleted_at is null) or public.is_staff());
create policy events_admin_insert on public.events
  for insert to authenticated with check (public.is_admin());
create policy events_staff_update on public.events
  for update to authenticated using (public.is_staff()) with check (public.is_staff());
create policy events_admin_delete on public.events
  for delete to authenticated using (public.is_admin());

create policy event_categories_read on public.event_categories
  for select using (
    exists (
      select 1 from public.events e
      where e.id = event_id and ((e.status <> 'draft' and e.deleted_at is null) or public.is_staff())
    )
  );
create policy event_categories_admin on public.event_categories
  for all to authenticated using (public.is_admin()) with check (public.is_admin());

-- ---------------------------------------------------------------------------
-- media, announcements, sponsors: staff manage, public reads live rows
-- ---------------------------------------------------------------------------
create policy media_read on public.media
  for select using (deleted_at is null or public.is_staff());
create policy media_staff on public.media
  for all to authenticated using (public.is_staff()) with check (public.is_staff());

create policy announcements_read on public.announcements
  for select using (
    (deleted_at is null and publish_at <= now() and (expires_at is null or expires_at > now()))
    or public.is_staff()
  );
create policy announcements_staff on public.announcements
  for all to authenticated using (public.is_staff()) with check (public.is_staff());

create policy sponsors_read on public.sponsors
  for select using ((is_active and deleted_at is null) or public.is_staff());
create policy sponsors_staff on public.sponsors
  for all to authenticated using (public.is_staff()) with check (public.is_staff());

-- ---------------------------------------------------------------------------
-- registrations and season passes: riders read their own. Rider writes go
-- through SECURITY DEFINER functions (capacity, waiver, and close-time rules
-- live there). Staff read and write directly.
-- ---------------------------------------------------------------------------
create policy registrations_read on public.registrations
  for select to authenticated
  using (rider_id = public.current_profile_id() or public.is_staff());
create policy registrations_staff_insert on public.registrations
  for insert to authenticated with check (public.is_staff());
create policy registrations_staff_update on public.registrations
  for update to authenticated using (public.is_staff()) with check (public.is_staff());

create policy season_passes_read on public.season_passes
  for select to authenticated
  using (rider_id = public.current_profile_id() or public.is_staff());
create policy season_passes_staff_insert on public.season_passes
  for insert to authenticated with check (public.is_staff());
create policy season_passes_staff_update on public.season_passes
  for update to authenticated using (public.is_staff()) with check (public.is_staff());

-- ---------------------------------------------------------------------------
-- waivers
-- ---------------------------------------------------------------------------
create policy waiver_versions_read on public.waiver_versions for select using (true);
create policy waiver_versions_admin_insert on public.waiver_versions
  for insert to authenticated with check (public.is_admin());
create policy waiver_versions_admin_update on public.waiver_versions
  for update to authenticated using (public.is_admin()) with check (public.is_admin());

-- Riders sign through trusted server code (service role) so the IP address and
-- user agent come from the request, not the client. Staff collecting a
-- signature on their device insert directly.
create policy waiver_signatures_read on public.waiver_signatures
  for select to authenticated
  using (rider_id = public.current_profile_id() or public.is_staff());
create policy waiver_signatures_staff_insert on public.waiver_signatures
  for insert to authenticated
  with check (public.is_staff() and collected_by = public.current_profile_id());

-- ---------------------------------------------------------------------------
-- results: staff read and write the raw table. Riders see their own rows.
-- The public sees published results through public_results (safe columns).
-- ---------------------------------------------------------------------------
create policy results_read on public.results
  for select to authenticated
  using ((rider_id = public.current_profile_id() and is_published) or public.is_staff());
create policy results_staff on public.results
  for all to authenticated using (public.is_staff()) with check (public.is_staff());

-- ---------------------------------------------------------------------------
-- audit_log: admins read. Rows come only from the audit trigger.
-- ---------------------------------------------------------------------------
create policy audit_log_admin_read on public.audit_log
  for select to authenticated using (public.is_admin());

-- ---------------------------------------------------------------------------
-- Public-safe views. These run with the view owner's rights on purpose and
-- expose only non-sensitive columns. See DECISIONS.md (D-012).
-- ---------------------------------------------------------------------------
create view public.public_riders as
  select p.id, coalesce(nullif(p.display_name, ''), trim(p.first_name || ' ' || left(p.last_name, 1))) as display_name, p.team
  from public.profiles p
  where p.deleted_at is null;

create view public.public_results as
  select
    r.id,
    r.event_category_id,
    ec.event_id,
    e.season_id,
    ec.category_id,
    c.name as category_name,
    r.rider_id,
    coalesce(pr.display_name, r.raw_name) as display_name,
    pr.team,
    r.place,
    r.status,
    r.points_awarded
  from public.results r
  join public.event_categories ec on ec.id = r.event_category_id
  join public.events e on e.id = ec.event_id
  join public.categories c on c.id = ec.category_id
  left join public.public_riders pr on pr.id = r.rider_id
  where r.is_published and e.deleted_at is null and e.status <> 'draft';

create view public.event_category_availability as
  select
    ec.id as event_category_id,
    ec.event_id,
    ec.capacity,
    count(r.id) filter (where r.status in ('confirmed', 'pending_payment'))::integer as registered_count,
    count(r.id) filter (where r.status = 'waitlisted')::integer as waitlist_count,
    greatest(ec.capacity - count(r.id) filter (where r.status in ('confirmed', 'pending_payment')), 0)::integer as spots_left
  from public.event_categories ec
  join public.events e on e.id = ec.event_id
  left join public.registrations r on r.event_category_id = ec.id
  where e.status <> 'draft' and e.deleted_at is null
  group by ec.id;

-- Series standings. Drop-worst-N counts each rider's best (events scored - N)
-- results, so missed races count as dropped first. Tiebreakers are applied in
-- the app's points engine (src/lib/points.ts), which mirrors this view.
create view public.standings as
  with scored as (
    select
      e.season_id, ec.category_id, r.rider_id, e.id as event_id, e.event_date,
      r.points_awarded, r.place, r.status
    from public.results r
    join public.event_categories ec on ec.id = r.event_category_id
    join public.events e on e.id = ec.event_id
    where r.is_published and r.rider_id is not null
      and e.deleted_at is null and e.status <> 'canceled'
  ),
  events_scored as (
    select season_id, category_id, count(distinct event_id) as n_events
    from scored group by season_id, category_id
  ),
  ranked as (
    select s.*,
      row_number() over (
        partition by s.season_id, s.category_id, s.rider_id
        order by s.points_awarded desc, s.event_date desc
      ) as rn
    from scored s
  )
  select
    rk.season_id,
    rk.category_id,
    rk.rider_id,
    pr.display_name,
    pr.team,
    sum(rk.points_awarded) filter (
      where coalesce(pt.drop_worst_n, 0) = 0
         or rk.rn <= greatest(es.n_events - pt.drop_worst_n, 0)
    )::integer as total_points,
    sum(rk.points_awarded)::integer as raw_points,
    count(*)::integer as races,
    count(*) filter (where rk.place = 1 and rk.status = 'finished')::integer as wins
  from ranked rk
  join events_scored es on es.season_id = rk.season_id and es.category_id = rk.category_id
  join public.seasons se on se.id = rk.season_id
  left join public.points_rules pt on pt.id = se.points_rules_id
  join public.public_riders pr on pr.id = rk.rider_id
  group by rk.season_id, rk.category_id, rk.rider_id, pr.display_name, pr.team;

grant select on public.public_riders, public.public_results,
  public.event_category_availability, public.standings
  to anon, authenticated;

-- ---------------------------------------------------------------------------
-- Storage buckets and policies
--   public-media : course maps, images, GPX, sponsor logos (public read)
--   waivers      : signed waiver PDFs, path "<profile_id>/<signature_id>.pdf"
-- ---------------------------------------------------------------------------
insert into storage.buckets (id, name, public)
values ('public-media', 'public-media', true), ('waivers', 'waivers', false)
on conflict (id) do nothing;

create policy "public-media read" on storage.objects
  for select using (bucket_id = 'public-media');
create policy "public-media staff insert" on storage.objects
  for insert to authenticated with check (bucket_id = 'public-media' and public.is_staff());
create policy "public-media staff update" on storage.objects
  for update to authenticated using (bucket_id = 'public-media' and public.is_staff());
create policy "public-media staff delete" on storage.objects
  for delete to authenticated using (bucket_id = 'public-media' and public.is_staff());

create policy "waivers read own or staff" on storage.objects
  for select to authenticated using (
    bucket_id = 'waivers'
    and (
      (storage.foldername(name))[1] = public.current_profile_id()::text
      or public.is_staff()
    )
  );
