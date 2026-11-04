import type { Metadata } from "next";
import { Suspense } from "react";
import { requireAdmin } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import type { SettingRow } from "@/lib/admin/data";
import { SETTING_LABELS, SETTING_ORDER, settingKind } from "@/lib/admin/settings-form";
import { centsToDollars } from "@/lib/time";
import { PageLoading } from "@/components/page-loading";
import { AdminForm } from "@/components/admin/admin-form";
import { CheckboxField, SelectField, TextField } from "@/components/admin/fields";
import { saveSettings } from "./actions";

export const metadata: Metadata = { title: "Settings" };

function SettingInput({ row }: { row: SettingRow }) {
  const id = `setting-${row.key}`;
  const name = `s:${row.key}`;
  const label = SETTING_LABELS[row.key] ?? row.key.replaceAll("_", " ");
  const hint = row.description || undefined;
  const v = row.value;
  switch (settingKind(row.key, v)) {
    case "boolean":
      return <CheckboxField id={id} name={name} label={label} hint={hint} defaultChecked={v === true} />;
    case "integer":
      return <TextField id={id} name={name} label={label} hint={hint} type="number" inputMode="numeric" min={0} defaultValue={String(v ?? 0)} required />;
    case "money":
      return <TextField id={id} name={name} label={label} hint={hint} inputMode="decimal" defaultValue={centsToDollars(Number(v ?? 0))} required />;
    case "url":
      return <TextField id={id} name={name} label={label} hint={hint} type="url" placeholder="https://" defaultValue={typeof v === "string" ? v : ""} />;
    case "refund_policy":
      return (
        <SelectField id={id} name={name} label={label} hint="Refunds are issued by hand in the Stripe dashboard either way." defaultValue={String(v)}>
          <option value="no_automatic_refunds">No automatic refunds. Staff decide case by case.</option>
          <option value="full_refund_before_close">Full refund when a rider cancels before registration closes</option>
        </SelectField>
      );
    case "text":
      return <TextField id={id} name={name} label={label} hint={hint} defaultValue={typeof v === "string" ? v : ""} maxLength={500} />;
  }
}

async function Settings() {
  await requireAdmin("/admin/settings");
  const supabase = await createClient();
  const { data } = await supabase.from("app_settings").select("key, value, description");
  const rank = (k: string) => (SETTING_ORDER.includes(k) ? SETTING_ORDER.indexOf(k) : 1000);
  const rows = ((data ?? []) as SettingRow[]).sort((a, b) => rank(a.key) - rank(b.key) || a.key.localeCompare(b.key));
  return (
    <AdminForm action={saveSettings} submitLabel="Save settings">
      <div className="space-y-5">
        {rows.map((row) => (
          <div key={row.key}>
            <input type="hidden" name={`shown:${row.key}`} value="1" />
            <SettingInput row={row} />
          </div>
        ))}
      </div>
    </AdminForm>
  );
}

export default function Page() {
  return (
    <div className="space-y-4">
      <h1 className="text-3xl font-bold">Settings</h1>
      <p>These apply to the whole series. Prices for each race are set on each event. The defaults here fill in new events.</p>
      <Suspense fallback={<PageLoading label="Loading settings" />}>
        <Settings />
      </Suspense>
    </div>
  );
}
