/**
 * Builds the demo data set in memory. scripts/seed.ts writes it to Supabase
 * (or prints SQL with --sql, which the local test database uses to check the
 * data against every constraint and trigger).
 *
 * Everything here is fictional. Email addresses use the reserved
 * ".test" domain so they can never reach a real inbox.
 */
import { randomUUID } from "node:crypto";
import { DEFAULT_POINTS_TABLE, pointsForResult, type ResultStatus } from "../src/lib/points";
import { ageOn } from "../src/lib/time";
import { SAMPLE_WAIVER_BODY as SAMPLE_WAIVER, SAMPLE_WAIVER_TITLE } from "../src/lib/sample-waiver";

export const SEED_EMAIL_DOMAIN = "example.test";
export const SEED_SEASON_NAME = "2027 Conestee Crit Series";

// Deterministic pseudo-random numbers so every seed run produces the same data.
function mulberry32(seed: number) {
  let a = seed;
  return () => {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const FIRST = ["Avery", "Blake", "Casey", "Dana", "Emery", "Finley", "Gray", "Harper", "Indy", "Jordan",
  "Kai", "Logan", "Morgan", "Noel", "Oakley", "Parker", "Quinn", "Reese", "Sawyer", "Taylor"];
const LAST = ["Abbott", "Barnes", "Calloway", "Dunmore", "Ellison", "Fairchild", "Garrison", "Holloway",
  "Ingram", "Jessup", "Kendrick", "Lockhart", "Merriwether", "Northcutt", "Ogden", "Pruitt",
  "Quarles", "Rutledge", "Sheffield", "Talbot"];
const TEAMS = ["Pisgah Velo", "French Broad Wheelmen", "Blue Ridge Racing", "Transylvania Cycling Club", null];

export type SeedUser = {
  id: string;
  email: string;
  first_name: string;
  last_name: string;
  role: "rider" | "staff" | "admin";
  profile: {
    display_name: string;
    phone: string;
    birth_date: string;
    gender: "woman" | "man" | "non_binary" | "prefer_not_to_say" | null;
    team: string | null;
    emergency_contact_name: string;
    emergency_contact_relationship: string;
    emergency_contact_phone: string;
    onboarded_at: string;
  };
  primaryCategory?: string;
  signsWaiver: boolean;
};

export type SeedData = ReturnType<typeof buildSeedData>;

const EVENT_DATES = [
  "2027-05-12", "2027-05-26", "2027-06-09", "2027-06-23", "2027-07-07",
  "2027-07-14", "2027-07-21", "2027-08-04", "2027-08-11", "2027-08-25",
];
// Start times in Eastern Daylight Time (every date above falls in EDT).
const CATEGORY_SCHEDULE: Record<string, { start: string; minutes: number; laps: number }> = {
  B: { start: "17:15", minutes: 35, laps: 2 },
  "Open Women": { start: "18:00", minutes: 35, laps: 2 },
  Masters: { start: "18:45", minutes: 40, laps: 2 },
  A: { start: "19:35", minutes: 45, laps: 3 },
};
const COMPLETED_EVENTS = 3; // events with results, for standings demos

export function buildSeedData(opts: { adminEmail?: string; staffEmail?: string } = {}) {
  const rand = mulberry32(2027);
  const pick = <T,>(arr: T[]) => arr[Math.floor(rand() * arr.length)];
  const nowIso = new Date("2026-11-01T12:00:00Z").toISOString();

  const mkProfile = (first: string, last: string, birth: string, gender: SeedUser["profile"]["gender"], n: number) => ({
    display_name: `${first} ${last.charAt(0)}.`,
    phone: `828-555-${String(1000 + n).slice(-4)}`,
    birth_date: birth,
    gender,
    team: pick(TEAMS),
    emergency_contact_name: `${pick(FIRST)} ${last}`,
    emergency_contact_relationship: pick(["Partner", "Parent", "Sibling", "Friend"]),
    emergency_contact_phone: `828-555-${String(5000 + n).slice(-4)}`,
    onboarded_at: nowIso,
  });

  const users: SeedUser[] = [
    {
      id: randomUUID(), email: opts.adminEmail ?? `admin@${SEED_EMAIL_DOMAIN}`, first_name: "Series", last_name: "Admin",
      role: "admin", profile: mkProfile("Series", "Admin", "1978-03-14", null, 1), signsWaiver: true,
    },
    {
      id: randomUUID(), email: opts.staffEmail ?? `staff@${SEED_EMAIL_DOMAIN}`, first_name: "Ben", last_name: "Coach",
      role: "staff", profile: mkProfile("Ben", "Coach", "1984-08-09", null, 2), signsWaiver: true,
    },
  ];

  // 40 riders: 10 A, 12 B, 8 Open Women, 10 Masters. Two B riders are under 18.
  const plan: { cat: string; count: number }[] = [
    { cat: "A", count: 10 }, { cat: "B", count: 12 }, { cat: "Open Women", count: 8 }, { cat: "Masters", count: 10 },
  ];
  let n = 0;
  for (const { cat, count } of plan) {
    for (let i = 0; i < count; i++) {
      const first = FIRST[n % FIRST.length];
      const last = LAST[(n * 7) % LAST.length];
      let year: number;
      if (cat === "Masters") year = 1965 + Math.floor(rand() * 20); // 42-62 in 2027
      else if (cat === "B" && i < 2) year = 2010; // 16-17 on race day
      else year = 1988 + Math.floor(rand() * 18);
      const birth = `${year}-${String(1 + Math.floor(rand() * 12)).padStart(2, "0")}-${String(1 + Math.floor(rand() * 28)).padStart(2, "0")}`;
      const gender = cat === "Open Women" ? "woman" : pick(["man", "woman", "non_binary", null] as const);
      users.push({
        id: randomUUID(),
        email: `rider${String(n + 1).padStart(2, "0")}@${SEED_EMAIL_DOMAIN}`,
        first_name: first,
        last_name: last,
        role: "rider",
        profile: mkProfile(first, last, birth, gender, n + 10),
        primaryCategory: cat,
        signsWaiver: n % 8 !== 7, // 35 of 40 have signed; 5 still need to sign at check-in
      });
      n++;
    }
  }

  const season = { id: randomUUID(), name: SEED_SEASON_NAME, year: 2027, is_active: true, season_pass_price_cents: 20000 };

  const events = EVENT_DATES.map((date, i) => {
    const prev = new Date(`${date}T12:00:00Z`);
    prev.setUTCDate(prev.getUTCDate() - 1);
    const closeDate = prev.toISOString().slice(0, 10);
    return {
      id: randomUUID(),
      season_id: season.id,
      name: `Race ${i + 1}`,
      event_date: date,
      registration_opens_at: "2027-03-01T09:00:00-05:00",
      registration_closes_at: `${closeDate}T23:59:00-04:00`,
      status: i < COMPLETED_EVENTS ? ("completed" as const) : ("published" as const),
      notes: i === 0 ? "Season opener. Arrive early for number pickup." : "",
    };
  });

  const eventCategories = events.flatMap((e) =>
    Object.entries(CATEGORY_SCHEDULE).map(([cat, s]) => ({
      id: randomUUID(),
      event_id: e.id,
      category: cat,
      start_at: `${e.event_date}T${s.start}:00-04:00`,
      duration_minutes: s.minutes,
      laps: s.laps,
      capacity: 60,
      price_cents: 2500,
      walk_up_price_cents: 3000,
    })),
  );

  const riders = users.filter((u) => u.role === "rider");
  const bibs = new Map(riders.map((r, i) => [r.id, 101 + i]));

  // Registrations: everyone in their category for the three completed races
  // and the next race; about half for the race after that.
  const registrations: {
    id: string; rider_id: string; event_category_id: string; status: "confirmed";
    source: "online"; payment_method: "stripe"; payment_reference: string; amount_paid_cents: number;
    bib_number: number | null; checked_in_at: string | null;
  }[] = [];
  events.forEach((e, ei) => {
    if (ei > COMPLETED_EVENTS + 1) return;
    for (const r of riders) {
      if (ei === COMPLETED_EVENTS + 1 && rand() < 0.5) continue;
      const ec = eventCategories.find((x) => x.event_id === e.id && x.category === r.primaryCategory)!;
      const done = ei < COMPLETED_EVENTS;
      registrations.push({
        id: randomUUID(),
        rider_id: r.id,
        event_category_id: ec.id,
        status: "confirmed",
        source: "online",
        payment_method: "stripe",
        payment_reference: `seed_${ec.id.slice(0, 8)}_${bibs.get(r.id)}`,
        amount_paid_cents: ec.price_cents,
        bib_number: done ? bibs.get(r.id)! : null,
        checked_in_at: done ? new Date(new Date(ec.start_at).getTime() - 30 * 60 * 1000).toISOString() : null,
      });
    }
  });

  // Results for the completed races. One DNF per race.
  const results: {
    id: string; event_category_id: string; rider_id: string; raw_name: string; bib: number;
    place: number | null; status: ResultStatus; laps: number | null; points_awarded: number;
  }[] = [];
  for (const e of events.slice(0, COMPLETED_EVENTS)) {
    for (const ec of eventCategories.filter((x) => x.event_id === e.id)) {
      const field = riders.filter((r) => r.primaryCategory === ec.category);
      const order = [...field];
      for (let k = order.length - 1; k > 0; k--) {
        const j = Math.floor(rand() * (k + 1));
        [order[k], order[j]] = [order[j], order[k]];
      }
      order.forEach((r, idx) => {
        const status: ResultStatus = idx === order.length - 1 ? "DNF" : "finished";
        const place = status === "finished" ? idx + 1 : null;
        results.push({
          id: randomUUID(),
          event_category_id: ec.id,
          rider_id: r.id,
          raw_name: `${r.first_name} ${r.last_name}`,
          bib: bibs.get(r.id)!,
          place,
          status,
          laps: status === "finished" ? 20 : 12,
          points_awarded: pointsForResult(DEFAULT_POINTS_TABLE, place, status),
        });
      });
    }
  }

  const waiver = {
    id: randomUUID(),
    season_id: season.id,
    version_number: 1,
    title: SAMPLE_WAIVER_TITLE,
    effective_date: "2027-01-01",
    body_markdown: SAMPLE_WAIVER,
  };

  // Riders under 18 on opening day sign with a parent or guardian.
  const signatures = users
    .filter((u) => u.signsWaiver)
    .map((u) => {
      const minor = ageOn(u.profile.birth_date, EVENT_DATES[0]) < 18;
      return {
        rider_id: u.id,
        waiver_version_id: waiver.id,
        typed_full_name: `${u.first_name} ${u.last_name}`,
        agreed: true,
        ip_address: "127.0.0.1",
        user_agent: "seed script",
        guardian_name: minor ? `Pat ${u.last_name}` : null,
        guardian_relationship: minor ? "Parent" : null,
        guardian_typed_signature: minor ? `Pat ${u.last_name}` : null,
      };
    });

  const sponsors = [
    { name: "Ridgeline Bike Shop", url: "https://example.com/ridgeline", tier: "presenting", sort_order: 1 },
    { name: "Davidson River Coffee Co.", url: "https://example.com/coffee", tier: "gold", sort_order: 2 },
    { name: "Little Mountain Physical Therapy", url: "https://example.com/pt", tier: "supporter", sort_order: 3 },
  ];

  const announcements = [
    {
      title: "Welcome to the 2027 series",
      body_markdown: "Registration is open for every race. Sign the season waiver once and you're set until the waiver changes.",
      priority: "normal" as const,
    },
  ];

  return { users, season, events, eventCategories, registrations, results, waiver, signatures, sponsors, announcements, nowIso };
}
