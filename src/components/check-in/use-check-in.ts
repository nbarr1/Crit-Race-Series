"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  applyQueuedOps,
  createQueueStore,
  deviceId as getDeviceId,
  reconcile,
  type FailedOp,
  type OpResult,
  type QueuedOp,
  type RosterSnapshot,
} from "@/lib/offline/check-in-queue";

export type Connection = "online" | "offline" | "unreachable" | "signed_out";

type DistributiveOmit<T, K extends PropertyKey> = T extends unknown ? Omit<T, K> : never;
export type NewOp = DistributiveOmit<QueuedOp, "op_id" | "queued_at">;

function safeStorage(): Storage | null {
  try {
    return typeof window === "undefined" ? null : window.localStorage;
  } catch {
    return null;
  }
}

const newId = () =>
  typeof crypto !== "undefined" && "randomUUID" in crypto
    ? crypto.randomUUID()
    : "10000000-1000-4000-8000-100000000000".replace(/[018]/g, (c) =>
        (Number(c) ^ (Math.floor(Math.random() * 256) & (15 >> (Number(c) / 4)))).toString(16),
      );

/**
 * Check-in state for one event: the cached roster, the offline queue, and
 * the sync loop. Queued operations are saved before anything is sent, so
 * closing the tab or losing signal never loses a check-in.
 */
export function useCheckIn(eventId: string) {
  const store = useMemo(() => createQueueStore(safeStorage(), eventId), [eventId]);
  const device = useMemo(() => getDeviceId(safeStorage(), newId), []);
  const [snapshot, setSnapshot] = useState<RosterSnapshot | null>(null);
  const [queue, setQueue] = useState<QueuedOp[]>([]);
  const [failed, setFailed] = useState<FailedOp[]>([]);
  const [connection, setConnection] = useState<Connection>("online");
  const [syncing, setSyncing] = useState(false);
  const [lastSynced, setLastSynced] = useState<string | null>(null);
  const [storageOk, setStorageOk] = useState(true);
  const syncingRef = useRef(false);
  const queueRef = useRef<QueuedOp[]>([]);

  // Load what this device already has.
  useEffect(() => {
    /* eslint-disable react-hooks/set-state-in-effect -- reading local storage after mount */
    setSnapshot(store.roster());
    const q = store.queue();
    queueRef.current = q;
    setQueue(q);
    setFailed(store.failed());
    setConnection(navigator.onLine ? "online" : "offline");
    /* eslint-enable react-hooks/set-state-in-effect */
  }, [store]);

  const saveQueue = useCallback(
    (q: QueuedOp[]) => {
      queueRef.current = q;
      setQueue(q);
      setStorageOk(store.saveQueue(q));
    },
    [store],
  );

  const refresh = useCallback(async () => {
    try {
      const res = await fetch(`/api/staff/roster?event=${eventId}`, { cache: "no-store" });
      if (res.status === 401 || res.status === 403) {
        setConnection("signed_out");
        return;
      }
      if (!res.ok) throw new Error(String(res.status));
      const snap = (await res.json()) as RosterSnapshot;
      setSnapshot(snap);
      store.saveRoster(snap);
      setConnection("online");
    } catch {
      setConnection(navigator.onLine ? "unreachable" : "offline");
    }
  }, [eventId, store]);

  const sync = useCallback(async () => {
    if (syncingRef.current) return;
    const batch = queueRef.current;
    if (batch.length === 0) {
      await refresh();
      return;
    }
    syncingRef.current = true;
    setSyncing(true);
    try {
      const res = await fetch("/api/staff/sync", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ device_id: device, ops: batch.slice(0, 200) }),
      });
      if (res.status === 401 || res.status === 403) {
        setConnection("signed_out");
        const partial = (await res.json().catch(() => ({}))) as { results?: OpResult[] };
        if (partial.results?.length) applyResults(partial.results);
        return;
      }
      if (!res.ok) throw new Error(String(res.status));
      const { results } = (await res.json()) as { results: OpResult[] };
      applyResults(results);
      setLastSynced(new Date().toISOString());
      setConnection("online");
      await refresh();
    } catch {
      setConnection(navigator.onLine ? "unreachable" : "offline");
    } finally {
      syncingRef.current = false;
      setSyncing(false);
    }

    function applyResults(results: OpResult[]) {
      // Anything queued while the request was in flight stays queued.
      const { remaining, failed: newlyFailed } = reconcile(queueRef.current, results, new Date().toISOString());
      saveQueue(remaining);
      if (newlyFailed.length) {
        setFailed((f) => {
          const next = [...f, ...newlyFailed];
          store.saveFailed(next);
          return next;
        });
      }
    }
  }, [device, refresh, saveQueue, store]);

  // Sync on connection changes, on focus, and every 20 seconds.
  useEffect(() => {
    const kick = () => void sync();
    const goOffline = () => setConnection("offline");
    window.addEventListener("online", kick);
    window.addEventListener("offline", goOffline);
    window.addEventListener("focus", kick);
    const timer = window.setInterval(kick, 20_000);
    kick();
    return () => {
      window.removeEventListener("online", kick);
      window.removeEventListener("offline", goOffline);
      window.removeEventListener("focus", kick);
      window.clearInterval(timer);
    };
  }, [sync]);

  const enqueue = useCallback(
    (op: NewOp) => {
      const full = { ...op, op_id: newId(), queued_at: new Date().toISOString() } as QueuedOp;
      saveQueue([...queueRef.current, full]);
      void sync();
      return full;
    },
    [saveQueue, sync],
  );

  const dismissFailed = useCallback(
    (opId: string) => {
      setFailed((f) => {
        const next = f.filter((x) => x.op.op_id !== opId);
        store.saveFailed(next);
        return next;
      });
    },
    [store],
  );

  const rows = useMemo(() => applyQueuedOps(snapshot?.rows ?? [], queue), [snapshot, queue]);

  return {
    snapshot,
    rows,
    queue,
    failed,
    connection,
    syncing,
    lastSynced,
    storageOk,
    deviceId: device,
    enqueue,
    sync,
    refresh,
    dismissFailed,
    newId,
  };
}
