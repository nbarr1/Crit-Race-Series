"use client";

import { useActionState } from "react";
import type { AdminState } from "@/lib/admin/errors";
import { Button } from "@/components/ui/button";
import { Alert } from "@/components/ui/card";
import { cn } from "@/lib/utils";

/**
 * A form posted to an admin server action. Shows the action's error or
 * success message above the fields. The fields are plain inputs with
 * defaultValues from the server, and the browser checks required fields
 * and number ranges before the form is sent.
 */
export function AdminForm({
  action,
  submitLabel,
  pendingLabel = "Saving…",
  variant = "default",
  className,
  children,
}: {
  action: (prev: AdminState, form: FormData) => Promise<AdminState>;
  submitLabel: string;
  pendingLabel?: string;
  variant?: "default" | "secondary" | "destructive";
  className?: string;
  children?: React.ReactNode;
}) {
  const [state, formAction, pending] = useActionState<AdminState, FormData>(action, {});
  return (
    <form action={formAction} className={cn("space-y-3", className)}>
      {state.error ? <Alert tone="error">{state.error}</Alert> : null}
      {state.message ? <Alert tone="success">{state.message}</Alert> : null}
      {children}
      <Button type="submit" variant={variant} disabled={pending}>
        {pending ? pendingLabel : submitLabel}
      </Button>
    </form>
  );
}
