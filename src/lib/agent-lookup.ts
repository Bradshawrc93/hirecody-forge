import { unstable_cache } from "next/cache";
import { listAgents, type AgentRecord } from "./obs";

// Slug → AgentRecord lookups happened on every navigation to /agents/...
// pages. Each one re-fetched the full agent list from Obs, so even
// going back-and-forth between an agent and its run paid two full
// listAgents round-trips. Cache the lookup for 30s so repeat nav is
// effectively free; still fresh enough that newly-created agents show
// up quickly.
const cachedListAgents = unstable_cache(
  async () => {
    const { agents } = await listAgents();
    return agents;
  },
  ["agent-lookup:listAgents"],
  { revalidate: 30, tags: ["agents"] }
);

export async function findAgentBySlug(
  slug: string
): Promise<AgentRecord | null> {
  try {
    const agents = await cachedListAgents();
    return agents.find((a) => a.apps?.slug === slug) ?? null;
  } catch {
    return null;
  }
}
