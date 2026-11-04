"use client";

import { useActionState, useEffect, useRef, useState } from "react";
import { createAnnouncement, type AnnouncementState } from "@/app/staff/announcements/actions";
import { Button } from "@/components/ui/button";
import { Field, Input, Select } from "@/components/ui/input";
import { Alert } from "@/components/ui/card";

export function AnnouncementForm({ events }: { events: { id: string; label: string }[] }) {
  const [state, action, pending] = useActionState<AnnouncementState, FormData>(createAnnouncement, {});
  const [offset, setOffset] = useState(0);
  const formRef = useRef<HTMLFormElement>(null);
  const e = state.errors ?? {};

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- the browser's offset is only known after mount
    setOffset(new Date().getTimezoneOffset());
  }, []);
  useEffect(() => {
    if (state.message) formRef.current?.reset();
  }, [state.message]);

  return (
    <form ref={formRef} action={action} className="space-y-4" noValidate>
      <input type="hidden" name="tz_offset_minutes" value={offset} />
      {e.form ? <Alert tone="error">{e.form}</Alert> : null}
      {state.message ? <Alert tone="success">{state.message}</Alert> : null}
      <Field id="a-title" label="Title" error={e.title}>
        {(a) => <Input {...a} name="title" required />}
      </Field>
      <Field id="a-body" label="Message (optional)" hint="Markdown works: **bold**, lists, and links." error={e.body_markdown}>
        {(a) => (
          <textarea
            {...a}
            name="body_markdown"
            rows={5}
            className="block w-full rounded-md border-2 border-input bg-background p-3 text-base focus-visible:outline-none focus-visible:ring-4 focus-visible:ring-ring"
          />
        )}
      </Field>
      <Field id="a-event" label="Event (optional)" hint="Shows the announcement on that event's page too." error={e.event_id}>
        {(a) => (
          <Select {...a} name="event_id" defaultValue="">
            <option value="">Whole series</option>
            {events.map((ev) => (
              <option key={ev.id} value={ev.id}>
                {ev.label}
              </option>
            ))}
          </Select>
        )}
      </Field>
      <Field id="a-priority" label="Priority" hint="Urgent shows as a banner on the home page." error={e.priority}>
        {(a) => (
          <Select {...a} name="priority" defaultValue="normal">
            <option value="normal">Normal</option>
            <option value="urgent">Urgent</option>
          </Select>
        )}
      </Field>
      <Field id="a-publish" label="Publish at (optional)" hint="Leave blank to post now." error={e.publish_at}>
        {(a) => <Input {...a} name="publish_at" type="datetime-local" />}
      </Field>
      <Field id="a-expires" label="Stop showing at (optional)" error={e.expires_at}>
        {(a) => <Input {...a} name="expires_at" type="datetime-local" />}
      </Field>
      <Field id="a-email" label="Email it" error={e.email}>
        {(a) => (
          <Select {...a} name="email" defaultValue="none">
            <option value="none">Don&apos;t email</option>
            <option value="event_registrants">Riders registered for the event</option>
            <option value="season">Everyone registered this season</option>
          </Select>
        )}
      </Field>
      <Button type="submit" size="lg" disabled={pending}>
        {pending ? "Posting…" : "Post announcement"}
      </Button>
    </form>
  );
}
