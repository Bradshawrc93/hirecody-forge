import { NextResponse } from "next/server";
import { createRun, getAgent, ObsError, type RunType } from "@/lib/obs";
import { getAgentKey } from "@/lib/kv";
import { executeAgent } from "@/lib/execution-engine";
import { isAgentPlan } from "@/lib/agent-plan";

interface Body {
  app_id: string;
  run_type: RunType;
  input_text?: string | null;
  file_text?: string | null;
}

export const maxDuration = 60;

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

  let agentInfo;
  try {
    agentInfo = await getAgent(body.app_id, apiKey);
  } catch (e) {
    if (e instanceof ObsError) return NextResponse.json(e.body, { status: e.status });
    return NextResponse.json({ error: "load_agent_failed" }, { status: 502 });
  }

  const plan = agentInfo.agent.config;
  if (!isAgentPlan(plan)) {
    return NextResponse.json(
      { error: "agent has no valid plan" },
      { status: 400 }
    );
  }

  let run;
  try {
    const { run: r } = await createRun(apiKey, {
      run_type: body.run_type,
      input_text: body.input_text ?? null,
    });
    run = r;
  } catch (e) {
    if (e instanceof ObsError) return NextResponse.json(e.body, { status: e.status });
    return NextResponse.json({ error: "create_run_failed" }, { status: 502 });
  }

  // Kick execution off async. We return the run_id immediately so the
  // client can begin polling the waterfall. The execution finishes inside
  // this same serverless invocation.
  executeAgent({
    runId: run.id,
    apiKey,
    plan,
    inputText: body.input_text,
    fileText: body.file_text,
    verifiedEmail: agentInfo.agent.verified_email,
  }).catch((err) => console.error("execution error", err));

  return NextResponse.json({ run_id: run.id });
}
