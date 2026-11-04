"use client";

import { useActionState } from "react";
import { saveEventNotes, uploadCourseFile, type EventInfoState } from "@/app/staff/events/[id]/actions";
import { Button } from "@/components/ui/button";
import { Field, Input } from "@/components/ui/input";
import { Alert } from "@/components/ui/card";

const textarea =
  "block w-full rounded-md border-2 border-input bg-background p-3 text-base focus-visible:outline-none focus-visible:ring-4 focus-visible:ring-ring";

export function EventNotesForm({ eventId, override, notes }: { eventId: string; override: string; notes: string }) {
  const [state, action, pending] = useActionState<EventInfoState, FormData>(saveEventNotes, {});
  return (
    <form action={action} className="space-y-3">
      <input type="hidden" name="event_id" value={eventId} />
      {state.error ? <Alert tone="error">{state.error}</Alert> : null}
      {state.message ? <Alert tone="success">{state.message}</Alert> : null}
      <Field id="override" label="Weather and course note" hint="Shown above the forecast. For example, course is wet in turn 3.">
        {(a) => <textarea {...a} name="weather_override_text" rows={2} defaultValue={override} className={textarea} />}
      </Field>
      <Field id="notes" label="Event notes" hint="Shown on the event page.">
        {(a) => <textarea {...a} name="notes" rows={4} defaultValue={notes} className={textarea} />}
      </Field>
      <Button type="submit" disabled={pending}>
        {pending ? "Saving…" : "Save"}
      </Button>
    </form>
  );
}

export function UploadForm({ eventId, kind }: { eventId: string; kind: "course_map" | "gpx" }) {
  const [state, action, pending] = useActionState<EventInfoState, FormData>(uploadCourseFile, {});
  const label = kind === "gpx" ? "GPX file" : "Course map (PNG, JPEG, WebP, or PDF)";
  return (
    <form action={action} className="space-y-3">
      <input type="hidden" name="event_id" value={eventId} />
      <input type="hidden" name="kind" value={kind} />
      {state.error ? <Alert tone="error">{state.error}</Alert> : null}
      {state.message ? <Alert tone="success">{state.message}</Alert> : null}
      <Field id={`file-${kind}`} label={label}>
        {(a) => (
          <input
            {...a}
            name="file"
            type="file"
            accept={kind === "gpx" ? ".gpx,application/gpx+xml" : "image/png,image/jpeg,image/webp,application/pdf"}
            className="block min-h-11 w-full text-base"
            required
          />
        )}
      </Field>
      <Field id={`caption-${kind}`} label="Caption (optional)" hint={kind === "gpx" ? "For example, 1.1 km loop." : "Describes the map for screen readers."}>
        {(a) => <Input {...a} name="caption" />}
      </Field>
      <Button type="submit" disabled={pending}>
        {pending ? "Uploading…" : kind === "gpx" ? "Add GPX file" : "Upload course map"}
      </Button>
    </form>
  );
}
