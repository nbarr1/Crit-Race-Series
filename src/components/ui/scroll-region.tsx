"use client";

import { useEffect, useRef, useState } from "react";

/**
 * A container that scrolls sideways when its table is wider than the screen.
 * When it does scroll, it joins the tab order and gets a name, so keyboard
 * users can scroll it too (WCAG 2.1.1). When it fits, it stays out of the way.
 */
export function ScrollRegion({ label, children }: { label: string; children: React.ReactNode }) {
  const ref = useRef<HTMLDivElement>(null);
  const [scrolls, setScrolls] = useState(false);
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const check = () => setScrolls(el.scrollWidth > el.clientWidth + 1);
    check();
    const ro = new ResizeObserver(check);
    ro.observe(el);
    return () => ro.disconnect();
  }, []);
  return (
    <div
      ref={ref}
      className="overflow-x-auto"
      {...(scrolls ? { role: "region", "aria-label": label, tabIndex: 0 } : {})}
    >
      {children}
    </div>
  );
}
