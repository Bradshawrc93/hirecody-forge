import { NextResponse } from "next/server";
import { getSteps, ObsError } from "@/lib/obs";
import { getAgentKey } from "@/lib/kv";

// Proxy poll endpoint: client → Forge → Obs. Uses KV to look up the api
// key so we never expose it to the browser.
export async function GET(req: Request) {
  const url = new URL(req.url);
  const appId = url.searchParams.get("app_id");
  const runId = url.searchParams.get("run_id");
  const since = Number(url.searchParams.get("since") ?? "0");
  if (!appId || !runId) {
    return NextResponse.json({ error: "app_id and run_id required" }, { status: 400 });
  }
  const apiKey = await getAgentKey(appId);
  if (!apiKey) {
    return NextResponse.json({ error: "agent key not in KV" }, { status: 404 });
  }
  try {
    const data = await getSteps(runId, apiKey, since);
    return NextResponse.json(data);
  } catch (e) {
    if (e instanceof ObsError) return NextResponse.json(e.body, { status: e.status });
    return NextResponse.json({ error: "poll_failed" }, { status: 502 });
  }
}
