import { NextResponse } from "next/server";
import { getRun, ObsError } from "@/lib/obs";
import { getAgentKey } from "@/lib/kv";

export async function GET(req: Request) {
  const url = new URL(req.url);
  const appId = url.searchParams.get("app_id");
  const runId = url.searchParams.get("run_id");
  if (!appId || !runId) {
    return NextResponse.json({ error: "app_id and run_id required" }, { status: 400 });
  }
  const apiKey = await getAgentKey(appId);
  if (!apiKey) {
    return NextResponse.json({ error: "agent key not in KV" }, { status: 404 });
  }
  try {
    const { run } = await getRun(runId, apiKey);
    return NextResponse.json(run);
  } catch (e) {
    if (e instanceof ObsError) return NextResponse.json(e.body, { status: e.status });
    return NextResponse.json({ error: "fetch_failed" }, { status: 502 });
  }
}
