"use client";

import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Field, Input, Select } from "@/components/ui/input";
import { Alert, Badge } from "@/components/ui/card";
import { describeWarning } from "@/lib/messages";
import { formatCents, formatTime } from "@/lib/time";
import { bibInUse, isPaid, suggestBib, type DeskPaymentMethod, type RosterRow } from "@/lib/offline/check-in-queue";
import type { NewOp } from "./use-check-in";

const METHODS: { value: DeskPaymentMethod; label: string }[] = [
  { value: "cash", label: "Cash" },
  { value: "card_at_desk", label: "Card at the desk" },
  { value: "stripe_link", label: "Stripe payment link" },
  { value: "comp", label: "Comp (free)" },
];

export function RiderPanel({
  row,
  rows,
  online,
  hasWaiver,
  enqueue,
  onHandToRider,
  onUndo,
  onClose,
}: {
  row: RosterRow;
  rows: RosterRow[];
  online: boolean;
  hasWaiver: boolean;
  enqueue: (op: NewOp) => void;
  onHandToRider: () => void;
  onUndo: () => Promise<string | null>;
  onClose: () => void;
}) {
  const [bib, setBib] = useState(String(row.bib_number ?? suggestBib(rows)));
  const [method, setMethod] = useState<DeskPaymentMethod>("cash");
  const defaultAmount = row.source === "online" && row.status === "pending_payment" ? row.price_cents : row.walk_up_price_cents;
  const [amount, setAmount] = useState((defaultAmount / 100).toFixed(2));
  const [reason, setReason] = useState("");
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const paid = isPaid(row);
  const needsPayment = !paid;
  const warnings = row.eligibility_warnings.filter(Boolean);
  const bibNumber = Number(bib);
  const bibValid = Number.isInteger(bibNumber) && bibNumber >= 1 && bibNumber <= 99999;
  const clash = bibValid ? bibInUse(rows, bibNumber, row.registration_id) : undefined;
  const canCheckIn = row.status === "confirmed" && row.waiver_signed && bibValid && !clash;

  function checkIn() {
    setError(null);
    if (!canCheckIn) return;
    enqueue({ type: "check_in", registration_id: row.registration_id, bib: bibNumber, checked_in_at: new Date().toISOString() });
    setMessage(`Checked in with bib ${bibNumber}.`);
  }

  function recordPayment() {
    setError(null);
    const cents = method === "comp" ? 0 : Math.round(Number(amount) * 100);
    if (!Number.isFinite(cents) || cents < 0 || cents > 100_000) {
      setError("Enter an amount between $0 and $1,000.");
      return;
    }
    enqueue({ type: "record_payment", registration_id: row.registration_id, payment_method: method, amount_cents: cents });
    setMessage(method === "comp" ? "Recorded as a comp." : `Recorded ${formatCents(cents)} (${METHODS.find((m) => m.value === method)?.label}).`);
  }

  function override() {
    setError(null);
    if (!reason.trim()) {
      setError("Enter a reason for the override.");
      return;
    }
    enqueue({ type: "override_eligibility", registration_id: row.registration_id, reason: reason.trim() });
    setMessage("Override recorded.");
  }

  return (
    <div className="space-y-4">
      <div>
        <h2 className="text-2xl font-bold">
          {row.first_name} {row.last_name}
        </h2>
        <p className="text-lg">
          {row.category_name}
          {row.team ? ` · ${row.team}` : ""}
        </p>
        <div className="mt-2 flex flex-wrap gap-2">
          <Badge tone={paid ? "success" : "danger"}>{paid ? "Paid" : "Not paid"}</Badge>
          <Badge tone={row.waiver_signed ? "success" : "danger"}>{row.waiver_signed ? "Waiver signed" : "Waiver needed"}</Badge>
          <Badge tone={row.has_license ? "success" : "neutral"}>{row.has_license ? "License on file" : "No license"}</Badge>
          {row.is_minor ? <Badge tone="warning">Under 18</Badge> : null}
          {row.status === "waitlisted" ? <Badge tone="warning">Waitlist #{row.waitlist_position}</Badge> : null}
          {row.checked_in_at ? <Badge tone="success">Checked in {formatTime(row.checked_in_at)}</Badge> : null}
        </div>
      </div>

      {message ? <Alert tone="success">{message}</Alert> : null}
      {error ? <Alert tone="error">{error}</Alert> : null}

      {warnings.length > 0 && !row.eligibility_overridden ? (
        <section className="space-y-2 rounded-lg border-2 border-warning p-3" aria-labelledby="elig-h">
          <h3 id="elig-h" className="font-bold">
            Eligibility to check
          </h3>
          <ul className="list-disc pl-5">
            {warnings.map((w) => (
              <li key={w}>{describeWarning(w)}</li>
            ))}
          </ul>
          <Field id="reason" label="Override reason" hint="For example, checked license: age 41.">
            {(a) => <Input {...a} value={reason} onChange={(e) => setReason(e.target.value)} />}
          </Field>
          <Button type="button" variant="secondary" onClick={override}>
            Record override
          </Button>
        </section>
      ) : null}

      {needsPayment ? (
        <section className="space-y-2 rounded-lg border-2 border-border p-3" aria-labelledby="pay-h">
          <h3 id="pay-h" className="font-bold">
            Payment at the desk
          </h3>
          <Field id="method" label="Payment method">
            {(a) => (
              <Select {...a} value={method} onChange={(e) => setMethod(e.target.value as DeskPaymentMethod)}>
                {METHODS.map((m) => (
                  <option key={m.value} value={m.value}>
                    {m.label}
                  </option>
                ))}
              </Select>
            )}
          </Field>
          {method !== "comp" ? (
            <Field id="amount" label="Amount in dollars">
              {(a) => <Input {...a} inputMode="decimal" value={amount} onChange={(e) => setAmount(e.target.value)} />}
            </Field>
          ) : null}
          <Button type="button" onClick={recordPayment}>
            Record payment
          </Button>
        </section>
      ) : null}

      {!row.waiver_signed ? (
        <section className="space-y-2 rounded-lg border-2 border-border p-3" aria-labelledby="waiver-h">
          <h3 id="waiver-h" className="font-bold">
            Waiver
          </h3>
          {hasWaiver ? (
            <>
              <p>The rider signs on this device. Hand it to them.</p>
              <Button type="button" onClick={onHandToRider}>
                Hand to rider to sign
              </Button>
            </>
          ) : (
            <p>No waiver text on this device. Reconnect and refresh the roster.</p>
          )}
        </section>
      ) : null}

      <section className="space-y-2 rounded-lg border-2 border-primary p-3" aria-labelledby="ci-h">
        <h3 id="ci-h" className="font-bold">
          {row.checked_in_at ? "Checked in" : "Check in"}
        </h3>
        <Field
          id="bib"
          label="Bib number"
          hint={row.bib_number ? "This rider's assigned bib." : "Suggested: the next free number."}
          error={clash ? `Bib ${bibNumber} belongs to ${clash.first_name} ${clash.last_name}.` : undefined}
        >
          {(a) => (
            <Input
              {...a}
              inputMode="numeric"
              pattern="[0-9]*"
              value={bib}
              onChange={(e) => setBib(e.target.value.replace(/\D/g, ""))}
              className="text-2xl font-bold"
            />
          )}
        </Field>
        {!row.checked_in_at ? (
          <>
            <Button type="button" size="lg" className="w-full" disabled={!canCheckIn} onClick={checkIn}>
              Check in
            </Button>
            {row.status !== "confirmed" ? <p className="text-sm">Record the payment first.</p> : null}
            {row.status === "confirmed" && !row.waiver_signed ? <p className="text-sm">The rider must sign the waiver first.</p> : null}
          </>
        ) : (
          <Button
            type="button"
            variant="secondary"
            disabled={!online}
            onClick={async () => {
              setError(null);
              const err = await onUndo();
              if (err) setError(err);
              else setMessage("Check-in undone.");
            }}
          >
            {online ? "Undo check-in" : "Undo check-in (needs a connection)"}
          </Button>
        )}
      </section>

      <Button type="button" variant="ghost" className="w-full" onClick={onClose}>
        Back to the list
      </Button>
    </div>
  );
}
