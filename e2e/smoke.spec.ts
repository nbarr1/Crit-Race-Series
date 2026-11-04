import { expect, test } from "@playwright/test";

// These run without a database. Flows that need Supabase (sign-in,
// registration, check-in) are added in later phases and skip when
// E2E_SUPABASE is not set.

test("home page renders with navigation", async ({ page }) => {
  await page.goto("/");
  await expect(page.getByRole("heading", { level: 1 })).toBeVisible();
  await expect(page.getByRole("navigation", { name: "Main" }).getByRole("link", { name: "Schedule" })).toBeVisible();
});

test("sign-in form is labeled and validates email", async ({ page }) => {
  await page.goto("/sign-in");
  const email = page.getByLabel("Email");
  await expect(email).toBeVisible();
  await email.fill("not-an-email");
  await page.getByRole("button", { name: "Email me a sign-in code" }).click();
  await expect(page.getByText("Enter a valid email address.")).toBeVisible();
});

for (const path of ["/my-races", "/register", "/waiver", "/season-pass"]) {
  test(`${path} sends signed-out visitors to sign in`, async ({ page }) => {
    await page.goto(path);
    await expect(page).toHaveURL(new RegExp(`/sign-in\\?next=${encodeURIComponent(path)}`));
  });
}

test("the Stripe webhook rejects unsigned requests", async ({ request }) => {
  const res = await request.post("/api/stripe/webhook", { data: { type: "checkout.session.completed" } });
  expect(res.status()).toBe(400);
});

test("the scheduled job requires its secret", async ({ request }) => {
  const res = await request.get("/api/cron/registrations");
  expect(res.status()).toBe(401);
});

test("tap targets are at least 44px tall", async ({ page }) => {
  await page.goto("/sign-in");
  const box = await page.getByRole("button", { name: "Email me a sign-in code" }).boundingBox();
  expect(box?.height ?? 0).toBeGreaterThanOrEqual(44);
});
