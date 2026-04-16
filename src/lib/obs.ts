// Typed wrappers for the Obs Forge API. See FORGE_INTEGRATION.md for the
// complete contract — these are 1:1 with the documented endpoints.

const OBS_BASE =
  process.env.OBS_API_BASE_URL ?? "https://obs.hirecody.dev";

export type AgentStatus =
  | "building"
  | "build_failed"
  | "awaiting_test"
  | "test_failed"
  | "active"
  | "paused"
  | "expired"
  | "deleted";

export type RunStatus = "queued" | "running" | "completed" | "failed";
export type RunType = "test" | "scheduled" | "manual";
export type InputType = "none" | "text" | "file" | "both";
export type OutputType = "text" | "file" | "email" | "notification" | "side-effect";
export type CreatorType = "owner" | "visitor";
export type Cadence = "daily" | "weekly" | "monthly";

export interface AppSummary {
  id: string;
  slug: string;
  display_name: string;
  created_at?: string;
}

export interface AgentRecord {
  app_id: string;
  description: string;
  status: AgentStatus;
  config?: Record<string, unknown>;
  needs_llm?: boolean;
  model?: string | null;
  input_type?: InputType;
  can_send_email?: boolean;
  has_web_access?: boolean;
  success_criteria?: string | null;
  output_type?: OutputType;
  context_text?: string | null;
  schedule_cadence?: Cadence | null;
  schedule_time?: string | null;
  schedule_day_of_week?: number | null;
  schedule_day_of_month?: number | null;
  verified_email?: string | null;
  creator_type?: CreatorType;
  expires_at?: string | null;
  next_run_at?: string | null;
  last_run_at?: string | null;
  created_at?: string;
  apps?: { slug: string; display_name: string };
}

export interface CreateAgentInput {
  slug: string;
  display_name: string;
  description: string;
  config?: Record<string, unknown>;
  needs_llm?: boolean;
  model?: string | null;
  input_type?: InputType;
  can_send_email?: boolean;
  has_web_access?: boolean;
  success_criteria?: string | null;
  output_type?: OutputType;
  context_text?: string | null;
  schedule_cadence?: Cadence | null;
  schedule_time?: string | null;
  schedule_day_of_week?: number | null;
  schedule_day_of_month?: number | null;
  verified_email?: string | null;
}

export interface CreateAgentResponse {
  app: AppSummary;
  agent: AgentRecord;
  api_key: string;
}

export interface RunRecord {
  id: string;
  app_id?: string;
  run_type: RunType;
  status: RunStatus;
  input_text?: string | null;
  input_file_path?: string | null;
  output?: string | null;
  started_at?: string | null;
  completed_at?: string | null;
  duration_ms?: number | null;
  input_tokens?: number | null;
  output_tokens?: number | null;
  cost_usd?: number | null;
  user_rating?: "up" | "down" | null;
  success_criteria_met?: boolean | null;
  error_message?: string | null;
  created_at?: string;
}

export interface RunStep {
  id: string;
  seq: number;
  step_name: string;
  service: string;
  event_type: "start" | "complete" | "fail";
  started_at?: string | null;
  completed_at?: string | null;
  duration_ms?: number | null;
  metadata?: Record<string, unknown> | null;
  event_ref?: string | null;
}

export interface BuildRecord {
  id: string;
  attempt_number: number;
  status: "pending" | "success" | "failed";
  error_message?: string | null;
  created_at?: string;
}

export interface ObsErrorBody {
  error: string;
  details?: unknown;
}

export class ObsError extends Error {
  status: number;
  body: ObsErrorBody | string;
  constructor(status: number, body: ObsErrorBody | string) {
    super(typeof body === "string" ? body : body.error);
    this.status = status;
    this.body = body;
  }
}

async function request<T>(
  path: string,
  init: RequestInit & { apiKey?: string } = {}
): Promise<T> {
  const headers: Record<string, string> = {
    "content-type": "application/json",
    ...(init.headers as Record<string, string> | undefined),
  };
  if (init.apiKey) headers["x-api-key"] = init.apiKey;
  const res = await fetch(`${OBS_BASE}${path}`, {
    ...init,
    headers,
    cache: "no-store",
  });
  const text = await res.text();
  let body: unknown;
  try {
    body = text ? JSON.parse(text) : null;
  } catch {
    body = text;
  }
  if (!res.ok) {
    throw new ObsError(res.status, body as ObsErrorBody | string);
  }
  return body as T;
}

// ───────────────────────── Agents ─────────────────────────

export function createAgent(input: CreateAgentInput): Promise<CreateAgentResponse> {
  return request<CreateAgentResponse>("/api/forge/agents", {
    method: "POST",
    body: JSON.stringify(input),
  });
}

export function listAgents(params?: {
  creator_type?: CreatorType;
  status?: AgentStatus;
}): Promise<{ agents: AgentRecord[] }> {
  const q = new URLSearchParams();
  if (params?.creator_type) q.set("creator_type", params.creator_type);
  if (params?.status) q.set("status", params.status);
  const qs = q.toString();
  return request<{ agents: AgentRecord[] }>(
    `/api/forge/agents${qs ? `?${qs}` : ""}`
  );
}

export function getAgent(
  appId: string,
  apiKey: string
): Promise<{ app: AppSummary; agent: AgentRecord; builds: BuildRecord[] }> {
  return request(`/api/forge/agents/${appId}`, { apiKey });
}

export function patchAgent(
  appId: string,
  apiKey: string,
  patch: Partial<{
    status: Exclude<AgentStatus, "expired">;
    config: Record<string, unknown>;
    schedule_cadence: Cadence | null;
    schedule_time: string | null;
    schedule_day_of_week: number | null;
    schedule_day_of_month: number | null;
    verified_email: string;
    last_run_at: string;
  }>
): Promise<{ agent: AgentRecord }> {
  return request(`/api/forge/agents/${appId}`, {
    method: "PATCH",
    body: JSON.stringify(patch),
    apiKey,
  });
}

export function deleteAgent(appId: string, apiKey: string): Promise<{ ok: true }> {
  return request(`/api/forge/agents/${appId}`, { method: "DELETE", apiKey });
}

export function listAgentRuns(
  appId: string,
  apiKey: string,
  params?: {
    status?: RunStatus;
    run_type?: RunType;
    limit?: number;
    offset?: number;
  }
): Promise<{ runs: RunRecord[]; limit: number; offset: number }> {
  const q = new URLSearchParams();
  if (params?.status) q.set("status", params.status);
  if (params?.run_type) q.set("run_type", params.run_type);
  if (params?.limit != null) q.set("limit", String(params.limit));
  if (params?.offset != null) q.set("offset", String(params.offset));
  const qs = q.toString();
  return request(
    `/api/forge/agents/${appId}/runs${qs ? `?${qs}` : ""}`,
    { apiKey }
  );
}

// ───────────────────────── Builds ─────────────────────────

export function postBuild(
  appId: string,
  apiKey: string,
  build: {
    attempt_number: 1 | 2;
    prompt: string;
    form_snapshot: Record<string, unknown>;
    generated_config: Record<string, unknown>;
    builder_model: string;
    input_tokens: number;
    output_tokens: number;
    duration_ms: number;
    status: "pending" | "success" | "failed";
    error_message?: string | null;
    user_feedback?: string | null;
  }
): Promise<{ build: BuildRecord }> {
  return request(`/api/forge/agents/${appId}/builds`, {
    method: "POST",
    body: JSON.stringify(build),
    apiKey,
  });
}

// ───────────────────────── Runs ─────────────────────────

export function createRun(
  apiKey: string,
  input: {
    run_type: RunType;
    input_text?: string | null;
    input_file_path?: string | null;
  }
): Promise<{ run: RunRecord }> {
  return request("/api/forge/runs", {
    method: "POST",
    body: JSON.stringify(input),
    apiKey,
  });
}

export function getRun(runId: string, apiKey: string): Promise<{ run: RunRecord }> {
  return request(`/api/forge/runs/${runId}`, { apiKey });
}

export function patchRun(
  runId: string,
  apiKey: string,
  patch: Partial<{
    status: RunStatus;
    started_at: string;
    completed_at: string;
    duration_ms: number;
    output: string;
    input_tokens: number;
    output_tokens: number;
    cost_usd: number;
    user_rating: "up" | "down";
    success_criteria_met: boolean;
    error_message: string | null;
  }>
): Promise<{ run: RunRecord }> {
  return request(`/api/forge/runs/${runId}`, {
    method: "PATCH",
    body: JSON.stringify(patch),
    apiKey,
  });
}

// ───────────────────────── Run steps ─────────────────────────

export function postStep(
  runId: string,
  apiKey: string,
  step: {
    step_name: string;
    service: string;
    event_type: "start" | "complete" | "fail";
    started_at?: string;
    completed_at?: string;
    duration_ms?: number;
    metadata?: Record<string, unknown>;
    event_ref?: string;
  }
): Promise<{ step: RunStep }> {
  return request(`/api/forge/runs/${runId}/steps`, {
    method: "POST",
    body: JSON.stringify(step),
    apiKey,
  });
}

export function getSteps(
  runId: string,
  apiKey: string,
  since = 0
): Promise<{ run_status: RunStatus; steps: RunStep[]; last_seq: number }> {
  return request(
    `/api/forge/runs/${runId}/steps?since=${since}`,
    { apiKey }
  );
}

// ───────────────────────── Email verification ─────────────────────────

export function emailSend(email: string): Promise<{ ok: true; expires_in_seconds: number }> {
  return request("/api/forge/email/send", {
    method: "POST",
    body: JSON.stringify({ email }),
  });
}

export function emailVerify(
  email: string,
  code: string
): Promise<{ ok: true; email: string }> {
  return request("/api/forge/email/verify", {
    method: "POST",
    body: JSON.stringify({ email, code }),
  });
}

export function emailSendResult(
  apiKey: string,
  input: { subject: string; body: string; format?: "text" | "html" }
): Promise<{ ok: true; message_id: string }> {
  return request("/api/forge/email/send-result", {
    method: "POST",
    body: JSON.stringify(input),
    apiKey,
  });
}

// ───────────────────────── Feedback ─────────────────────────

export function postFeedback(input: {
  agent_id?: string | null;
  email?: string | null;
  feedback_text: string;
}): Promise<{ ok: true }> {
  return request("/api/forge/feedback", {
    method: "POST",
    body: JSON.stringify(input),
  });
}

// ───────────────────────── LLM telemetry collector ─────────────────────────

export function postEvent(
  apiKey: string,
  payload: {
    model: string;
    provider: "anthropic" | "openai";
    inputTokens: number;
    outputTokens: number;
    latencyMs: number;
    status: "success" | "error";
    sessionId?: string;
    metadata?: Record<string, unknown>;
  }
): Promise<{ id: string; cost_usd: number }> {
  return request("/api/events", {
    method: "POST",
    body: JSON.stringify(payload),
    apiKey,
  });
}
