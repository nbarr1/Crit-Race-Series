"use client";

import { useState } from "react";
import Markdown from "react-markdown";
import { normalizeName } from "@/lib/validation/waiver";
import { Button } from "@/components/ui/button";
import { Field, Input } from "@/components/ui/input";
import type { RosterRow, RosterSnapshot } from "@/lib/offline/check-in-queue";

export type HandoffSignature = {
  typed_full_name: string;
  guardian_name?: string;
  guardian_relationship?: string;
  guardian_typed_signature?: string;
};

/**
 * "Hand to rider" mode: a full-screen waiver form with nothing else on it.
 * Works offline from the cached waiver text; the signature is queued.
 */
export function WaiverHandoff({
  rider,
  waiver,
  onSigned,
  onCancel,
}: {
  rider: RosterRow;
  waiver: NonNullable<RosterSnapshot["waiver"]>;
  onSigned: (sig: HandoffSignature) => void;
  onCancel: () => void;
}) {
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [done, setDone] = useState(false);
  const fullName = `${rider.first_name} ${rider.last_name}`;

  function submit(form: FormData) {
    const v = Object.fromEntries([...form.entries()].map(([k, x]) => [k, String(x).trim()]));
    const e: Record<string, string> = {};
    if (v.agree !== "on") e.agree = "Check the box to agree to the waiver.";
    if (normalizeName(v.typed_full_name ?? "") !== normalizeName(fullName)) e.typed_full_name = `Type your full name: ${fullName}.`;
    if (rider.is_minor) {
      if (!v.guardian_name) e.guardian_name = "Enter the parent or guardian's full name.";
      if (!v.guardian_relationship) e.guardian_relationship = "Enter the relationship to the rider.";
      if (!v.guardian_typed_signature || normalizeName(v.guardian_typed_signature) !== normalizeName(v.guardian_name ?? ""))
        e.guardian_typed_signature = "The parent or guardian types their full name, matching the name entered.";
      if (v.guardian_agree !== "on") e.guardian_agree = "The parent or guardian must check the box to agree.";
    }
    setErrors(e);
    if (Object.keys(e).length) return;
    onSigned({
      typed_full_name: v.typed_full_name,
      ...(rider.is_minor
        ? { guardian_name: v.guardian_name, guardian_relationship: v.guardian_relationship, guardian_typed_signature: v.guardian_typed_signature }
        : {}),
    });
    setDone(true);
  }

  return (
    <div className="fixed inset-0 z-50 overflow-y-auto bg-background" role="dialog" aria-modal="true" aria-labelledby="handoff-title">
      <div className="mx-auto max-w-2xl space-y-5 px-4 py-6">
        {done ? (
          <div className="space-y-4 py-12 text-center">
            <h2 id="handoff-title" className="text-3xl font-bold">
              Thanks, {rider.first_name}. You&apos;re signed.
            </h2>
            <p className="text-lg">Hand the device back to the staff member.</p>
            <Button type="button" size="lg" onClick={onCancel}>
              Staff: return to check-in
            </Button>
          </div>
        ) : (
          <>
            <h2 id="handoff-title" className="text-2xl font-bold">
              {waiver.title}
            </h2>
            <p className="text-muted-foreground">Version {waiver.version_number} · Signing as {fullName}</p>
            <div className="space-y-3 rounded-lg border-2 border-border bg-muted/40 p-4 leading-relaxed [&_li]:ml-5 [&_ol]:list-decimal [&_ol]:space-y-2 [&_strong]:font-bold [&_ul]:list-disc">
              <Markdown>{waiver.body_markdown}</Markdown>
            </div>
            <form action={submit} className="space-y-5" noValidate>
              <div className="space-y-1">
                <div className="flex items-start gap-3">
                  <input id="h-agree" name="agree" type="checkbox" className="mt-1 size-7 shrink-0 accent-primary" />
                  <label htmlFor="h-agree" className="text-lg font-semibold">
                    I have read and agree to this waiver.
                  </label>
                </div>
                {errors.agree ? <p className="font-semibold text-destructive">{errors.agree}</p> : null}
              </div>
              <Field id="h-name" label="Type your full name to sign" error={errors.typed_full_name}>
                {(a) => <Input {...a} name="typed_full_name" autoComplete="off" className="text-lg" />}
              </Field>
              {rider.is_minor ? (
                <fieldset className="space-y-4 rounded-lg border-2 border-warning p-4">
                  <legend className="px-1 text-lg font-bold">Parent or guardian</legend>
                  <p>The rider is under 18, so a parent or legal guardian must also sign.</p>
                  <Field id="h-gname" label="Parent or guardian's full name" error={errors.guardian_name}>
                    {(a) => <Input {...a} name="guardian_name" autoComplete="off" />}
                  </Field>
                  <Field id="h-grel" label="Relationship to the rider" error={errors.guardian_relationship}>
                    {(a) => <Input {...a} name="guardian_relationship" autoComplete="off" />}
                  </Field>
                  <div className="space-y-1">
                    <div className="flex items-start gap-3">
                      <input id="h-gagree" name="guardian_agree" type="checkbox" className="mt-1 size-7 shrink-0 accent-primary" />
                      <label htmlFor="h-gagree" className="font-semibold">
                        As the rider&apos;s parent or guardian, I have read and agree to this waiver on the rider&apos;s behalf and my own.
                      </label>
                    </div>
                    {errors.guardian_agree ? <p className="font-semibold text-destructive">{errors.guardian_agree}</p> : null}
                  </div>
                  <Field id="h-gsig" label="Parent or guardian: type your full name to sign" error={errors.guardian_typed_signature}>
                    {(a) => <Input {...a} name="guardian_typed_signature" autoComplete="off" />}
                  </Field>
                </fieldset>
              ) : null}
              <Button type="submit" size="lg" className="w-full">
                Sign the waiver
              </Button>
            </form>
            <Button type="button" variant="link" onClick={onCancel}>
              Staff: exit without signing
            </Button>
          </>
        )}
      </div>
    </div>
  );
}
