import { NextResponse } from "next/server";
import { patchAgent, ObsError } from "@/lib/obs";
import { getAgentKey } from "@/lib/kv";

export async function POST(req: Request) {
  const { app_id, target } = (await req.json()) as {
    app_id: string;
    target: "active" | "paused";
  };
  const apiKey = await getAgentKey(app_id);
  if (!apiKey) return NextResponse.json({ error: "no key" }, { status: 404 });
  try {
    const r = await patchAgent(app_id, apiKey, { status: target });
    return NextResponse.json(r);
  } catch (e) {
    if (e instanceof ObsError) return NextResponse.json(e.body, { status: e.status });
    return NextResponse.json({ error: "patch_failed" }, { status: 500 });
  }
}
