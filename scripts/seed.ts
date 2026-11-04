/**
 * Seeds demo data: one season, 10 events, the four categories (from the
 * migrations), a sample waiver, the default points table, three sponsors, one
 * admin, one staff user, and 40 riders with registrations and results.
 *
 *   npm run seed                 # writes to the Supabase project in .env.local
 *   npm run seed -- --sql > x.sql   # prints SQL for the local test database
 *
 * Set SEED_ADMIN_EMAIL and SEED_STAFF_EMAIL to make real inboxes the admin and
 * staff users so you can sign in as them. Other seeded users get
 * "@example.test" addresses that can't receive mail.
 */
import { createClient } from "@supabase/supabase-js";
import { buildSeedData, SEED_SEASON_NAME, type SeedData } from "./seed-data";

const data = buildSeedData({
  adminEmail: process.env.SEED_ADMIN_EMAIL || undefined,
  staffEmail: process.env.SEED_STAFF_EMAIL || undefined,
});

if (process.argv.includes("--sql")) {
  process.stdout.write(toSql(data));
} else {
  seedSupabase(data).catch((err) => {
    console.error(err instanceof Error ? err.message : err);
    process.exit(1);
  });
}

// ---------------------------------------------------------------------------
// Supabase writer (service role)
// ---------------------------------------------------------------------------
async function seedSupabase(d: SeedData) {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SECRET_KEY ?? process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) throw new Error("Set NEXT_PUBLIC_SUPABASE_URL and SUPABASE_SECRET_KEY (see .env.example).");
  const db = createClient(url, key, { auth: { persistSession: false, autoRefreshToken: false } });

  const check = <T,>(label: string, res: { data: T; error: { message: string } | null }): T => {
    if (res.error) throw new Error(`${label}: ${res.error.message}`);
    return res.data;
  };

  const existing = check("check season", await db.from("seasons").select("id").eq("name", SEED_SEASON_NAME).maybeSingle());
  if (existing) {
    console.log(`"${SEED_SEASON_NAME}" already exists. Nothing to do.`);
    return;
  }

  console.log(`Creating ${d.users.length} users…`);
  const profileIdByUser = new Map<string, string>();
  for (const u of d.users) {
    const created = await db.auth.admin.createUser({
      id: u.id,
      email: u.email,
      email_confirm: true,
      user_metadata: { first_name: u.first_name, last_name: u.last_name },
    });
    if (created.error && !/already/i.test(created.error.message)) throw new Error(`create ${u.email}: ${created.error.message}`);
    const profile = check(
      `profile ${u.email}`,
      await db.from("profiles").select("id").eq("email", u.email).single(),
    ) as { id: string };
    profileIdByUser.set(u.id, profile.id);
    check(
      `update ${u.email}`,
      await db.from("profiles").update({ first_name: u.first_name, last_name: u.last_name, role: u.role, ...u.profile }).eq("id", profile.id),
    );
  }
  const pid = (userId: string) => profileIdByUser.get(userId)!;

  const pointsRules = check("points rules", await db.from("points_rules").select("id").limit(1).single()) as { id: string };
  const venue = check("venue", await db.from("venues").select("id").limit(1).single()) as { id: string };
  const categories = check("categories", await db.from("categories").select("id, name")) as { id: string; name: string }[];
  const catId = (name: string) => categories.find((c) => c.name === name)!.id;

  check("deactivate seasons", await db.from("seasons").update({ is_active: false }).eq("is_active", true));
  check("season", await db.from("seasons").insert({ ...d.season, points_rules_id: pointsRules.id }));
  check("events", await db.from("events").insert(d.events.map((e) => ({ ...e, venue_id: venue.id }))));
  check(
    "event categories",
    await db.from("event_categories").insert(d.eventCategories.map(({ category, ...ec }) => ({ ...ec, category_id: catId(category) }))),
  );
  check("waiver", await db.from("waiver_versions").insert({ ...d.waiver, is_current: true }));
  check(
    "waiver signatures",
    await db.from("waiver_signatures").insert(d.signatures.map((x) => ({ ...x, rider_id: pid(x.rider_id) }))),
  );
  check("registrations", await db.from("registrations").insert(d.registrations.map((r) => ({ ...r, rider_id: pid(r.rider_id) }))));
  check(
    "results",
    await db.from("results").insert(
      d.results.map((r) => ({ ...r, rider_id: pid(r.rider_id), is_published: true, published_at: d.nowIso })),
    ),
  );
  check("sponsors", await db.from("sponsors").insert(d.sponsors));
  check("announcements", await db.from("announcements").insert(d.announcements));

  console.log(
    `Seeded ${d.events.length} events, ${d.registrations.length} registrations, and ${d.results.length} results.`,
  );
}

// ---------------------------------------------------------------------------
// SQL writer (local test database with the Supabase shim)
// ---------------------------------------------------------------------------
function lit(v: unknown): string {
  if (v === null || v === undefined) return "null";
  if (typeof v === "number" || typeof v === "boolean") return String(v);
  return `'${String(v).replaceAll("'", "''")}'`;
}

function insert(table: string, rows: Record<string, unknown>[], raw: Record<string, (row: Record<string, unknown>) => string> = {}) {
  if (rows.length === 0) return "";
  const cols = Object.keys(rows[0]);
  const values = rows.map((r) => `(${cols.map((c) => (raw[c] ? raw[c](r) : lit(r[c]))).join(", ")})`);
  return `insert into ${table} (${cols.join(", ")}) values\n  ${values.join(",\n  ")};\n`;
}

function toSql(d: SeedData): string {
  const profile = (userId: unknown) => `(select id from public.profiles where user_id = ${lit(userId)})`;
  let sql = "begin;\n";
  sql += insert(
    "auth.users",
    d.users.map((u) => ({ id: u.id, email: u.email, raw_user_meta_data: JSON.stringify({ first_name: u.first_name, last_name: u.last_name }) })),
  );
  for (const u of d.users) {
    const sets = Object.entries({ first_name: u.first_name, last_name: u.last_name, role: u.role, ...u.profile })
      .map(([k, v]) => `${k} = ${lit(v)}`)
      .join(", ");
    sql += `update public.profiles set ${sets} where user_id = ${lit(u.id)};\n`;
  }
  sql += "update public.seasons set is_active = false where is_active;\n";
  sql += insert("public.seasons", [{ ...d.season, points_rules_id: "" }], {
    points_rules_id: () => "(select id from public.points_rules limit 1)",
  });
  sql += insert("public.events", d.events.map((e) => ({ ...e, venue_id: "" })), {
    venue_id: () => "(select id from public.venues limit 1)",
  });
  sql += insert("public.event_categories", d.eventCategories.map(({ category, ...ec }) => ({ ...ec, category_id: category })), {
    category_id: (r) => `(select id from public.categories where name = ${lit(r.category_id)})`,
  });
  sql += insert("public.waiver_versions", [{ ...d.waiver, is_current: true }]);
  sql += insert("public.waiver_signatures", d.signatures, { rider_id: (r) => profile(r.rider_id) });
  sql += insert("public.registrations", d.registrations, { rider_id: (r) => profile(r.rider_id) });
  sql += insert(
    "public.results",
    d.results.map((r) => ({ ...r, is_published: true, published_at: d.nowIso })),
    { rider_id: (r) => profile(r.rider_id) },
  );
  sql += insert("public.sponsors", d.sponsors);
  sql += insert("public.announcements", d.announcements);
  sql += "commit;\n";
  return sql;
}
