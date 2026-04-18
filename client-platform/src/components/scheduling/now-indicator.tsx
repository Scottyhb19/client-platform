"use client";

import { useEffect, useState } from "react";
import { SCH_END_HOUR, SCH_START_HOUR, schMinToTop } from "@/utils/scheduleGrid";

export function NowIndicator() {
  const [top, setTop] = useState<number | null>(null);

  useEffect(() => {
    function update() {
      const now = new Date();
      const mins = now.getHours() * 60 + now.getMinutes();
      const startMins = SCH_START_HOUR * 60;
      const endMins = SCH_END_HOUR * 60;
      if (mins < startMins || mins > endMins) {
        setTop(null);
      } else {
        setTop(schMinToTop(mins));
      }
    }
    update();
    const id = setInterval(update, 60_000);
    return () => clearInterval(id);
  }, []);

  if (top === null) return null;

  return (
    <div
      className="sch-now-dot absolute left-0 right-0 h-[2px] bg-[var(--color-red)] z-[3] pointer-events-none"
      style={{ top: `${top}px` }}
      aria-hidden="true"
    />
  );
}
