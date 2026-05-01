// Renders instantly while the server resolves the run detail page.
// Mirrors the real layout so the swap to real content doesn't shift.
export default function Loading() {
  return (
    <main className="relative min-h-screen">
      <div className="mx-auto max-w-5xl px-6 pt-20 pb-16">
        <div className="h-3 w-24 animate-pulse rounded bg-[color:var(--color-border)]/60" />
        <header className="mt-4 flex flex-wrap items-center justify-between gap-3 border-b border-[color:var(--color-border)] pb-6">
          <div>
            <div className="mb-2 flex items-center gap-3">
              <span className="h-px w-8 bg-[color:var(--color-primary)]" />
              <span className="text-sm font-medium uppercase tracking-wide text-[color:var(--color-primary)]">
                Run
              </span>
            </div>
            <div className="h-9 w-48 animate-pulse rounded bg-[color:var(--color-border)]/60" />
            <div className="mt-2 h-3 w-32 animate-pulse rounded bg-[color:var(--color-border)]/40" />
          </div>
          <div className="h-5 w-32 animate-pulse rounded bg-[color:var(--color-border)]/40" />
        </header>

        <section className="mt-8">
          <h2 className="mb-3 text-sm font-semibold uppercase tracking-wide">
            Output
          </h2>
          <div className="card animate-pulse p-5">
            <div className="space-y-2">
              <div className="h-3 w-full rounded bg-[color:var(--color-border)]/40" />
              <div className="h-3 w-11/12 rounded bg-[color:var(--color-border)]/40" />
              <div className="h-3 w-3/4 rounded bg-[color:var(--color-border)]/40" />
            </div>
          </div>
        </section>

        <section className="mt-10">
          <h2 className="mb-3 text-sm font-semibold uppercase tracking-wide">
            Waterfall
          </h2>
          <div className="card h-32 animate-pulse p-5" />
        </section>
      </div>
    </main>
  );
}
