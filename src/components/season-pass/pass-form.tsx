"use client";

import { useActionState, useState } from "react";
import { buySeasonPass, type PassState } from "@/app/season-pass/actions";
import { Button } from "@/components/ui/button";
import { Alert } from "@/components/ui/card";
import { formatCents } from "@/lib/time";

export function PassForm({ categories, priceCents }: { categories: { id: string; name: string; description: string }[]; priceCents: number }) {
  const [state, action, pending] = useActionState<PassState, FormData>(buySeasonPass, {});
  const [count, setCount] = useState(0);
  return (
    <form action={action} className="space-y-4">
      {state.error ? <Alert tone="error">{state.error}</Alert> : null}
      <fieldset className="space-y-2">
        <legend className="text-xl font-bold">Categories</legend>
        <p className="text-sm text-muted-foreground">{formatCents(priceCents)} per category for the whole season.</p>
        {categories.map((c) => (
          <div key={c.id} className="flex items-start gap-3 rounded-lg border-2 border-border p-3">
            <input
              id={`cat-${c.id}`}
              type="checkbox"
              name="category_id"
              value={c.id}
              className="mt-1 size-6 shrink-0 accent-primary"
              onChange={(e) => setCount((n) => n + (e.target.checked ? 1 : -1))}
            />
            <label htmlFor={`cat-${c.id}`}>
              <span className="block text-lg font-bold">{c.name}</span>
              <span className="block text-sm">{c.description}</span>
            </label>
          </div>
        ))}
      </fieldset>
      <p className="text-lg font-semibold" aria-live="polite">
        {count > 0 ? `Total: ${formatCents(priceCents * count)}` : "Pick one or more categories."}
      </p>
      <Button type="submit" size="lg" className="w-full" disabled={pending || count === 0}>
        {pending ? "Opening payment…" : "Continue to payment"}
      </Button>
    </form>
  );
}
