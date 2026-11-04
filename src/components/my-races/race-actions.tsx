"use client";

import { useActionState } from "react";
import { cancelRegistration, payRegistration, type RaceActionState } from "@/app/my-races/actions";
import { Button } from "@/components/ui/button";
import { Alert } from "@/components/ui/card";

export function RaceActions({
  registrationId,
  canCancel,
  canPay,
  label,
}: {
  registrationId: string;
  canCancel: boolean;
  canPay: boolean;
  label: string;
}) {
  const [cancelState, cancelAction, canceling] = useActionState<RaceActionState, FormData>(cancelRegistration, {});
  const [payState, payAction, paying] = useActionState<RaceActionState, FormData>(payRegistration, {});
  const state = cancelState.error || cancelState.message ? cancelState : payState;

  return (
    <div className="space-y-2">
      {state.error ? <Alert tone="error">{state.error}</Alert> : null}
      {state.message ? <Alert tone="success">{state.message}</Alert> : null}
      <div className="flex flex-wrap gap-2">
        {canPay ? (
          <form action={payAction}>
            <input type="hidden" name="registration_id" value={registrationId} />
            <Button type="submit" disabled={paying}>
              {paying ? "Opening payment…" : "Pay to confirm"}
            </Button>
          </form>
        ) : null}
        {canCancel && !cancelState.message ? (
          <form
            action={cancelAction}
            onSubmit={(e) => {
              if (!window.confirm(`Cancel your registration for ${label}?`)) e.preventDefault();
            }}
          >
            <input type="hidden" name="registration_id" value={registrationId} />
            <Button type="submit" variant="secondary" disabled={canceling}>
              {canceling ? "Canceling…" : "Cancel registration"}
            </Button>
          </form>
        ) : null}
      </div>
    </div>
  );
}
