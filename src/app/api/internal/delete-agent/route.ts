import { NextResponse } from "next/server";
import { deleteAgent, ObsError } from "@/lib/obs";
import { deleteAgentKey, getAgentKey } from "@/lib/kv";

export async function POST(req: Request) {
  const { app_id } = (await req.json()) as { app_id: string };
  const apiKey = await getAgentKey(app_id);
  if (!apiKey) return NextResponse.json({ error: "no key" }, { status: 404 });
  try {
    await deleteAgent(app_id, apiKey);
    await deleteAgentKey(app_id);
    return NextResponse.json({ ok: true });
  } catch (e) {
    if (e instanceof ObsError) return NextResponse.json(e.body, { status: e.status });
    return NextResponse.json({ error: "delete_failed" }, { status: 500 });
  }
}
