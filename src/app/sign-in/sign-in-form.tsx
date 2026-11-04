"use client";

import { useActionState } from "react";
import { requestCode, verifyCode, type SignInState } from "./actions";
import { Button } from "@/components/ui/button";
import { Field, Input } from "@/components/ui/input";
import { Alert } from "@/components/ui/card";

export function SignInForm({ next }: { next: string }) {
  const [emailState, emailAction, emailPending] = useActionState<SignInState, FormData>(requestCode, { step: "email" });
  const [codeState, codeAction, codePending] = useActionState<SignInState, FormData>(verifyCode, { step: "code" });

  if (emailState.step === "code") {
    return (
      <div className="space-y-4">
        {emailState.message ? <Alert tone="success">{emailState.message}</Alert> : null}
        <form action={codeAction} className="space-y-4" noValidate>
          <input type="hidden" name="email" value={emailState.email} />
          <input type="hidden" name="next" value={next} />
          <Field id="token" label="Code from your email" error={codeState.error}>
            {(aria) => (
              <Input
                {...aria}
                name="token"
                inputMode="numeric"
                autoComplete="one-time-code"
                pattern="[0-9]*"
                maxLength={10}
                required
                className="text-2xl tracking-widest"
              />
            )}
          </Field>
          <Button type="submit" size="lg" className="w-full" disabled={codePending}>
            {codePending ? "Checking…" : "Sign in"}
          </Button>
        </form>
        <form action={emailAction}>
          <input type="hidden" name="email" value={emailState.email} />
          <input type="hidden" name="next" value={next} />
          <Button type="submit" variant="link" disabled={emailPending}>
            Send a new code
          </Button>
        </form>
      </div>
    );
  }

  return (
    <form action={emailAction} className="space-y-4" noValidate>
      <input type="hidden" name="next" value={next} />
      <Field
        id="email"
        label="Email"
        hint="We'll email you a sign-in link and a code. No password needed."
        error={emailState.error}
      >
        {(aria) => (
          <Input {...aria} name="email" type="email" autoComplete="email" required defaultValue={emailState.email} />
        )}
      </Field>
      <Button type="submit" size="lg" className="w-full" disabled={emailPending}>
        {emailPending ? "Sending…" : "Email me a sign-in code"}
      </Button>
    </form>
  );
}
