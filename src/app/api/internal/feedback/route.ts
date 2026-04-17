import { NextResponse } from "next/server";
import { Redis } from "@upstash/redis";
import { getRun, listAgentRuns, patchRun, ObsError } from "@/lib/obs";
import { getAgentKey } from "@/lib/kv";

const redis = Redis.fromEnv();

const RATE_LIMIT_PER_MIN = 10;

function clientIp(req: Request): string {
  const fwd = req.headers.get("x-forwarded-for");
  if (fwd) return fwd.split(",")[0]!.trim();
  return req.headers.get("x-real-ip") ?? "unknown";
}

export async function POST(req: Request) {
  const body = await req.json().catch(() => null);
  const appId = body?.app_id;
  const runId = body?.run_id;
  const vote = body?.vote;
  if (
    typeof appId !== "string" ||
    typeof runId !== "string" ||
    (vote !== "up" && vote !== "down")
  ) {
    return NextResponse.json(
      { error: "app_id, run_id, vote ('up'|'down') required" },
      { status: 400 }
    );
  }

  const ip = clientIp(req);
  const rlKey = `forge:feedback:rl:${ip}`;
  const count = await redis.incr(rlKey);
  if (count === 1) await redis.expire(rlKey, 60);
  if (count > RATE_LIMIT_PER_MIN) {
    return NextResponse.json({ error: "rate_limited" }, { status: 429 });
  }

  const apiKey = await getAgentKey(appId);
  if (!apiKey) {
    return NextResponse.json({ error: "agent_not_found" }, { status: 404 });
  }

  try {
    const latestResp = await listAgentRuns(appId, apiKey, { limit: 1 });
    const latest = latestResp.runs[0];
    if (!latest || latest.id !== runId) {
      return NextResponse.json({ error: "not_latest_run" }, { status: 400 });
    }
    if (latest.user_rating) {
      return NextResponse.json({ error: "already_voted" }, { status: 409 });
    }
    await patchRun(runId, apiKey, { user_rating: vote });
    return NextResponse.json({ ok: true, vote });
  } catch (e) {
    if (e instanceof ObsError) {
      return NextResponse.json(e.body, { status: e.status });
    }
    return NextResponse.json({ error: "feedback_failed" }, { status: 502 });
  }
}
