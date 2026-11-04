"use client";

import { useActionState } from "react";
import { signWaiver, type SignState } from "@/app/waiver/actions";
import { Button } from "@/components/ui/button";
import { Field, Input } from "@/components/ui/input";
import { Alert } from "@/components/ui/card";

export function SignForm({
  waiverVersionId,
  riderName,
  needsGuardian,
  next,
}: {
  waiverVersionId: string;
  riderName: string;
  needsGuardian: boolean;
  next: string;
}) {
  const [state, action, pending] = useActionState<SignState, FormData>(signWaiver, {});
  const e = state.errors ?? {};

  return (
    <form action={action} className="space-y-5" noValidate>
      <input type="hidden" name="waiver_version_id" value={waiverVersionId} />
      <input type="hidden" name="next" value={next} />
      {e.form ? <Alert tone="error">{e.form}</Alert> : null}

      <div className="space-y-1">
        <div className="flex items-start gap-3">
          <input
            id="agree"
            name="agree"
            type="checkbox"
            className="mt-1 size-6 shrink-0 accent-primary"
            aria-describedby={e.agree ? "agree-error" : undefined}
            aria-invalid={e.agree ? true : undefined}
          />
          <label htmlFor="agree" className="text-base font-semibold">
            I have read and agree to this waiver.
          </label>
        </div>
        {e.agree ? (
          <p id="agree-error" className="text-sm font-semibold text-destructive">
            {e.agree}
          </p>
        ) : null}
      </div>

      <Field
        id="typed_full_name"
        label="Type your full name to sign"
        hint={`Type it as it appears on your profile: ${riderName}.`}
        error={e.typed_full_name}
      >
        {(a) => <Input {...a} name="typed_full_name" autoComplete="name" required />}
      </Field>

      {needsGuardian ? (
        <fieldset className="space-y-4 rounded-lg border-2 border-warning p-4">
          <legend className="px-1 text-lg font-bold">Parent or guardian</legend>
          <p>The rider is under 18, so a parent or legal guardian must also sign.</p>
          <Field id="guardian_name" label="Parent or guardian's full name" error={e.guardian_name}>
            {(a) => <Input {...a} name="guardian_name" required />}
          </Field>
          <Field id="guardian_relationship" label="Relationship to the rider" error={e.guardian_relationship}>
            {(a) => <Input {...a} name="guardian_relationship" placeholder="For example, parent" required />}
          </Field>
          <div className="space-y-1">
            <div className="flex items-start gap-3">
              <input
                id="guardian_agree"
                name="guardian_agree"
                type="checkbox"
                className="mt-1 size-6 shrink-0 accent-primary"
                aria-describedby={e.guardian_agree ? "guardian_agree-error" : undefined}
              />
              <label htmlFor="guardian_agree" className="font-semibold">
                As the rider&apos;s parent or guardian, I have read and agree to this waiver on the rider&apos;s behalf
                and my own.
              </label>
            </div>
            {e.guardian_agree ? (
              <p id="guardian_agree-error" className="text-sm font-semibold text-destructive">
                {e.guardian_agree}
              </p>
            ) : null}
          </div>
          <Field id="guardian_typed_signature" label="Parent or guardian: type your full name to sign" error={e.guardian_typed_signature}>
            {(a) => <Input {...a} name="guardian_typed_signature" required />}
          </Field>
        </fieldset>
      ) : null}

      <Button type="submit" size="lg" className="w-full" disabled={pending}>
        {pending ? "Signing…" : "Sign the waiver"}
      </Button>
    </form>
  );
}
