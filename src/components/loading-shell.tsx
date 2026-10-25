export function LoadingShell({ label }: { label: string }) {
  return (
    <div className="min-h-dvh" role="status" aria-label={label}>
      <header className="border-b border-line">
        <div className="mx-auto flex max-w-6xl items-center gap-3 px-6 py-4 md:px-10">
          <div aria-hidden="true" className="size-9 animate-pulse rounded-lg bg-line" />
          <div className="space-y-1.5">
            <div className="h-3 w-24 animate-pulse rounded bg-line" />
            <div className="h-2.5 w-32 animate-pulse rounded bg-line/70" />
          </div>
          <div className="ml-auto flex gap-1.5">
            {[0, 1, 2, 3].map((index) => (
              <div
                key={index}
                aria-hidden="true"
                className="size-9 animate-pulse rounded-md bg-line/70"
              />
            ))}
          </div>
        </div>
      </header>
      <main className="mx-auto max-w-6xl px-6 py-10 md:px-10 md:py-14">
        <div className="h-7 w-64 animate-pulse rounded bg-line" />
        <div className="mt-3 h-4 w-96 max-w-full animate-pulse rounded bg-line/70" />
        <div className="mt-8 h-72 animate-pulse rounded-xl border border-line bg-panel" />
        <span className="sr-only">{label}</span>
      </main>
    </div>
  );
}
