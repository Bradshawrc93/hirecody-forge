import { NextResponse } from "next/server";
import { getRun, getSteps, ObsError } from "@/lib/obs";
import { getAgentKey } from "@/lib/kv";

export async function GET(req: Request) {
  const url = new URL(req.url);
  const appId = url.searchParams.get("app_id");
  const runId = url.searchParams.get("run_id");
  if (!appId || !runId) {
    return NextResponse.json({ error: "app_id and run_id required" }, { status: 400 });
  }
  const apiKey = await getAgentKey(appId);
  if (!apiKey) return NextResponse.json({ error: "no key" }, { status: 404 });
  try {
    const [{ run }, stepsResp] = await Promise.all([
      getRun(runId, apiKey),
      getSteps(runId, apiKey, 0),
    ]);
    return NextResponse.json({ run, steps: stepsResp.steps });
  } catch (e) {
    if (e instanceof ObsError) return NextResponse.json(e.body, { status: e.status });
    return NextResponse.json({ error: "fetch_failed" }, { status: 502 });
  }
}
