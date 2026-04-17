import { NextResponse } from "next/server";
import { listAgentIds, getAgentKey } from "@/lib/kv";
import { listAgentRuns, getSteps, patchRun } from "@/lib/obs";

export const maxDuration = 60;

const RUNNING_STALE_MS = 15 * 60_000;
const QUEUED_STALE_MS = 30 * 60_000;

interface SweptEntry {
  app_id: string;
  run_id: string;
  was: "running" | "queued";
  reason: string;
  stale_ms: number;
}

export async function GET(req: Request) {
  const cronSecret = process.env.CRON_SECRET;
  const auth = req.headers.get("authorization");
  const isVercelCron = !!cronSecret && auth === `Bearer ${cronSecret}`;
  const forgeSecret = process.env.FORGE_CRON_SECRET;
  const provided = req.headers.get("x-cron-key");
  const isManual = !!forgeSecret && provided === forgeSecret;
  if (!isVercelCron && !isManual) {
    return NextResponse.json({ error: "unauthorized" }, { status: 403 });
  }

  const now = Date.now();
  const swept: SweptEntry[] = [];

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
    const apiKey = await getAgentKey(appId);
    if (!apiKey) continue;

    // Stale `running`: no step activity in RUNNING_STALE_MS.
    try {
      const { runs } = await listAgentRuns(appId, apiKey, {
        status: "running",
        limit: 20,
      });
      for (const r of runs) {
        const { steps } = await getSteps(r.id, apiKey);
        const stepTimes = steps
          .map((s) => Date.parse(s.completed_at ?? s.started_at ?? ""))
          .filter((n) => !Number.isNaN(n));
        const lastActivity = stepTimes.length
          ? Math.max(...stepTimes)
          : Date.parse(r.started_at ?? r.created_at ?? "");
        if (Number.isNaN(lastActivity)) continue;
        const staleMs = now - lastActivity;
        if (staleMs > RUNNING_STALE_MS) {
          await patchRun(r.id, apiKey, {
            status: "failed",
            error_message:
              "Stranded — execution did not complete (sweeper detected no step activity).",
            completed_at: new Date().toISOString(),
          }).catch(() => undefined);
          swept.push({
            app_id: appId,
            run_id: r.id,
            was: "running",
            reason: "no_step_activity",
            stale_ms: staleMs,
          });
        }
      }
    } catch {
      // ignore — try next agent
    }

    // Stale `queued`: never picked up by dispatch.
    try {
      const { runs } = await listAgentRuns(appId, apiKey, {
        status: "queued",
        limit: 20,
      });
      for (const r of runs) {
        const createdAt = Date.parse(r.created_at ?? "");
        if (Number.isNaN(createdAt)) continue;
        const staleMs = now - createdAt;
        if (staleMs > QUEUED_STALE_MS) {
          await patchRun(r.id, apiKey, {
            status: "failed",
            error_message:
              "Stranded — never picked up by dispatch (sweeper).",
            completed_at: new Date().toISOString(),
          }).catch(() => undefined);
          swept.push({
            app_id: appId,
            run_id: r.id,
            was: "queued",
            reason: "never_dispatched",
            stale_ms: staleMs,
          });
        }
      }
    } catch {
      // ignore — try next agent
    }
  }

  return NextResponse.json({ ok: true, swept_count: swept.length, swept });
}

export const POST = GET;
