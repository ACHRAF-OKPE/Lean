"use client";

import { useEffect, useState } from "react";
import type { TaskStatus } from "@/db/schema";
import { formatDuration, formatStopwatch } from "@/modules/tasks/time";

export function TaskChrono({
  status,
  startedAt,
  elapsedSeconds,
  initialSeconds,
  compact = false,
}: {
  status: TaskStatus;
  startedAt: string | null;
  elapsedSeconds: number;
  initialSeconds: number;
  compact?: boolean;
}) {
  const running = status === "in_progress" && startedAt !== null;
  const [liveSeconds, setLiveSeconds] = useState(initialSeconds);

  useEffect(() => {
    if (!running || !startedAt) {
      return;
    }
    const started = Date.parse(startedAt);
    const timer = window.setInterval(() => {
      setLiveSeconds(elapsedSeconds + Math.max(0, Math.round((Date.now() - started) / 1000)));
    }, 1000);
    return () => window.clearInterval(timer);
  }, [elapsedSeconds, running, startedAt]);

  const seconds = running ? liveSeconds : elapsedSeconds;

  if (compact) {
    if (!running && seconds === 0) {
      return <span className="text-muted">—</span>;
    }
    return (
      <span
        className={`font-mono tabular-nums ${running ? "text-brand-strong" : "text-muted"}`}
        aria-label={running ? "Chronomètre en cours" : "Temps cumulé"}
      >
        {running ? formatStopwatch(seconds) : formatDuration(seconds)}
      </span>
    );
  }

  return (
    <span className={`font-mono tabular-nums ${running ? "text-brand-strong" : ""}`}>
      {formatStopwatch(seconds)}
    </span>
  );
}
