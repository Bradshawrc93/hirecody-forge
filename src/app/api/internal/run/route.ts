import { NextResponse } from "next/server";
import { createRun, getAgent, ObsError, type RunType } from "@/lib/obs";
import { getAgentKey } from "@/lib/kv";
import { executeAgent, type ExecutionFile } from "@/lib/execution-engine";
import { isAgentPlan } from "@/lib/agent-plan";
import { parseDocx } from "@/lib/docx-parse";

interface IncomingFile {
  label?: string;
  content?: string | null;
  filename?: string | null;
}

interface Body {
  app_id: string;
  run_type: RunType;
  input_text?: string | null;
  input_url?: string | null;
  // New multi-file shape.
  files?: IncomingFile[];
  // Legacy single-file shape (kept so old clients don't break).
  file_text?: string | null;
  file_name?: string | null;
}

export const maxDuration = 60;

async function materializeFile(
  content: string,
  filename: string
): Promise<string> {
  if (filename.endsWith(".docx")) {
    try {
      return await parseDocx(Buffer.from(content, "base64"));
    } catch {
      throw new Error("docx_parse_failed");
    }
  }
  return content;
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

  // Resolve the incoming files. Prefer the new `files` array; fall back to
  // the legacy `file_text`/`file_name` single-slot form.
  let executionFiles: ExecutionFile[] = [];
  try {
    if (body.files && body.files.length > 0) {
      for (const f of body.files) {
        const label = f.label ?? "";
        const filename = f.filename ?? "";
        const rawContent = f.content ?? "";
        if (!rawContent) {
          executionFiles.push({ label, content: "", filename });
          continue;
        }
        const content = await materializeFile(rawContent, filename);
        executionFiles.push({ label, content, filename });
      }
    } else if (body.file_text) {
      const filename = body.file_name ?? "";
      const content = await materializeFile(body.file_text, filename);
      executionFiles = [{ label: "", content, filename }];
    }
  } catch (e) {
    if (e instanceof Error && e.message === "docx_parse_failed") {
      return NextResponse.json({ error: "docx_parse_failed" }, { status: 400 });
    }
    return NextResponse.json({ error: "file_parse_failed" }, { status: 400 });
  }

  executeAgent({
    runId: run.id,
    apiKey,
    slug: agentInfo.app.slug,
    plan,
    inputText: body.input_text,
    inputUrl: body.input_url,
    files: executionFiles,
    verifiedEmail: agentInfo.agent.verified_email,
  }).catch((err) => console.error("execution error", err));

  return NextResponse.json({ run_id: run.id });
}
