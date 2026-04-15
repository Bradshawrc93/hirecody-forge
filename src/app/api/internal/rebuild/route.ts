import { NextResponse } from "next/server";
import { patchAgent, postBuild, ObsError } from "@/lib/obs";
import { getAgentKey } from "@/lib/kv";
import { buildAgentPlan } from "@/lib/builder";
import { BUILDER_MODEL } from "@/lib/anthropic";

interface Body {
  app_id: string;
  user_feedback: string;
  // Same form fields used at first build.
  display_name: string;
  description: string;
  needs_llm: boolean;
  model: string;
  input_type: "none" | "text" | "file" | "both";
  can_send_email: boolean;
  has_web_access: boolean;
  output_type: "text" | "file" | "email" | "notification" | "side-effect";
  success_criteria: string;
  context_text: string | null;
  verified_email: string | null;
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

  // Walk the agent back to building so we can post a 2nd build attempt.
  try {
    await patchAgent(body.app_id, apiKey, { status: "building" });
  } catch (e) {
    if (e instanceof ObsError) return NextResponse.json(e.body, { status: e.status });
    return NextResponse.json({ error: "patch_failed" }, { status: 500 });
  }

  let buildResult;
  try {
    buildResult = await buildAgentPlan({
      display_name: body.display_name,
      description: body.description,
      success_criteria: body.success_criteria,
      context_text: body.context_text,
      needs_llm: body.needs_llm,
      model: body.model,
      input_type: body.input_type,
      can_send_email: body.can_send_email,
      has_web_access: body.has_web_access,
      output_type: body.output_type,
      verified_email: body.verified_email,
      user_feedback: body.user_feedback,
    });
  } catch (e) {
    await postBuild(body.app_id, apiKey, {
      attempt_number: 2,
      prompt: body.description,
      form_snapshot: body as unknown as Record<string, unknown>,
      generated_config: {},
      builder_model: BUILDER_MODEL,
      input_tokens: 0,
      output_tokens: 0,
      duration_ms: 0,
      status: "failed",
      error_message: String(e),
      user_feedback: body.user_feedback,
    }).catch(() => undefined);
    return NextResponse.json({ error: "builder_failed", details: String(e) }, { status: 500 });
  }

  await patchAgent(body.app_id, apiKey, {
    config: buildResult.plan as unknown as Record<string, unknown>,
  });
  await postBuild(body.app_id, apiKey, {
    attempt_number: 2,
    prompt: body.description,
    form_snapshot: body as unknown as Record<string, unknown>,
    generated_config: buildResult.plan as unknown as Record<string, unknown>,
    builder_model: BUILDER_MODEL,
    input_tokens: buildResult.inputTokens,
    output_tokens: buildResult.outputTokens,
    duration_ms: buildResult.durationMs,
    status: "success",
    user_feedback: body.user_feedback,
  });

  return NextResponse.json({ ok: true, app_id: body.app_id });
}
