import type { Metadata } from "next";
import { Suspense } from "react";
import { requireAdmin } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { PageLoading } from "@/components/page-loading";
import { Badge, Card } from "@/components/ui/card";
import { AdminForm } from "@/components/admin/admin-form";
import { CheckboxField, TextAreaField, TextField } from "@/components/admin/fields";
import type { Venue } from "@/lib/types";
import { saveVenue } from "./actions";

export const metadata: Metadata = { title: "Venue" };

function VenueFields({ v }: { v?: Venue }) {
  const p = v?.id ?? "new";
  return (
    <>
      <input type="hidden" name="id" value={v?.id ?? ""} />
      <TextField id={`${p}-name`} name="name" label="Name" defaultValue={v?.name ?? ""} required minLength={2} />
      <TextField id={`${p}-address`} name="address" label="Address" defaultValue={v?.address ?? ""} maxLength={300} />
      <div className="grid gap-3 sm:grid-cols-2">
        <TextField
          id={`${p}-lat`}
          name="latitude"
          label="Latitude"
          inputMode="decimal"
          defaultValue={v?.latitude ?? ""}
          required
          hint="For example, 35.2338. The forecast uses it."
        />
        <TextField id={`${p}-lon`} name="longitude" label="Longitude" inputMode="decimal" defaultValue={v?.longitude ?? ""} required hint="West is negative, such as -82.7343." />
      </div>
      <CheckboxField
        id={`${p}-confirmed`}
        name="coordinates_confirmed"
        label="The address and coordinates are correct"
        hint="Until this is checked, event pages say the location is still being confirmed."
        defaultChecked={v?.coordinates_confirmed ?? false}
      />
      <TextAreaField id={`${p}-parking`} name="parking_notes" label="Parking and arrival notes" rows={3} defaultValue={v?.parking_notes ?? ""} maxLength={2000} />
      <TextField id={`${p}-map`} name="map_embed_url" label="Map link (optional)" type="url" defaultValue={v?.map_embed_url ?? ""} placeholder="https://" />
    </>
  );
}

async function Venues() {
  await requireAdmin("/admin/venues");
  const supabase = await createClient();
  const { data } = await supabase
    .from("venues")
    .select("id, name, address, latitude, longitude, coordinates_confirmed, parking_notes, map_embed_url")
    .order("name");
  const venues = (data ?? []) as Venue[];
  return (
    <div className="space-y-6">
      <ul className="space-y-3">
        {venues.map((v) => (
          <li key={v.id}>
            <Card className="space-y-2">
              <h2 className="text-xl font-bold">
                {v.name} {v.coordinates_confirmed ? <Badge tone="success">Confirmed</Badge> : <Badge tone="warning">Not confirmed</Badge>}
              </h2>
              <AdminForm action={saveVenue} submitLabel={`Save ${v.name}`}>
                <VenueFields v={v} />
              </AdminForm>
            </Card>
          </li>
        ))}
      </ul>
      <details>
        <summary className="inline-flex min-h-11 cursor-pointer items-center text-xl font-bold">Add another venue</summary>
        <AdminForm action={saveVenue} submitLabel="Add venue" className="pt-2">
          <VenueFields />
        </AdminForm>
      </details>
    </div>
  );
}

export default function Page() {
  return (
    <div className="space-y-4">
      <h1 className="text-3xl font-bold">Venue</h1>
      <Suspense fallback={<PageLoading label="Loading venues" />}>
        <Venues />
      </Suspense>
    </div>
  );
}
