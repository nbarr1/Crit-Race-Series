import type { BrowserContext } from "@playwright/test";

/**
 * Signs a browser in as a user by writing the Supabase session cookie that
 * @supabase/ssr reads. The fake Supabase server trusts the token's sub claim.
 */
export async function signInAs(context: BrowserContext, user: { id: string; email: string }, baseURL: string) {
  const b64 = (o: object) => Buffer.from(JSON.stringify(o)).toString("base64url");
  const exp = Math.floor(Date.now() / 1000) + 24 * 3600;
  const accessToken = `${b64({ alg: "HS256", typ: "JWT" })}.${b64({ sub: user.id, email: user.email, role: "authenticated", aud: "authenticated", exp })}.test-signature`;
  const session = {
    access_token: accessToken,
    refresh_token: "test-refresh",
    token_type: "bearer",
    expires_in: 24 * 3600,
    expires_at: exp,
    user: { id: user.id, email: user.email, aud: "authenticated", role: "authenticated", app_metadata: {}, user_metadata: {} },
  };
  await context.addCookies([
    { name: "sb-127-auth-token", value: `base64-${b64(session)}`, url: baseURL, httpOnly: false, sameSite: "Lax" },
  ]);
}
