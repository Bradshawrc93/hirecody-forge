import { NextResponse } from "next/server";
import { patchAgent, patchRun, postFeedback, ObsError } from "@/lib/obs";
import { getAgentKey } from "@/lib/kv";

interface Body {
  app_id: string;
  run_id: string;
  rating: "up" | "down";
  feedback?: string;
}

export async function POST(req: Request) {
  let body: Body;
  try {
    body = (await req.json()) as Body;
  } catch {
    return NextResponse.json({ error: "invalid json" }, { status: 400 });
  }
  const apiKey = await getAgentKey(body.app_id);
  if (!apiKey) {
    return NextResponse.json({ error: "agent key not in KV" }, { status: 404 });
  }

  try {
    if (body.rating === "up") {
      await patchRun(body.run_id, apiKey, {
        user_rating: "up",
        success_criteria_met: true,
      });
      await patchAgent(body.app_id, apiKey, { status: "active" });
      return NextResponse.json({ ok: true, status: "active" });
    } else {
      await patchRun(body.run_id, apiKey, {
        user_rating: "down",
        success_criteria_met: false,
      });
      // Always capture feedback if provided.
      if (body.feedback?.trim()) {
        await postFeedback({
          agent_id: body.app_id,
          feedback_text: body.feedback,
        }).catch(() => undefined);
      }
      return NextResponse.json({ ok: true });
    }
  } catch (e) {
    if (e instanceof ObsError) return NextResponse.json(e.body, { status: e.status });
    return NextResponse.json({ error: "finalize_failed" }, { status: 500 });
  }
}
