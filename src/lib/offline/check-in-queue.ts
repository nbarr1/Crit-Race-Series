/**
 * Offline check-in queue (section 5.4). Pure functions plus a small storage
 * wrapper, so the logic is unit tested without a browser.
 *
 * The staff device keeps the day's roster and a queue of operations in local
 * storage. The screen always shows the roster with queued operations applied
 * on top. When a connection is available, the queue is sent to
 * /api/staff/sync in order. The server is idempotent by op ID, so resending
 * after a dropped response is safe.
 */

export type RosterRow = {
  registration_id: string;
  rider_id: string;
  first_name: string;
  last_name: string;
  display_name: string;
  team: string | null;
  is_minor: boolean;
  event_category_id: string;
  category_name: string;
  category_sort: number;
  status: "confirmed" | "pending_payment" | "waitlisted";
  source: "online" | "walk_up" | "season_pass";
  payment_method: string;
  amount_paid_cents: number | null;
  price_cents: number;
  walk_up_price_cents: number;
  bib_number: number | null;
  checked_in_at: string | null;
  waitlist_position: number | null;
  waiver_signed: boolean;
  has_license: boolean;
  license_expiry: string | null;
  eligibility_warnings: string[];
  eligibility_overridden: boolean;
};

export type RosterSnapshot = {
  event: { id: string; name: string; event_date: string };
  waiver: { id: string; title: string; version_number: number; body_markdown: string } | null;
  rows: RosterRow[];
  fetched_at: string;
};

export type DeskPaymentMethod = "cash" | "card_at_desk" | "stripe_link" | "comp";

type OpBase = { op_id: string; queued_at: string };
export type QueuedOp = OpBase &
  (
    | { type: "check_in"; registration_id: string; bib: number | null; checked_in_at: string }
    | { type: "record_payment"; registration_id: string; payment_method: DeskPaymentMethod; amount_cents: number }
    | { type: "override_eligibility"; registration_id: string; reason: string }
    | {
        type: "collect_waiver";
        rider_id: string;
        waiver_version_id: string;
        typed_full_name: string;
        signed_at: string;
        guardian_name?: string;
        guardian_relationship?: string;
        guardian_typed_signature?: string;
      }
  );

export type OpResult = { op_id: string; ok: boolean; outcome?: string; error?: string; message?: string };

export type FailedOp = { op: QueuedOp; error: string; message: string; failed_at: string };

/** Shows queued operations on top of the last roster from the server. */
export function applyQueuedOps(rows: RosterRow[], ops: QueuedOp[]): RosterRow[] {
  const byReg = new Map(rows.map((r) => [r.registration_id, { ...r }]));
  for (const op of ops) {
    if (op.type === "collect_waiver") {
      for (const r of byReg.values()) if (r.rider_id === op.rider_id) r.waiver_signed = true;
      continue;
    }
    const r = byReg.get(op.registration_id);
    if (!r) continue;
    if (op.type === "check_in") {
      // Earliest time wins, matching the server.
      if (!r.checked_in_at || op.checked_in_at < r.checked_in_at) {
        r.checked_in_at = op.checked_in_at;
        if (op.bib != null) r.bib_number = op.bib;
      }
      if (r.bib_number == null && op.bib != null) r.bib_number = op.bib;
    } else if (op.type === "record_payment") {
      r.status = "confirmed";
      r.payment_method = op.payment_method;
      r.amount_paid_cents = op.payment_method === "comp" ? 0 : op.amount_cents;
    } else if (op.type === "override_eligibility") {
      r.eligibility_overridden = true;
    }
  }
  return [...byReg.values()];
}

export type CategoryCount = {
  event_category_id: string;
  category_name: string;
  registered: number;
  checked_in: number;
  outstanding: number;
};

/** Live counts per category. "Registered" counts confirmed riders only. */
export function countByCategory(rows: RosterRow[]): CategoryCount[] {
  const map = new Map<string, CategoryCount & { sort: number }>();
  for (const r of rows) {
    const c = map.get(r.event_category_id) ?? {
      event_category_id: r.event_category_id,
      category_name: r.category_name,
      sort: r.category_sort,
      registered: 0,
      checked_in: 0,
      outstanding: 0,
    };
    if (r.status === "confirmed") {
      c.registered++;
      if (r.checked_in_at) c.checked_in++;
      else c.outstanding++;
    }
    map.set(r.event_category_id, c);
  }
  return [...map.values()]
    .sort((a, b) => a.sort - b.sort)
    .map((c) => ({
      event_category_id: c.event_category_id,
      category_name: c.category_name,
      registered: c.registered,
      checked_in: c.checked_in,
      outstanding: c.outstanding,
    }));
}

export function isPaid(r: RosterRow): boolean {
  return r.status === "confirmed" && r.payment_method !== "none";
}

/** Name, display name, team, or bib. Bib matches exactly. */
export function searchRoster(rows: RosterRow[], query: string): RosterRow[] {
  const q = query.trim().toLowerCase();
  if (!q) return rows;
  if (/^\d+$/.test(q)) return rows.filter((r) => String(r.bib_number ?? "") === q);
  const words = q.split(/\s+/);
  return rows.filter((r) => {
    const hay = `${r.first_name} ${r.last_name} ${r.display_name} ${r.team ?? ""}`.toLowerCase();
    return words.every((w) => hay.includes(w));
  });
}

/** The smallest bib at or above `start` that no rider at this event has. */
export function suggestBib(rows: RosterRow[], start = 101): number {
  const used = new Set(rows.map((r) => r.bib_number).filter((b): b is number => b != null));
  let b = start;
  while (used.has(b)) b++;
  return b;
}

export function bibInUse(rows: RosterRow[], bib: number, exceptRegistrationId: string): RosterRow | undefined {
  return rows.find((r) => r.bib_number === bib && r.registration_id !== exceptRegistrationId);
}

/** QR payload on a rider's phone: "CRS1:<registration id>". */
export const QR_PREFIX = "CRS1:";
export function parseQrPayload(text: string): string | null {
  const t = text.trim();
  const id = t.startsWith(QR_PREFIX) ? t.slice(QR_PREFIX.length) : t;
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(id) ? id.toLowerCase() : null;
}

/**
 * Removes applied operations from the queue and moves rejected ones to the
 * failed list. Operations without a result (the request died) stay queued.
 */
export function reconcile(queue: QueuedOp[], results: OpResult[], now: string) {
  const byId = new Map(results.map((r) => [r.op_id, r]));
  const remaining: QueuedOp[] = [];
  const failed: FailedOp[] = [];
  for (const op of queue) {
    const res = byId.get(op.op_id);
    if (!res) remaining.push(op);
    else if (!res.ok) failed.push({ op, error: res.error ?? "unknown", message: res.message ?? "The server rejected this change.", failed_at: now });
  }
  return { remaining, failed };
}

// ---------------------------------------------------------------------------
// Storage. Wrapped so a full or blocked storage never breaks the screen.
// ---------------------------------------------------------------------------
export type KeyValueStore = Pick<Storage, "getItem" | "setItem" | "removeItem">;

export function createQueueStore(store: KeyValueStore | null, eventId: string) {
  const k = (name: string) => `crs:${name}:${eventId}`;
  const read = <T,>(name: string, fallback: T): T => {
    try {
      const raw = store?.getItem(k(name));
      return raw ? (JSON.parse(raw) as T) : fallback;
    } catch {
      return fallback;
    }
  };
  const write = (name: string, value: unknown): boolean => {
    try {
      store?.setItem(k(name), JSON.stringify(value));
      return Boolean(store);
    } catch {
      return false;
    }
  };
  return {
    roster: () => read<RosterSnapshot | null>("roster", null),
    saveRoster: (s: RosterSnapshot) => write("roster", s),
    queue: () => read<QueuedOp[]>("queue", []),
    saveQueue: (q: QueuedOp[]) => write("queue", q),
    failed: () => read<FailedOp[]>("failed", []),
    saveFailed: (f: FailedOp[]) => write("failed", f),
  };
}

export function deviceId(store: KeyValueStore | null, makeId: () => string): string {
  try {
    const existing = store?.getItem("crs:device");
    if (existing) return existing;
    const id = makeId();
    store?.setItem("crs:device", id);
    return id;
  } catch {
    return makeId();
  }
}

type PickableEvent = { id: string; event_date: string };
/** Today's event, else the next one, else the most recent (events sorted by date). */
export function pickEvent<T extends PickableEvent>(events: T[], today: string, requested?: string): T | undefined {
  return (
    events.find((e) => e.id === requested) ??
    events.find((e) => e.event_date === today) ??
    events.find((e) => e.event_date > today) ??
    [...events].reverse().find((e) => e.event_date < today)
  );
}
