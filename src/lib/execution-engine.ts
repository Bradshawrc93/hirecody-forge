import { marked } from "marked";
import { anthropic } from "./anthropic";
import { openai } from "./openai";
import {
  emailSendResult,
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

// Wrap rendered markdown HTML in a minimal email-safe shell with
// inline-ish styles. Keeps headings/bold/lists readable in Gmail, Apple
// Mail, and Outlook without pulling in a templating library.
function markdownToEmailHtml(md: string): string {
  const inner = marked.parse(md, { async: false, gfm: true, breaks: true }) as string;
  return `<!doctype html><html><body style="margin:0;padding:24px;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Helvetica,Arial,sans-serif;font-size:15px;line-height:1.55;color:#1a1a1a;background:#ffffff;"><div style="max-width:640px;margin:0 auto;">${inner}</div></body></html>`;
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

      // Build a richer start metadata payload so the waterfall can show
      // something useful while the step is still running.
      const startMeta: Record<string, unknown> = { type: step.type };
      if (step.type === "llm") {
        const renderedPrompt = render(step.prompt, vars);
        startMeta.model = plan.model;
        startMeta.prompt_preview = renderedPrompt.slice(0, 800);
        startMeta.prompt_chars = renderedPrompt.length;
        if (step.max_tokens) startMeta.max_tokens = step.max_tokens;
        if (step.output_var) startMeta.output_var = step.output_var;
      } else if (step.type === "web_fetch") {
        startMeta.url = render(step.url, vars);
        if (step.output_var) startMeta.output_var = step.output_var;
      } else if (step.type === "email") {
        startMeta.to = verifiedEmail ?? null;
        startMeta.subject_preview = render(step.subject_template, vars).slice(0, 200);
      } else if (step.type === "output") {
        startMeta.template_preview = render(step.template, vars).slice(0, 400);
      } else if (step.type === "file_read") {
        startMeta.bytes = (fileText ?? "").length;
        if (step.output_var) startMeta.output_var = step.output_var;
      }

      await postStep(runId, apiKey, {
        step_name: step.name,
        service: step.type,
        event_type: "start",
        started_at: new Date(stepStart).toISOString(),
        metadata: startMeta,
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
          const rawSubject = render(step.subject_template, vars);
          const subject = rawSubject.replace(/[\r\n]+/g, " ").replace(/\s+/g, " ").trim().slice(0, 200);
          const bodyMarkdown = render(step.body_template, vars);
          const bodyHtml = markdownToEmailHtml(bodyMarkdown);
          const sendRes = await emailSendResult(apiKey, {
            subject,
            body: bodyHtml,
            format: "html",
          });
          producedOutput = `To: ${verifiedEmail ?? "(no verified email)"}\nSubject: ${subject}\n\n${bodyMarkdown}`;
          finalOutput = producedOutput;
          eventRef = sendRes.message_id;
        } else if (step.type === "output") {
          producedOutput = render(step.template, vars);
          finalOutput = producedOutput;
        }

        const stepDuration = Date.now() - stepStart;
        const completeMeta: Record<string, unknown> = {
          type: step.type,
          output_preview: producedOutput?.slice(0, 1200) ?? "",
          output_chars: producedOutput?.length ?? 0,
        };
        if (step.type === "llm") {
          // tokens/cost are recorded on the run; nothing extra to carry here
          // since the live run already folds these into the totals — but we
          // do want the prompt too, so re-attach it for the detail panel.
          completeMeta.prompt_preview = render(step.prompt, vars).slice(0, 800);
          completeMeta.model = plan.model;
        } else if (step.type === "web_fetch") {
          completeMeta.url = render(step.url, vars);
        }
        await postStep(runId, apiKey, {
          step_name: step.name,
          service: step.type,
          event_type: "complete",
          completed_at: new Date().toISOString(),
          duration_ms: stepDuration,
          metadata: completeMeta,
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

