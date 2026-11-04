"use client";

import { useEffect, useState } from "react";

function parts(ms: number) {
  const s = Math.max(0, Math.floor(ms / 1000));
  return { days: Math.floor(s / 86400), hours: Math.floor((s % 86400) / 3600), minutes: Math.floor((s % 3600) / 60) };
}

/**
 * Time until the first start. Renders nothing on the server (the static
 * shell already shows the date), then updates every 30 seconds.
 */
export function Countdown({ startAt }: { startAt: string }) {
  const [now, setNow] = useState<number | null>(null);
  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- first tick after mount avoids a hydration mismatch
    setNow(Date.now());
    const t = setInterval(() => setNow(Date.now()), 30_000);
    return () => clearInterval(t);
  }, []);
  if (now === null) return null;
  const diff = new Date(startAt).getTime() - now;
  if (diff <= 0) return <p className="text-lg font-bold">Racing is underway.</p>;
  const { days, hours, minutes } = parts(diff);
  const text =
    days > 0
      ? `${days} ${days === 1 ? "day" : "days"}, ${hours} ${hours === 1 ? "hour" : "hours"}`
      : `${hours} ${hours === 1 ? "hour" : "hours"}, ${minutes} ${minutes === 1 ? "minute" : "minutes"}`;
  return (
    <p className="text-lg">
      First race in <span className="font-bold">{text}</span>
    </p>
  );
}
