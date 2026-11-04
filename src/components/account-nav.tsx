import Link from "next/link";
import { getCurrentProfile } from "@/lib/auth";

const linkClass = "flex min-h-11 items-center rounded px-2 hover:underline";

export function SignInLink() {
  return (
    <li>
      <Link className={linkClass} href="/sign-in">
        Sign in
      </Link>
    </li>
  );
}

/** Session-dependent nav links. Streams in after the static header. */
export async function AccountNav() {
  const profile = await getCurrentProfile();
  if (!profile) return <SignInLink />;
  const isStaff = profile.role === "staff" || profile.role === "admin";
  return (
    <>
      <li>
        <Link className={linkClass} href="/my-races">
          My races
        </Link>
      </li>
      {isStaff ? (
        <li>
          <Link className={linkClass} href="/staff">
            Staff
          </Link>
        </li>
      ) : null}
      <li>
        <Link className={linkClass} href="/profile">
          Profile
        </Link>
      </li>
    </>
  );
}
