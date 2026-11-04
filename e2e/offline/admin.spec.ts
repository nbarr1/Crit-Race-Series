import AxeBuilder from "@axe-core/playwright";
import { expect, test, type Page } from "@playwright/test";
import pg from "pg";
import { signInAs } from "./session";

/*
 * Phase 6: admin screens against seeded data. Every change made here is
 * undone in afterAll, so later test files see the seed as it was.
 */
const db = new pg.Pool({ database: process.env.E2E_DB_NAME ?? "crit_race_series_e2e" });
const created: string[] = [];
let promotedRider: string | null = null;
let paymentsBefore: unknown;

test.beforeAll(async () => {
  paymentsBefore = (await db.query("select value from public.app_settings where key = 'payments_enabled'")).rows[0].value;
});

test.afterAll(async () => {
  if (created.length) {
    await db.query("delete from public.event_categories where event_id = any($1::uuid[])", [created]);
    await db.query("delete from public.events where id = any($1::uuid[])", [created]);
  }
  await db.query("update public.app_settings set value = $1 where key = 'payments_enabled'", [JSON.stringify(paymentsBefore)]);
  if (promotedRider) {
    await db.query("update public.profiles set role = 'rider' where id = $1", [promotedRider]);
  }
  await db.end();
});

async function user(role: "admin" | "staff") {
  const { rows: [u] } = await db.query("select user_id as id, email::text from public.profiles where role = $1 order by created_at limit 1", [role]);
  return u as { id: string; email: string };
}

/** Fails on any WCAG 2.1 A or AA problem axe-core finds. */
async function expectAccessible(page: Page) {
  const results = await new AxeBuilder({ page }).withTags(["wcag2a", "wcag2aa", "wcag21a", "wcag21aa"]).analyze();
  expect(results.violations.map((v) => `${v.id}: ${v.nodes.map((n) => n.target.join(" ")).join(", ")}`)).toEqual([]);
}

test("staff can't open the admin screens", async ({ page, context, baseURL }) => {
  await signInAs(context, await user("staff"), baseURL!);
  await page.goto("/admin/events");
  await expect(page).toHaveURL(/\/$/);
});

test("an admin sees the season dashboard", async ({ page, context, baseURL }) => {
  await signInAs(context, await user("admin"), baseURL!);
  await page.goto("/admin");
  await expect(page.getByRole("heading", { name: "2027 Connestee Crit Series" })).toBeVisible();
  const { rows: [{ n }] } = await db.query(
    `select count(distinct r.rider_id)::int as n from public.registrations r join public.events e on e.id = r.event_id
     join public.seasons s on s.id = e.season_id where s.is_active and r.status in ('confirmed', 'pending_payment')`,
  );
  await expect(page.getByText("Riders registered").locator("..")).toContainText(String(n));
  await expect(page.getByText("Waiver version 1 is published.")).toBeVisible();
  await expect(page.getByText("The venue address and coordinates aren't confirmed.")).toBeVisible();
  await expectAccessible(page);
});

test("an admin creates, publishes, and copies an event, with prices", async ({ page, context, baseURL }) => {
  await signInAs(context, await user("admin"), baseURL!);
  await page.goto("/admin/events");
  await expect(page.getByRole("heading", { name: /2027 Connestee Crit Series/ })).toBeVisible();
  await expectAccessible(page);
  await page.getByRole("link", { name: "Add an event" }).click();
  await expect(page.getByRole("heading", { name: "Add an event" })).toBeVisible();

  await page.getByLabel("Name", { exact: true }).fill("Bonus Race");
  await page.getByLabel("Date", { exact: true }).fill("2027-09-01");
  // Picking the date fills in a registration window.
  await expect(page.getByLabel("Registration opens (Eastern Time)")).toHaveValue("2027-08-02T09:00");
  await expect(page.getByLabel("Online registration closes (Eastern Time)")).toHaveValue("2027-09-01T12:00");
  // The categories come from the season's latest event; drop one.
  const b = page.getByRole("group", { name: "B", exact: true });
  await expect(b.getByLabel("Start time")).toHaveValue("17:15");
  await page.getByRole("button", { name: /^Remove Masters/ }).click();
  await expect(page.getByRole("group", { name: "Masters" })).toHaveCount(0);
  await b.getByLabel("Online price ($)").fill("22.50");
  await expectAccessible(page);
  await page.getByRole("button", { name: "Create event" }).click();

  await expect(page.getByText("Created Bonus Race.")).toBeVisible();
  const id = page.url().match(/\/admin\/events\/([0-9a-f-]{36})/)![1];
  created.push(id);
  const { rows: ecs } = await db.query(
    `select c.name, ec.price_cents, ec.start_at from public.event_categories ec join public.categories c on c.id = ec.category_id
     where ec.event_id = $1 order by c.sort_order`,
    [id],
  );
  expect(ecs.map((r) => r.name)).toEqual(["A", "B", "Open Women"]);
  expect(ecs.find((r) => r.name === "B")!.price_cents).toBe(2250);
  // 5:15 PM Eastern on September 1 is 21:15 UTC.
  expect(new Date(ecs.find((r) => r.name === "B")!.start_at).toISOString()).toBe("2027-09-01T21:15:00.000Z");
  const { rows: [draft] } = await db.query("select status from public.events where id = $1", [id]);
  expect(draft.status).toBe("draft");

  // Publish it, and the public schedule lists it.
  await page.getByLabel("Status").selectOption("published");
  await page.getByRole("button", { name: "Save event" }).click();
  await expect(page.getByText("Saved the event.")).toBeVisible();
  const { rows: [pub] } = await db.query("select status from public.events where id = $1", [id]);
  expect(pub.status).toBe("published");
  const schedule = await context.newPage();
  await schedule.goto("/schedule");
  await expect(schedule.getByText("Bonus Race")).toBeVisible();
  await schedule.close();

  // Copy it a week later as a draft.
  await expect(page.getByLabel("Name of the copy")).toHaveValue("Bonus Race (copy)");
  await page.getByLabel("Name of the copy").fill("Bonus Race 2");
  await page.getByRole("button", { name: "Copy event" }).click();
  await expect(page.getByText("Copied.")).toBeVisible();
  const copyId = page.url().match(/\/admin\/events\/([0-9a-f-]{36})/)![1];
  created.push(copyId);
  const { rows: [copy] } = await db.query(
    "select e.event_date::text, e.status, count(ec.id)::int as n from public.events e join public.event_categories ec on ec.event_id = e.id where e.id = $1 group by e.id",
    [copyId],
  );
  expect(copy).toEqual({ event_date: "2027-09-08", status: "draft", n: 3 });

  // An unused draft can be deleted.
  await page.getByLabel("Delete Bonus Race 2").check();
  await page.getByRole("button", { name: "Delete event" }).click();
  await expect(page.getByRole("heading", { name: "Events and prices" })).toBeVisible();
  const { rows: [gone] } = await db.query("select deleted_at from public.events where id = $1", [copyId]);
  expect(gone.deleted_at).not.toBeNull();
});

test("an event with registrations keeps its categories", async ({ page, context, baseURL }) => {
  await signInAs(context, await user("admin"), baseURL!);
  const { rows: [ev] } = await db.query("select id from public.events where name = 'Race 4'");
  await page.goto(`/admin/events/${ev.id}`);
  await expect(page.getByRole("heading", { name: "Edit event" })).toBeVisible();
  await expect(page.getByRole("button", { name: /^Remove / })).toHaveCount(0);
  await page.getByLabel("Delete Race 4").check();
  await page.getByRole("button", { name: "Delete event" }).click();
  await expect(page.getByText(/can't be deleted. Change its status to canceled instead./)).toBeVisible();
});

test("an admin changes settings and makes a volunteer staff", async ({ page, context, baseURL }) => {
  await signInAs(context, await user("admin"), baseURL!);
  await page.goto("/admin/settings");
  const payments = page.getByLabel("Take online payments through Stripe");
  await expect(payments).toBeChecked();
  await payments.uncheck();
  await expectAccessible(page);
  await page.getByRole("button", { name: "Save settings" }).click();
  await expect(page.getByText("Saved 1 setting.")).toBeVisible();
  const { rows: [s] } = await db.query("select value from public.app_settings where key = 'payments_enabled'");
  expect(s.value).toBe(false);

  const { rows: [rider] } = await db.query("select id, first_name, last_name, email::text from public.profiles where role = 'rider' and user_id is not null order by email limit 1");
  await page.goto("/admin/people");
  await expect(page.getByRole("heading", { name: "Staff and admins", level: 2 })).toBeVisible();
  await page.getByLabel("Name or email").fill(rider.email);
  await page.getByRole("button", { name: "Search" }).click();
  const results = page.getByRole("list", { name: "Search results" });
  await results.getByLabel("Role").selectOption("staff");
  await expectAccessible(page);
  await results.getByRole("button", { name: /^Save role for/ }).click();
  await expect(page.getByText(`${rider.first_name} ${rider.last_name} is now staff.`)).toBeVisible();
  promotedRider = rider.id;
  const { rows: [after] } = await db.query("select role from public.profiles where id = $1", [rider.id]);
  expect(after.role).toBe("staff");

  // The change is in the activity log.
  await page.goto("/admin/activity?table=profiles");
  await expect(page.getByRole("cell", { name: "role" }).first()).toBeVisible();
});

test("exports: registrations CSV for admins, emergency contacts for staff", async ({ page, context, baseURL }) => {
  const { rows: [ev] } = await db.query("select id from public.events where name = 'Race 1'");
  const { rows: [{ n }] } = await db.query("select count(*)::int as n from public.registrations where event_id = $1", [ev.id]);

  await signInAs(context, await user("admin"), baseURL!);
  const res = await page.request.get(`/admin/export/registrations?event=${ev.id}`);
  expect(res.status()).toBe(200);
  expect(res.headers()["content-type"]).toContain("text/csv");
  const lines = (await res.text()).trim().split("\r\n");
  expect(lines[0]).toMatch(/^event,event_date,category,last_name,first_name,email,phone/);
  expect(lines).toHaveLength(n + 1);

  await context.clearCookies();
  await signInAs(context, await user("staff"), baseURL!);
  expect((await page.request.get(`/admin/export/registrations?event=${ev.id}`)).status()).toBe(403);
  await page.goto(`/staff/events/${ev.id}/emergency`);
  await expect(page.getByRole("heading", { name: "Emergency contacts" })).toBeVisible();
  const { rows: [{ riders }] } = await db.query(
    "select count(distinct rider_id)::int as riders from public.registrations where event_id = $1 and status in ('confirmed', 'pending_payment')",
    [ev.id],
  );
  await expect(page.getByRole("row")).toHaveCount(riders + 1);
  await expectAccessible(page);
});

test("public pages have no WCAG A or AA problems", async ({ page }) => {
  const { rows: [ev] } = await db.query("select id from public.events where name = 'Race 4'");
  for (const path of ["/", "/schedule", `/events/${ev.id}`, "/standings", "/sponsors", "/announcements", "/sign-in"]) {
    await page.goto(path);
    await expect(page.locator("main")).toBeVisible();
    await expectAccessible(page);
  }
});
