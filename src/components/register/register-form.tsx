"use client";

import { useActionState, useMemo, useState } from "react";
import { register, type RegisterState } from "@/app/register/actions";
import { Button } from "@/components/ui/button";
import { Alert, Badge, Card } from "@/components/ui/card";
import { formatCents, formatDateTime, formatEventDate, formatTime } from "@/lib/time";
import type { OpenRace } from "@/lib/data";

export function RegisterForm({
  races,
  initialSelected,
  alreadyRegistered,
  paymentsEnabled,
}: {
  races: OpenRace[];
  initialSelected: string[];
  alreadyRegistered: string[];
  paymentsEnabled: boolean;
}) {
  const [state, action, pending] = useActionState<RegisterState, FormData>(register, {});
  const [selected, setSelected] = useState<Set<string>>(() => new Set(initialSelected));
  const registered = useMemo(() => new Set(alreadyRegistered), [alreadyRegistered]);

  const byId = useMemo(() => {
    const m = new Map<string, { label: string; price: number; full: boolean }>();
    for (const r of races)
      for (const c of r.categories)
        m.set(c.id, { label: `${r.event.name}: ${c.categories.name}`, price: c.price_cents, full: c.spots_left <= 0 });
    return m;
  }, [races]);

  const chosen = [...selected].filter((id) => byId.has(id));
  const total = chosen.reduce((sum, id) => sum + (byId.get(id)!.full ? 0 : byId.get(id)!.price), 0);
  const warnings = state.warnings ?? [];

  const toggle = (id: string) =>
    setSelected((s) => {
      const next = new Set(s);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });

  return (
    <form action={action} className="space-y-5">
      {state.error ? <Alert tone="error">{state.error}</Alert> : null}

      {races.map(({ event, categories }) => (
        <fieldset key={event.id} className="space-y-2">
          <legend className="text-xl font-bold">
            {event.name} · {formatEventDate(event.event_date, "short")}
          </legend>
          <p className="text-sm text-muted-foreground">Online registration closes {formatDateTime(event.registration_closes_at)}.</p>
          <ul className="space-y-2">
            {categories.map((c) => {
              const id = `ec-${c.id}`;
              const isRegistered = registered.has(c.id);
              return (
                <li key={c.id}>
                  <Card className="flex items-start gap-3 p-3">
                    <input
                      id={id}
                      type="checkbox"
                      name="event_category_id"
                      value={c.id}
                      checked={selected.has(c.id) && !isRegistered}
                      disabled={isRegistered}
                      onChange={() => toggle(c.id)}
                      className="mt-1 size-6 shrink-0 accent-primary"
                    />
                    <label htmlFor={id} className="flex-1 space-y-0.5">
                      <span className="block text-lg font-bold">{c.categories.name}</span>
                      <span className="block">
                        Starts {formatTime(c.start_at)} · {paymentsEnabled && c.price_cents > 0 ? formatCents(c.price_cents) : "Pay at the desk"}
                      </span>
                      <span className="flex flex-wrap gap-2 pt-1">
                        {isRegistered ? (
                          <Badge tone="success">You&apos;re registered</Badge>
                        ) : c.spots_left > 0 ? (
                          <Badge>{c.spots_left} spots left</Badge>
                        ) : (
                          <Badge tone="warning">Full: join the waitlist</Badge>
                        )}
                      </span>
                    </label>
                  </Card>
                </li>
              );
            })}
          </ul>
        </fieldset>
      ))}

      {warnings.length > 0 ? (
        <Alert tone="error">
          <p className="mb-2 font-semibold">Read these eligibility notes before you continue.</p>
          <ul className="list-disc space-y-1 pl-5">
            {warnings.map((w) =>
              w.messages.map((m, i) => (
                <li key={`${w.eventCategoryId}-${i}`}>
                  <span className="font-semibold">{byId.get(w.eventCategoryId)?.label}:</span> {m}
                </li>
              )),
            )}
          </ul>
          <div className="mt-3 flex items-start gap-3">
            <input id="acknowledge" name="acknowledge" type="checkbox" className="mt-1 size-6 shrink-0 accent-primary" required />
            <label htmlFor="acknowledge" className="font-semibold">
              I understand. Register me anyway, and staff will confirm my category at check-in.
            </label>
          </div>
        </Alert>
      ) : null}

      <div className="sticky bottom-0 -mx-4 space-y-2 border-t-2 border-border bg-background px-4 py-3">
        <p className="text-lg font-semibold" aria-live="polite">
          {chosen.length === 0
            ? "Pick one or more races."
            : `${chosen.length} ${chosen.length === 1 ? "race" : "races"}${paymentsEnabled && total > 0 ? ` · ${formatCents(total)} due now` : ""}`}
        </p>
        <Button type="submit" size="lg" className="w-full" disabled={pending || chosen.length === 0}>
          {pending ? "Working…" : paymentsEnabled && total > 0 ? "Continue to payment" : "Register"}
        </Button>
        <p className="text-sm text-muted-foreground">Waitlisted races aren&apos;t charged until a spot opens.</p>
      </div>
    </form>
  );
}
