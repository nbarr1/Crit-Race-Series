import { describe, expect, it } from "vitest";
import {
  applyQueuedOps,
  bibInUse,
  countByCategory,
  createQueueStore,
  deviceId,
  parseQrPayload,
  pickEvent,
  reconcile,
  searchRoster,
  suggestBib,
  type QueuedOp,
  type RosterRow,
} from "@/lib/offline/check-in-queue";

const uuid = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`;

function row(n: number, over: Partial<RosterRow> = {}): RosterRow {
  return {
    registration_id: uuid(n),
    rider_id: uuid(1000 + n),
    first_name: `First${n}`,
    last_name: `Last${n}`,
    display_name: `First${n} L.`,
    team: n % 2 ? "Pisgah Velo" : null,
    is_minor: false,
    event_category_id: n % 2 ? "cat-a" : "cat-b",
    category_name: n % 2 ? "A" : "B",
    category_sort: n % 2 ? 10 : 20,
    status: "confirmed",
    source: "online",
    payment_method: "stripe",
    amount_paid_cents: 2500,
    price_cents: 2500,
    walk_up_price_cents: 3000,
    bib_number: null,
    checked_in_at: null,
    waitlist_position: null,
    waiver_signed: true,
    has_license: false,
    license_expiry: null,
    eligibility_warnings: [],
    eligibility_overridden: false,
    ...over,
  };
}

const checkIn = (n: number, bib: number, at: string): QueuedOp => ({
  type: "check_in",
  op_id: `op-${n}-${at}`,
  queued_at: at,
  registration_id: uuid(n),
  bib,
  checked_in_at: at,
});

describe("offline check-in queue", () => {
  it("shows 20 offline check-ins on the roster and clears them once synced", () => {
    const rows = Array.from({ length: 24 }, (_, i) => row(i + 1));
    const queue = Array.from({ length: 20 }, (_, i) => checkIn(i + 1, 101 + i, `2027-05-12T21:${String(i).padStart(2, "0")}:00Z`));

    const shown = applyQueuedOps(rows, queue);
    expect(shown.filter((r) => r.checked_in_at).length).toBe(20);
    expect(shown.find((r) => r.registration_id === uuid(5))?.bib_number).toBe(105);
    expect(rows.every((r) => r.checked_in_at === null)).toBe(true); // input untouched

    const counts = countByCategory(shown);
    expect(counts.map((c) => [c.category_name, c.registered, c.checked_in, c.outstanding])).toEqual([
      ["A", 12, 10, 2],
      ["B", 12, 10, 2],
    ]);

    const { remaining, failed } = reconcile(queue, queue.map((op) => ({ op_id: op.op_id, ok: true, outcome: "checked_in" })), "now");
    expect(remaining).toEqual([]);
    expect(failed).toEqual([]);
  });

  it("keeps operations whose request never got an answer", () => {
    const queue = [checkIn(1, 101, "2027-05-12T21:00:00Z"), checkIn(2, 102, "2027-05-12T21:01:00Z")];
    const { remaining } = reconcile(queue, [{ op_id: queue[0].op_id, ok: true }], "now");
    expect(remaining).toEqual([queue[1]]);
  });

  it("moves rejected operations to the failed list with the reason", () => {
    const queue = [checkIn(1, 101, "2027-05-12T21:00:00Z")];
    const { remaining, failed } = reconcile(queue, [{ op_id: queue[0].op_id, ok: false, error: "bib_taken", message: "Bib 101 is taken." }], "t");
    expect(remaining).toEqual([]);
    expect(failed[0]).toMatchObject({ error: "bib_taken", message: "Bib 101 is taken.", failed_at: "t" });
  });

  it("keeps the earliest check-in when two are queued for the same rider", () => {
    const shown = applyQueuedOps(
      [row(1)],
      [checkIn(1, 150, "2027-05-12T21:10:00Z"), checkIn(1, 101, "2027-05-12T21:05:00Z"), checkIn(1, 160, "2027-05-12T21:20:00Z")],
    );
    expect(shown[0].checked_in_at).toBe("2027-05-12T21:05:00Z");
    expect(shown[0].bib_number).toBe(101);
  });

  it("applies payments, overrides, and on-device waivers", () => {
    const rows = [row(1, { status: "pending_payment", payment_method: "none", waiver_signed: false })];
    const shown = applyQueuedOps(rows, [
      { type: "record_payment", op_id: "p", queued_at: "t", registration_id: uuid(1), payment_method: "cash", amount_cents: 3000 },
      { type: "override_eligibility", op_id: "o", queued_at: "t", registration_id: uuid(1), reason: "ok" },
      { type: "collect_waiver", op_id: "w", queued_at: "t", rider_id: uuid(1001), waiver_version_id: "v", typed_full_name: "x", signed_at: "t" },
    ]);
    expect(shown[0]).toMatchObject({ status: "confirmed", payment_method: "cash", amount_paid_cents: 3000, eligibility_overridden: true, waiver_signed: true });
  });

  it("only counts confirmed riders as registered", () => {
    const counts = countByCategory([row(1), row(3, { status: "waitlisted" }), row(5, { status: "pending_payment" })]);
    expect(counts[0]).toMatchObject({ registered: 1, outstanding: 1 });
  });
});

describe("roster helpers", () => {
  const rows = [row(1, { bib_number: 101 }), row(2, { bib_number: 102, first_name: "Ann", last_name: "Lee" }), row(3)];

  it("searches by name, team, or exact bib", () => {
    expect(searchRoster(rows, "ann lee").map((r) => r.registration_id)).toEqual([uuid(2)]);
    expect(searchRoster(rows, "102").map((r) => r.registration_id)).toEqual([uuid(2)]);
    expect(searchRoster(rows, "10")).toEqual([]);
    expect(searchRoster(rows, "pisgah").length).toBe(2);
    expect(searchRoster(rows, "  ").length).toBe(3);
  });

  it("suggests the next free bib and spots duplicates", () => {
    expect(suggestBib(rows)).toBe(103);
    expect(bibInUse(rows, 101, uuid(3))?.registration_id).toBe(uuid(1));
    expect(bibInUse(rows, 101, uuid(1))).toBeUndefined();
  });

  it("reads QR codes from riders' phones", () => {
    expect(parseQrPayload(`CRS1:${uuid(7).toUpperCase()}`)).toBe(uuid(7));
    expect(parseQrPayload(uuid(7))).toBe(uuid(7));
    expect(parseQrPayload("https://evil.example")).toBeNull();
  });
});

describe("queue storage", () => {
  function memory() {
    const m = new Map<string, string>();
    return { getItem: (k: string) => m.get(k) ?? null, setItem: (k: string, v: string) => void m.set(k, v), removeItem: (k: string) => void m.delete(k) };
  }

  it("round-trips the roster and queue per event", () => {
    const mem = memory();
    const a = createQueueStore(mem, "event-a");
    const b = createQueueStore(mem, "event-b");
    a.saveQueue([checkIn(1, 101, "t")]);
    expect(a.queue()).toHaveLength(1);
    expect(b.queue()).toEqual([]);
  });

  it("survives storage that throws or is missing", () => {
    const broken = { getItem: () => { throw new Error("blocked"); }, setItem: () => { throw new Error("full"); }, removeItem: () => {} };
    const s = createQueueStore(broken, "e");
    expect(s.queue()).toEqual([]);
    expect(s.saveQueue([])).toBe(false);
    expect(createQueueStore(null, "e").roster()).toBeNull();
  });

  it("keeps a stable device ID", () => {
    const mem = memory();
    let n = 0;
    const make = () => `dev-${++n}`;
    expect(deviceId(mem, make)).toBe("dev-1");
    expect(deviceId(mem, make)).toBe("dev-1");
  });
});

describe("pickEvent", () => {
  const events = [
    { id: "a", event_date: "2027-05-12" },
    { id: "b", event_date: "2027-05-26" },
    { id: "c", event_date: "2027-06-09" },
  ];
  it("prefers the requested event, then today's, then the next, then the last", () => {
    expect(pickEvent(events, "2027-05-26", "c")?.id).toBe("c");
    expect(pickEvent(events, "2027-05-26")?.id).toBe("b");
    expect(pickEvent(events, "2027-05-20")?.id).toBe("b");
    expect(pickEvent(events, "2027-07-01")?.id).toBe("c");
    expect(pickEvent([], "2027-07-01")).toBeUndefined();
  });
});
