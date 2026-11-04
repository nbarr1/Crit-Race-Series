import { Field, Input, Select } from "@/components/ui/input";

export const textareaClass =
  "block w-full rounded-md border-2 border-input bg-background p-3 text-base focus-visible:outline-none focus-visible:ring-4 focus-visible:ring-ring";

/** A labeled text, number, or date input. */
export function TextField({
  id,
  label,
  hint,
  ...props
}: React.InputHTMLAttributes<HTMLInputElement> & { id: string; label: string; hint?: string }) {
  return (
    <Field id={id} label={label} hint={hint}>
      {(a) => <Input {...a} {...props} />}
    </Field>
  );
}

export function TextAreaField({
  id,
  label,
  hint,
  ...props
}: React.TextareaHTMLAttributes<HTMLTextAreaElement> & { id: string; label: string; hint?: string }) {
  return (
    <Field id={id} label={label} hint={hint}>
      {(a) => <textarea {...a} {...props} className={textareaClass} />}
    </Field>
  );
}

export function SelectField({
  id,
  label,
  hint,
  children,
  ...props
}: React.SelectHTMLAttributes<HTMLSelectElement> & { id: string; label: string; hint?: string }) {
  return (
    <Field id={id} label={label} hint={hint}>
      {(a) => (
        <Select {...a} {...props}>
          {children}
        </Select>
      )}
    </Field>
  );
}

/** A checkbox with its label beside it, sized for a thumb. */
export function CheckboxField({
  id,
  label,
  hint,
  ...props
}: React.InputHTMLAttributes<HTMLInputElement> & { id: string; label: string; hint?: string }) {
  return (
    <div className="space-y-1">
      <div className="flex items-start gap-3">
        <input
          id={id}
          type="checkbox"
          className="mt-1 size-6 shrink-0 accent-primary"
          aria-describedby={hint ? `${id}-hint` : undefined}
          {...props}
        />
        <label htmlFor={id} className="font-semibold">
          {label}
        </label>
      </div>
      {hint ? (
        <p id={`${id}-hint`} className="pl-9 text-sm text-muted-foreground">
          {hint}
        </p>
      ) : null}
    </div>
  );
}
