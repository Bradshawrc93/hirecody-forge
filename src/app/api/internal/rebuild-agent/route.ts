import { NextResponse } from "next/server";
import { getAgent, patchAgent, postBuild, ObsError } from "@/lib/obs";
import { getAgentKey } from "@/lib/kv";
import { buildAgentPlan } from "@/lib/builder";
import { BUILDER_MODEL } from "@/lib/anthropic";
import { isAgentPlan, type AgentPlan } from "@/lib/agent-plan";
import { legacyInputTypeToConfig, normalizeInputConfig } from "@/components/CreateFlow/types";

interface RequestBody {
  app_id: string;
  user_feedback: string;
}

export async function POST(req: Request) {
  let body: RequestBody;
  try {
    body = (await req.json()) as RequestBody;
  } catch {
    return NextResponse.json({ error: "invalid json" }, { status: 400 });
  }

  if (!body.app_id || !body.user_feedback) {
    return NextResponse.json(
      { error: "missing app_id or user_feedback" },
      { status: 400 }
    );
  }

  const apiKey = await getAgentKey(body.app_id);
  if (!apiKey) {
    return NextResponse.json({ error: "no key for app" }, { status: 404 });
  }

  // Read the existing agent + current plan so we can feed both the form
  // fields and the previous plan into the rebuild.
  let app, agent;
  try {
    const resp = await getAgent(body.app_id, apiKey);
    app = resp.app;
    agent = resp.agent;
  } catch (e) {
    if (e instanceof ObsError) return NextResponse.json(e.body, { status: e.status });
    return NextResponse.json({ error: "get_agent_failed" }, { status: 502 });
  }

  const previousPlan: AgentPlan | null = isAgentPlan(agent.config) ? agent.config : null;

  // Prefer the InputConfig stored on the previous plan (includes slot
  // labels); fall back to the legacy input_type mapping otherwise.
  const inputConfig = previousPlan?.input_config
    ? normalizeInputConfig(previousPlan.input_config)
    : legacyInputTypeToConfig(agent.input_type ?? "none");

  let buildResult;
  try {
    buildResult = await buildAgentPlan({
      display_name: app.display_name,
      description: agent.description,
      success_criteria: agent.success_criteria ?? null,
      context_text: agent.context_text ?? null,
      needs_llm: agent.needs_llm ?? true,
      model: agent.model ?? "claude-sonnet-4-6",
      input_config: inputConfig,
      can_send_email: agent.can_send_email ?? false,
      has_web_access: agent.has_web_access ?? false,
      // Prefer the forge-level output_type embedded in the plan over
      // Obs's stored value — Obs down-maps csv → file and html_report →
      // text, so its record would lose fidelity on rebuild.
      output_type: previousPlan?.output_type ?? agent.output_type ?? "text",
      verified_email: agent.verified_email ?? null,
      user_feedback: body.user_feedback,
      previous_plan: previousPlan,
    });
  } catch (e) {
    await postBuild(body.app_id, apiKey, {
      attempt_number: 2,
      prompt: agent.description,
      form_snapshot: {},
      generated_config: {},
      builder_model: BUILDER_MODEL,
      input_tokens: 0,
      output_tokens: 0,
      duration_ms: 0,
      status: "failed",
      error_message: String(e),
      user_feedback: body.user_feedback,
    }).catch(() => undefined);
    return NextResponse.json(
      {
        error: "builder_failed",
        details: String(e),
        app_id: body.app_id,
        slug: app.slug,
      },
      { status: 500 }
    );
  }

  try {
    await patchAgent(body.app_id, apiKey, {
      config: buildResult.plan as unknown as Record<string, unknown>,
    });
  } catch (e) {
    return NextResponse.json(
      { error: "patch_config_failed", details: String(e) },
      { status: 500 }
    );
  }

  try {
    await postBuild(body.app_id, apiKey, {
      attempt_number: 2,
      prompt: agent.description,
      form_snapshot: {},
      generated_config: buildResult.plan as unknown as Record<string, unknown>,
      builder_model: BUILDER_MODEL,
      input_tokens: buildResult.inputTokens,
      output_tokens: buildResult.outputTokens,
      duration_ms: buildResult.durationMs,
      status: "success",
      user_feedback: body.user_feedback,
    });
  } catch (e) {
    return NextResponse.json(
      { error: "post_build_failed", details: String(e) },
      { status: 500 }
    );
  }

  return NextResponse.json({
    ok: true,
    app_id: body.app_id,
    slug: app.slug,
    display_name: app.display_name,
  });
}
