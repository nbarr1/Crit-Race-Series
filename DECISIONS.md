# Decisions

This file records every assumption and trade-off made while building the app. Each entry has an ID so code comments can refer to it. When a decision changes, edit its entry and note the phase in which it changed.

## Organizer settings (section 8 of the build prompt)

These decisions belong to the organizers. Each one is a row in the `app_settings` table (seeded by `supabase/migrations/20261104000400_defaults.sql`) or a column an admin edits, so they can change without code changes. The admin settings screen arrives in phase 6. Until then, edit them in the Supabase table editor.

| Decision | Default | Where it lives |
|---|---|---|
| Weekly or every two weeks | Staff enter each date by hand | `events.event_date` (setting `schedule_cadence_note` is informational) |
| Online payments | On (Stripe), with an off switch | `app_settings.payments_enabled` |
| Per-race, walk-up, and season pass prices | Placeholders ($25, $30, $200). Admin must set them. | `event_categories.price_cents`, `walk_up_price_cents`, `seasons.season_pass_price_cents`, plus defaults in `app_settings` |
| Refund policy | No automatic refunds | `app_settings.refund_policy` |
| USA Cycling license required | Optional field, not enforced | `app_settings.usac_license_required` |
| Masters minimum age | 40, warning only | `app_settings.masters_min_age`, `categories.min_age` |
| Riders under 18 allowed | Yes, with guardian signature | `app_settings.minors_allowed` |
| Category capacity | 60 per category | `event_categories.capacity`, `app_settings.default_category_capacity` |
| Points table and dropped races | Section 5.6 table, no dropped races | `points_rules` |
| Venue coordinates and address | Placeholder. Admin must confirm. | `venues` (`coordinates_confirmed = false` until confirmed) |

USA Cycling integration point: if the series is sanctioned, the sanctioning body may have its own registration and waiver requirements. The app leaves room for them without assuming what they are: `app_settings.external_waiver_url` and `waiver_versions.external_waiver_url` hold an optional external waiver link, and `profiles.usac_license_number` and `usac_license_expiry` hold license details. No license verification API is called.

## Phase 1: foundation

### Stack and tooling

**D-001. Versions were checked, not pinned from memory.** On November 4, 2026, `npm view` reported Next.js 16.4.5, React 19.3.0, `@supabase/supabase-js` 2.118.0, `@supabase/ssr` 0.12.7, Zod 4.6.7, Tailwind CSS 4.3, and Vitest 5.1.0. Playwright is 1.63.0, matching the browser in the build environment. `package-lock.json` records exact versions.

**D-002. Cache Components stays on.** Next.js 16 enables Cache Components and Partial Prefetching by default for new apps. Pages ship a static shell (header, headings) and stream dynamic parts inside `<Suspense>`. Public data (schedule and event pages) is fetched with a session-less anonymous client inside `"use cache"` functions with the `minutes` cache profile and the `events` cache tag, so a weak connection gets the shell first and repeat visitors share cached data. Later phases call `revalidateTag("events")` after staff edits.

**D-003. shadcn/ui components are written by hand.** The shadcn CLI couldn't reach its registry from the build environment, so `src/components/ui` holds hand-written components that follow shadcn/ui conventions (`cva` variants, `cn()` helper, Tailwind tokens). `npx shadcn add <component>` works later from a machine with registry access.

**D-004. `src/proxy.ts` only refreshes the session.** Next.js 16 renamed middleware to "proxy." It refreshes the Supabase session cookie and redirects signed-out visitors away from rider pages. It isn't an authorization layer. Authorization happens in Postgres (row-level security) and is re-checked in every server action.

**D-005. No generated database types yet.** Generating types needs a running Supabase project. `src/lib/types.ts` holds hand-written row shapes for what the app reads. Replace them with `npx supabase gen types typescript` once a project exists.

**D-006. The SQL security tests run on plain Postgres with a shim.** The build environment couldn't pull Supabase's Docker images, so `supabase/tests/_shim/supabase_shim.sql` stands in for `auth.users`, `auth.uid()`, the `anon`, `authenticated`, and `service_role` roles, and `storage.objects`. The tests are plain SQL with small assertion helpers (no pgTAP), so the same files also run against a real Supabase database with `npm run test:db -- --existing`. Run them there before launch: the shim is close to Supabase but not identical.

**D-007. One light, high-contrast theme and system fonts.** Staff use the app outdoors in direct sun, so there's a single light theme with dark text. Text meets WCAG AA contrast (4.5:1) and input borders meet 3:1. The app uses the system font stack instead of downloading a web font, which keeps the first render fast on weak connections.

### Data model

**D-010. Profiles can exist without an account.** `profiles.user_id` is nullable so staff can create walk-up riders who have never signed in. When someone signs in with an email that matches an unlinked walk-up profile, the auth trigger links that profile instead of creating a duplicate. This trusts that the person who controls the email inbox is the walk-up rider, which the email code or link verifies.

**D-011. Event dates are dates. Start times are timestamps.** `events.event_date` is a `date`, and each `event_categories.start_at` is a `timestamptz` stored in UTC. Display uses America/New_York (`src/lib/time.ts`). Formatting a date-only value uses noon UTC so it never shifts to the previous day.

**D-012. Bibs are unique per event, not per category.** Riders can race more than one category at an event, and officials read bibs across the whole event. `registrations.event_id` is copied from the event category by a trigger to support that unique index.

**D-013. Registrations record how they were paid.** Beyond the fields in the prompt, `registrations` has `payment_method` (none, stripe, cash, card_at_desk, stripe_link, comp, season_pass), `amount_paid_cents`, `waitlist_position`, and eligibility override fields (who overrode and why). `source` adds `season_pass` to online and walk-up.

**D-014. Category eligibility is data, checked as warnings.** `categories.min_age` and `categories.requires_gender` drive warnings, never hard blocks, per the prompt. The Masters warning uses racing age (the age a rider turns by December 31 of the season year), which is the common convention in US racing. The under-18 guardian rule uses actual age on race day.

**D-015. Gender is optional with four values.** The options are woman, man, non-binary, and prefer not to say. Gender is used only for the Open Women eligibility warning.

**D-016. Default settings and reference data live in a migration.** The four categories, the default points table, the venue placeholder, and `app_settings` defaults are configuration that every environment needs, so they're in `20261104000400_defaults.sql`. Demo data (season, events, riders) is in the seed script only.

**D-017. The venue coordinates are a placeholder near Brevard, North Carolina.** The exact location of Connestee Nature Park wasn't verified while building. The venue row is marked `coordinates_confirmed = false`, and event pages say the location is still being confirmed until an admin updates it.

**D-018. `citext` lives in the `extensions` schema.** This matches Supabase's convention and keeps extension functions out of `public`.

### Security

**D-020. Role changes go through one function.** Column-level grants keep `role`, `email`, and `user_id` out of reach of every API user, and a trigger rejects role changes from anywhere except `admin_set_role()`, which checks that the caller is an admin. Admins can't remove their own admin role, so the series can't lose its last admin by accident.

**D-021. Riders never write registrations directly.** Riders can read their own registrations. Creating and canceling go through `SECURITY DEFINER` database functions (phase 2) that enforce capacity, waiver, close-time, and waitlist rules in one transaction. Staff write registrations directly, with row-level security checking their role.

**D-022. Riders sign waivers through trusted server code.** If riders could insert signatures directly, they could forge the IP address and user agent. Instead, the signing server action (phase 2) checks the session and inserts with the service role, taking the IP address and user agent from the request. Staff collecting a signature on their own device ("hand to rider" mode) insert directly, and row-level security requires them to record themselves as the collector.

**D-023. Staff can change only two fields on an event.** Section 5.5 lets staff add a weather override, but events otherwise belong to admins. Row-level security lets staff update events, and a trigger rejects any change by a non-admin other than `weather_override_text` and `notes`.

**D-024. Auditing is done by database triggers.** Every insert, update, and delete on registrations, results, profiles, events, event categories, settings, waiver versions and signatures, season passes, announcements, seasons, points rules, categories, sponsors, and venues is written to `audit_log` with the actor, action, table, row, and before and after JSON. A rider editing their own profile isn't logged (it isn't a staff write). Writes with no signed-in user (the seed script, and later Stripe webhooks) are logged with an empty actor. To keep the actor accurate, server code performs staff actions with the user's session, not the service role. The audit log can't be updated or deleted, and only admins can read it.

**D-025. Waivers are append-only.** A trigger rejects updates and deletes on `waiver_signatures`, with one exception: attaching the generated PDF path once. Waiver versions can't be deleted, and only their `is_current` flag can change after creation. A new waiver text means a new version.

**D-026. Public data goes through views that run with the owner's rights.** `public_riders`, `public_results`, `event_category_availability`, and `standings` expose only safe columns: display name, team, category, place, status, and points. Signed-out visitors can't read `profiles`, `results`, or `registrations` at all. These views intentionally bypass row-level security, and the Supabase security advisor flags them as "security definer views." The tests check that no private column appears in them.

**D-027. Public results include status and points.** The prompt lists display name, category, team, and placing. Status (DNF, DNS, DQ) and points are added because the standings page shows points per race. Bib, time, and laps stay private. Riders see their own raw result rows once published.

**D-028. A missing display name falls back to first name and last initial.** Riders choose the name shown in public results. If they leave it blank, the public sees "Rita O.", not their full name.

**D-029. Rate limiting is in memory, with Supabase's limits behind it.** Sign-in and code verification are limited per IP address and per email address with a fixed-window counter (`src/lib/rate-limit.ts`). On Vercel, each function instance keeps its own counters, so this is a first line of defense. Supabase Auth's own email and verification limits apply on top. For a shared limit, swap in a Redis-backed limiter (for example, Upstash) behind the same function.

**D-030. Redirect targets must be relative paths.** The `next` parameter used after sign-in accepts only paths that start with a single `/`, which blocks open redirects.

### Auth

**D-031. One email carries both a code and a link.** Supabase's magic link template is replaced with one that includes the six-digit code and a link to `/auth/confirm` (token hash flow). Riders who open email on a different device than the one they started on can type the code. Google sign-in is optional behind `NEXT_PUBLIC_GOOGLE_AUTH_ENABLED`.

**D-032. Onboarding gates registration, not browsing.** Signed-in riders can browse public pages with an incomplete profile. Rider pages that need a full profile (My races, and later registration) send them to onboarding first. Required fields: first and last name, mobile phone, birth date, and emergency contact name, relationship, and phone.

**D-033. Phone numbers aren't verified.** They're validated for format only.

### Seed data

**D-040. Seed users are created through the Supabase admin API.** That creates real auth users with confirmed emails, so the auth trigger creates their profiles the same way it does in production. Seeded addresses use the reserved `example.test` domain. The script also prints SQL (`--sql`), which `npm run test:db` loads to prove the seed data satisfies every constraint and trigger.

**D-041. The seed schedule is illustrative.** Ten Wednesday evenings from May 12 to August 25, 2027, with starts at 5:15 PM (B), 6:00 PM (Open Women), 6:45 PM (Masters), and 7:35 PM (A) Eastern Time. The first three events are marked completed with published results so standings have data. Two B riders are under 18, and five riders haven't signed the waiver, so check-in has cases to handle.

**D-042. The sample waiver is placeholder text.** It's marked as sample text and needs a lawyer's review.

## Open questions for the organizers

These don't block the build, but the answers change settings or copy:

1. The real venue address, coordinates, and parking notes.
2. Real prices, and whether there's a season pass.
3. Whether the series will be sanctioned by USA Cycling, which may bring its own waiver and license requirements.
4. Start times, race lengths, and the actual event dates.
5. The sender email domain for Resend.
