import { expect, test } from "@playwright/test";
import pg from "pg";
import { signInAs } from "./session";

/*
 * Phase 3 acceptance: staff check in 20 seeded riders with the network off,
 * and every check-in syncs once the network is back.
 */
const db = new pg.Pool({ database: process.env.E2E_DB_NAME ?? "crit_race_series_e2e" });
test.afterAll(() => db.end());

test("checks in 20 riders offline and syncs them when the signal returns", async ({ page, context, baseURL }) => {
  const { rows: [staff] } = await db.query("select user_id as id, email::text from public.profiles where role = 'staff' limit 1");
  const { rows: [event] } = await db.query("select id from public.events where name = 'Race 4'");
  // 20 confirmed riders who have signed the current waiver and aren't checked in.
  const { rows: riders } = await db.query(
    `select r.id from public.registrations r
     join public.events e on e.id = r.event_id
     where r.event_id = $1 and r.status = 'confirmed' and r.checked_in_at is null
       and public.has_signed_current_waiver(r.rider_id, e.season_id)
     order by r.id limit 20`,
    [event.id],
  );
  expect(riders).toHaveLength(20);

  await signInAs(context, staff, baseURL!);
  await page.goto(`/staff/check-in?event=${event.id}`);
  await expect(page.getByRole("heading", { name: /Check-in: Race 4/ })).toBeVisible();
  await expect(page.getByText(/Roster downloaded/)).toBeVisible();

  // Let the service worker take control, and load once more so it caches the page.
  await page.evaluate(() => navigator.serviceWorker.ready.then(() => undefined));
  await page.reload();
  await expect(page.getByText(/Roster downloaded/)).toBeVisible();

  await context.setOffline(true);
  await expect(page.getByText("Offline", { exact: true })).toBeVisible();

  for (const { id } of riders) {
    await page.locator(`[data-registration-id="${id}"]`).click();
    await page.getByRole("button", { name: "Check in", exact: true }).click();
    await expect(page.getByText(/^Checked in with bib \d+\.$/)).toBeVisible();
    await page.getByRole("button", { name: "Back to the list" }).click();
  }
  await expect(page.getByText("Offline, 20 changes pending.", { exact: false })).toBeVisible();

  // Reloading with no signal still opens the screen with the queue intact.
  await page.reload();
  await expect(page.getByRole("heading", { name: /Check-in: Race 4/ })).toBeVisible();
  await expect(page.getByText("Offline, 20 changes pending.", { exact: false })).toBeVisible();

  // Nothing reached the server while offline.
  const before = await db.query("select count(*)::int as n from public.registrations where id = any($1) and checked_in_at is not null", [riders.map((r) => r.id)]);
  expect(before.rows[0].n).toBe(0);

  await context.setOffline(false);
  await page.evaluate(() => window.dispatchEvent(new Event("online")));
  await expect(page.getByText(/changes pending|Syncing/)).toHaveCount(0, { timeout: 30_000 });

  const after = await db.query(
    `select count(*)::int as n, count(distinct bib_number)::int as bibs, count(distinct checked_in_by)::int as staff
     from public.registrations where id = any($1) and checked_in_at is not null and bib_number is not null`,
    [riders.map((r) => r.id)],
  );
  expect(after.rows[0]).toEqual({ n: 20, bibs: 20, staff: 1 });
  const events = await db.query("select count(*)::int as n from public.check_in_events where registration_id = any($1) and outcome = 'checked_in'", [riders.map((r) => r.id)]);
  expect(events.rows[0].n).toBe(20);
  // Check-in times are the device's times from while it was offline, not the sync time.
  const times = await db.query(
    `select bool_and(c.client_checked_in_at < c.created_at) as ok from public.check_in_events c where c.registration_id = any($1)`,
    [riders.map((r) => r.id)],
  );
  expect(times.rows[0].ok).toBe(true);
});

test("the roster and sync endpoints refuse riders", async ({ request, context, baseURL }) => {
  const { rows: [rider] } = await db.query("select user_id as id, email::text from public.profiles where role = 'rider' and user_id is not null limit 1");
  const { rows: [event] } = await db.query("select id from public.events where name = 'Race 4'");
  await signInAs(context, rider, baseURL!);
  const cookies = await context.cookies();
  const headers = { cookie: cookies.map((c) => `${c.name}=${c.value}`).join("; ") };
  expect((await request.get(`/api/staff/roster?event=${event.id}`, { headers })).status()).toBe(403);
  expect((await request.post("/api/staff/sync", { headers, data: { device_id: "x", ops: [] } })).status()).toBe(403);
});
