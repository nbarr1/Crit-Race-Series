"use client";

import { useActionState, useId, useRef, useState } from "react";
import { saveEvent } from "@/app/admin/events/actions";
import type { AdminState } from "@/lib/admin/errors";
import { Button } from "@/components/ui/button";
import { Alert } from "@/components/ui/card";
import { Field, Input, Select } from "@/components/ui/input";
import { textareaClass } from "@/components/admin/fields";

export type CategoryRow = {
  id?: string;
  category_id: string;
  start_time: string;
  duration_minutes: string;
  laps: string;
  capacity: string;
  price: string;
  walk_up_price: string;
  /** Riders registered, so the row can't be removed. */
  registered?: number;
};

export type EventFormValues = {
  id?: string;
  season_id: string;
  venue_id: string;
  name: string;
  event_date: string;
  registration_opens_at: string;
  registration_closes_at: string;
  status: "draft" | "published" | "canceled" | "completed";
  notes: string;
  categories: CategoryRow[];
};

type Option = { id: string; name: string };

const STATUS_HINTS: Record<EventFormValues["status"], string> = {
  draft: "Only staff can see a draft.",
  published: "Riders see the event on the schedule, and can register during the registration window.",
  canceled: "Shown as canceled. Registrations stay on file, and refunds are by hand.",
  completed: "Shown as finished.",
};

/** Shifts a YYYY-MM-DD date by whole days. */
function addDays(date: string, days: number): string {
  const d = new Date(`${date}T12:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

export function EventForm({
  values,
  seasons,
  venues,
  categories,
  blankRow,
}: {
  values: EventFormValues;
  seasons: Option[];
  venues: Option[];
  categories: Option[];
  blankRow: Omit<CategoryRow, "category_id">;
}) {
  const [state, action, pending] = useActionState<AdminState, FormData>(saveEvent, {});
  const [rows, setRows] = useState<(CategoryRow & { key: string })[]>(() =>
    values.categories.map((c, i) => ({ ...c, key: c.id ?? `row-${i}` })),
  );
  const [status, setStatus] = useState(values.status);
  const opensRef = useRef<HTMLInputElement>(null);
  const closesRef = useRef<HTMLInputElement>(null);
  const uid = useId();
  const isNew = !values.id;

  const update = (key: string, patch: Partial<CategoryRow>) =>
    setRows((rs) => rs.map((r) => (r.key === key ? { ...r, ...patch } : r)));
  const unused = categories.filter((c) => !rows.some((r) => r.category_id === c.id));

  // On a new event, picking the date fills in a registration window (opens
  // 30 days before at 9:00 AM, closes at noon on race day) unless one is set.
  const onDate = (date: string) => {
    if (!isNew || !/^\d{4}-\d{2}-\d{2}$/.test(date)) return;
    if (opensRef.current && !opensRef.current.value) opensRef.current.value = `${addDays(date, -30)}T09:00`;
    if (closesRef.current && !closesRef.current.value) closesRef.current.value = `${date}T12:00`;
  };

  const payload = JSON.stringify(
    rows.map((r) => ({
      id: r.id,
      category_id: r.category_id,
      start_time: r.start_time,
      duration_minutes: r.duration_minutes,
      laps: r.laps,
      capacity: r.capacity,
      price: r.price,
      walk_up_price: r.walk_up_price,
    })),
  );

  return (
    <form action={action} className="space-y-6">
      {state.error ? <Alert tone="error">{state.error}</Alert> : null}
      {state.message ? <Alert tone="success">{state.message}</Alert> : null}
      <input type="hidden" name="id" value={values.id ?? ""} />
      <input type="hidden" name="categories" value={payload} />

      <fieldset className="space-y-3">
        <legend className="mb-2 text-2xl font-bold">Event</legend>
        <Field id="ev-name" label="Name" hint="For example, Race 4.">
          {(a) => <Input {...a} name="name" defaultValue={values.name} required minLength={2} maxLength={120} />}
        </Field>
        <Field id="ev-date" label="Date">
          {(a) => <Input {...a} name="event_date" type="date" defaultValue={values.event_date} required onChange={(e) => onDate(e.target.value)} />}
        </Field>
        <Field id="ev-opens" label="Registration opens (Eastern Time)">
          {(a) => <Input {...a} ref={opensRef} name="registration_opens_at" type="datetime-local" defaultValue={values.registration_opens_at} required />}
        </Field>
        <Field id="ev-closes" label="Online registration closes (Eastern Time)" hint="After this, riders register as walk-ups at the desk.">
          {(a) => <Input {...a} ref={closesRef} name="registration_closes_at" type="datetime-local" defaultValue={values.registration_closes_at} required />}
        </Field>
        <Field id="ev-status" label="Status" hint={STATUS_HINTS[status]}>
          {(a) => (
            <Select {...a} name="status" value={status} onChange={(e) => setStatus(e.target.value as EventFormValues["status"])}>
              <option value="draft">Draft</option>
              <option value="published">Published</option>
              <option value="canceled">Canceled</option>
              <option value="completed">Completed</option>
            </Select>
          )}
        </Field>
        <Field id="ev-season" label="Season">
          {(a) => (
            <Select {...a} name="season_id" defaultValue={values.season_id} required>
              {seasons.map((s) => (
                <option key={s.id} value={s.id}>
                  {s.name}
                </option>
              ))}
            </Select>
          )}
        </Field>
        <Field id="ev-venue" label="Venue">
          {(a) => (
            <Select {...a} name="venue_id" defaultValue={values.venue_id} required>
              {venues.map((v) => (
                <option key={v.id} value={v.id}>
                  {v.name}
                </option>
              ))}
            </Select>
          )}
        </Field>
        <Field id="ev-notes" label="Event notes (optional)" hint="Shown on the event page. Staff can also edit these.">
          {(a) => <textarea {...a} name="notes" rows={3} defaultValue={values.notes} maxLength={5000} className={textareaClass} />}
        </Field>
      </fieldset>

      <fieldset className="space-y-3">
        <legend className="mb-2 text-2xl font-bold">Categories, start times, and prices</legend>
        <p className="text-sm text-muted-foreground">
          Times are Eastern Time on the event date. Prices are in dollars. Use 0 for a free race. To close a category without removing it, set its capacity to 0.
        </p>
        {rows.length === 0 ? <p>No categories yet. Add one below.</p> : null}
        <ul className="space-y-3">
          {rows.map((r, i) => {
            const name = categories.find((c) => c.id === r.category_id)?.name ?? "Category";
            const p = `${uid}-${r.key}`;
            return (
              <li key={r.key}>
                <fieldset className="space-y-3 rounded-lg border-2 border-border p-3">
                  <legend className="px-1 text-lg font-bold">{name}</legend>
                  <Field id={`${p}-cat`} label="Category">
                    {(a) => (
                      <Select
                        {...a}
                        value={r.category_id}
                        onChange={(e) => update(r.key, { category_id: e.target.value })}
                        disabled={Boolean(r.registered)}
                      >
                        {categories
                          .filter((c) => c.id === r.category_id || !rows.some((o) => o.category_id === c.id))
                          .map((c) => (
                            <option key={c.id} value={c.id}>
                              {c.name}
                            </option>
                          ))}
                      </Select>
                    )}
                  </Field>
                  <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
                    <Field id={`${p}-start`} label="Start time">
                      {(a) => <Input {...a} type="time" value={r.start_time} onChange={(e) => update(r.key, { start_time: e.target.value })} required />}
                    </Field>
                    <Field id={`${p}-dur`} label="Minutes">
                      {(a) => (
                        <Input {...a} type="number" inputMode="numeric" min={1} max={600} value={r.duration_minutes} onChange={(e) => update(r.key, { duration_minutes: e.target.value })} required />
                      )}
                    </Field>
                    <Field id={`${p}-laps`} label="Laps (optional)">
                      {(a) => <Input {...a} type="number" inputMode="numeric" min={1} max={500} value={r.laps} onChange={(e) => update(r.key, { laps: e.target.value })} />}
                    </Field>
                    <Field id={`${p}-cap`} label="Capacity">
                      {(a) => (
                        <Input {...a} type="number" inputMode="numeric" min={0} max={1000} value={r.capacity} onChange={(e) => update(r.key, { capacity: e.target.value })} required />
                      )}
                    </Field>
                    <Field id={`${p}-price`} label="Online price ($)">
                      {(a) => <Input {...a} inputMode="decimal" value={r.price} onChange={(e) => update(r.key, { price: e.target.value })} required />}
                    </Field>
                    <Field id={`${p}-walk`} label="Walk-up price ($)">
                      {(a) => <Input {...a} inputMode="decimal" value={r.walk_up_price} onChange={(e) => update(r.key, { walk_up_price: e.target.value })} required />}
                    </Field>
                  </div>
                  {r.registered ? (
                    <p className="text-sm">
                      {r.registered} registered, so this category can&apos;t be removed or changed to another category.
                    </p>
                  ) : (
                    <Button type="button" variant="secondary" size="sm" onClick={() => setRows((rs) => rs.filter((x) => x.key !== r.key))}>
                      Remove {name}
                      <span className="sr-only"> (row {i + 1})</span>
                    </Button>
                  )}
                </fieldset>
              </li>
            );
          })}
        </ul>
        {unused.length ? (
          <Button
            type="button"
            variant="secondary"
            onClick={() => setRows((rs) => [...rs, { ...blankRow, category_id: unused[0].id, key: `new-${Date.now()}` }])}
          >
            Add a category
          </Button>
        ) : null}
      </fieldset>

      <Button type="submit" size="lg" disabled={pending}>
        {pending ? "Saving…" : isNew ? "Create event" : "Save event"}
      </Button>
    </form>
  );
}
