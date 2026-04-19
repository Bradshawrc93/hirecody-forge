import Link from "next/link";
import { Server } from "lucide-react";
import { listAgents, type AgentRecord } from "@/lib/obs";
import { AgentCard } from "@/components/AgentCard";
import { BackButton } from "@/components/BackButton";

export const dynamic = "force-dynamic";
export const revalidate = 0;

async function loadAgents(): Promise<AgentRecord[]> {
  try {
    const { agents } = await listAgents();
    return agents.filter(
      (a) => a.status !== "expired" && a.status !== "deleted"
    );
  } catch {
    return [];
  }
}

export default async function HomePage() {
  const agents = await loadAgents();
  const owner = agents.filter((a) => a.creator_type === "owner");
  const community = agents.filter((a) => a.creator_type !== "owner");

  return (
    <main className="relative min-h-screen">
      <header className="mx-auto max-w-5xl px-6 pt-6">
        <BackButton />
      </header>

      <section className="mx-auto max-w-5xl px-6 pt-20 pb-16">
        <div className="mb-3 flex items-center gap-3">
          <span className="h-px w-8 bg-[color:var(--color-primary)]" />
          <span className="text-sm font-medium uppercase tracking-wide text-[color:var(--color-primary)]">
            Playground
          </span>
        </div>
        <h1 className="text-3xl font-semibold leading-tight tracking-tight md:text-4xl">
          Forge
        </h1>
        <p className="mt-3 max-w-2xl text-sm leading-relaxed text-[color:var(--color-muted-foreground)]">
          A playground for building and running custom agents. Build one, watch
          it work, see the telemetry.
        </p>
        <div className="mt-6 flex flex-wrap items-center gap-3">
          <Link
            href="/create"
            className="inline-flex items-center gap-2 rounded-lg bg-[color:var(--color-primary)] px-4 py-2 text-sm font-medium text-[color:var(--color-primary-foreground)] transition-colors duration-200 hover:bg-[#a85a24]"
          >
            Create Agent
          </Link>
          <a
            href="https://obs.hirecody.dev"
            target="_blank"
            rel="noopener noreferrer"
            className="inline-flex items-center gap-2 rounded-lg border border-[color:var(--color-border)] bg-transparent px-4 py-2 text-sm font-medium text-[color:var(--color-foreground)] transition-colors duration-200 hover:bg-[color:var(--color-muted)]"
          >
            <Server size={16} className="shrink-0" />
            Obs
          </a>
        </div>
      </section>

      <section className="mx-auto max-w-5xl px-6 pb-16">
        <h2 className="mb-3 text-sm font-semibold uppercase tracking-wide">
          Built by Cody
        </h2>
        {owner.length === 0 ? (
          <p className="text-sm leading-relaxed text-[color:var(--color-muted-foreground)]">
            No owner-curated agents yet.
          </p>
        ) : (
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
            {owner.map((a) => (
              <AgentCard key={a.app_id} agent={a} />
            ))}
          </div>
        )}
      </section>

      <section className="mx-auto max-w-5xl px-6 pb-24">
        <h2 className="mb-3 text-sm font-semibold uppercase tracking-wide">
          Community Agents
        </h2>
        {community.length === 0 ? (
          <p className="text-sm leading-relaxed text-[color:var(--color-muted-foreground)]">
            Be the first — click{" "}
            <span className="text-[color:var(--color-foreground)]">
              Create Agent
            </span>{" "}
            above.
          </p>
        ) : (
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
            {community.map((a) => (
              <AgentCard key={a.app_id} agent={a} />
            ))}
          </div>
        )}
      </section>

      <footer className="mx-auto max-w-5xl border-t border-[color:var(--color-border)] px-6 py-10 text-xs leading-relaxed text-[color:var(--color-muted-foreground)]">
        Agents are automatically removed after 6 months. This is a proof of
        concept — complex automations may not work perfectly.
      </footer>
    </main>
  );
}
