import type { ReactNode } from "react";
import { CircleAlert } from "lucide-react";

export const INPUT_CLASS =
  "w-full rounded-md border border-line bg-panel px-3 py-2 text-sm outline-none transition-colors placeholder:text-muted/60 focus-visible:border-brand focus-visible:ring-2 focus-visible:ring-brand/20";

export function Field({
  label,
  htmlFor,
  hint,
  children,
}: {
  label: string;
  htmlFor: string;
  hint?: string;
  children: ReactNode;
}) {
  return (
    <div className="space-y-1.5">
      <label htmlFor={htmlFor} className="block text-[11px] font-medium">
        {label}
      </label>
      {children}
      {hint ? <p className="text-[10px] leading-4 text-muted">{hint}</p> : null}
    </div>
  );
}

export function CheckboxField({
  name,
  label,
  hint,
  defaultChecked = true,
}: {
  name: string;
  label: string;
  hint?: string;
  defaultChecked?: boolean;
}) {
  return (
    <label className="flex items-start gap-2 rounded-md border border-line bg-panel px-3 py-2">
      <input
        type="checkbox"
        name={name}
        defaultChecked={defaultChecked}
        className="mt-0.5 size-3.5 accent-brand"
      />
      <span>
        <span className="block text-[11px] font-medium">{label}</span>
        {hint ? <span className="block text-[10px] leading-4 text-muted">{hint}</span> : null}
      </span>
    </label>
  );
}

export function FormErrors({ errors }: { errors: readonly string[] }) {
  if (errors.length === 0) {
    return null;
  }

  return (
    <div
      role="alert"
      className="flex gap-2 rounded-md border border-copper/20 bg-copper-soft px-3 py-2.5 text-[11px] leading-5 text-copper"
    >
      <CircleAlert className="mt-0.5 size-3.5 shrink-0" aria-hidden="true" />
      <ul className="space-y-0.5">
        {errors.map((error) => (
          <li key={error}>{error}</li>
        ))}
      </ul>
    </div>
  );
}
