// Renders instantly while the server resolves the agent detail page.
// Mirrors the real layout (header, latest-run card, history list, sidebar)
// so the swap to real content doesn't shift the page.
export default function Loading() {
  return (
    <main className="relative min-h-screen">
      <div className="mx-auto max-w-5xl px-6 pt-20 pb-16">
        <div className="h-3 w-24 animate-pulse rounded bg-[color:var(--color-border)]/60" />
        <header className="mt-4 border-b border-[color:var(--color-border)] pb-8">
          <div className="mb-3 flex items-center gap-3">
            <span className="h-px w-8 bg-[color:var(--color-primary)]" />
            <span className="text-sm font-medium uppercase tracking-wide text-[color:var(--color-primary)]">
              Agent
            </span>
          </div>
          <div className="h-9 w-72 animate-pulse rounded bg-[color:var(--color-border)]/60" />
          <div className="mt-4 space-y-2">
            <div className="h-3 w-full max-w-xl animate-pulse rounded bg-[color:var(--color-border)]/40" />
            <div className="h-3 w-2/3 max-w-md animate-pulse rounded bg-[color:var(--color-border)]/40" />
          </div>
        </header>

        <div className="mt-10 grid grid-cols-1 gap-10 md:grid-cols-[1fr_240px]">
          <div className="space-y-10">
            <section>
              <h2 className="mb-3 text-sm font-semibold uppercase tracking-wide">
                Latest Run
              </h2>
              <div className="card h-[88px] animate-pulse p-5" />
            </section>
            <section>
              <h2 className="mb-3 text-sm font-semibold uppercase tracking-wide">
                Run History
              </h2>
              <div className="overflow-hidden rounded-xl border border-[color:var(--color-border)] bg-[color:var(--color-card)]">
                {Array.from({ length: 4 }).map((_, i) => (
                  <div
                    key={i}
                    className="h-12 animate-pulse border-b border-[color:var(--color-border)]/60 last:border-b-0"
                  />
                ))}
              </div>
            </section>
          </div>
          <aside className="card h-fit animate-pulse p-5">
            <div className="h-32" />
          </aside>
        </div>
      </div>
    </main>
  );
}
