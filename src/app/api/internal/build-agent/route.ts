import { NextResponse } from "next/server";
import {
  createAgent,
  patchAgent,
  postBuild,
  ObsError,
  type CreateAgentInput,
  type AgentRecord,
} from "@/lib/obs";
import { setAgentKey } from "@/lib/kv";
import { buildAgentPlan } from "@/lib/builder";
import { safetyCheck } from "@/lib/guardrail";
import { BUILDER_MODEL } from "@/lib/anthropic";
import { slugify } from "@/lib/format";
import type { InputConfig } from "@/components/CreateFlow/types";
import { inputConfigToLegacy } from "@/components/CreateFlow/types";

interface RequestBody {
  // Step 1
  display_name: string;
  slug?: string;
  description: string;
  // Step 2
  needs_llm: boolean;
  model: string;
  input_config: InputConfig;
  can_send_email: boolean;
  has_web_access: boolean;
  schedule_cadence: "daily" | "weekly" | "monthly" | null;
  schedule_time: string | null;
  schedule_day_of_week: number | null;
  schedule_day_of_month: number | null;
  verified_email: string | null;
  // Step 3
  success_criteria: string;
  output_type: "text" | "file" | "email" | "notification" | "side-effect";
  context_text: string | null;
  user_feedback?: string | null;
}

export async function POST(req: Request) {
  let body: RequestBody;
  try {
    body = (await req.json()) as RequestBody;
  } catch {
    return NextResponse.json({ error: "invalid json" }, { status: 400 });
  }

  // Server-side safety check (re-run defensively even if client checked).
  try {
    const safety = await safetyCheck(body.display_name, body.description);
    if (!safety.safe) {
      return NextResponse.json(
        { error: "content_blocked", details: safety.reason },
        { status: 400 }
      );
    }
  } catch (e) {
    return NextResponse.json(
      { error: "safety_check_failed", details: String(e) },
      { status: 500 }
    );
  }

  const baseSlug = body.slug?.trim() || slugify(body.display_name);

  const createPayload: CreateAgentInput = {
    slug: baseSlug,
    display_name: body.display_name,
    description: body.description,
    config: {},
    needs_llm: body.needs_llm,
    model: body.model,
    input_type: inputConfigToLegacy(body.input_config),
    can_send_email: body.can_send_email,
    has_web_access: body.has_web_access,
    success_criteria: body.success_criteria,
    output_type: body.output_type,
    context_text: body.context_text,
    schedule_cadence: body.schedule_cadence,
    schedule_time: body.schedule_time,
    schedule_day_of_week: body.schedule_day_of_week,
    schedule_day_of_month: body.schedule_day_of_month,
    verified_email: body.verified_email,
  };

  // Retry with -2, -3, ... if the slug collides with a soft-deleted
  // agent that's still holding the unique-key row on apps.slug.
  function isDupSlug(err: ObsError): boolean {
    const blob = typeof err.body === "string" ? err.body : JSON.stringify(err.body ?? "");
    return /apps_slug_key|duplicate key|already exists/i.test(blob);
  }

  let app: { id: string; slug: string; display_name: string };
  let agent: AgentRecord;
  let apiKey: string;
  try {
    let attempt = 0;
    while (true) {
      try {
        const created = await createAgent(createPayload);
        app = created.app;
        agent = created.agent;
        apiKey = created.api_key;
        break;
      } catch (e) {
        if (e instanceof ObsError && isDupSlug(e) && attempt < 20) {
          attempt += 1;
          createPayload.slug = `${baseSlug}-${attempt + 1}`;
          continue;
        }
        throw e;
      }
    }
  } catch (e) {
    if (e instanceof ObsError) {
      return NextResponse.json(e.body, { status: e.status });
    }
    return NextResponse.json({ error: "obs_create_failed" }, { status: 502 });
  }

  // KV write must happen before anything else can fail — the key is
  // unrecoverable.
  try {
    await setAgentKey(app.id, apiKey);
  } catch (e) {
    return NextResponse.json(
      { error: "kv_write_failed", details: String(e), app_id: app.id },
      { status: 500 }
    );
  }

  // Build the plan.
  let buildResult;
  try {
    buildResult = await buildAgentPlan({
      display_name: body.display_name,
      description: body.description,
      success_criteria: body.success_criteria,
      context_text: body.context_text,
      needs_llm: body.needs_llm,
      model: body.model,
      input_config: body.input_config,
      can_send_email: body.can_send_email,
      has_web_access: body.has_web_access,
      output_type: body.output_type,
      verified_email: body.verified_email,
      user_feedback: body.user_feedback ?? null,
    });
  } catch (e) {
    // Log the failed build attempt.
    await postBuild(app.id, apiKey, {
      attempt_number: 1,
      prompt: body.description,
      form_snapshot: body as unknown as Record<string, unknown>,
      generated_config: {},
      builder_model: BUILDER_MODEL,
      input_tokens: 0,
      output_tokens: 0,
      duration_ms: 0,
      status: "failed",
      error_message: String(e),
    }).catch(() => undefined);
    return NextResponse.json(
      {
        error: "builder_failed",
        details: String(e),
        app_id: app.id,
        slug: app.slug,
      },
      { status: 500 }
    );
  }

  // Persist the generated plan as the agent's config.
  try {
    await patchAgent(app.id, apiKey, { config: buildResult.plan as unknown as Record<string, unknown> });
  } catch (e) {
    return NextResponse.json(
      { error: "patch_config_failed", details: String(e) },
      { status: 500 }
    );
  }

  // Log the successful build (auto-advances agent to awaiting_test).
  try {
    await postBuild(app.id, apiKey, {
      attempt_number: 1,
      prompt: body.description,
      form_snapshot: body as unknown as Record<string, unknown>,
      generated_config: buildResult.plan as unknown as Record<string, unknown>,
      builder_model: BUILDER_MODEL,
      input_tokens: buildResult.inputTokens,
      output_tokens: buildResult.outputTokens,
      duration_ms: buildResult.durationMs,
      status: "success",
    });
  } catch (e) {
    return NextResponse.json(
      { error: "post_build_failed", details: String(e) },
      { status: 500 }
    );
  }

  return NextResponse.json({
    ok: true,
    app_id: app.id,
    slug: app.slug,
    display_name: app.display_name,
    agent_status: agent.status,
  });
}
