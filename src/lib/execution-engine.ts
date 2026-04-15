import { anthropic } from "./anthropic";
import { openai } from "./openai";
import {
  patchRun,
  postEvent,
  postStep,
  type RunStatus,
} from "./obs";
import type { AgentPlan, PlanStep } from "./agent-plan";

// Tiny templating: replace {{var}} with the variable bag.
function render(template: string, vars: Record<string, string>): string {
  return template.replace(/\{\{\s*([a-zA-Z0-9_]+)\s*\}\}/g, (_, k) => vars[k] ?? "");
}

interface ExecutionInput {
  runId: string;
  apiKey: string;
  plan: AgentPlan;
  inputText?: string | null;
  fileText?: string | null;
  verifiedEmail?: string | null;
}

export interface ExecutionResult {
  status: RunStatus;
  output: string;
  inputTokens: number;
  outputTokens: number;
  costUsd: number;
  durationMs: number;
  error?: string;
}

async function runLLMStep(
  step: Extract<PlanStep, { type: "llm" }>,
  plan: AgentPlan,
  vars: Record<string, string>,
  runId: string,
  apiKey: string
): Promise<{ text: string; inputTokens: number; outputTokens: number; costUsd: number }> {
  const prompt = render(step.prompt, vars);
  const max_tokens = step.max_tokens ?? 1024;
  const isAnthropic = plan.model.startsWith("claude");
  const start = Date.now();

  let text = "";
  let inputTokens = 0;
  let outputTokens = 0;

  try {
    if (isAnthropic) {
      const res = await anthropic().messages.create({
        model: plan.model,
        max_tokens,
        system: plan.system_prompt,
        messages: [{ role: "user", content: prompt }],
      });
      text = res.content
        .filter((b): b is { type: "text"; text: string } => b.type === "text")
        .map((b) => b.text)
        .join("");
      inputTokens = res.usage.input_tokens;
      outputTokens = res.usage.output_tokens;
    } else {
      const res = await openai().chat.completions.create({
        model: plan.model,
        max_tokens,
        messages: [
          { role: "system", content: plan.system_prompt },
          { role: "user", content: prompt },
        ],
      });
      text = res.choices[0]?.message?.content ?? "";
      inputTokens = res.usage?.prompt_tokens ?? 0;
      outputTokens = res.usage?.completion_tokens ?? 0;
    }
  } catch (err) {
    throw err;
  }

  const latencyMs = Date.now() - start;

  // Dual-telemetry: emit the LLM call to Obs's events collector.
  let costUsd = 0;
  let eventRef: string | undefined;
  try {
    const ev = await postEvent(apiKey, {
      model: plan.model,
      provider: isAnthropic ? "anthropic" : "openai",
      inputTokens,
      outputTokens,
      latencyMs,
      status: "success",
      sessionId: runId,
      metadata: { run_id: runId, step_name: step.name },
    });
    costUsd = ev.cost_usd;
    eventRef = ev.id;
  } catch {
    // Telemetry failures shouldn't break the run.
  }

  // Stash event_ref on a global so the caller can attach it to the
  // forge_run_steps "complete" event. Pass-through via return is cleaner.
  (vars as Record<string, string>).__last_event_ref = eventRef ?? "";

  return { text, inputTokens, outputTokens, costUsd };
}

async function runWebFetchStep(
  step: Extract<PlanStep, { type: "web_fetch" }>,
  vars: Record<string, string>
): Promise<string> {
  const url = render(step.url, vars);
  const res = await fetch(url, {
    headers: { "user-agent": "hirecody-forge/1.0" },
    signal: AbortSignal.timeout(20000),
  });
  if (!res.ok) throw new Error(`web_fetch ${url} → HTTP ${res.status}`);
  const text = await res.text();
  return text.length > 50000 ? text.slice(0, 50000) + "\n…[truncated]" : text;
}

export async function executeAgent(
  input: ExecutionInput
): Promise<ExecutionResult> {
  const { runId, apiKey, plan, inputText, fileText, verifiedEmail } = input;
  const runStart = Date.now();
  let totalInputTokens = 0;
  let totalOutputTokens = 0;
  let totalCost = 0;
  let finalOutput = "";

  // Mark run as running.
  await patchRun(runId, apiKey, {
    status: "running",
    started_at: new Date().toISOString(),
  }).catch(() => undefined);

  const vars: Record<string, string> = {
    input_text: inputText ?? "",
    file_text: fileText ?? "",
  };

  try {
    for (const step of plan.steps) {
      const stepStart = Date.now();

      // start event
      await postStep(runId, apiKey, {
        step_name: step.name,
        service: step.type,
        event_type: "start",
        started_at: new Date(stepStart).toISOString(),
        metadata: { type: step.type },
      }).catch(() => undefined);

      try {
        let producedOutput: string | undefined;
        let eventRef: string | undefined;

        if (step.type === "llm") {
          const r = await runLLMStep(step, plan, vars, runId, apiKey);
          totalInputTokens += r.inputTokens;
          totalOutputTokens += r.outputTokens;
          totalCost += r.costUsd;
          producedOutput = r.text;
          eventRef = vars.__last_event_ref || undefined;
          if (step.output_var) vars[step.output_var] = r.text;
        } else if (step.type === "web_fetch") {
          producedOutput = await runWebFetchStep(step, vars);
          if (step.output_var) vars[step.output_var] = producedOutput;
        } else if (step.type === "file_read") {
          producedOutput = fileText ?? "";
          if (step.output_var) vars[step.output_var] = producedOutput;
        } else if (step.type === "email") {
          const subject = render(step.subject_template, vars);
          const bodyText = render(step.body_template, vars);
          // Email sending is stubbed in v1 — Obs will own delivery via
          // its existing email pipeline. For now we just record what
          // would be sent and surface it as the run output.
          producedOutput = `📧 To: ${verifiedEmail ?? "(no verified email)"}\nSubject: ${subject}\n\n${bodyText}`;
          finalOutput = producedOutput;
        } else if (step.type === "output") {
          producedOutput = render(step.template, vars);
          finalOutput = producedOutput;
        }

        const stepDuration = Date.now() - stepStart;
        await postStep(runId, apiKey, {
          step_name: step.name,
          service: step.type,
          event_type: "complete",
          completed_at: new Date().toISOString(),
          duration_ms: stepDuration,
          metadata: {
            type: step.type,
            preview: producedOutput?.slice(0, 200),
          },
          ...(eventRef ? { event_ref: eventRef } : {}),
        }).catch(() => undefined);
      } catch (stepErr) {
        const stepDuration = Date.now() - stepStart;
        await postStep(runId, apiKey, {
          step_name: step.name,
          service: step.type,
          event_type: "fail",
          completed_at: new Date().toISOString(),
          duration_ms: stepDuration,
          metadata: { error: String(stepErr) },
        }).catch(() => undefined);
        throw stepErr;
      }
    }

    // If no terminal step explicitly set finalOutput, fall back to the
    // last step's value via vars.
    if (!finalOutput) {
      finalOutput =
        vars[plan.steps[plan.steps.length - 1]?.name as string] ??
        "(agent completed with no output)";
    }

    const durationMs = Date.now() - runStart;
    await patchRun(runId, apiKey, {
      status: "completed",
      completed_at: new Date().toISOString(),
      duration_ms: durationMs,
      output: finalOutput,
      input_tokens: totalInputTokens,
      output_tokens: totalOutputTokens,
      cost_usd: totalCost,
    });

    return {
      status: "completed",
      output: finalOutput,
      inputTokens: totalInputTokens,
      outputTokens: totalOutputTokens,
      costUsd: totalCost,
      durationMs,
    };
  } catch (err) {
    const durationMs = Date.now() - runStart;
    await patchRun(runId, apiKey, {
      status: "failed",
      completed_at: new Date().toISOString(),
      duration_ms: durationMs,
      error_message: String(err),
    }).catch(() => undefined);
    return {
      status: "failed",
      output: "",
      inputTokens: totalInputTokens,
      outputTokens: totalOutputTokens,
      costUsd: totalCost,
      durationMs,
      error: String(err),
    };
  }
}

