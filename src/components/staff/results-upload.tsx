"use client";

import { useActionState, useEffect, useMemo, useState } from "react";
import { previewResults, saveResults, type PreviewState, type SaveState } from "@/app/staff/results/actions";
import type { MatchedRow } from "@/lib/results-match";
import { Button } from "@/components/ui/button";
import { Alert } from "@/components/ui/card";
import { Field, Input, Select } from "@/components/ui/input";

type RiderOption = { id: string; label: string };

const STATUS_LABEL = { finished: "", DNF: "DNF", DNS: "DNS", DQ: "DQ" } as const;

export function ResultsUpload({ eventCategoryId, riders }: { eventCategoryId: string; riders: RiderOption[] }) {
  const [preview, previewAction, previewing] = useActionState<PreviewState, FormData>(previewResults, {});
  const [saved, saveAction, saving] = useActionState<SaveState, FormData>(saveResults, {});
  const [choices, setChoices] = useState<Record<number, string>>({});
  const [savedVersion, setSavedVersion] = useState<number | null>(null);

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- a new preview starts with no manual changes
    setChoices({});
  }, [preview.version]);
  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- hide the preview once it has been saved
    if (saved.message) setSavedVersion(preview.version ?? null);
  }, [saved, preview.version]);

  const rows: MatchedRow[] = useMemo(() => preview.rows ?? [], [preview.rows]);
  const chosen = rows.map((r) => (r.line in choices ? choices[r.line] || null : r.riderId));
  const duplicates = new Set(chosen.filter((id, i) => id && chosen.indexOf(id) !== i));
  const unmatched = chosen.filter((id) => !id).length;
  const showPreview = rows.length > 0 && savedVersion !== preview.version;
  const payload = JSON.stringify(
    rows.map((r, i) => ({
      place: r.place,
      status: r.status,
      bib: r.bib,
      name: r.name,
      laps: r.laps,
      finishTime: r.finishTime,
      riderId: chosen[i],
    })),
  );

  return (
    <div className="space-y-4">
      <form action={previewAction} className="space-y-4">
        <input type="hidden" name="event_category_id" value={eventCategoryId} />
        {preview.error ? <Alert tone="error">{preview.error}</Alert> : null}
        {preview.errors?.length ? (
          <Alert tone="error">
            <p className="font-semibold">Fix these in the sheet, then preview again:</p>
            <ul className="list-disc pl-5">
              {preview.errors.map((e, i) => (
                <li key={i}>{e.line ? `Line ${e.line}: ` : ""}{e.message}</li>
              ))}
            </ul>
          </Alert>
        ) : null}
        <Field id="r-file" label="CSV file" hint="Exported from the timing software or a spreadsheet. Up to 512 KB.">
          {(a) => <Input {...a} name="file" type="file" accept=".csv,.tsv,.txt,text/csv,text/plain" className="py-2" />}
        </Field>
        <Field id="r-paste" label="Or paste the results" hint="Copy the rows from a spreadsheet, including the header row.">
          {(a) => (
            <textarea
              {...a}
              name="pasted"
              rows={6}
              className="block w-full rounded-md border-2 border-input bg-background p-3 font-mono text-sm focus-visible:outline-none focus-visible:ring-4 focus-visible:ring-ring"
            />
          )}
        </Field>
        <Button type="submit" variant="secondary" disabled={previewing}>
          {previewing ? "Reading…" : "Preview results"}
        </Button>
      </form>

      {saved.error ? <Alert tone="error">{saved.error}</Alert> : null}
      {saved.message && !showPreview ? <Alert tone="success">{saved.message}</Alert> : null}

      {showPreview ? (
        <section aria-labelledby="preview-h" className="space-y-3">
          <h3 id="preview-h" className="text-xl font-bold">Check the matches</h3>
          <p>
            Riders are matched by bib, then by name. Change any match that&apos;s wrong. Unmatched rows keep the name from the
            sheet and don&apos;t count toward the standings.
          </p>
          {preview.warnings?.length ? (
            <Alert>
              <ul className="list-disc pl-5">
                {preview.warnings.map((w, i) => (
                  <li key={i}>{w.line ? `Line ${w.line}: ` : ""}{w.message}</li>
                ))}
              </ul>
            </Alert>
          ) : null}
          <p className="font-semibold" role="status">
            {rows.length} rows · {rows.length - unmatched} matched · {unmatched} not matched
          </p>
          <ol className="space-y-2">
            {rows.map((r, i) => (
              <li key={r.line} className="rounded-md border-2 border-border p-3" data-line={r.line}>
                <p className="font-semibold">
                  {r.place ?? STATUS_LABEL[r.status]} · {r.name || "(no name)"}
                  {r.bib != null ? ` · bib ${r.bib}` : ""}
                </p>
                {r.notes.length ? (
                  <ul className="text-sm text-muted-foreground">
                    {r.notes.map((n, j) => <li key={j}>{n}</li>)}
                  </ul>
                ) : null}
                <Field
                  id={`match-${r.line}`}
                  label={`Rider for line ${r.line}`}
                  error={chosen[i] && duplicates.has(chosen[i]) ? "This rider is matched to another row too." : undefined}
                >
                  {(a) => (
                    <Select
                      {...a}
                      value={chosen[i] ?? ""}
                      onChange={(e) => setChoices((c) => ({ ...c, [r.line]: e.target.value }))}
                    >
                      <option value="">Not matched (use the name from the sheet)</option>
                      {riders.map((o) => (
                        <option key={o.id} value={o.id}>{o.label}</option>
                      ))}
                    </Select>
                  )}
                </Field>
              </li>
            ))}
          </ol>
          <form action={saveAction}>
            <input type="hidden" name="event_category_id" value={eventCategoryId} />
            <input type="hidden" name="rows" value={payload} />
            <Button type="submit" size="lg" disabled={saving || duplicates.size > 0}>
              {saving ? "Saving…" : `Save ${rows.length} results as a draft`}
            </Button>
          </form>
        </section>
      ) : null}
    </div>
  );
}
