import { describe, expect, it } from "vitest";
import {
  deadlineLabel,
  elapsedSecondsAt,
  formatDuration,
  formatStopwatch,
  runPatch,
  secondsUntilDeadline,
} from "./time";

const START = new Date("2026-10-28T09:00:00Z");
const NINETY_SECONDS_LATER = new Date("2026-10-28T09:01:30Z");

describe("TSK-006 — chronométrage d'une tâche", () => {
  it("arme un passage au démarrage puis cumule sa durée à la fermeture", () => {
    const opened = { status: "open" as const, startedAt: null, elapsedSeconds: 0 };

    const running = runPatch(opened, "in_progress", START);
    expect(running).toEqual({ startedAt: START, elapsedSeconds: 0 });

    const during = { status: "in_progress" as const, ...running };
    expect(elapsedSecondsAt(during, NINETY_SECONDS_LATER)).toBe(90);

    const closed = runPatch(during, "done", NINETY_SECONDS_LATER);
    expect(closed).toEqual({ startedAt: null, elapsedSeconds: 90 });

    const cancelled = runPatch(during, "cancelled", NINETY_SECONDS_LATER);
    expect(cancelled).toEqual({ startedAt: null, elapsedSeconds: 90 });

    const withoutRun = runPatch(opened, "done", NINETY_SECONDS_LATER);
    expect(withoutRun).toEqual({ startedAt: null, elapsedSeconds: 0 });
  });

  it("conserve le cumul à la réouverture et ouvre un second passage", () => {
    const reopened = runPatch(
      { status: "done", startedAt: null, elapsedSeconds: 90 },
      "open",
      new Date("2026-10-28T10:00:00Z"),
    );
    expect(reopened).toEqual({ startedAt: null, elapsedSeconds: 90 });

    const secondStart = new Date("2026-10-28T10:00:00Z");
    const running = runPatch({ status: "open", ...reopened }, "in_progress", secondStart);
    expect(running).toEqual({ startedAt: secondStart, elapsedSeconds: 90 });
    expect(
      elapsedSecondsAt({ status: "in_progress", ...running }, new Date("2026-10-28T10:02:00Z")),
    ).toBe(210);
  });

  it("formate le chronomètre et les durées lisibles", () => {
    expect(formatStopwatch(0)).toBe("0:00");
    expect(formatStopwatch(90)).toBe("1:30");
    expect(formatStopwatch(3661)).toBe("1:01:01");

    expect(formatDuration(0)).toBe("0 s");
    expect(formatDuration(59)).toBe("59 s");
    expect(formatDuration(60)).toBe("1 min");
    expect(formatDuration(3600)).toBe("1 h");
    expect(formatDuration(3661)).toBe("1 h 01 min");
    expect(formatDuration(86400)).toBe("1 j");
    expect(formatDuration(90000)).toBe("1 j 1 h");
  });

  it("mesure le reste avant la fin du jour civil d'Abidjan", () => {
    const noon = new Date("2026-10-28T12:00:00Z");
    expect(secondsUntilDeadline("2026-10-28", noon)).toBe(43200);
    expect(deadlineLabel("2026-10-28", noon)).toBe("Échéance dans 12 h");

    expect(secondsUntilDeadline("2026-10-27", noon)).toBe(-43200);
    expect(deadlineLabel("2026-10-27", noon)).toBe("Échéance dépassée de 12 h");

    const lastSecond = new Date("2026-10-28T23:59:59.999Z");
    expect(secondsUntilDeadline("2026-10-28", lastSecond)).toBe(0);
    expect(deadlineLabel("2026-10-28", lastSecond)).toBe("Échéance dans 0 s");
  });
});
