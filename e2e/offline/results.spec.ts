import { expect, test } from "@playwright/test";
import pg from "pg";
import { signInAs } from "./session";

/*
 * Phase 5: results upload, publishing, and series standings against seeded
 * data (three races with published results).
 */
const db = new pg.Pool({ database: process.env.E2E_DB_NAME ?? "crit_race_series_e2e" });
test.afterAll(() => db.end());

async function categoryA() {
  const { rows: [season] } = await db.query("select id from public.seasons where is_active");
  const { rows: [cat] } = await db.query("select id from public.categories where name = 'A'");
  return { seasonId: season.id as string, categoryId: cat.id as string };
}

test("the standings page ranks riders from the seeded results", async ({ page }) => {
  const { seasonId, categoryId } = await categoryA();
  const { rows: [leader] } = await db.query(
    "select max(total_points) as total from public.standings where season_id = $1 and category_id = $2",
    [seasonId, categoryId],
  );
  await page.goto("/standings");
  await expect(page.getByRole("heading", { name: "Series standings" })).toBeVisible();
  const section = page.getByRole("region", { name: "A", exact: true });
  await expect(section.getByText("3 races scored.")).toBeVisible();
  const first = section.getByRole("row").nth(1);
  await expect(first.getByRole("cell").first()).toHaveText(/^T?1$/);
  await expect(first.getByRole("cell").last()).toHaveText(String(leader.total));
});

test("staff upload a results sheet, publish it, and the standings update", async ({ page, context, baseURL }) => {
  const { seasonId, categoryId } = await categoryA();
  const { rows: [staff] } = await db.query("select user_id as id, email::text from public.profiles where role = 'staff' limit 1");
  const { rows: [ec] } = await db.query(
    `select ec.id, e.id as event_id from public.event_categories ec join public.events e on e.id = ec.event_id
     where e.name = 'Race 4' and ec.category_id = $1`,
    [categoryId],
  );
  const { rows: riders } = await db.query(
    `select p.id, p.first_name, p.last_name from public.registrations r join public.profiles p on p.id = r.rider_id
     where r.event_category_id = $1 and r.status = 'confirmed' order by p.last_name, p.first_name limit 4`,
    [ec.id],
  );
  expect(riders).toHaveLength(4);
  const before = new Map(
    (await db.query("select rider_id, total_points from public.standings where season_id = $1 and category_id = $2", [seasonId, categoryId]))
      .rows.map((r) => [r.rider_id, r.total_points as number]),
  );

  // Names only (no bibs), one written "Last, First", plus a rider who isn't registered.
  const csv = [
    "Place,Name,Team,Laps",
    `1,${riders[0].first_name} ${riders[0].last_name},,20`,
    `2,"${riders[1].last_name}, ${riders[1].first_name}",,20`,
    `3,${riders[2].first_name.toUpperCase()} ${riders[2].last_name},,20`,
    "4,Guest Racer,Out of Town CC,20",
    `DNF,${riders[3].first_name} ${riders[3].last_name},,8`,
  ].join("\n");

  await signInAs(context, staff, baseURL!);
  await page.goto("/staff/results");
  await expect(page.getByRole("heading", { name: "Results", exact: true })).toBeVisible();
  await page.goto(`/staff/results/${ec.id}`);
  await expect(page.getByRole("heading", { name: "Results: A" })).toBeVisible();
  await expect(page.getByText("No results saved for this race yet.")).toBeVisible();

  await page.getByLabel("Or paste the results").fill(csv);
  await page.getByRole("button", { name: "Preview results" }).click();
  await expect(page.getByText("5 rows · 4 matched · 1 not matched")).toBeVisible();
  await expect(page.getByText('No registered rider is named "Guest Racer".')).toBeVisible();
  await expect(page.getByLabel("Rider for line 2")).toHaveValue(riders[0].id);
  await expect(page.getByLabel("Rider for line 3")).toHaveValue(riders[1].id);

  await page.getByRole("button", { name: "Save 5 results as a draft" }).click();
  await expect(page.getByText("Saved 5 results as a draft.")).toBeVisible();
  await expect(page.getByText("Draft", { exact: true })).toBeVisible();
  const { rows: drafts } = await db.query("select is_published, points_awarded, rider_id from public.results where event_category_id = $1", [ec.id]);
  expect(drafts).toHaveLength(5);
  expect(drafts.every((r) => !r.is_published)).toBe(true);

  // Drafts are not public yet.
  const publicPage = await context.newPage();
  await publicPage.goto(`/events/${ec.event_id}`);
  await expect(publicPage.getByRole("heading", { name: "Races" })).toBeVisible();
  await expect(publicPage.getByText("Guest Racer")).toHaveCount(0);

  await page.getByRole("button", { name: "Publish results" }).click();
  await expect(page.getByRole("button", { name: "Unpublish results" })).toBeVisible();
  const { rows: [{ n }] } = await db.query("select count(*)::int as n from public.results where event_category_id = $1 and is_published", [ec.id]);
  expect(n).toBe(5);

  // The event page lists the results, including the unmatched guest.
  await publicPage.goto(`/events/${ec.event_id}`);
  const results = publicPage.getByRole("region", { name: "Results" });
  await expect(results.getByRole("heading", { name: "A", exact: true })).toBeVisible();
  await expect(results.getByText("Guest Racer")).toBeVisible();
  await expect(results.getByRole("row").nth(1).getByRole("cell").last()).toHaveText("25");

  // The winner gains 25 points in the standings; the guest isn't in them.
  await publicPage.goto("/standings");
  const winnerRow = publicPage.locator(`[data-rider-id="${riders[0].id}"]`);
  await expect(winnerRow.getByRole("cell").last()).toHaveText(String((before.get(riders[0].id) ?? 0) + 25));
  await expect(publicPage.getByRole("region", { name: "A", exact: true }).getByText("4 races scored.")).toBeVisible();
  await expect(publicPage.getByText("Guest Racer")).toHaveCount(0);
  await publicPage.close();
});
