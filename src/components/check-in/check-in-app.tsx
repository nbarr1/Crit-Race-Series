"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Alert, Badge } from "@/components/ui/card";
import { formatDateTime, formatTime } from "@/lib/time";
import { countByCategory, isPaid, searchRoster, type RosterRow } from "@/lib/offline/check-in-queue";
import { useCheckIn } from "./use-check-in";
import { RiderPanel } from "./rider-panel";
import { Scanner } from "./scanner";
import { WaiverHandoff } from "./waiver-handoff";
import { WalkUpForm, type WalkUpCategory } from "./walk-up-form";

type View = { kind: "list" } | { kind: "rider"; id: string } | { kind: "scan" } | { kind: "walk-up" } | { kind: "handoff"; id: string };

export function CheckInApp({ eventId, eventName, categories }: { eventId: string; eventName: string; categories: WalkUpCategory[] }) {
  const ci = useCheckIn(eventId);
  const [view, setView] = useState<View>({ kind: "list" });
  const [query, setQuery] = useState("");
  const [category, setCategory] = useState<string>("all");
  const [showDone, setShowDone] = useState(true);
  const [notice, setNotice] = useState<string | null>(null);
  const headingRef = useRef<HTMLHeadingElement>(null);

  // Register the service worker so this screen opens without a signal, and
  // load the fallback QR decoder now (iOS has no BarcodeDetector), so the
  // scanner also works offline.
  useEffect(() => {
    if ("serviceWorker" in navigator) navigator.serviceWorker.register("/sw.js", { scope: "/" }).catch(() => {});
    if (!("BarcodeDetector" in window)) import("jsqr").catch(() => {});
  }, []);

  useEffect(() => {
    headingRef.current?.focus();
  }, [view.kind]);

  const online = ci.connection === "online";
  const counts = useMemo(() => countByCategory(ci.rows), [ci.rows]);
  const visible = useMemo(() => {
    let rows = searchRoster(ci.rows, query);
    if (category !== "all") rows = rows.filter((r) => r.event_category_id === category);
    if (!showDone) rows = rows.filter((r) => !r.checked_in_at);
    return [...rows].sort(
      (a, b) => a.category_sort - b.category_sort || a.last_name.localeCompare(b.last_name) || a.first_name.localeCompare(b.first_name),
    );
  }, [ci.rows, query, category, showDone]);

  const current = (id: string) => ci.rows.find((r) => r.registration_id === id);

  const onScan = useCallback(
    (id: string) => {
      if (ci.rows.some((r) => r.registration_id === id)) {
        setView({ kind: "rider", id });
      } else {
        setNotice("That code isn't registered for this event. Search by name, or add a walk-up.");
        setView({ kind: "list" });
      }
    },
    [ci.rows],
  );

  const banner = (() => {
    const pending = ci.queue.length;
    if (ci.connection === "signed_out")
      return { tone: "error" as const, text: `Your staff sign-in expired. Changes are saved on this device${pending ? ` (${pending} waiting)` : ""}. Open a new tab, sign in, then come back.` };
    if (ci.connection === "offline" || ci.connection === "unreachable")
      return { tone: "error" as const, text: `Offline, ${pending} ${pending === 1 ? "change" : "changes"} pending. Check-ins are saved on this device and sync when the signal returns.` };
    if (pending > 0) return { tone: "info" as const, text: `Syncing ${pending} ${pending === 1 ? "change" : "changes"}…` };
    return null;
  })();

  if (view.kind === "handoff") {
    const row = current(view.id);
    const waiver = ci.snapshot?.waiver;
    if (row && waiver) {
      return (
        <WaiverHandoff
          rider={row}
          waiver={waiver}
          onSigned={(sig) =>
            ci.enqueue({
              type: "collect_waiver",
              rider_id: row.rider_id,
              waiver_version_id: waiver.id,
              signed_at: new Date().toISOString(),
              ...sig,
            })
          }
          onCancel={() => setView({ kind: "rider", id: row.registration_id })}
        />
      );
    }
  }

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h1 ref={headingRef} tabIndex={-1} className="text-2xl font-bold outline-none">
          Check-in: {eventName}
        </h1>
        <Badge tone={online ? "success" : "danger"}>{online ? "Online" : "Offline"}</Badge>
      </div>

      <div aria-live="polite" className="space-y-2">
        {banner ? <Alert tone={banner.tone}>{banner.text}</Alert> : null}
        {!ci.storageOk ? (
          <Alert tone="error">This browser isn&apos;t saving changes on the device (private mode or full storage). Stay online until they sync.</Alert>
        ) : null}
        {notice ? (
          <Alert tone="info">
            {notice}{" "}
            <button type="button" className="font-semibold underline" onClick={() => setNotice(null)}>
              Dismiss
            </button>
          </Alert>
        ) : null}
        {ci.failed.map((f) => (
          <Alert key={f.op.op_id} tone="error">
            <p>
              <span className="font-semibold">A change didn&apos;t save</span>
              {"registration_id" in f.op ? ` for ${riderName(current(f.op.registration_id))}` : ""}: {f.message}
            </p>
            <button type="button" className="mt-1 font-semibold underline" onClick={() => ci.dismissFailed(f.op.op_id)}>
              Dismiss
            </button>
          </Alert>
        ))}
      </div>

      {view.kind === "scan" ? (
        <Scanner onResult={onScan} onClose={() => setView({ kind: "list" })} />
      ) : view.kind === "walk-up" ? (
        <WalkUpForm
          categories={categories}
          online={online}
          deviceId={ci.deviceId}
          newId={ci.newId}
          onCancel={() => setView({ kind: "list" })}
          onDone={async (r) => {
            await ci.refresh();
            setNotice(r.waiver_signed ? "Walk-up registered. Check them in now." : "Walk-up registered. Hand them the device to sign the waiver, then check them in.");
            setView({ kind: "rider", id: r.registration_id });
          }}
        />
      ) : view.kind === "rider" && current(view.id) ? (
        <RiderPanel
          key={view.id}
          row={current(view.id)!}
          rows={ci.rows}
          online={online}
          hasWaiver={Boolean(ci.snapshot?.waiver)}
          enqueue={ci.enqueue}
          onHandToRider={() => setView({ kind: "handoff", id: view.id })}
          onUndo={async () => {
            try {
              const res = await fetch("/api/staff/undo", {
                method: "POST",
                headers: { "content-type": "application/json" },
                body: JSON.stringify({ registration_id: view.id }),
              });
              const body = (await res.json().catch(() => ({}))) as { ok?: boolean; message?: string };
              await ci.refresh();
              return body.ok ? null : (body.message ?? "Undo failed.");
            } catch {
              return "No connection. Try again when the signal returns.";
            }
          }}
          onClose={() => setView({ kind: "list" })}
        />
      ) : (
        <>
          <div className="grid grid-cols-2 gap-2">
            <Button type="button" size="lg" onClick={() => setView({ kind: "scan" })}>
              Scan a code
            </Button>
            <Button type="button" size="lg" variant="secondary" onClick={() => setView({ kind: "walk-up" })}>
              Walk-up
            </Button>
          </div>

          <section aria-labelledby="counts-h">
            <h2 id="counts-h" className="sr-only">
              Counts by category
            </h2>
            <table className="w-full border-collapse text-left text-sm sm:text-base">
              <thead>
                <tr className="border-b-2 border-foreground">
                  <th scope="col" className="py-1 pr-2">Category</th>
                  <th scope="col" className="px-2 py-1 text-right">Registered</th>
                  <th scope="col" className="px-2 py-1 text-right">Checked in</th>
                  <th scope="col" className="py-1 pl-2 text-right">To come</th>
                </tr>
              </thead>
              <tbody>
                {counts.map((c) => (
                  <tr key={c.event_category_id} className="border-b border-border">
                    <th scope="row" className="py-1 pr-2 font-semibold">{c.category_name}</th>
                    <td className="px-2 py-1 text-right">{c.registered}</td>
                    <td className="px-2 py-1 text-right">{c.checked_in}</td>
                    <td className="py-1 pl-2 text-right font-bold">{c.outstanding}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </section>

          <div className="space-y-2">
            <label htmlFor="roster-search" className="sr-only">
              Search by name or bib
            </label>
            <Input id="roster-search" type="search" placeholder="Search by name or bib" value={query} onChange={(e) => setQuery(e.target.value)} autoComplete="off" />
            <div className="flex flex-wrap gap-2" role="group" aria-label="Filter by category">
              {[{ id: "all", name: "All" }, ...counts.map((c) => ({ id: c.event_category_id, name: c.category_name }))].map((c) => (
                <Button key={c.id} type="button" size="sm" variant={category === c.id ? "default" : "secondary"} aria-pressed={category === c.id} onClick={() => setCategory(c.id)}>
                  {c.name}
                </Button>
              ))}
              <Button type="button" size="sm" variant={showDone ? "secondary" : "default"} aria-pressed={!showDone} onClick={() => setShowDone((s) => !s)}>
                {showDone ? "Hide checked in" : "Show checked in"}
              </Button>
            </div>
          </div>

          {ci.snapshot === null ? (
            <p role="status">{online ? "Loading the roster…" : "No roster saved on this device yet. Connect once to download it."}</p>
          ) : visible.length === 0 ? (
            <p>No riders match.</p>
          ) : (
            <ul className="divide-y-2 divide-border rounded-lg border-2 border-border" aria-label="Riders">
              {visible.map((r) => (
                <li key={r.registration_id}>
                  <button
                    type="button"
                    data-registration-id={r.registration_id}
                    className="flex min-h-14 w-full items-center gap-3 px-3 py-2 text-left hover:bg-muted"
                    onClick={() => setView({ kind: "rider", id: r.registration_id })}
                  >
                    <span className="w-14 shrink-0 text-center text-xl font-bold" aria-label={r.bib_number ? `Bib ${r.bib_number}` : "No bib"}>
                      {r.bib_number ?? "—"}
                    </span>
                    <span className="flex-1">
                      <span className="block text-lg font-semibold">
                        {r.last_name}, {r.first_name}
                      </span>
                      <span className="block text-sm text-muted-foreground">
                        {r.category_name}
                        {r.team ? ` · ${r.team}` : ""}
                      </span>
                      <span className="mt-1 flex flex-wrap gap-1">
                        <Badge tone={isPaid(r) ? "success" : "danger"}>{isPaid(r) ? "Paid" : "Not paid"}</Badge>
                        <Badge tone={r.waiver_signed ? "success" : "danger"}>{r.waiver_signed ? "Waiver" : "No waiver"}</Badge>
                        {r.has_license ? <Badge>License</Badge> : null}
                        {r.eligibility_warnings.length && !r.eligibility_overridden ? <Badge tone="warning">Check eligibility</Badge> : null}
                        {r.status === "waitlisted" ? <Badge tone="warning">Waitlist</Badge> : null}
                        {r.checked_in_at ? <Badge tone="success">In {formatTime(r.checked_in_at)}</Badge> : null}
                      </span>
                    </span>
                  </button>
                </li>
              ))}
            </ul>
          )}

          <div className="flex flex-wrap gap-2 text-sm">
            <Button type="button" size="sm" variant="secondary" disabled={!online || ci.syncing} onClick={() => void ci.sync()}>
              {ci.syncing ? "Syncing…" : "Refresh the roster"}
            </Button>
            <a className="inline-flex min-h-11 items-center font-semibold text-primary underline" href={`/staff/events/${eventId}/start-list?format=pdf`}>
              Start list (PDF)
            </a>
            <a className="inline-flex min-h-11 items-center font-semibold text-primary underline" href={`/staff/events/${eventId}/start-list?format=csv`}>
              Start list (CSV)
            </a>
          </div>
          <p className="text-sm text-muted-foreground">
            {ci.snapshot ? `Roster downloaded ${formatDateTime(ci.snapshot.fetched_at)}.` : ""}
            {ci.lastSynced ? ` Last synced ${formatDateTime(ci.lastSynced)}.` : ""}
          </p>
        </>
      )}
    </div>
  );
}

function riderName(r: RosterRow | undefined) {
  return r ? `${r.first_name} ${r.last_name}` : "a rider";
}
