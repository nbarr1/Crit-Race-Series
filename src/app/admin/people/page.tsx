import type { Metadata } from "next";
import { Suspense } from "react";
import { requireAdmin } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { PageLoading } from "@/components/page-loading";
import { Badge, Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Field, Input } from "@/components/ui/input";
import { AdminForm } from "@/components/admin/admin-form";
import { SelectField } from "@/components/admin/fields";
import type { AppRole } from "@/lib/types";
import { setRole } from "./actions";

export const metadata: Metadata = { title: "Staff and admins" };

type Person = { profile_id: string; first_name: string; last_name: string; email: string | null; role: AppRole; has_account: boolean };
type Props = { searchParams: Promise<{ q?: string }> };

const ROLE_LABELS: Record<AppRole, string> = { rider: "Rider", staff: "Staff", admin: "Admin" };

function PersonCard({ p, me }: { p: Person; me: string }) {
  const name = `${p.first_name} ${p.last_name}`.trim() || p.email || "Unnamed rider";
  return (
    <Card className="space-y-2">
      <p>
        <span className="font-bold">{name}</span> {p.role !== "rider" ? <Badge>{ROLE_LABELS[p.role]}</Badge> : null}
        {p.email ? <span className="block text-sm">{p.email}</span> : null}
        {!p.has_account ? <span className="block text-sm text-muted-foreground">Hasn&apos;t signed in yet (walk-up rider).</span> : null}
      </p>
      {p.profile_id === me ? (
        <p className="text-sm text-muted-foreground">This is you. Another admin can change your role.</p>
      ) : (
        <AdminForm action={setRole} submitLabel={`Save role for ${name}`}>
          <input type="hidden" name="id" value={p.profile_id} />
          <input type="hidden" name="name" value={name} />
          <SelectField id={`role-${p.profile_id}`} name="role" label="Role" defaultValue={p.role}>
            <option value="rider">Rider: no staff tools</option>
            <option value="staff">Staff: check-in, results, announcements, sponsors, event info</option>
            <option value="admin">Admin: everything, including these settings</option>
          </SelectField>
        </AdminForm>
      )}
    </Card>
  );
}

async function People({ searchParams }: Props) {
  const me = await requireAdmin("/admin/people");
  const { q = "" } = await searchParams;
  const supabase = await createClient();
  const term = q.trim().slice(0, 100);
  const [{ data: team }, { data: found }] = await Promise.all([
    supabase.rpc("admin_find_people", { p_query: "" }),
    term.length >= 2 ? supabase.rpc("admin_find_people", { p_query: term }) : Promise.resolve({ data: null }),
  ]);
  const staff = (team ?? []) as Person[];
  const results = (found ?? null) as Person[] | null;

  return (
    <div className="space-y-6">
      <section aria-labelledby="team-h" className="space-y-3">
        <h2 id="team-h" className="text-2xl font-bold">Current staff and admins</h2>
        <ul className="space-y-3">
          {staff.map((p) => (
            <li key={p.profile_id}>
              <PersonCard p={p} me={me.id} />
            </li>
          ))}
        </ul>
      </section>
      <section aria-labelledby="find-h" className="space-y-3">
        <h2 id="find-h" className="text-2xl font-bold">Add staff</h2>
        <p>Ask the volunteer to sign in once with their email, then find them here and choose Staff.</p>
        <form method="get" className="space-y-3" role="search">
          <Field id="people-q" label="Name or email">
            {(a) => <Input {...a} name="q" type="search" defaultValue={term} minLength={2} required />}
          </Field>
          <Button type="submit" variant="secondary">Search</Button>
        </form>
        {results ? (
          results.length ? (
            <ul className="space-y-3" aria-label="Search results">
              {results.map((p) => (
                <li key={p.profile_id}>
                  <PersonCard p={p} me={me.id} />
                </li>
              ))}
            </ul>
          ) : (
            <p role="status">Nobody matches &quot;{term}&quot;. Check the spelling, or ask them to sign in first.</p>
          )
        ) : null}
      </section>
    </div>
  );
}

export default function Page(props: Props) {
  return (
    <div className="space-y-4">
      <h1 className="text-3xl font-bold">Staff and admins</h1>
      <Suspense fallback={<PageLoading label="Loading people" />}>
        <People {...props} />
      </Suspense>
    </div>
  );
}
