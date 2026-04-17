import { NextResponse } from "next/server";
import { listAgentIds, getAgentKey } from "@/lib/kv";
import { getAgent, listAgentRuns } from "@/lib/obs";
import { isAgentPlan } from "@/lib/agent-plan";
import { executeAgent } from "@/lib/execution-engine";

export const maxDuration = 300;

// Vercel cron hits this every 5 minutes. We pick up `queued` scheduled
// runs for KV-known agents and execute them serially. Bail before the
// 60-second function limit; remaining runs get picked up next tick.
export async function GET(req: Request) {
  // Auth: Vercel cron sends `Authorization: Bearer ${CRON_SECRET}`.
  // For local/manual triggers we also accept FORGE_CRON_SECRET via x-cron-key.
  const cronSecret = process.env.CRON_SECRET;
  const auth = req.headers.get("authorization");
  const isVercelCron = !!cronSecret && auth === `Bearer ${cronSecret}`;
  const forgeSecret = process.env.FORGE_CRON_SECRET;
  const provided = req.headers.get("x-cron-key");
  const isManual = !!forgeSecret && provided === forgeSecret;
  if (!isVercelCron && !isManual) {
    return NextResponse.json({ error: "unauthorized" }, { status: 403 });
  }

  const startedAt = Date.now();
  const BAIL_AT_MS = 280_000;
  const executed: { app_id: string; run_id: string; status: string }[] = [];
  const skipped: string[] = [];

  let agentIds: string[];
  try {
    agentIds = await listAgentIds();
  } catch (e) {
    return NextResponse.json(
      { error: "kv_list_failed", details: String(e) },
      { status: 500 }
    );
  }

  for (const appId of agentIds) {
    if (Date.now() - startedAt > BAIL_AT_MS) {
      skipped.push(appId);
      continue;
    }
    const apiKey = await getAgentKey(appId);
    if (!apiKey) continue;

    let queued;
    try {
      const r = await listAgentRuns(appId, apiKey, {
        status: "queued",
        run_type: "scheduled",
        limit: 5,
      });
      queued = r.runs;
    } catch {
      continue;
    }
    if (queued.length === 0) continue;

    let plan;
    let slug: string | undefined;
    let verifiedEmail: string | null | undefined;
    try {
      const info = await getAgent(appId, apiKey);
      if (!isAgentPlan(info.agent.config)) continue;
      plan = info.agent.config;
      slug = info.app.slug;
      verifiedEmail = info.agent.verified_email;
    } catch {
      continue;
    }

    for (const run of queued) {
      if (Date.now() - startedAt > BAIL_AT_MS) {
        skipped.push(`${appId}:${run.id}`);
        break;
      }
      const result = await executeAgent({
        runId: run.id,
        apiKey,
        slug,
        plan,
        verifiedEmail,
      });
      executed.push({ app_id: appId, run_id: run.id, status: result.status });
    }
  }

  return NextResponse.json({
    ok: true,
    executed_count: executed.length,
    skipped_count: skipped.length,
    duration_ms: Date.now() - startedAt,
    executed,
  });
}

// Allow POST too — Vercel cron can be either depending on config.
export const POST = GET;
