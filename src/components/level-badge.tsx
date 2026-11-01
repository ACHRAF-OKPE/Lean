import type { Level } from "@/modules/identity/modules";
import { levelLabel } from "@/modules/identity/modules";

const LEVEL_CLASS: Record<Level, string> = {
  none: "border-copper/20 bg-panel text-copper",
  read: "border-line bg-canvas text-muted",
  write: "border-brand/20 bg-brand-soft text-brand-strong",
  manage: "border-brand/30 bg-brand text-canvas",
};

export function LevelBadge({ level, title }: { level: Level; title?: string }) {
  return (
    <span
      title={title}
      className={`inline-flex rounded-full border px-2 py-0.5 text-[10px] whitespace-nowrap ${LEVEL_CLASS[level]}`}
    >
      {levelLabel(level)}
    </span>
  );
}
