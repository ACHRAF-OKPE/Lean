import type { TaskStatus } from "@/db/schema";

export interface TaskChronoState {
  readonly status: TaskStatus;
  readonly startedAt: Date | null;
  readonly elapsedSeconds: number;
}

function secondsBetween(from: Date, to: Date): number {
  return Math.max(0, Math.round((to.getTime() - from.getTime()) / 1000));
}

export function elapsedSecondsAt(task: TaskChronoState, now: Date): number {
  if (task.status !== "in_progress" || !task.startedAt) {
    return task.elapsedSeconds;
  }
  return task.elapsedSeconds + secondsBetween(task.startedAt, now);
}

export function runPatch(
  task: TaskChronoState,
  next: TaskStatus,
  now: Date,
): { startedAt: Date | null; elapsedSeconds: number } {
  if (next === "in_progress") {
    return { startedAt: now, elapsedSeconds: task.elapsedSeconds };
  }
  return { startedAt: null, elapsedSeconds: elapsedSecondsAt(task, now) };
}

export function formatStopwatch(totalSeconds: number): string {
  const seconds = Math.max(0, Math.floor(totalSeconds));
  const hours = Math.floor(seconds / 3600);
  const minutes = Math.floor((seconds % 3600) / 60);
  const rest = seconds % 60;
  const pad = (value: number) => String(value).padStart(2, "0");
  return hours > 0 ? `${hours}:${pad(minutes)}:${pad(rest)}` : `${minutes}:${pad(rest)}`;
}

export function formatDuration(totalSeconds: number): string {
  const seconds = Math.max(0, Math.floor(totalSeconds));
  if (seconds < 60) {
    return `${seconds} s`;
  }
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) {
    return `${minutes} min`;
  }
  const hours = Math.floor(minutes / 60);
  if (hours < 24) {
    const rest = minutes % 60;
    return rest > 0 ? `${hours} h ${String(rest).padStart(2, "0")} min` : `${hours} h`;
  }
  const days = Math.floor(hours / 24);
  const rest = hours % 24;
  return rest > 0 ? `${days} j ${rest} h` : `${days} j`;
}

// Abidjan reste à UTC+0 toute l'année : l'échéance court jusqu'à la fin du jour civil.
export function secondsUntilDeadline(dueDate: string, now: Date): number {
  return Math.round((Date.parse(`${dueDate}T23:59:59.999Z`) - now.getTime()) / 1000);
}

export function deadlineLabel(dueDate: string, now: Date): string {
  const remaining = secondsUntilDeadline(dueDate, now);
  return remaining < 0
    ? `Échéance dépassée de ${formatDuration(-remaining)}`
    : `Échéance dans ${formatDuration(remaining)}`;
}
