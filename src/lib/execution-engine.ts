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
import { prepareHtmlReport } from "./html-report";
import { buildCsvEnvelope, CSV_ROW_LIMIT } from "./csv-report";

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

// Short notification email used when the agent produces an HTML report.
// Linking is more reliable than inlining Chart.js-heavy HTML into Gmail.
function reportNotificationEmailHtml(agentName: string, reportUrl: string): string {
  const safeName = agentName.replace(/[<>&"']/g, "");
  return `<!doctype html><html><body style="margin:0;padding:24px;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Helvetica,Arial,sans-serif;font-size:15px;line-height:1.55;color:#1a1a1a;background:#ffffff;"><div style="max-width:640px;margin:0 auto;"><p style="margin:0 0 16px;">Your ${safeName} report is ready.</p><p style="margin:16px 0;"><a href="${reportUrl}" style="display:inline-block;background:#C56A2D;color:#ffffff;padding:10px 18px;border-radius:6px;text-decoration:none;font-weight:600;">View Report</a></p><p style="margin:16px 0 0;font-size:12px;color:#666;">This link opens the full interactive report in your browser.</p></div></body></html>`;
}

// Short notification email for CSV output. The Obs email API does not
// currently support attachments, so the spec's "attach the CSV" becomes
// "link to the download endpoint" here (documented in the spec's open
// questions). The download link serves the CSV with the right filename.
function csvNotificationEmailHtml(
  agentName: string,
  downloadUrl: string,
  rowCount: number,
  columnCount: number,
  filename: string
): string {
  const safeName = agentName.replace(/[<>&"']/g, "");
  const safeFilename = filename.replace(/[<>&"']/g, "");
  return `<!doctype html><html><body style="margin:0;padding:24px;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Helvetica,Arial,sans-serif;font-size:15px;line-height:1.55;color:#1a1a1a;background:#ffffff;"><div style="max-width:640px;margin:0 auto;"><p style="margin:0 0 16px;">Your ${safeName} CSV is ready. ${rowCount} rows, ${columnCount} columns.</p><p style="margin:16px 0;"><a href="${downloadUrl}" style="display:inline-block;background:#C56A2D;color:#ffffff;padding:10px 18px;border-radius:6px;text-decoration:none;font-weight:600;">Download CSV</a></p><p style="margin:16px 0 0;font-size:12px;color:#666;">${safeFilename}</p></div></body></html>`;
}

export interface ExecutionFile {
  label: string;
  content: string;
  filename: string;
}

interface ExecutionInput {
  runId: string;
  apiKey: string;
  // agent slug — needed to build absolute report-viewer URLs for email.
  slug?: string;
  plan: AgentPlan;
  inputText?: string | null;
  inputUrl?: string | null;
  files?: ExecutionFile[];
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

// Derive the app's public base URL for building the email's report link.
// Vercel provides VERCEL_URL without scheme; prefer an explicit
// FORGE_APP_BASE_URL override for staging/prod.
function resolveAppBaseUrl(): string {
  if (process.env.FORGE_APP_BASE_URL) {
    return process.env.FORGE_APP_BASE_URL.replace(/\/$/, "");
  }
  if (process.env.VERCEL_URL) {
    return `https://${process.env.VERCEL_URL}`;
  }
  return "http://localhost:3000";
}

// LLMs routinely truncate long HTML/CSV envelopes when max_tokens is too
// low. For HTML, a truncated <script> kills every Chart.js init; for CSV,
// a truncated row array blows up JSON.parse. If the plan ends in (or
// contains) an html_report or csv_report step, floor every LLM step's
// max_tokens so the model has room to emit the full document. Providers
// only bill for *generated* tokens, so raising the ceiling is cheap.
const STRUCTURED_REPORT_MIN_MAX_TOKENS = 16000;
function ensureStructuredReportCapacity(plan: AgentPlan): AgentPlan {
  const hasStructured = plan.steps.some(
    (s) => s.type === "html_report" || s.type === "csv_report"
  );
  if (!hasStructured) return plan;
  const bumped = plan.steps.map((s) => {
    if (s.type === "llm") {
      const cur = s.max_tokens ?? 1024;
      if (cur < STRUCTURED_REPORT_MIN_MAX_TOKENS) {
        return { ...s, max_tokens: STRUCTURED_REPORT_MIN_MAX_TOKENS };
      }
    }
    return s;
  });
  return { ...plan, steps: bumped };
}

export async function executeAgent(
  input: ExecutionInput
): Promise<ExecutionResult> {
  const { runId, apiKey, slug, inputText, inputUrl, files, verifiedEmail } = input;
  const plan = ensureStructuredReportCapacity(input.plan);
  const runStart = Date.now();
  let totalInputTokens = 0;
  let totalOutputTokens = 0;
  let totalCost = 0;
  let finalOutput = "";
  let outputIsHtmlReport = false;
  let csvMeta: {
    filename: string;
    row_count: number;
    column_count: number;
    columns: string[];
    truncated: boolean;
  } | null = null;

  // Mark run as running.
  await patchRun(runId, apiKey, {
    status: "running",
    started_at: new Date().toISOString(),
  }).catch(() => undefined);

  const vars: Record<string, string> = {
    input_text: inputText ?? "",
    input_url: inputUrl ?? "",
  };

  // Map the files array into file_1/file_1_label/... template vars.
  // Also keep file_text pointing at the first file for backwards compat
  // with plans built before multi-file support.
  const filesArr = files ?? [];
  vars.file_text = filesArr[0]?.content ?? "";
  for (let i = 0; i < filesArr.length; i++) {
    const f = filesArr[i];
    vars[`file_${i + 1}`] = f.content ?? "";
    vars[`file_${i + 1}_label`] = f.label ?? "";
    vars[`file_${i + 1}_filename`] = f.filename ?? "";
  }

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
      } else if (step.type === "html_report") {
        startMeta.template_preview = render(step.template, vars).slice(0, 400);
      } else if (step.type === "csv_report") {
        startMeta.template_preview = render(step.template, vars).slice(0, 400);
      } else if (step.type === "file_read") {
        startMeta.bytes = filesArr.reduce((n, f) => n + (f.content?.length ?? 0), 0);
        startMeta.file_count = filesArr.length;
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
          // Concatenate all files with clear labels so the LLM sees each
          // one's semantic meaning. The individual file_N vars are still
          // available for plans that prefer to reference them directly.
          if (filesArr.length === 0) {
            producedOutput = "";
          } else if (filesArr.length === 1) {
            producedOutput = filesArr[0].content ?? "";
          } else {
            producedOutput = filesArr
              .map((f, i) => {
                const header = f.label
                  ? `--- File ${i + 1}: ${f.label}${f.filename ? ` (${f.filename})` : ""} ---`
                  : `--- File ${i + 1}${f.filename ? `: ${f.filename}` : ""} ---`;
                return `${header}\n${f.content ?? ""}`;
              })
              .join("\n\n");
          }
          if (step.output_var) vars[step.output_var] = producedOutput;
        } else if (step.type === "email") {
          const rawSubject = render(step.subject_template, vars);
          const subject = rawSubject.replace(/[\r\n]+/g, " ").replace(/\s+/g, " ").trim().slice(0, 200);
          // If we've already produced an HTML report or a CSV, send a
          // link email instead of inlining heavy HTML or raw CSV text.
          // (Obs's email API doesn't support attachments yet — documented
          // in the CSV spec's open questions — so CSV becomes a download
          // link for now.)
          let bodyMarkdown: string;
          let bodyHtml: string;
          if (outputIsHtmlReport && slug) {
            const reportUrl = `${resolveAppBaseUrl()}/agents/${slug}/runs/${runId}/report`;
            bodyMarkdown = `Your report is ready.\n\nView Report: ${reportUrl}`;
            bodyHtml = reportNotificationEmailHtml(subject || "Forge", reportUrl);
          } else if (csvMeta && slug) {
            const downloadUrl = `${resolveAppBaseUrl()}/agents/${slug}/runs/${runId}/csv`;
            bodyMarkdown = `Your CSV is attached. ${csvMeta.row_count} rows, ${csvMeta.column_count} columns.\n\nDownload: ${downloadUrl}`;
            bodyHtml = csvNotificationEmailHtml(
              subject || "Forge",
              downloadUrl,
              csvMeta.row_count,
              csvMeta.column_count,
              csvMeta.filename
            );
          } else {
            bodyMarkdown = render(step.body_template, vars);
            bodyHtml = markdownToEmailHtml(bodyMarkdown);
          }
          const sendRes = await emailSendResult(apiKey, {
            subject,
            body: bodyHtml,
            format: "html",
          });
          producedOutput = `To: ${verifiedEmail ?? "(no verified email)"}\nSubject: ${subject}\n\n${bodyMarkdown}`;
          if (!outputIsHtmlReport && !csvMeta) {
            finalOutput = producedOutput;
          }
          eventRef = sendRes.message_id;
        } else if (step.type === "output") {
          producedOutput = render(step.template, vars);
          finalOutput = producedOutput;
        } else if (step.type === "html_report") {
          const rendered = render(step.template, vars);
          producedOutput = prepareHtmlReport(rendered);
          finalOutput = producedOutput;
          outputIsHtmlReport = true;
        } else if (step.type === "csv_report") {
          const rendered = render(step.template, vars);
          const envelope = buildCsvEnvelope({
            llmOutput: rendered,
            slug: slug ?? null,
            completedAt: new Date(),
          });
          csvMeta = {
            filename: envelope.filename,
            row_count: envelope.row_count,
            column_count: envelope.column_count,
            columns: envelope.columns,
            truncated: envelope.truncated,
          };
          // Store the full envelope (including CSV text) as run.output so
          // the run page and download endpoint can reconstruct everything
          // without extra artifact storage.
          producedOutput = JSON.stringify(envelope);
          finalOutput = producedOutput;
        }

        const stepDuration = Date.now() - stepStart;
        const completeMeta: Record<string, unknown> = {
          type: step.type,
          output_preview: producedOutput?.slice(0, 1200) ?? "",
          output_chars: producedOutput?.length ?? 0,
        };
        if (step.type === "llm") {
          completeMeta.prompt_preview = render(step.prompt, vars).slice(0, 800);
          completeMeta.model = plan.model;
        } else if (step.type === "web_fetch") {
          completeMeta.url = render(step.url, vars);
        } else if (step.type === "html_report") {
          completeMeta.output_type = "html_report";
        } else if (step.type === "csv_report") {
          completeMeta.output_type = "csv";
          if (csvMeta) {
            completeMeta.filename = csvMeta.filename;
            completeMeta.row_count = csvMeta.row_count;
            completeMeta.column_count = csvMeta.column_count;
            completeMeta.columns = csvMeta.columns;
            completeMeta.truncated = csvMeta.truncated;
            completeMeta.row_limit = CSV_ROW_LIMIT;
          }
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
