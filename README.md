# Connestee Crit Series

A mobile-first web app for a summer criterium race series at Connestee Nature Park: online registration, waivers, race-day check-in, event information, results, and series standings.

The app is built in six phases (see the build prompt). This README describes what exists so far.

| Phase | Scope | Status |
|---|---|---|
| 1. Foundation | Schema, row-level security, auth, onboarding, schedule, seed data | Done |
| 2. Registration and waivers | Registration flow, waiver signing and PDFs, Stripe, waitlist, email | Not started |
| 3. Check-in | Staff roster, QR scanning, walk-ups, offline queue, start lists | Not started |
| 4. Event information | Home page, weather, announcements, sponsors, calendar files | Not started |
| 5. Results and standings | CSV upload and matching, publishing, points engine | Not started |
| 6. Admin and polish | Dashboard, CRUD screens, exports, accessibility and Lighthouse passes | Not started |

For every assumption and trade-off, see [DECISIONS.md](DECISIONS.md).

## Tech stack

- Next.js 16 (App Router, Cache Components) with TypeScript in strict mode
- Tailwind CSS 4 with shadcn/ui-style components in `src/components/ui`
- Supabase: Postgres, Auth (email one-time code and magic link, optional Google), Storage, and row-level security
- Zod 4 for server-side validation
- Vitest for unit tests, Playwright for end-to-end tests, and plain SQL tests for row-level security
- Planned for later phases: Stripe Checkout, Resend, Open-Meteo, and the National Weather Service API

## Project layout

```text
src/app/                 Routes (App Router)
src/components/          UI components; ui/ holds the shadcn-style primitives
src/lib/                 Data access, auth helpers, validation, time zone helpers
src/proxy.ts             Session refresh and sign-in redirects (Next.js 16 "proxy", formerly middleware)
supabase/migrations/     Schema, functions, row-level security, default settings
supabase/tests/          SQL security tests and a Supabase shim for plain Postgres
scripts/seed.ts          Demo data seed
e2e/                     Playwright tests
```

## Run locally

Prerequisites: Node.js 22 or later, and a Supabase project (hosted, or local through the Supabase CLI and Docker).

1. Install dependencies.

   ```bash
   npm install
   ```

2. Create a Supabase project at [the Supabase dashboard](https://supabase.com/dashboard), or start one locally with `npx supabase start`.

3. Apply the migrations.

   ```bash
   npx supabase link --project-ref <your-project-ref>
   npx supabase db push
   ```

   For a local Supabase stack, `npx supabase db reset` applies them instead.

4. Configure Supabase Auth (see the next section).

5. Copy the environment file and fill it in. Every variable is described in `.env.example`.

   ```bash
   cp .env.example .env.local
   ```

6. Seed demo data (optional, see "Seed data").

7. Start the development server and open `http://localhost:3000`.

   ```bash
   npm run dev
   ```

Without Supabase settings, the app still starts and shows a setup notice in place of data.

### Configure Supabase Auth

In the Supabase dashboard, under **Authentication**:

1. Under **URL Configuration**, set the site URL to your app's URL, and add `<site URL>/auth/confirm` as a redirect URL.
2. Under **Email Templates**, replace the **Magic Link** template with the contents of `supabase/templates/magic_link.html`. The template includes both the six-digit code and a link to `/auth/confirm`, so riders can sign in either way.
3. Under **Providers**, keep **Email** on. Passwords aren't used.
4. Under **SMTP Settings**, connect a sender (for example, Resend's SMTP service). Supabase's built-in sender is rate-limited and meant for testing only.
5. Optional: to turn on Google sign-in, enable the Google provider and set `NEXT_PUBLIC_GOOGLE_AUTH_ENABLED=true`.

The local CLI stack reads these settings from `supabase/config.toml`.

## Seed data

```bash
npm run seed
```

The seed script creates one active season ("2027 Connestee Crit Series"), 10 Wednesday-evening events from May through August 2027, a sample waiver, three fictional sponsors, one admin, one staff user, and 40 riders. Riders are registered for the first four or five races, and the first three races have published results, so standings have data.

- The four categories, the default points table, the venue, and the admin settings come from the migrations, not the seed.
- Seeded users get `@example.test` email addresses, which can't receive mail. To sign in as the seeded admin or staff user, set `SEED_ADMIN_EMAIL` and `SEED_STAFF_EMAIL` to real inboxes before seeding.
- The script stops without changes if the demo season already exists.
- It uses the secret (service role) key, so point it only at a development or demo project.

To make an existing account an admin without seeding, run this in the Supabase SQL editor:

```sql
update public.profiles set role = 'admin' where email = 'you@example.com';
```

## Tests

| Command | What it runs |
|---|---|
| `npm test` | Vitest unit tests |
| `npm run test:db` | SQL row-level security tests, plus a check that the seed data loads |
| `npm run test:e2e` | Playwright tests (builds and starts the app on port 3100) |
| `npm run check` | Type check, lint, and unit tests |

### SQL security tests

`npm run test:db` creates a throwaway database on a Postgres 15+ server, loads a small shim that stands in for Supabase's `auth` and `storage` schemas (`supabase/tests/_shim`), applies every migration, and runs `supabase/tests/*.test.sql`. Set `PGHOST`, `PGUSER`, and `PGPASSWORD` to a superuser connection first. Each test file runs in a transaction that rolls back.

To run the same tests against a real Supabase database where the migrations are already applied:

```bash
DATABASE_URL="postgresql://postgres:<password>@db.<ref>.supabase.co:5432/postgres" npm run test:db -- --existing
```

The tests cover, among other things:

- A rider can't read or change another rider's profile, emergency contact, registrations, or waiver signatures.
- A rider can't write results, registrations, events, announcements, sponsors, settings, or waiver text, and can't change their own role.
- Signed-out visitors see only published events and results, through views that expose no private columns.
- Staff can check riders in and edit profiles, and those writes land in the audit log with before and after values.
- Waiver signatures and the audit log are append-only. Published waiver text can't be edited.

### End-to-end tests

Phase 1's Playwright tests need no database: they check the public shell, sign-in form validation, the signed-out redirect, and tap target size. Flows that need Supabase (registration, check-in, results) arrive with their phases.

## Deploy

### Supabase

1. Create a production project.
2. Link it and push the migrations: `npx supabase link --project-ref <ref>` and then `npx supabase db push`.
3. Configure Auth as described in "Configure Supabase Auth."
4. Make the organizers admins with the SQL in "Seed data." Don't run the seed script against production.
5. In **Table Editor > venues**, confirm the venue's address and coordinates, and set `coordinates_confirmed` to true.

### Vercel

1. Import the repository in Vercel. The framework preset is Next.js.
2. Add the environment variables from `.env.example` for the Production and Preview environments. Set `NEXT_PUBLIC_SITE_URL` to the production URL.
3. Deploy, then add the production URL to Supabase's Auth redirect URLs.

## Environment variables

Every variable is listed with a description in [.env.example](.env.example). The app needs only the three Supabase values and `NEXT_PUBLIC_SITE_URL` in phase 1. Variables for Stripe, Resend, weather, and scheduled jobs are listed ahead of the phases that use them.

## Staff guide

`STAFF_GUIDE.md`, the race-day guide for volunteers, is written in phase 3 alongside the check-in tools it describes.
