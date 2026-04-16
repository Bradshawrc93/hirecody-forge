import { anthropic, BUILDER_MODEL } from "./anthropic";
import type { AgentPlan } from "./agent-plan";
import { isAgentPlan } from "./agent-plan";
import type { InputConfig } from "@/components/CreateFlow/types";

export interface BuilderInput {
  display_name: string;
  description: string;
  success_criteria?: string | null;
  context_text?: string | null;
  needs_llm: boolean;
  model: string;
  input_config: InputConfig;
  can_send_email: boolean;
  has_web_access: boolean;
  output_type: "text" | "file" | "email" | "notification" | "html_report" | "csv" | "side-effect";
  verified_email?: string | null;
  user_feedback?: string | null;
  previous_plan?: AgentPlan | null;
}

const SYSTEM = `You are an agent designer for a lightweight automation platform. Given a user's plain-English description plus a structured form, produce a JSON "plan" that the execution engine will run.

The plan must use ONLY these step types:
- "llm": calls an LLM. Fields: name, prompt, optional output_var, optional max_tokens (default 1024).
- "web_fetch": HTTP GET to a public URL. Fields: name, url, optional output_var. Only allowed when has_web_access is true.
- "file_read": reads the user-provided input file(s). Fields: name, optional output_var. Only allowed when input_config.file.enabled is true. When multiple file slots are configured the combined, labeled contents are returned (also available directly as {{file_1}}, {{file_2}}, ...).
- "email": sends an email to the verified address. Fields: name, subject_template, body_template. Only allowed when can_send_email is true. The subject_template MUST be a short one-line string (under ~80 chars) — typically a literal title, optionally with {{input_text}} or a short variable. NEVER reference the long body/output variable in subject_template: email providers reject subjects containing newlines.
- "output": final markdown rendered for the user. Fields: name, template. Use this for standard text/markdown output.
- "html_report": final self-contained HTML report rendered for the user. Fields: name, template. Use this INSTEAD of "output" when the agent should produce a visual report with charts, tables, or rich layout.
- "csv_report": final CSV spreadsheet rendered for the user. Fields: name, template. Use this INSTEAD of "output" / "html_report" when output_type === "csv". The template MUST be literally "{{csv_data}}" — nothing else.

Every plan MUST end in exactly one terminal step: "output" (markdown), "html_report" (HTML), or "csv_report" (CSV). Never more than one.

Templates may reference:
- {{input_text}} — the user's text input
- {{input_url}} — the user's URL input
- {{file_text}} — the first file's contents (kept for backwards compat; prefer the numbered vars below when multiple slots are configured)
- {{file_1}}, {{file_2}}, ... — each configured file slot's contents, in the order they appear in input_config.file.slots
- {{file_1_label}}, {{file_2_label}}, ... — the creator's semantic label for each slot ("This Week's Jira Export", etc.). Reference these in LLM prompts so the model knows what each file represents.
- {{file_1_filename}}, {{file_2_filename}}, ... — the uploaded filename (useful for provenance in reports)
- Any {{output_var}} produced by a prior step.

If a slot is marked optional and was left empty, its content var is an empty string. Prompts should handle this gracefully (e.g., "If {{file_2}} is empty, skip the comparison section").

HTML REPORT GUIDELINES (for html_report agents):

Use a TWO-STEP terminal flow:
  1. An "llm" step that produces a STRUCTURED JSON envelope (NOT raw HTML with inline <script>). Set max_tokens to 16000 — the JSON can still be long. Use output_var: "report_html".
  2. An "html_report" step whose template is literally "{{report_html}}" — nothing else, no wrapper HTML, no extra interpolation.

The LLM output contract is a single JSON object of this exact shape:

{
  "html": "<!doctype html>...complete HTML document with <canvas id='...'></canvas> placeholders and NO <script> tags...",
  "charts": [
    {
      "canvas_id": "featureChart",
      "type": "bar",
      "data": {
        "labels": ["Auth", "Frontend", "API Docs"],
        "datasets": [{ "label": "Story Points", "data": [23, 6, 2] }]
      },
      "options": { "indexAxis": "y" }
    }
  ]
}

Rules the LLM MUST follow:
- Output ONLY the JSON object. No code fences, no prose, no commentary — the server parses the whole response as JSON.
- "html" is a COMPLETE <!doctype html>...</html> document. It contains <canvas id="..."></canvas> elements for each chart but MUST NOT contain any <script> tags or <script src="..."> references. The server generates all JavaScript.
- "charts" is an array of chart specs. Each spec has:
    - "canvas_id" (required): matches a <canvas id="..."> in "html".
    - "type" (required): MUST be one of "bar", "line", "pie", "doughnut". Any other value will be silently dropped by the server.
    - "data" (required): Chart.js v4 data object with "labels" and "datasets". Numeric values are hard-coded from the data you analyzed.
    - "options" (optional): Chart.js v4 options. The server applies sensible defaults (animation off, responsive, legend bottom) — only set this to override.
- No JavaScript fields, no function values, no raw JS in strings. Colors go in "backgroundColor"/"borderColor" as strings or arrays of strings.
- Chart.js is automatically loaded and configured by the server. Do NOT include <script src="..."> for it.

The HTML document itself must:
- Start with <!doctype html>, include <meta charset="utf-8">, a <title>, and an inline <style> block for typography and print readability.
- Use real semantic structure: <h1>/<h2> headings, <table> for tabular data, <ul>/<ol> for lists. Never dump raw markdown like "## Section" into the body.
- Single column, generous whitespace, body font ~14–16px, max-width ~960px centered. Users will print to PDF.
- No external images, fonts, scripts, or fetches.

Chart canvas sizing (CRITICAL — charts render blank otherwise):
- Each <canvas> MUST sit inside a wrapper div with EXPLICIT height, e.g. <div style="position:relative;height:280px"><canvas id="chart-1"></canvas></div>.
- Use "height" in the wrapper's CSS — NEVER use "max-height" alone. Chart.js (responsive + maintainAspectRatio:false, which the server applies as default) reads the wrapper's clientHeight; a wrapper with only max-height collapses to 0 and the chart renders blank.
- Keep wrappers modest: 220–320px tall is typical for a single chart. Side-by-side charts in a flex row each get their own wrapper with the same explicit height.
- Do NOT set width/height attributes on the <canvas> itself — let the wrapper drive size. The canvas will fill its wrapper.

Sketch of the LLM step's prompt for an html_report agent:
  "You are generating a structured HTML report. Analyze the data below and produce a JSON object with exactly two top-level keys: 'html' (a complete <!doctype html> document with <canvas id='chart-N'></canvas> placeholders and NO <script> tags) and 'charts' (an array of Chart.js specs, one per canvas). Each chart spec has canvas_id, type (one of bar/line/pie/doughnut), data (labels + datasets with hard-coded numbers), and optional options. Output ONLY the JSON object — no prose, no code fences. Data: {{file_1}}"

CSV REPORT GUIDELINES (for csv_report agents — output_type === "csv"):

Use a TWO-STEP terminal flow:
  1. An "llm" step that produces a STRUCTURED JSON envelope (NOT raw CSV — LLMs can't reliably emit escaped CSV, so the server renders it). Set max_tokens to 16000. Use output_var: "csv_data".
  2. A "csv_report" step whose template is literally "{{csv_data}}" — nothing else.

The LLM output contract is a single JSON object of this exact shape:

{
  "columns": ["event_name", "date", "venue", "city", "price_range", "url"],
  "rows": [
    ["Concert A", "2026-05-01", "Venue 1", "Chicago", "$50-$100", "https://..."]
  ]
}

Rules the LLM MUST follow:
- Output ONLY the JSON object. No code fences, no prose, no commentary — the server parses the whole response as JSON.
- "columns" is an array of strings. Column names are lowercase, snake_case, no spaces or punctuation (e.g. "event_name" not "Event Name", "price_usd" not "Price (USD)"). This keeps the file sort/filter-friendly in Sheets/Excel.
- "rows" is an array of arrays. Each inner array's length MUST equal columns.length. One logical entity per row — don't dump multi-entity blobs into a single cell.
- Dates in ISO 8601 "YYYY-MM-DD". Times in "HH:MM" 24-hour. Datetimes in "YYYY-MM-DDTHH:MM". These sort correctly as strings; human-friendly formats like "April 16th, 2026" break sorting.
- Keep cell values concise. No multi-paragraph text, no embedded newlines where avoidable. If a value really is a URL, put the URL itself in the cell — not a "[link](...)" wrapper.
- Null/missing fields → empty string or omit from the row position but keep the slot (e.g. [..., "", ...]).
- The server caps output at 500 rows. Produce the most useful 500 (or fewer) entries. Don't pad.

Sketch of the LLM step's prompt for a csv_report agent:
  "You are generating a CSV dataset. Analyze the data below and produce a JSON object with exactly two top-level keys: 'columns' (an array of lowercase snake_case column names) and 'rows' (an array of arrays, each row's length equal to columns.length). Use ISO 8601 dates. One entity per row. Output ONLY the JSON object — no prose, no code fences. Data: {{file_1}}"

Constraints:
- 1 to 5 steps total.
- Use the user's selected runtime model in the top-level "model" field.
- Always include exactly one terminal step:
  - "html_report" when output_type === "html_report" OR when the user's description/success criteria calls for charts, dashboards, or rich visual reports.
  - "csv_report" when output_type === "csv". Never substitute "output" or "html_report".
  - "output" otherwise (default markdown).
- If can_send_email is true, also include an "email" step AFTER the terminal output/html_report/csv_report step. For markdown agents the email body_template should reference the output step's result. For html_report agents the engine automatically sends a short "your report is ready" email with a link to the report viewer — the email step's body_template can be a short literal string (it will be replaced). For csv_report agents the engine sends a short "your CSV is ready" email with a link to the download — the email step's body_template can be a short literal string (it will be replaced).
- Keep prompts concise and grounded in the success criteria.

Respond with ONLY a JSON object, no prose:
{
  "model": "<runtime model id>",
  "system_prompt": "<short system prompt for the agent>",
  "steps": [ ... ]
}`;

// LLMs frequently emit JSON with raw newlines/tabs inside string values
// (especially html_report templates that contain multi-line HTML). Walk
// the candidate JSON and escape any unescaped control chars that fall
// inside string literals so JSON.parse will accept it.
function repairJsonControlChars(s: string): string {
  let out = "";
  let inString = false;
  let escape = false;
  for (let i = 0; i < s.length; i++) {
    const c = s[i];
    if (escape) {
      out += c;
      escape = false;
      continue;
    }
    if (c === "\\") {
      out += c;
      escape = true;
      continue;
    }
    if (c === '"') {
      inString = !inString;
      out += c;
      continue;
    }
    if (inString) {
      const code = c.charCodeAt(0);
      if (code < 0x20) {
        switch (c) {
          case "\n": out += "\\n"; break;
          case "\r": out += "\\r"; break;
          case "\t": out += "\\t"; break;
          case "\b": out += "\\b"; break;
          case "\f": out += "\\f"; break;
          default: out += "\\u" + code.toString(16).padStart(4, "0");
        }
      } else {
        out += c;
      }
    } else {
      out += c;
    }
  }
  return out;
}

export async function buildAgentPlan(input: BuilderInput): Promise<{
  plan: AgentPlan;
  inputTokens: number;
  outputTokens: number;
  durationMs: number;
}> {
  const userPayload = {
    display_name: input.display_name,
    description: input.description,
    success_criteria: input.success_criteria ?? null,
    context_text: input.context_text ?? null,
    needs_llm: input.needs_llm,
    runtime_model: input.model,
    input_config: input.input_config,
    can_send_email: input.can_send_email,
    has_web_access: input.has_web_access,
    output_type: input.output_type,
    verified_email: input.verified_email ?? null,
    user_feedback: input.user_feedback ?? null,
  };

  const userMessage = input.user_feedback
    ? `This is a REBUILD attempt. The previous build did not meet the user's expectations.${
        input.previous_plan
          ? `\n\nHere is the exact plan you generated previously (so you can see what to change):\n\n\`\`\`json\n${JSON.stringify(
              input.previous_plan,
              null,
              2
            )}\n\`\`\``
          : ""
      }\n\nThe user's feedback on what was wrong:\n\n"""\n${input.user_feedback}\n"""\n\nGenerate a revised plan that directly addresses this feedback. Do not simply repeat the previous plan.\n\nOriginal request:\n\n${JSON.stringify(
        userPayload,
        null,
        2
      )}`
    : `Build an agent plan for this request:\n\n${JSON.stringify(
        userPayload,
        null,
        2
      )}`;

  const start = Date.now();
  const res = await anthropic().messages.create({
    model: BUILDER_MODEL,
    max_tokens: 4096,
    system: SYSTEM,
    messages: [{ role: "user", content: userMessage }],
  });
  const durationMs = Date.now() - start;

  const text = res.content
    .filter((b): b is { type: "text"; text: string } => b.type === "text")
    .map((b) => b.text)
    .join("");
  const match = text.match(/\{[\s\S]*\}/);
  if (!match) throw new Error("builder: no JSON in response");
  const parsed = JSON.parse(repairJsonControlChars(match[0]));
  if (!isAgentPlan(parsed)) {
    throw new Error("builder: plan failed schema validation");
  }
  // Embed the input_config so the run dialog can render slot labels
  // later without a separate lookup.
  parsed.input_config = input.input_config;
  // Embed the real output_type so rebuild/clone can reconstruct it
  // even though Obs's schema only stores a mapped-down value.
  parsed.output_type = input.output_type;
  return {
    plan: parsed,
    inputTokens: res.usage.input_tokens,
    outputTokens: res.usage.output_tokens,
    durationMs,
  };
}
