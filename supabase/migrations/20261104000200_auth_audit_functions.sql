-- Role helpers, auth trigger, audit logging, and integrity guards.

-- ---------------------------------------------------------------------------
-- Role helpers. SECURITY DEFINER so they can read profiles without recursing
-- through the profiles RLS policies.
-- ---------------------------------------------------------------------------
create or replace function public.current_profile_id()
returns uuid
language sql
stable
security definer
set search_path = ''
as $$
  select p.id
  from public.profiles p
  where p.user_id = auth.uid() and p.deleted_at is null
  limit 1;
$$;

create or replace function public.current_app_role()
returns public.app_role
language sql
stable
security definer
set search_path = ''
as $$
  select coalesce(
    (select p.role from public.profiles p where p.user_id = auth.uid() and p.deleted_at is null limit 1),
    'rider'::public.app_role
  );
$$;

create or replace function public.is_staff()
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1 from public.profiles p
    where p.user_id = auth.uid() and p.deleted_at is null and p.role in ('staff', 'admin')
  );
$$;

create or replace function public.is_admin()
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1 from public.profiles p
    where p.user_id = auth.uid() and p.deleted_at is null and p.role = 'admin'
  );
$$;

-- ---------------------------------------------------------------------------
-- New auth user -> profile. Links a staff-created walk-up profile with the
-- same email instead of creating a duplicate.
-- ---------------------------------------------------------------------------
create or replace function public.handle_new_auth_user()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  existing uuid;
begin
  if new.email is not null then
    select p.id into existing
    from public.profiles p
    where p.email = new.email::extensions.citext and p.user_id is null and p.deleted_at is null
    limit 1;
  end if;

  if existing is not null then
    update public.profiles set user_id = new.id where id = existing;
  else
    insert into public.profiles (user_id, email, first_name, last_name, display_name)
    values (
      new.id,
      new.email,
      coalesce(new.raw_user_meta_data ->> 'first_name', ''),
      coalesce(new.raw_user_meta_data ->> 'last_name', ''),
      coalesce(new.raw_user_meta_data ->> 'display_name', '')
    );
  end if;
  return new;
end;
$$;

create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.handle_new_auth_user();

-- Keep profile email in sync when a user changes their auth email.
create or replace function public.handle_auth_user_email_change()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if new.email is distinct from old.email then
    update public.profiles set email = new.email where user_id = new.id;
  end if;
  return new;
end;
$$;

create trigger on_auth_user_email_changed
  after update of email on auth.users
  for each row execute function public.handle_auth_user_email_change();

-- ---------------------------------------------------------------------------
-- Guard: role can change only through admin_set_role().
-- ---------------------------------------------------------------------------
create or replace function public.profiles_guard_role()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if new.role is distinct from old.role
     and coalesce(current_setting('app.allow_role_change', true), '') <> 'on'
     and current_user not in ('postgres', 'service_role', 'supabase_admin') then
    raise exception 'role can only be changed by an admin through admin_set_role()'
      using errcode = '42501';
  end if;
  return new;
end;
$$;

create trigger profiles_guard_role
  before update on public.profiles
  for each row execute function public.profiles_guard_role();

create or replace function public.admin_set_role(target_profile_id uuid, new_role public.app_role)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  if not public.is_admin() then
    raise exception 'only admins can change roles' using errcode = '42501';
  end if;
  if target_profile_id = public.current_profile_id() and new_role <> 'admin' then
    raise exception 'admins cannot remove their own admin role' using errcode = '22023';
  end if;
  perform set_config('app.allow_role_change', 'on', true);
  update public.profiles set role = new_role where id = target_profile_id;
  perform set_config('app.allow_role_change', 'off', true);
end;
$$;

-- ---------------------------------------------------------------------------
-- Guard: staff (non-admin) can change only the weather override and notes on
-- an event. Everything else on events is admin-only.
-- ---------------------------------------------------------------------------
create or replace function public.events_guard_staff_update()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if current_user in ('postgres', 'service_role', 'supabase_admin') or public.is_admin() then
    return new;
  end if;
  if (to_jsonb(new) - array['weather_override_text', 'notes', 'updated_at'])
     is distinct from (to_jsonb(old) - array['weather_override_text', 'notes', 'updated_at']) then
    raise exception 'staff can only change the weather override and notes on an event'
      using errcode = '42501';
  end if;
  return new;
end;
$$;

create trigger events_guard_staff_update
  before update on public.events
  for each row execute function public.events_guard_staff_update();

-- ---------------------------------------------------------------------------
-- Append-only guards
-- ---------------------------------------------------------------------------
create or replace function public.waiver_signatures_append_only()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if tg_op = 'DELETE' then
    raise exception 'waiver signatures are append-only' using errcode = '42501';
  end if;
  -- The only permitted update is attaching the generated PDF once.
  if old.pdf_path is null and new.pdf_path is not null
     and (to_jsonb(new) - array['pdf_path', 'updated_at']) = (to_jsonb(old) - array['pdf_path', 'updated_at']) then
    return new;
  end if;
  raise exception 'waiver signatures are append-only' using errcode = '42501';
end;
$$;

create trigger waiver_signatures_append_only
  before update or delete on public.waiver_signatures
  for each row execute function public.waiver_signatures_append_only();

create or replace function public.waiver_versions_immutable()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if tg_op = 'DELETE' then
    raise exception 'waiver versions cannot be deleted' using errcode = '42501';
  end if;
  -- Only the is_current flag may change after a version is created.
  if (to_jsonb(new) - array['is_current', 'updated_at']) is distinct from (to_jsonb(old) - array['is_current', 'updated_at']) then
    raise exception 'published waiver versions cannot be edited; publish a new version'
      using errcode = '42501';
  end if;
  return new;
end;
$$;

create trigger waiver_versions_immutable
  before update or delete on public.waiver_versions
  for each row execute function public.waiver_versions_immutable();

create or replace function public.audit_log_immutable()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  raise exception 'audit log entries cannot be changed' using errcode = '42501';
end;
$$;

create trigger audit_log_immutable
  before update or delete on public.audit_log
  for each row execute function public.audit_log_immutable();

-- ---------------------------------------------------------------------------
-- Audit logging. Records who, what, when, before, and after.
-- For profiles, only edits by someone other than the profile owner are logged
-- (a rider editing their own profile isn't a staff write).
-- ---------------------------------------------------------------------------
create or replace function public.audit_row_change()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  actor uuid := auth.uid();
  actor_profile uuid;
  row_uuid uuid;
  before_row jsonb;
  after_row jsonb;
begin
  if tg_op in ('UPDATE', 'DELETE') then before_row := to_jsonb(old); end if;
  if tg_op in ('INSERT', 'UPDATE') then after_row := to_jsonb(new); end if;
  row_uuid := coalesce((after_row ->> 'id')::uuid, (before_row ->> 'id')::uuid);

  if tg_table_name = 'profiles' then
    if actor is not null and coalesce(after_row, before_row) ->> 'user_id' = actor::text then
      return coalesce(new, old);
    end if;
  end if;

  if tg_op = 'UPDATE' and (before_row - 'updated_at') = (after_row - 'updated_at') then
    return new;
  end if;

  select p.id into actor_profile from public.profiles p where p.user_id = actor limit 1;

  insert into public.audit_log (actor_user_id, actor_profile_id, action, table_name, row_id, before_data, after_data)
  values (actor, actor_profile, lower(tg_op), tg_table_name, row_uuid, before_row, after_row);

  return coalesce(new, old);
end;
$$;

do $$
declare
  t text;
begin
  foreach t in array array[
    'registrations', 'results', 'profiles', 'events', 'event_categories', 'app_settings',
    'waiver_versions', 'waiver_signatures', 'season_passes', 'announcements', 'seasons',
    'points_rules', 'categories', 'sponsors', 'venues'
  ] loop
    execute format(
      'create trigger %I after insert or update or delete on public.%I for each row execute function public.audit_row_change()',
      t || '_audit', t
    );
  end loop;
end;
$$;
