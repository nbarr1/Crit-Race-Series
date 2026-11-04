import { Alert } from "@/components/ui/card";

export function SetupNotice() {
  return (
    <Alert tone="info">
      <p className="font-semibold">Supabase isn&apos;t configured.</p>
      <p>
        Copy <code>.env.example</code> to <code>.env.local</code> and fill in the Supabase values. For more information,
        see the README.
      </p>
    </Alert>
  );
}
