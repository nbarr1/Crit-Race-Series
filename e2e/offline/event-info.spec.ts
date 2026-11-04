import { expect, test } from "@playwright/test";
import pg from "pg";

/*
 * Phase 4: public event information against seeded data. Weather comes from
 * the Open-Meteo stand-in in e2e/support/fake-supabase.mjs (same response
 * shape, made-up values), not the live API.
 */
const db = new pg.Pool({ database: process.env.E2E_DB_NAME ?? "crit_race_series_e2e" });
test.afterAll(() => db.end());

test("the event page shows the race-day weather panel", async ({ page }) => {
  const { rows: [event] } = await db.query("select id from public.events where name = 'Race 4'");
  await page.goto(`/events/${event.id}`);
  const panel = page.getByRole("region", { name: "Race-day weather" });
  await expect(panel).toBeVisible();
  await expect(panel.getByText("Course is wet in turn 3.")).toBeVisible();
  await expect(panel.getByText("Gusts to 17 mph, from the northwest (NW)")).toBeVisible();
  await expect(panel.getByText("Sunset")).toBeVisible();
  await expect(panel.getByText("8:31 PM")).toBeVisible();
  await expect(panel.getByText("Sunrise")).toBeVisible();
  await expect(panel.getByText("Chance of rain")).toBeVisible();
  await expect(panel.getByText(/Last updated/)).toBeVisible();
});

test("far-off races say the forecast comes later", async ({ page }) => {
  const { rows: [event] } = await db.query("select id from public.events where name = 'Race 10'");
  await page.goto(`/events/${event.id}`);
  await expect(page.getByText("Forecast available closer to race day.")).toBeVisible();
});

test("the home page shows the urgent announcement, the next race, and sponsors", async ({ page }) => {
  await page.goto("/");
  await expect(page.getByRole("alert").getByText("Course change for Race 4")).toBeVisible();
  await expect(page.getByText("Next race", { exact: true })).toBeVisible();
  await expect(page.getByText(/First race in/)).toBeVisible();
  await expect(page.getByRole("region", { name: "Thanks to our sponsors" }).getByText("Ridgeline Bike Shop")).toBeVisible();
});

test("announcements and sponsors pages list seeded content", async ({ page }) => {
  await page.goto("/announcements");
  await expect(page.getByRole("heading", { name: "Course change for Race 4" })).toBeVisible();
  await expect(page.getByRole("heading", { name: "Welcome to the 2027 series" })).toBeVisible();
  await page.goto("/sponsors");
  await expect(page.getByRole("heading", { name: "Presenting sponsor" })).toBeVisible();
  await expect(page.getByText("Davidson River Coffee Co.")).toBeVisible();
});

test("calendar downloads cover the season and single events", async ({ request }) => {
  const season = await request.get("/schedule/calendar.ics");
  expect(season.status()).toBe(200);
  expect(season.headers()["content-type"]).toContain("text/calendar");
  const body = await season.text();
  expect(body.match(/BEGIN:VEVENT/g)).toHaveLength(10);
  expect(body).toContain("SUMMARY:Race 1\\, Conestee Crit Series");

  const { rows: [event] } = await db.query("select id from public.events where name = 'Race 2'");
  const one = await (await request.get(`/events/${event.id}/calendar.ics`)).text();
  expect(one.match(/BEGIN:VEVENT/g)).toHaveLength(1);
  expect(one).toContain("DTSTART:20270526T211500Z");
});
