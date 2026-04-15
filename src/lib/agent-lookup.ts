import { listAgents, type AgentRecord } from "./obs";

export async function findAgentBySlug(
  slug: string
): Promise<AgentRecord | null> {
  try {
    const { agents } = await listAgents();
    return agents.find((a) => a.apps?.slug === slug) ?? null;
  } catch {
    return null;
  }
}
