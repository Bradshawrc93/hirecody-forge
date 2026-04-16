import Link from "next/link";
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
      <header className="mx-auto max-w-6xl px-6 pt-6">
        <BackButton />
      </header>

      <section className="mx-auto max-w-6xl px-6 pt-12">
        <h1 className="text-4xl font-bold tracking-tight md:text-5xl">
          Forge
        </h1>
        <p className="mt-3 max-w-2xl text-base text-[color:var(--color-muted-foreground)] md:text-lg">
          A playground for building and running custom agents. Build one, watch
          it work, see the telemetry.
        </p>
        <div className="mt-6">
          <Link href="/create" className="btn-primary inline-block">
            Create Agent
          </Link>
        </div>
      </section>

      <section className="mx-auto max-w-6xl px-6 pt-12">
        <h2 className="mb-4 text-xl font-bold">Built by Cody</h2>
        {owner.length === 0 ? (
          <p className="text-sm text-[color:var(--color-muted-foreground)]">
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

      <section className="mx-auto max-w-6xl px-6 pt-12">
        <h2 className="mb-4 text-xl font-bold">Community Agents</h2>
        {community.length === 0 ? (
          <p className="text-sm text-[color:var(--color-muted-foreground)]">
            Be the first — click <span className="font-semibold">Create Agent</span>{" "}
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

      <footer className="mx-auto mt-20 max-w-6xl px-6 py-10 text-xs text-[color:var(--color-muted-foreground)]">
        Agents are automatically removed after 6 months. This is a proof of
        concept — complex automations may not work perfectly.
      </footer>
    </main>
  );
}
