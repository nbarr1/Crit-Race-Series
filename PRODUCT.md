# Product

<!-- impeccable:product-schema 1 -->

## Platform

web

## Users

- **Organizers (primary).** The people who run the Conestee Crit Series. They set up seasons, events, prices, categories, points, the venue, waivers, and staff roles on the admin screens, and they publish results. When the needs of different users conflict, organizers come first.
- **Race-day staff.** Volunteers at the registration desk. They check riders in on a phone or tablet, outdoors and often in direct sun, sometimes with no signal. They scan check-in codes, take walk-up registrations and payments, hand the device to riders to sign waivers, and post announcements and weather notes.
- **Riders.** Amateur racers in four fields: A, B, Open Women, and Masters. They register and pay online, sign the season waiver, show a check-in code on race day, and follow results and series standings, mostly on their phones.

## Product Purpose

One home for a single local criterium series at Conestee Nature Park. It covers the whole season: online registration and waivers, race-day check-in that works offline, event information (schedule, weather, course map, announcements, sponsors), results, and season standings. Riders and staff no longer juggle a registration site, paper sheets, and a spreadsheet.

Success means organizers can run a season from the admin screens without code changes. It also means the desk checks riders in quickly with or without a signal, and riders find their race, their status, and their standings without asking anyone.

## Positioning

The app is built for this one series and its race day, not as a general event platform. Check-in keeps working with no signal, waivers can be signed on the staff device, and series standings come from the same records as registration and results.

## Operating Context

- Race-day check-in happens at an outdoor desk at the park, on staff phones and tablets, often added to the home screen. Staff open check-in once with a signal to save the roster, and changes sync when the signal returns. Walk-up registration and undo need a signal.
- Staff follow STAFF_GUIDE.md, which is kept on the desk.
- Times are Eastern Time.
- Payments go through Stripe Checkout, with desk payments recorded as cash, card at the desk, a Stripe payment link, or a comp. Email goes through Gmail SMTP. Forecasts come from Open-Meteo, with optional National Weather Service alerts.
- Organizers export registrations and waivers as CSV and PDF, and staff print start lists.

## Capabilities and Constraints

- Stack: Next.js 16 (App Router), TypeScript, Tailwind CSS 4, and Supabase (Postgres, Auth, Storage, row-level security). See README.md.
- Organizer decisions live in settings, not code: online payments, prices, refund policy, USA Cycling license requirement, Masters age, minors, capacity, points table, and venue (DECISIONS.md, "Organizer settings").
- Category eligibility rules (Masters age, Open Women) are warnings that staff confirm, never hard blocks (D-014).
- Riders under 18 can race with a parent or guardian signature, if minors are allowed.
- Terminology: series, season, event (race day), category or field, registration, walk-up, waiver, check-in code, bib, results, points, standings.
- Undecided: the open organizer questions in DECISIONS.md, including the real venue address, real prices and dates, USA Cycling sanctioning, season pass pricing, bib numbering, sponsor tiers and logos, and points tiebreaks.

## Brand Commitments

None yet. The series name is "Conestee Crit Series." There is no logo, voice guide, or sponsor obligation.

## Evidence on Hand

- The seed data (scripts/seed.ts) is demo content only: sample riders, teams, results, and sponsors. Don't present any of it as real.
- No real photos, course maps, sponsor logos, testimonials, or rider counts exist yet. Don't invent them.
- The venue address and coordinates are placeholders until an admin confirms them.

## Product Principles

1. Organizers run the series without a developer. A decision the organizers own is a setting they can change.
2. Race day can't depend on a signal. Anything the desk needs during check-in works offline or has a paper fallback.
3. Warn, don't block. Eligibility and edge cases go to staff judgment, with a recorded reason.
4. One record, many views. Registration, check-in, results, and standings read the same data, so nothing is entered twice.
5. Private stays private. Public pages show display names, teams, categories, places, and points, never contact or emergency details.

## Accessibility & Inclusion

- WCAG 2.1 AA. Automated axe checks run in the end-to-end tests (D-122), and a screen reader pass on VoiceOver and TalkBack is still recommended before launch.
- One light, high-contrast theme for use in direct sun: text at 4.5:1 or better and input borders at 3:1 (D-007).
- Tap targets are at least 44px for outdoor use, sometimes with gloves.
- The app uses system fonts and fast first renders for weak connections at the park.
