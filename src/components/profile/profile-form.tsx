"use client";

import { useActionState } from "react";
import { saveProfile, type ProfileFormState } from "./actions";
import { Button } from "@/components/ui/button";
import { Field, Input, Select } from "@/components/ui/input";
import { Alert } from "@/components/ui/card";
import type { Profile } from "@/lib/types";

export function ProfileForm({
  profile,
  next,
  submitLabel,
}: {
  profile: Profile;
  next?: string;
  submitLabel: string;
}) {
  const [state, action, pending] = useActionState<ProfileFormState, FormData>(saveProfile, {});
  const e = state.errors ?? {};

  return (
    <form action={action} className="space-y-6" noValidate>
      {next ? <input type="hidden" name="next" value={next} /> : null}
      {e.form ? <Alert tone="error">{e.form}</Alert> : null}
      {state.saved ? <Alert tone="success">Profile saved.</Alert> : null}
      {Object.keys(e).length > 0 && !e.form ? (
        <Alert tone="error">Some fields need attention. Each one is marked in the form.</Alert>
      ) : null}

      <fieldset className="space-y-4">
        <legend className="mb-2 text-xl font-bold">About you</legend>
        <Field id="first_name" label="First name" error={e.first_name}>
          {(a) => <Input {...a} name="first_name" autoComplete="given-name" defaultValue={profile.first_name} required />}
        </Field>
        <Field id="last_name" label="Last name" error={e.last_name}>
          {(a) => <Input {...a} name="last_name" autoComplete="family-name" defaultValue={profile.last_name} required />}
        </Field>
        <Field
          id="display_name"
          label="Name in results (optional)"
          hint="Shown publicly in results and standings. Leave blank to use your first name and last initial."
          error={e.display_name}
        >
          {(a) => <Input {...a} name="display_name" autoComplete="nickname" defaultValue={profile.display_name} />}
        </Field>
        <Field id="phone" label="Mobile phone" error={e.phone}>
          {(a) => <Input {...a} name="phone" type="tel" autoComplete="tel" defaultValue={profile.phone ?? ""} required />}
        </Field>
        <Field
          id="birth_date"
          label="Birth date"
          hint="Used for Masters eligibility and to check whether a guardian must sign your waiver. Never shown publicly."
          error={e.birth_date}
        >
          {(a) => <Input {...a} name="birth_date" type="date" autoComplete="bday" defaultValue={profile.birth_date ?? ""} required />}
        </Field>
        <Field
          id="gender"
          label="Gender (optional)"
          hint="Used only to check Open Women eligibility."
          error={e.gender}
        >
          {(a) => (
            <Select {...a} name="gender" defaultValue={profile.gender ?? ""}>
              <option value="">Not specified</option>
              <option value="woman">Woman</option>
              <option value="man">Man</option>
              <option value="non_binary">Non-binary</option>
              <option value="prefer_not_to_say">Prefer not to say</option>
            </Select>
          )}
        </Field>
        <Field id="team" label="Team or club (optional)" error={e.team}>
          {(a) => <Input {...a} name="team" autoComplete="organization" defaultValue={profile.team ?? ""} />}
        </Field>
      </fieldset>

      <fieldset className="space-y-4">
        <legend className="mb-2 text-xl font-bold">USA Cycling license (optional)</legend>
        <Field id="usac_license_number" label="License number" error={e.usac_license_number}>
          {(a) => <Input {...a} name="usac_license_number" inputMode="numeric" defaultValue={profile.usac_license_number ?? ""} />}
        </Field>
        <Field id="usac_license_expiry" label="License expiry date" error={e.usac_license_expiry}>
          {(a) => <Input {...a} name="usac_license_expiry" type="date" defaultValue={profile.usac_license_expiry ?? ""} />}
        </Field>
      </fieldset>

      <fieldset className="space-y-4">
        <legend className="mb-2 text-xl font-bold">Emergency contact</legend>
        <p className="text-sm text-muted-foreground">Only you and race staff can see this.</p>
        <Field id="emergency_contact_name" label="Contact name" error={e.emergency_contact_name}>
          {(a) => <Input {...a} name="emergency_contact_name" defaultValue={profile.emergency_contact_name ?? ""} required />}
        </Field>
        <Field id="emergency_contact_relationship" label="Relationship to you" error={e.emergency_contact_relationship}>
          {(a) => (
            <Input {...a} name="emergency_contact_relationship" defaultValue={profile.emergency_contact_relationship ?? ""} required />
          )}
        </Field>
        <Field id="emergency_contact_phone" label="Contact phone" error={e.emergency_contact_phone}>
          {(a) => (
            <Input {...a} name="emergency_contact_phone" type="tel" defaultValue={profile.emergency_contact_phone ?? ""} required />
          )}
        </Field>
      </fieldset>

      <Button type="submit" size="lg" className="w-full" disabled={pending}>
        {pending ? "Saving…" : submitLabel}
      </Button>
    </form>
  );
}
