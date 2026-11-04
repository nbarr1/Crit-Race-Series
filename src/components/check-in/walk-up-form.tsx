"use client";

import { useEffect, useState } from "react";
import { Button } from "@/components/ui/button";
import { Field, Input, Select } from "@/components/ui/input";
import { Alert, Card } from "@/components/ui/card";
import { formatCents } from "@/lib/time";
import type { DeskPaymentMethod } from "@/lib/offline/check-in-queue";

export type WalkUpCategory = { id: string; name: string; walk_up_price_cents: number };
type Found = { rider_id: string; first_name: string; last_name: string; email: string | null; team: string | null; birth_year: number | null };

/** Walk-up registration. Needs a connection (D-073). */
export function WalkUpForm({
  categories,
  online,
  deviceId,
  newId,
  onDone,
  onCancel,
}: {
  categories: WalkUpCategory[];
  online: boolean;
  deviceId: string;
  newId: () => string;
  onDone: (result: { registration_id: string; waiver_signed: boolean }) => void;
  onCancel: () => void;
}) {
  const [query, setQuery] = useState("");
  const [found, setFound] = useState<Found[]>([]);
  const [existing, setExisting] = useState<Found | null>(null);
  const [categoryId, setCategoryId] = useState(categories[0]?.id ?? "");
  const [method, setMethod] = useState<DeskPaymentMethod>("cash");
  const price = categories.find((c) => c.id === categoryId)?.walk_up_price_cents ?? 0;
  const [amount, setAmount] = useState((price / 100).toFixed(2));
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);
  const [opId] = useState(newId);

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- keep the amount in step with the category's price
    setAmount((price / 100).toFixed(2));
  }, [price]);

  useEffect(() => {
    if (!online || query.trim().length < 2 || existing) return;
    const ctrl = new AbortController();
    const t = setTimeout(async () => {
      try {
        const res = await fetch(`/api/staff/riders?q=${encodeURIComponent(query)}`, { signal: ctrl.signal });
        if (res.ok) setFound(((await res.json()) as { riders: Found[] }).riders);
      } catch {
        // Typing again retries.
      }
    }, 250);
    return () => {
      clearTimeout(t);
      ctrl.abort();
    };
  }, [query, online, existing]);

  async function submit(form: FormData) {
    setError(null);
    const v = Object.fromEntries([...form.entries()].map(([k, x]) => [k, String(x).trim()]));
    const cents = method === "comp" ? 0 : Math.round(Number(amount) * 100);
    if (!Number.isFinite(cents) || cents < 0) {
      setError("Enter the amount paid.");
      return;
    }
    setPending(true);
    try {
      const res = await fetch("/api/staff/walk-up", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          op_id: opId,
          device_id: deviceId,
          existing_rider_id: existing?.rider_id ?? null,
          rider: existing
            ? {}
            : {
                first_name: v.first_name,
                last_name: v.last_name,
                email: v.email,
                phone: v.phone,
                birth_date: v.birth_date,
                gender: v.gender,
                team: v.team,
                emergency_contact_name: v.emergency_contact_name,
                emergency_contact_relationship: v.emergency_contact_relationship,
                emergency_contact_phone: v.emergency_contact_phone,
              },
          event_category_id: categoryId,
          payment_method: method,
          amount_cents: cents,
        }),
      });
      const body = (await res.json().catch(() => ({}))) as { ok?: boolean; message?: string; registration_id?: string; waiver_signed?: boolean };
      if (!res.ok || !body.ok || !body.registration_id) {
        setError(body.message ?? "The walk-up didn't save. Check the connection and try again.");
        return;
      }
      onDone({ registration_id: body.registration_id, waiver_signed: Boolean(body.waiver_signed) });
    } catch {
      setError("No connection. Walk-up registration needs a signal. Try again in a moment, or take details on paper.");
    } finally {
      setPending(false);
    }
  }

  if (!online) {
    return (
      <div className="space-y-3">
        <Alert tone="error">Walk-up registration needs a connection. Take the rider&apos;s details on paper and enter them when the signal returns.</Alert>
        <Button type="button" variant="secondary" onClick={onCancel}>
          Back
        </Button>
      </div>
    );
  }

  return (
    <form action={submit} className="space-y-4" noValidate>
      <h2 className="text-2xl font-bold">Walk-up registration</h2>
      {error ? <Alert tone="error">{error}</Alert> : null}

      {existing ? (
        <Card className="space-y-2">
          <p className="font-bold">
            {existing.first_name} {existing.last_name}
          </p>
          <p className="text-sm">{[existing.email, existing.team].filter(Boolean).join(" · ")}</p>
          <Button type="button" variant="link" onClick={() => setExisting(null)}>
            Choose someone else
          </Button>
        </Card>
      ) : (
        <>
          <Field id="wu-find" label="Find an existing rider" hint="Search by name or email. If they're new, fill in the form.">
            {(a) => <Input {...a} value={query} onChange={(e) => setQuery(e.target.value)} type="search" autoComplete="off" />}
          </Field>
          {found.length > 0 && query.trim().length >= 2 ? (
            <ul className="space-y-1" aria-label="Matching riders">
              {found.map((f) => (
                <li key={f.rider_id}>
                  <button
                    type="button"
                    className="min-h-11 w-full rounded-md border-2 border-border px-3 text-left hover:bg-muted"
                    onClick={() => setExisting(f)}
                  >
                    <span className="font-semibold">
                      {f.first_name} {f.last_name}
                    </span>{" "}
                    <span className="text-sm text-muted-foreground">{[f.email, f.team, f.birth_year].filter(Boolean).join(" · ")}</span>
                  </button>
                </li>
              ))}
            </ul>
          ) : null}
          <fieldset className="space-y-3">
            <legend className="text-lg font-bold">New rider</legend>
            <Field id="wu-first" label="First name">{(a) => <Input {...a} name="first_name" autoComplete="off" />}</Field>
            <Field id="wu-last" label="Last name">{(a) => <Input {...a} name="last_name" autoComplete="off" />}</Field>
            <Field id="wu-birth" label="Birth date">{(a) => <Input {...a} name="birth_date" type="date" />}</Field>
            <Field id="wu-email" label="Email (optional)" hint="Lets the rider sign in later and see this registration.">
              {(a) => <Input {...a} name="email" type="email" autoComplete="off" />}
            </Field>
            <Field id="wu-phone" label="Phone (optional)">{(a) => <Input {...a} name="phone" type="tel" autoComplete="off" />}</Field>
            <Field id="wu-gender" label="Gender (optional)">
              {(a) => (
                <Select {...a} name="gender" defaultValue="">
                  <option value="">Not specified</option>
                  <option value="woman">Woman</option>
                  <option value="man">Man</option>
                  <option value="non_binary">Non-binary</option>
                  <option value="prefer_not_to_say">Prefer not to say</option>
                </Select>
              )}
            </Field>
            <Field id="wu-team" label="Team (optional)">{(a) => <Input {...a} name="team" autoComplete="off" />}</Field>
            <Field id="wu-ec" label="Emergency contact name">{(a) => <Input {...a} name="emergency_contact_name" autoComplete="off" />}</Field>
            <Field id="wu-ecr" label="Relationship (optional)">{(a) => <Input {...a} name="emergency_contact_relationship" autoComplete="off" />}</Field>
            <Field id="wu-ecp" label="Emergency contact phone">{(a) => <Input {...a} name="emergency_contact_phone" type="tel" autoComplete="off" />}</Field>
          </fieldset>
        </>
      )}

      <Field id="wu-cat" label="Category">
        {(a) => (
          <Select {...a} value={categoryId} onChange={(e) => setCategoryId(e.target.value)}>
            {categories.map((c) => (
              <option key={c.id} value={c.id}>
                {c.name} ({formatCents(c.walk_up_price_cents)})
              </option>
            ))}
          </Select>
        )}
      </Field>
      <Field id="wu-method" label="Payment method">
        {(a) => (
          <Select {...a} value={method} onChange={(e) => setMethod(e.target.value as DeskPaymentMethod)}>
            <option value="cash">Cash</option>
            <option value="card_at_desk">Card at the desk</option>
            <option value="stripe_link">Stripe payment link</option>
            <option value="comp">Comp (free)</option>
          </Select>
        )}
      </Field>
      {method !== "comp" ? (
        <Field id="wu-amount" label="Amount in dollars">
          {(a) => <Input {...a} inputMode="decimal" value={amount} onChange={(e) => setAmount(e.target.value)} />}
        </Field>
      ) : null}
      <div className="flex flex-wrap gap-2">
        <Button type="submit" size="lg" disabled={pending || !categoryId}>
          {pending ? "Saving…" : "Register the rider"}
        </Button>
        <Button type="button" variant="secondary" size="lg" onClick={onCancel}>
          Cancel
        </Button>
      </div>
    </form>
  );
}
