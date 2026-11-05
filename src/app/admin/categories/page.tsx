import type { Metadata } from "next";
import { Suspense } from "react";
import { requireAdmin } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { PageLoading } from "@/components/page-loading";
import { Card } from "@/components/ui/card";
import { AdminForm } from "@/components/admin/admin-form";
import { SelectField, TextAreaField, TextField } from "@/components/admin/fields";
import { saveCategory } from "./actions";

export const metadata: Metadata = { title: "Categories" };

type Category = {
  id: string;
  name: string;
  description: string;
  eligibility_notes: string;
  min_age: number | null;
  requires_gender: "woman" | "man" | "non_binary" | null;
  sort_order: number;
};

function CategoryFields({ c }: { c?: Category }) {
  const p = c?.id ?? "new";
  return (
    <>
      <input type="hidden" name="id" value={c?.id ?? ""} />
      <TextField id={`${p}-name`} name="name" label="Name" defaultValue={c?.name ?? ""} required maxLength={60} />
      <TextAreaField id={`${p}-desc`} name="description" label="Description" rows={2} defaultValue={c?.description ?? ""} maxLength={500} />
      <TextAreaField
        id={`${p}-elig`}
        name="eligibility_notes"
        label="Eligibility notes"
        hint="Shown to riders when they register."
        rows={2}
        defaultValue={c?.eligibility_notes ?? ""}
        maxLength={500}
      />
      <TextField
        id={`${p}-age`}
        name="min_age"
        label="Minimum racing age (optional)"
        hint="Age on December 31 of the season year. Riders under it see a warning, and staff can override it at check-in."
        type="number"
        inputMode="numeric"
        min={0}
        max={120}
        defaultValue={c?.min_age ?? ""}
      />
      <SelectField
        id={`${p}-gender`}
        name="requires_gender"
        label="Open to (optional)"
        hint="Other riders see a warning, not a block."
        defaultValue={c?.requires_gender ?? ""}
      >
        <option value="">Everyone</option>
        <option value="woman">Women</option>
        <option value="man">Men</option>
        <option value="non_binary">Non-binary riders</option>
      </SelectField>
      <TextField
        id={`${p}-order`}
        name="sort_order"
        label="Order"
        hint="Lower numbers are listed first."
        type="number"
        inputMode="numeric"
        min={0}
        max={9999}
        defaultValue={c?.sort_order ?? 100}
        required
      />
    </>
  );
}

async function Categories() {
  await requireAdmin("/admin/categories");
  const supabase = await createClient();
  const { data } = await supabase
    .from("categories")
    .select("id, name, description, eligibility_notes, min_age, requires_gender, sort_order")
    .order("sort_order");
  const categories = (data ?? []) as Category[];
  return (
    <div className="space-y-6">
      <p>Categories are shared by every season. Each event chooses which ones it runs, with its own start times and prices.</p>
      <ul className="space-y-3">
        {categories.map((c) => (
          <li key={c.id}>
            <Card>
              <details>
                <summary className="flex min-h-11 cursor-pointer items-center text-xl font-bold">{c.name}</summary>
                <AdminForm action={saveCategory} submitLabel={`Save ${c.name}`} className="pt-2">
                  <CategoryFields c={c} />
                </AdminForm>
              </details>
            </Card>
          </li>
        ))}
      </ul>
      <section aria-labelledby="new-cat" className="space-y-3">
        <h2 id="new-cat" className="text-2xl font-bold">Add a category</h2>
        <AdminForm action={saveCategory} submitLabel="Add category">
          <CategoryFields />
        </AdminForm>
      </section>
    </div>
  );
}

export default function Page() {
  return (
    <div className="space-y-4">
      <h1 className="text-3xl font-bold">Categories</h1>
      <Suspense fallback={<PageLoading label="Loading categories" />}>
        <Categories />
      </Suspense>
    </div>
  );
}
