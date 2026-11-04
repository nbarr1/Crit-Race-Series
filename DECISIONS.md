# Decisions

This file records every assumption and trade-off made while building the app. Each entry has an ID so code comments can refer to it. When a decision changes, edit its entry and note the phase in which it changed.

## Organizer settings (section 8 of the build prompt)

These decisions belong to the organizers. Each one is a row in the `app_settings` table (seeded by `supabase/migrations/20261104000400_defaults.sql`) or a column an admin edits, so they can change without code changes. The admin settings screen arrives in phase 6. Until then, edit them in the Supabase table editor.

| Decision | Default | Where it lives |
|---|---|---|
| Weekly or every two weeks | Staff enter each date by hand | `events.event_date` (setting `schedule_cadence_note` is informational) |
| Online payments | On (Stripe), with an off switch | `app_settings.payments_enabled` |
| Per-race, walk-up, and season pass prices | Placeholders ($25, $30, $200). Admin must set them. | `event_categories.price_cents`, `walk_up_price_cents`, `seasons.season_pass_price_cents`, plus defaults in `app_settings` |
| Refund policy | No automatic refunds | `app_settings.refund_policy` (`no_automatic_refunds` or `full_refund_before_close`) |
| USA Cycling license required | Optional field, not enforced | `app_settings.usac_license_required` |
| Masters minimum age | 40, warning only | `categories.min_age` on the Masters category (D-063) |
| Riders under 18 allowed | Yes, with guardian signature | `app_settings.minors_allowed` |
| Category capacity | 60 per category | `event_categories.capacity`, `app_settings.default_category_capacity` |
| Points table and dropped races | Section 5.6 table, no dropped races | `points_rules` (editing the table rescores results, D-107) |
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

## Phase 2: registration and waivers

### Registration rules

**D-050. Registration rules live in one database function.** `register_for_event_categories()` checks the profile, the registration window, the current waiver signature, duplicates, eligibility, and capacity, and then creates every selected registration in one transaction. It locks the event category rows in a fixed order, so two riders racing for the last spot can't both get it and concurrent multi-race registrations can't deadlock. Errors are stable codes (for example, `waiver_required`), which `src/lib/messages.ts` turns into sentences.

**D-051. Unpaid registrations hold a spot for 35 minutes.** With payments on, a priced registration starts as `pending_payment` and counts toward capacity until `pending_expires_at`. Stripe Checkout sessions last 30 minutes, the shortest Stripe allows. When a session starts, the hold is extended to the session's expiry plus 5 minutes, so a payment finished at the last second still lands on a held spot. Expired holds are released by the scheduled job and before each registration in that category. A payment that arrives after its hold expired gets the spot back if one is free. Otherwise, the registration is marked for staff to refund by hand.

**D-052. The waitlist is first come, first served, and riders pay only when promoted.** Waitlisted registrations aren't charged. When a spot opens (a cancellation or an expired hold), the next rider is promoted. In a free category, or with payments off, they're confirmed. Otherwise, they get a 24-hour offer (`waitlist_offer_hours`) as `pending_payment`. If they don't pay, the spot moves to the next rider. Promotions are queued in the database (`promoted_at`, `promotion_notified_at`) and emailed by whichever code runs next, so no promotion goes unannounced if an email fails.

**D-053. Season pass holders are guaranteed a spot.** A pass is priced per category (`seasons.season_pass_price_cents` times the number of categories). It registers the rider for every upcoming published event in those categories, including full races and races whose online registration has closed, and registers them automatically for events published later. Pass registrations count toward capacity but aren't blocked by it. Passes need online payments. With payments off, they aren't sold, and staff can comp riders at the desk instead.

**D-054. Minors are identified on the signing date.** A rider under 18 on the day they sign needs a parent or guardian name, relationship, agreement checkbox, and typed signature on the same form. Riders must type their name as it appears on their profile, compared without case or punctuation. The guardian's typed signature must match the guardian's name. When `minors_allowed` is off, riders under 18 on race day can't register.

**D-055. Refunds follow the admin's policy.** The default `no_automatic_refunds` cancels the registration and tells the rider the organizers will follow up. With `full_refund_before_close`, canceling before registration closes refunds the amount paid for that race through Stripe automatically. Waitlisted and unpaid registrations were never charged, so they need no refund.

**D-056. With payments off, riders pay at the desk.** Priced registrations confirm immediately with `payment_method = 'none'`, and check-in (phase 3) shows them as unpaid.

**D-057. Eligibility warnings need the rider's acknowledgment.** When a selection has warnings (for example, under the Masters age), the rider sees them and must check a box to continue. The warning codes are stored on the registration for staff to review at check-in, where staff can record an override (phase 3). An expired USA Cycling license is a warning. Hard requirements raise errors instead: `usac_license_required` blocks riders without a license number, and `minors_allowed = false` blocks riders under 18.

### Payments

**D-058. The confirmation page doesn't wait for the webhook.** After Checkout, the confirmation page fetches the session from Stripe, checks that it belongs to the signed-in rider (`metadata.profile_id`), and applies it. The webhook does the same. Both paths are idempotent, so whichever arrives first confirms the registration and the other does nothing.

**D-059. One registration can't be paid for twice.** Paying again from My races expires the rider's previous Checkout session for those registrations before creating a new one.

**D-060. Webhooks are verified, and a failure makes Stripe retry.** The webhook verifies Stripe's signature with `STRIPE_WEBHOOK_SECRET` and handles `checkout.session.completed`, `async_payment_succeeded`, `expired`, and `async_payment_failed`. If a handler fails, it returns HTTP 500, so Stripe retries.

### Waivers and email

**D-061. Signed PDFs are generated on the server and stored privately.** The PDF (pdf-lib, standard Helvetica) contains the waiver text, version, typed signatures, time in Eastern and UTC, IP address, user agent, guardian details, and signature ID. It's stored at `waivers/<profile id>/<signature id>.pdf`, which only the rider and staff can read. Downloads use signed links that expire in 2-5 minutes. Characters outside the font's character set are replaced with "?" in the PDF only. The signature itself stores the original text.

**D-062. PDF generation and email can fail without losing the signature.** The signature is recorded first. If the PDF or email fails, the scheduled job retries signatures from the last three days that lack a PDF, or lack an email to a rider who has an address.

**D-063. Masters minimum age has one source.** The phase 1 `masters_min_age` setting duplicated `categories.min_age`, so it was removed. Admins change the Masters category's minimum age.

**D-064. Waiver Markdown is rendered without raw HTML.** react-markdown ignores embedded HTML, so waiver text can't inject markup into the page.

**D-065. Email goes out over Gmail SMTP, skips reserved domains, and runs without SMTP in development.** The series has no domain of its own, which Resend requires, so email changed from Resend to SMTP through Nodemailer after phase 5, with defaults for Gmail and an app password. Messages to reserved domains (`.test`, `.example`, `.invalid`, `.localhost`, and `example.com/net/org`) are logged, not sent, so seeded riders can't cause bounces. Without `SMTP_USER` and `SMTP_PASSWORD`, every message is logged. SMTP has no idempotency keys, so each message's key becomes a stable Message-ID header instead. The waiver step records each send in `waiver_signatures.email_sent_at` before the scheduled job retries, so a duplicate there needs a failure between sending and recording. Announcements go out as one message per recipient, so riders don't see each other's addresses. Personal Gmail accounts allow about 500 messages a day.

**D-066. The signer's IP address comes from `x-forwarded-for`.** Vercel sets this header. On other hosts, configure the proxy to set it, or the recorded IP address could be spoofed.

### Operations

**D-067. A scheduled job runs once a day.** `vercel.json` schedules `/api/cron/registrations` at 11:00 UTC, which Vercel calls with `CRON_SECRET`. Vercel's Hobby plan runs cron jobs at most once a day, so the schedule started at every 15 minutes and changed to daily in phase 5. The morning run lands before race-day registration closes. Most work doesn't wait for it: expired holds are also released whenever someone registers for that category, promotions after a cancellation email right away, and announcements posted for now email right away. What waits up to a day: promotion emails after an expired payment hold, emails for scheduled announcements, and retries of waiver PDFs and emails that failed (each run retries up to 25 signatures from the last three days). For a shorter delay, move to a paid Vercel plan and set a schedule such as `*/15 * * * *`, or call the URL from another scheduler with the same bearer token.

## Phase 3: race-day check-in

### Check-in rules

**D-070. Check-in logic lives in database functions, and every operation is idempotent.** Each staff action (check-in, desk payment, eligibility override, on-device waiver) carries an operation ID that the device creates. Replaying an operation, after a dropped response or a second sync, returns the first result and changes nothing.

**D-071. When two check-ins conflict, the earliest wins.** If two devices check in the same rider while offline, the earliest check-in time is kept, along with that device's bib and staff member. Every attempt is written to `check_in_events`, which is append-only, so both are logged (section 5.4). A later check-in with a different bib keeps the bib already assigned and is logged as `already_checked_in_bib_kept`.

**D-072. Check-in needs a confirmed registration and a current waiver.** Unpaid (`pending_payment`), pay-at-desk, and waitlisted riders are confirmed when staff record a desk payment: cash, card at the desk, Stripe payment link, or comp. Staff may confirm a waitlisted rider over capacity, because that's a desk decision. Riders who paid online or hold a season pass can't be charged again.

**D-073. Some actions need a connection.** Walk-up registration, undoing a check-in, rider search, and start lists need a signal. Walk-ups create a rider on the server, and undo must not race with queued check-ins. Everything else works offline.

**D-074. The cached roster leaves out the most sensitive fields.** The roster saved on staff devices has names, team, category, bib, and status. Emergency contacts, email addresses, and phone numbers are left out, and birth dates are reduced to an under-18 flag. A lost phone then exposes as little as possible. Staff can still read emergency contacts online through the database, and an emergency contact sheet is planned for phase 6.

**D-075. Offline waivers keep the device's time.** A waiver signed on a staff device records the device's signing time, the staff device's user agent (from the sync request), and the collecting staff member. The IP address is left empty, because the address that later syncs the queue says nothing about where the rider signed. The rider types their name to match their profile, and minors need a guardian, as online.

**D-076. Device clocks are trusted, within limits.** Check-in and signing times from a device are kept unless they're in the future or more than two days old (a wrong clock). Out-of-range times are replaced with the time the server receives them.

**D-077. Bibs are suggested, and uniqueness is checked twice.** The panel suggests the lowest unused number from 101 and warns when a typed bib belongs to someone else on the cached roster. The database rejects duplicates per event. A duplicate that only shows up at sync (two offline devices) appears as a failed change for staff to fix.

### Offline design

**D-078. Queued changes and the roster are kept in local storage.** Each event has its own roster snapshot, queue, and failed-change list in `localStorage`. A few hundred riders fit easily, so IndexedDB isn't needed. Each change is saved before it's sent, and the screen always shows the roster with queued changes applied. Sync runs on reconnect, on focus, every 20 seconds, and after each change. If storage isn't available (private browsing), a banner tells staff to stay online until changes sync.

**D-079. A hand-written service worker makes the screen open offline.** `public/sw.js` caches `/staff/check-in` (network first, last good copy as fallback) and Next.js build files (cache first). Nothing else is cached, and API responses never are. Riders' pages don't work offline. Instead, riders are asked to screenshot their check-in code.

**D-080. The QR code holds the registration ID.** The code on My races encodes `CRS1:<registration id>`. Registration IDs are random UUIDs, the code is shown only to the rider, and staff still see the rider's name before checking in. Scanning looks the ID up in the cached roster, so it works offline. The scanner uses the browser's BarcodeDetector where it exists (Chrome on Android) and jsQR elsewhere (Safari on iOS). jsQR is loaded when the check-in screen opens, so it's available offline.

**D-081. Start lists are PDF and CSV.** The PDF (pdf-lib) has one section per category, sorted by bib, with team, license number, and a checked-in column for the officials. The CSV has the same data, with formula-safe cells.

### Testing

**D-082. Data-backed end-to-end tests use a test-only Supabase stand-in.** Supabase's Docker images aren't available in the build environment, and running a downloaded PostgREST binary wasn't allowed. Instead, `e2e/support/fake-supabase.mjs` answers the few auth and REST calls the app makes by running them against the real local Postgres database, as the `authenticated` role with the JWT claims set, as PostgREST does. The app, the database functions, and row-level security are real. The stand-in trusts a token's user ID without checking its signature, so it must never serve a real app. Run the same flows against a real Supabase project before launch.

**D-083. Security headers are set for every page.** These are `X-Content-Type-Options`, `X-Frame-Options: DENY`, a strict referrer policy, and a `Permissions-Policy` that allows the camera only for this site and blocks the microphone and location.

## Phase 4: event information

**D-090. The forecast comes from Open-Meteo, cached on the server for 30 minutes.** The event page asks Open-Meteo for the venue's coordinates on race day, in Fahrenheit and mph, in Eastern Time. It shows the hours from the first start to the last finish, estimated as each race's minutes plus about 3 minutes a lap. The panel shows temperature, feels-like temperature, chance of rain, wind speed, gusts, and direction (an arrow plus a compass name such as "from the northwest (NW)"), and sunrise and sunset. A failed request isn't cached, so the next visitor tries again. The panel credits Open-Meteo, as its license (CC BY 4.0) requires. `OPEN_METEO_BASE_URL` can point at another host, for testing or a self-hosted instance.

**D-091. The forecast appears only within Open-Meteo's range.** Open-Meteo forecasts today plus 15 days. Further out, the panel says "Forecast available closer to race day." Past and canceled races show no forecast. A staff note (`weather_override_text`) always shows above the forecast.

**D-092. National Weather Service alerts are optional.** When `NWS_USER_AGENT` is set, the panel also shows active NWS alerts for the venue, for races in the next two days. The NWS asks API clients to identify themselves with a contact in the User-Agent, so alerts are off until the organizers provide one.

**D-093. The wind arrow points where the wind is going.** Weather data gives the direction wind comes from. The arrow shows the way it blows, which is what a rider feels on the course, and the text label always says "from the ...". The arrow is hidden from screen readers. The text carries the meaning (WCAG 1.1.1).

**D-094. Uploads are limited to 4 MB.** Course maps (PNG, JPEG, WebP, PDF), GPX files, and sponsor logos (PNG, JPEG, WebP, SVG) go through a server action, and Vercel caps request bodies at 4.5 MB. Files are stored with random names in the public `public-media` bucket. A larger file would need direct browser-to-storage uploads with signed URLs.

**D-095. Staff manage course maps.** Section 2 gives staff "manage course maps," so the staff edit guard on events now allows `course_map_id` as well as the weather note and notes. Everything else on an event stays admin-only. Removing a map hides it (soft delete) and leaves the file in storage.

**D-096. Announcement emails go out once, at the publish time.** Staff choose no email, the riders registered for the event (confirmed, unpaid, or waitlisted), or everyone registered in the season (including season pass holders). A new announcement with a publish time that has arrived is emailed right away. A scheduled one is emailed by the scheduled job. Sending first claims the announcement (`emailed_at`), so two callers can't both send it. Emails go out as one SMTP message per recipient over a pool of three connections (D-065), and reserved test domains are skipped. A long list takes longer to send than Resend's batch endpoint did, and a personal Gmail account's daily limit (about 500 messages) caps how many riders one day's announcements can reach. These are messages about races riders signed up for. If the organizers start sending promotional mail, add an unsubscribe link.

**D-097. The home page shows only the latest urgent announcement as a banner.** Other announcements are on the announcements page and on their event's page, with urgent ones listed first.

**D-098. Calendar files use UTC and stable IDs.** The season file (`/schedule/calendar.ics`) and each event's file use UTC times, so calendar apps convert them to the reader's time zone. Each event's `UID` is stable, so a canceled event updates the existing calendar entry (`STATUS:CANCELLED`) instead of adding a new one.

**D-099. Images are plain `<img>` tags.** Course maps and sponsor logos come from storage at sizes that aren't known ahead of time. They load lazily below the fold, and the map links to its full-size file. Next.js image optimization would need the storage host configured at build time. It's worth revisiting if the Lighthouse pass in phase 6 flags these images.

## Phase 5: results and standings

The build prompt for this phase wasn't available in the session that built it, so the rules here come from the existing schema (`points_rules.drop_worst_n`, the `most_wins_then_most_recent_best` tiebreaker, and the `standings` view), the default settings table, and common practice in US criterium series. Each one is worth confirming with the organizers.

**D-100. The database computes points; the app ranks.** Points per result are computed in Postgres from the season's points table when results are saved and again when they're published, so the browser never supplies a points value. Ranking (drops and tiebreakers) is in `src/lib/points.ts`, which is unit-tested. The `standings` view applies the same drop rule, and the SQL tests check its totals.

**D-101. Dropped races: each rider's best E minus N results count, and at least one.** E is the number of events in the category with published results so far, and N is `drop_worst_n` (default 0). A missed race has no result, so it counts as one of the drops first. Among equal scores, the oldest is dropped. Early in the season, when E is no more than N, each rider's single best result counts, so the table never reads all zeros. This changes the phase 1 view, which summed nothing in that case.

**D-102. Tiebreakers: more wins, then the better place in the most recent race.** For riders level on points, the one with more wins ranks higher. If still level, the most recent event where their places differ decides it, walking back one event at a time. A finish beats a DNF, DNS, DQ, or no start. Riders still level after every event share a rank, shown as "T3." Only a finished first place counts as a win.

**D-103. DNF, DNS, and DQ score zero, and have no place.** A place on a DNF row in the sheet is ignored. Places past the end of the points table score zero.

**D-104. The results sheet is a CSV with a header row.** Comma, tab, or semicolon separated, as timing software and spreadsheets export it. The parser recognizes common column names: Place (or Pos, Position, Rank), Bib (or Number, No), Name (or Rider), or First and Last, plus optional Team, Status, Laps, and Time. DNF, DNS, DQ, and DSQ can be in the Place or Status column, and OTL (over the time limit) is read as DNF. Duplicate places or bibs block the save. A gap in the places is a warning only. Files are limited to 512 KB and 500 rows, one category per upload. Team names from the sheet aren't stored. Riders' teams come from their profiles.

**D-105. Riders are matched by bib, then by name, and staff confirm each match.** Bibs are unique per event (D-012), so a bib match is trusted, with a note if the sheet's name differs or the rider is registered in another category. Without a bib match, the name is compared after removing accents, case, and punctuation, in "First Last," "Last, First," or display-name form, preferring riders registered in the category being scored. Two riders with the same name are left for staff to choose. Only confirmed registrations at that event are candidates. A rider can have one result per category, enforced by a unique index.

**D-106. Unmatched rows are kept but don't score in the standings.** A result with no matched rider shows in the event's results under the name from the sheet (officials post these names publicly anyway), but it can't count toward a rider's series total. Staff can match it later by uploading again.

**D-107. Saving replaces a category's results as a draft; publishing is a separate step.** Saving deletes the category's earlier rows and inserts the new ones unpublished, in one transaction, so a correction takes the race off the public pages until staff publish again. Publishing recomputes points from the current table. When an admin edits a points table, a trigger rescores every result in the seasons that use it. Every write goes through the audit log with the staff member as the actor (D-024).

**D-108. The standings page renders per request.** Its data is cached and shared under the `results` tag, and publishing invalidates it. A prerendered page would serve one stale copy after each publish, so the page reads the cache at request time instead (the end-to-end test caught this).

## Open questions for the organizers

These don't block the build, but the answers change settings or copy:

1. The real venue address, coordinates, and parking notes.
2. Real prices, and whether there's a season pass.
3. Whether the series will be sanctioned by USA Cycling, which may bring its own waiver and license requirements.
4. Start times, race lengths, and the actual event dates.
5. Whether to move email from a Gmail account to the series' own domain (D-065).
6. Whether to refund automatically when riders cancel before registration closes (`refund_policy`).
7. Whether to sell a season pass, and its price per category.
8. Bib numbers: whether riders keep one bib all season (the seed data does), and the starting number (the app suggests from 101).
9. A contact email for the National Weather Service User-Agent, to turn on weather alerts.
10. Sponsor tiers and logos.
11. Points: the number of dropped races (default none), the tiebreak rule (D-102), and whether unregistered riders in a results sheet should score.
