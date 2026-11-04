"use client";

import { useActionState } from "react";
import { addSponsor, type SponsorState } from "@/app/staff/sponsors/actions";
import { Button } from "@/components/ui/button";
import { Field, Input, Select } from "@/components/ui/input";
import { Alert } from "@/components/ui/card";

export function SponsorForm() {
  const [state, action, pending] = useActionState<SponsorState, FormData>(addSponsor, {});
  const e = state.errors ?? {};
  return (
    <form action={action} className="space-y-3" noValidate>
      {e.form ? <Alert tone="error">{e.form}</Alert> : null}
      {state.message ? <Alert tone="success">{state.message}</Alert> : null}
      <Field id="s-name" label="Name" error={e.name}>{(a) => <Input {...a} name="name" required />}</Field>
      <Field id="s-url" label="Website (optional)" error={e.url}>{(a) => <Input {...a} name="url" type="url" placeholder="https://" />}</Field>
      <Field id="s-tier" label="Tier" error={e.tier}>
        {(a) => (
          <Select {...a} name="tier" defaultValue="supporter">
            <option value="presenting">Presenting</option>
            <option value="gold">Gold</option>
            <option value="silver">Silver</option>
            <option value="supporter">Supporter</option>
          </Select>
        )}
      </Field>
      <Field id="s-sort" label="Order" hint="Lower numbers show first." error={e.sort_order}>
        {(a) => <Input {...a} name="sort_order" inputMode="numeric" defaultValue="100" />}
      </Field>
      <Field id="s-logo" label="Logo (optional)" hint="PNG, JPEG, WebP, or SVG, up to 2 MB." error={e.logo}>
        {(a) => <input {...a} name="logo" type="file" accept="image/png,image/jpeg,image/webp,image/svg+xml" className="block min-h-11 w-full" />}
      </Field>
      <Button type="submit" disabled={pending}>{pending ? "Saving…" : "Add sponsor"}</Button>
    </form>
  );
}
