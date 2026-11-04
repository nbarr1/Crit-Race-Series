-- Criterium race series: core schema.
-- All times are timestamptz (stored in UTC). Display is America/New_York.

create schema if not exists extensions;
create extension if not exists citext with schema extensions;

-- ---------------------------------------------------------------------------
-- Enums
-- ---------------------------------------------------------------------------
create type public.app_role as enum ('rider', 'staff', 'admin');
create type public.event_status as enum ('draft', 'published', 'canceled', 'completed');
create type public.registration_status as enum ('pending_payment', 'confirmed', 'waitlisted', 'canceled', 'refunded');
create type public.registration_source as enum ('online', 'walk_up', 'season_pass');
create type public.payment_method as enum ('none', 'stripe', 'cash', 'card_at_desk', 'stripe_link', 'comp', 'season_pass');
create type public.result_status as enum ('finished', 'DNF', 'DNS', 'DQ');
create type public.announcement_priority as enum ('normal', 'urgent');
create type public.media_type as enum ('course_map', 'image', 'pdf', 'gpx');
create type public.gender as enum ('woman', 'man', 'non_binary', 'prefer_not_to_say');

-- ---------------------------------------------------------------------------
-- Shared trigger: keep updated_at current
-- ---------------------------------------------------------------------------
create or replace function public.set_updated_at()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  new.updated_at := now();
  return new;
end;
$$;

-- ---------------------------------------------------------------------------
-- App settings (section 8 decisions live here, editable by admins)
-- ---------------------------------------------------------------------------
create table public.app_settings (
  key text primary key,
  value jsonb not null,
  description text not null default '',
  is_public boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- ---------------------------------------------------------------------------
-- Profiles. user_id is nullable so staff can create walk-up riders who have
-- never signed in. When that person later signs in with the same email, the
-- auth trigger links the existing profile instead of creating a new one.
-- ---------------------------------------------------------------------------
create table public.profiles (
  id uuid primary key default gen_random_uuid(),
  user_id uuid unique references auth.users (id) on delete set null,
  first_name text not null default '',
  last_name text not null default '',
  display_name text not null default '',
  email extensions.citext,
  phone text,
  birth_date date,
  gender public.gender,
  team text,
  usac_license_number text,
  usac_license_expiry date,
  emergency_contact_name text,
  emergency_contact_relationship text,
  emergency_contact_phone text,
  role public.app_role not null default 'rider',
  onboarded_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  deleted_at timestamptz,
  constraint profiles_display_name_len check (char_length(display_name) <= 80),
  constraint profiles_first_name_len check (char_length(first_name) <= 80),
  constraint profiles_last_name_len check (char_length(last_name) <= 80)
);
create unique index profiles_email_unique on public.profiles (email) where deleted_at is null and email is not null;

-- ---------------------------------------------------------------------------
-- Points rules, seasons, venues
-- ---------------------------------------------------------------------------
create table public.points_rules (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  points_by_place jsonb not null,
  drop_worst_n integer not null default 0 check (drop_worst_n >= 0),
  tiebreaker text not null default 'most_wins_then_most_recent_best'
    check (tiebreaker in ('most_wins_then_most_recent_best')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table public.seasons (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  year integer not null check (year between 2000 and 2100),
  is_active boolean not null default false,
  points_rules_id uuid references public.points_rules (id),
  season_pass_price_cents integer check (season_pass_price_cents >= 0),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create unique index seasons_one_active on public.seasons (is_active) where is_active;

create table public.venues (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  address text not null default '',
  latitude double precision not null check (latitude between -90 and 90),
  longitude double precision not null check (longitude between -180 and 180),
  coordinates_confirmed boolean not null default false,
  parking_notes text not null default '',
  map_embed_url text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- ---------------------------------------------------------------------------
-- Media (course maps, images, PDFs, GPX). event_id FK added after events.
-- ---------------------------------------------------------------------------
create table public.media (
  id uuid primary key default gen_random_uuid(),
  type public.media_type not null,
  storage_path text not null,
  caption text not null default '',
  event_id uuid,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  deleted_at timestamptz
);

-- ---------------------------------------------------------------------------
-- Events and categories
-- ---------------------------------------------------------------------------
create table public.events (
  id uuid primary key default gen_random_uuid(),
  season_id uuid not null references public.seasons (id),
  venue_id uuid not null references public.venues (id),
  name text not null,
  event_date date not null,
  registration_opens_at timestamptz not null,
  registration_closes_at timestamptz not null,
  status public.event_status not null default 'draft',
  notes text not null default '',
  course_map_id uuid references public.media (id) on delete set null,
  weather_override_text text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  deleted_at timestamptz,
  constraint events_registration_window check (registration_closes_at > registration_opens_at)
);
create index events_season_date on public.events (season_id, event_date);

alter table public.media
  add constraint media_event_fk foreign key (event_id) references public.events (id) on delete set null;

create table public.categories (
  id uuid primary key default gen_random_uuid(),
  name text not null unique,
  description text not null default '',
  eligibility_notes text not null default '',
  -- Eligibility checks are warnings only. Staff can override them.
  min_age integer check (min_age between 0 and 120),
  requires_gender public.gender,
  sort_order integer not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table public.event_categories (
  id uuid primary key default gen_random_uuid(),
  event_id uuid not null references public.events (id) on delete cascade,
  category_id uuid not null references public.categories (id),
  start_at timestamptz not null,
  duration_minutes integer not null check (duration_minutes > 0),
  laps integer check (laps > 0),
  capacity integer not null default 60 check (capacity >= 0),
  price_cents integer not null default 0 check (price_cents >= 0),
  walk_up_price_cents integer not null default 0 check (walk_up_price_cents >= 0),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (event_id, category_id)
);

-- ---------------------------------------------------------------------------
-- Registrations
-- ---------------------------------------------------------------------------
create table public.registrations (
  id uuid primary key default gen_random_uuid(),
  rider_id uuid not null references public.profiles (id),
  event_category_id uuid not null references public.event_categories (id),
  -- Denormalized from event_categories by trigger, so bibs can be unique per event.
  event_id uuid not null references public.events (id),
  status public.registration_status not null default 'pending_payment',
  source public.registration_source not null default 'online',
  payment_method public.payment_method not null default 'none',
  payment_reference text,
  amount_paid_cents integer check (amount_paid_cents >= 0),
  bib_number integer check (bib_number > 0),
  checked_in_at timestamptz,
  checked_in_by uuid references public.profiles (id),
  waitlist_position integer,
  eligibility_override_by uuid references public.profiles (id),
  eligibility_override_reason text,
  notes text not null default '',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
-- One active registration per rider per event_category.
create unique index registrations_one_active
  on public.registrations (rider_id, event_category_id)
  where status not in ('canceled', 'refunded');
create unique index registrations_bib_per_event
  on public.registrations (event_id, bib_number)
  where bib_number is not null and status not in ('canceled', 'refunded');
create index registrations_event_category on public.registrations (event_category_id, status);

create or replace function public.registrations_set_event_id()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  select ec.event_id into new.event_id
  from public.event_categories ec
  where ec.id = new.event_category_id;
  return new;
end;
$$;

create table public.season_passes (
  id uuid primary key default gen_random_uuid(),
  rider_id uuid not null references public.profiles (id),
  season_id uuid not null references public.seasons (id),
  category_ids uuid[] not null,
  payment_reference text,
  status text not null default 'pending_payment' check (status in ('pending_payment', 'active', 'canceled', 'refunded')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- ---------------------------------------------------------------------------
-- Waivers
-- ---------------------------------------------------------------------------
create table public.waiver_versions (
  id uuid primary key default gen_random_uuid(),
  season_id uuid not null references public.seasons (id),
  version_number integer not null check (version_number > 0),
  title text not null,
  body_markdown text not null,
  effective_date date not null,
  is_current boolean not null default false,
  -- Optional link to an external waiver (for example, a sanctioning body's).
  external_waiver_url text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (season_id, version_number)
);
create unique index waiver_versions_one_current on public.waiver_versions (season_id) where is_current;

create table public.waiver_signatures (
  id uuid primary key default gen_random_uuid(),
  rider_id uuid not null references public.profiles (id),
  waiver_version_id uuid not null references public.waiver_versions (id),
  typed_full_name text not null check (char_length(typed_full_name) between 2 and 160),
  agreed boolean not null check (agreed),
  signed_at timestamptz not null default now(),
  ip_address inet,
  user_agent text,
  guardian_name text,
  guardian_relationship text,
  guardian_typed_signature text,
  collected_by uuid references public.profiles (id),
  pdf_path text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index waiver_signatures_rider on public.waiver_signatures (rider_id, waiver_version_id);

-- ---------------------------------------------------------------------------
-- Results
-- ---------------------------------------------------------------------------
create table public.results (
  id uuid primary key default gen_random_uuid(),
  event_category_id uuid not null references public.event_categories (id) on delete cascade,
  rider_id uuid references public.profiles (id),
  raw_name text not null default '',
  bib integer,
  place integer check (place > 0),
  status public.result_status not null default 'finished',
  laps integer check (laps >= 0),
  finish_time interval,
  points_awarded integer not null default 0 check (points_awarded >= 0),
  is_published boolean not null default false,
  published_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index results_event_category on public.results (event_category_id, place);
create index results_rider on public.results (rider_id);

-- ---------------------------------------------------------------------------
-- Announcements, sponsors, audit log
-- ---------------------------------------------------------------------------
create table public.announcements (
  id uuid primary key default gen_random_uuid(),
  title text not null,
  body_markdown text not null default '',
  event_id uuid references public.events (id) on delete set null,
  priority public.announcement_priority not null default 'normal',
  publish_at timestamptz not null default now(),
  expires_at timestamptz,
  send_email boolean not null default false,
  emailed_at timestamptz,
  created_by uuid references public.profiles (id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  deleted_at timestamptz
);

create table public.sponsors (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  logo_path text,
  url text,
  tier text not null default 'supporter',
  sort_order integer not null default 0,
  is_active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  deleted_at timestamptz
);

create table public.audit_log (
  id uuid primary key default gen_random_uuid(),
  actor_user_id uuid,
  actor_profile_id uuid,
  action text not null,
  table_name text not null,
  row_id uuid,
  before_data jsonb,
  after_data jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index audit_log_created on public.audit_log (created_at desc);
create index audit_log_row on public.audit_log (table_name, row_id);

-- ---------------------------------------------------------------------------
-- updated_at triggers on every table
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
    execute format(
      'create trigger %I before update on public.%I for each row execute function public.set_updated_at()',
      t || '_updated_at', t
    );
  end loop;
end;
$$;

create trigger registrations_event_id
  before insert or update of event_category_id on public.registrations
  for each row execute function public.registrations_set_event_id();
