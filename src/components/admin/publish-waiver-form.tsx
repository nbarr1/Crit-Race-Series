"use client";

import { useActionState } from "react";
import { publishWaiver, type PublishState } from "@/app/admin/waivers/actions";
import { Button } from "@/components/ui/button";
import { Field, Input } from "@/components/ui/input";
import { Alert } from "@/components/ui/card";

export function PublishWaiverForm({
  seasonId,
  defaults,
}: {
  seasonId: string;
  defaults: { title: string; body: string; externalUrl: string };
}) {
  const [state, action, pending] = useActionState<PublishState, FormData>(publishWaiver, {});
  const e = state.errors ?? {};
  return (
    <form action={action} className="space-y-4" noValidate>
      <input type="hidden" name="season_id" value={seasonId} />
      {e.form ? <Alert tone="error">{e.form}</Alert> : null}
      {state.published ? <Alert tone="success">Published version {state.published}. Riders sign it at their next registration or check-in.</Alert> : null}
      <Field id="title" label="Title" error={e.title}>
        {(a) => <Input {...a} name="title" defaultValue={defaults.title} required />}
      </Field>
      <Field id="body_markdown" label="Waiver text (Markdown)" hint="Use **bold**, numbered lists (1. ), and blank lines between paragraphs." error={e.body_markdown}>
        {(a) => (
          <textarea
            {...a}
            name="body_markdown"
            rows={18}
            defaultValue={defaults.body}
            className="block w-full rounded-md border-2 border-input bg-background p-3 font-mono text-sm focus-visible:outline-none focus-visible:ring-4 focus-visible:ring-ring"
            required
          />
        )}
      </Field>
      <Field id="effective_date" label="Effective date" error={e.effective_date}>
        {(a) => <Input {...a} name="effective_date" type="date" defaultValue={new Date().toISOString().slice(0, 10)} required />}
      </Field>
      <Field
        id="external_waiver_url"
        label="External waiver link (optional)"
        hint="For example, a sanctioning body's waiver. Riders see the link next to the series waiver."
        error={e.external_waiver_url}
      >
        {(a) => <Input {...a} name="external_waiver_url" type="url" defaultValue={defaults.externalUrl} />}
      </Field>
      <div className="space-y-1">
        <div className="flex items-start gap-3">
          <input id="confirm" name="confirm" type="checkbox" className="mt-1 size-6 shrink-0 accent-primary" />
          <label htmlFor="confirm" className="font-semibold">
            Publish as a new version. Every rider will need to sign it again. The current version stays on file unchanged.
          </label>
        </div>
        {e.confirm ? <p className="text-sm font-semibold text-destructive">{e.confirm}</p> : null}
      </div>
      <Button type="submit" size="lg" disabled={pending}>
        {pending ? "Publishing…" : "Publish new version"}
      </Button>
    </form>
  );
}
