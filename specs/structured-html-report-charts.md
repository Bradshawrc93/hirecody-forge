# Structured HTML Report Charts — Spec

## Overview

Refactor how Forge's `html_report` agents generate Chart.js visualizations. Today the builder LLM is instructed to output a complete HTML document that includes inline `<script>new Chart(...)</script>` blocks with JavaScript it has hand-authored. In practice the LLM is unreliable at this: we've observed output truncation, unterminated string literals, typos like `backgrouColor` / `backgroundColor:#7986cb'`, and (most recently) cases where the LLM produces `<canvas>` elements but forgets to include any chart init scripts at all. Each failure mode kills charts silently.

This spec replaces the "LLM writes JS" approach with a **structured JSON envelope**: the LLM outputs an object containing the HTML body (with empty `<canvas>` placeholders) plus a typed array of chart configs. The server generates the chart init `<script>` blocks with known-good syntax. The LLM never writes JavaScript.

## Goals

- The LLM's output contract no longer requires authoring JavaScript. It produces HTML and structured data; the server handles script generation.
- Charts render reliably. A typo in one chart's data produces a clean error on that chart's canvas, not a cascading failure.
- Supported chart types are a known, small set: `bar`, `line`, `pie`, `doughnut`. The builder prompt enumerates them explicitly.
- Existing `html_report` agents keep working without a rebuild (backwards compatibility with the legacy "HTML with inline scripts" shape).
- Code cleanup: the defensive splitter / per-chart IIFE wrapping added to paper over LLM-authored JS can be removed once the new path works.

## Non-Goals

- No change to the multi-file input system, the run dialog, the report viewer page, or the email-link flow.
- No change to the Obs schema. The run's `output` column continues to store the final, sanitized HTML document.
- No support for Chart.js plugins, mixed chart types, or radar/scatter/bubble. If a use case needs those, we revisit.

## Current Behavior (what we're replacing)

- The `html_report` plan step has shape `{ type: "html_report", name, template }`.
- In practice `template` is `"{{report_html}}"`, where `report_html` is an `output_var` produced by a preceding `llm` step.
- `executeAgent` renders the template, then calls `prepareHtmlReport(rendered)` which:
  1. Strips code fences.
  2. Injects Chart.js UMD bundle + a runtime shim (defaults, Chart constructor wrapper for per-chart runtime try/catch, global `window.error` → banner).
  3. Runs DOMPurify with `WHOLE_DOCUMENT: true` and an `uponSanitizeElement` hook that:
     - Keeps the injected library `<script>` (marked with `data-forge="forge-chartjs-lib"`).
     - Keeps any `<script>` whose text contains `new Chart(`, rewriting its content to a DOM-ready + `new Function()` per-chart isolation wrapper (`buildIsolatedChartRunner`, `splitIntoChartBlocks`).
     - Drops every other `<script>`.

This path stays for backwards compat but becomes the fallback, not the primary route.

## Proposed Behavior

### 1. JSON envelope output contract

The `llm` step that feeds `html_report` is instructed to output a JSON object of this shape:

```json
{
  "html": "<!doctype html>... full HTML document with empty <canvas id='...'></canvas> placeholders ...",
  "charts": [
    {
      "canvas_id": "featureChart",
      "type": "bar",
      "data": {
        "labels": ["Auth", "Frontend", "API Docs"],
        "datasets": [
          { "label": "Story Points", "data": [23, 6, 2] }
        ]
      },
      "options": { "indexAxis": "y" }
    }
  ]
}
```

- `html` is the full `<!doctype html>` document. It contains `<canvas id="<canvas_id>"></canvas>` elements but no `<script>` tags for chart initialization.
- `charts` is an array of chart specs. Each spec has:
  - `canvas_id` (string, required): matches a `<canvas id="...">` in `html`.
  - `type` (string, required): one of `"bar"`, `"line"`, `"pie"`, `"doughnut"`.
  - `data` (object, required): Chart.js v4 `data` config (`labels` + `datasets`).
  - `options` (object, optional): Chart.js v4 `options` config. May be omitted — sensible defaults are applied server-side.

No JavaScript fields. No function values. No `"backgroundColor"` expressions the LLM has to hand-format — colors are numbers/strings in the JSON, which the server converts correctly.

### 2. Server-side assembly

Replace the "inject Chart.js + sanitize scripts" flow in `src/lib/html-report.ts` with:

1. **Parse the LLM output** as JSON. Strip common wrappers first (code fences like ` ```json ... ``` `, leading prose).
2. **Validate the envelope**: `html` is a string, `charts` is an array of objects with required fields and supported types. Drop any chart with unknown `type` or missing `canvas_id`/`data`, and add a warning to a server-side log (not fatal).
3. **Generate init scripts** — for each valid chart spec, emit:
   ```html
   <script data-forge="forge-chart-init">
   (function(){
     var canvas = document.getElementById("<canvas_id>");
     if (!canvas) return;
     try {
       new Chart(canvas.getContext("2d"), <JSON.stringify({type, data, options})>);
     } catch (e) {
       console.error("[forge] chart <canvas_id> failed:", e);
       if (typeof __forgeBanner === "function") __forgeBanner("chart <canvas_id>: " + (e.message || e));
     }
   })();
   </script>
   ```
   Place these scripts immediately before `</body>` in the LLM's `html` (so canvases exist by the time they run; the DOM-ready defer is therefore unnecessary but harmless).
4. **Inject Chart.js + the runtime shim** into `<head>` exactly as today (library bundle + defaults + `__forgeBanner` helper + `window.error` listener).
5. **Sanitize with DOMPurify**. The `uponSanitizeElement` hook keeps any `<script>` carrying `data-forge="forge-chart-init"` or `data-forge="forge-chartjs-lib"`; drops everything else. No more text-pattern matching (`new Chart(`).
6. **Return** the sanitized document.

### 3. Backwards compatibility (legacy path)

If JSON parsing fails or the object doesn't have the expected shape, fall back to the existing HTML-with-inline-scripts path:

- Treat the raw output as HTML (as today).
- Run the existing DOMPurify hook that keeps scripts containing `new Chart(` via `buildIsolatedChartRunner` / `splitIntoChartBlocks`.
- This keeps existing deployed agents working if their plans still expect the old contract.

Log which path was taken (JSON vs legacy) with a short one-liner so we can measure adoption after a few live runs.

### 4. Default chart options

The generator applies these defaults to every chart unless the spec explicitly overrides them:

```js
{
  animation: false,            // print-to-PDF captures immediately
  responsive: true,
  maintainAspectRatio: false,
  plugins: {
    legend: { position: "bottom" }
  }
}
```

Shallow-merge spec `options` over these defaults. Nested `plugins` keys replace wholesale — don't try to deep-merge Chart.js's arbitrary option tree.

### 5. Builder prompt changes

Rewrite the `HTML REPORT GUIDELINES` section in `src/lib/builder.ts`'s `SYSTEM` constant:

- The feeder `llm` step for an `html_report` agent must output a JSON object with `html` and `charts` as described above. No code fences, no prose — just the JSON object.
- `type` must be one of: `bar`, `line`, `pie`, `doughnut`. The prompt should name these explicitly, and say that any other value will be dropped.
- Each `canvas_id` in `charts` must match a `<canvas id="...">` in `html`.
- The HTML must NOT contain `<script>` tags — the server generates them.
- Chart.js is automatically loaded and configured. Do NOT include `<script src="...">`.
- Keep the `max_tokens: 16000` guidance (the JSON can still be long).
- Keep the two-step structure: one `llm` step with `output_var: "report_html"`, then an `html_report` step with `template: "{{report_html}}"`.

### 6. Code cleanup

Once the new path is verified end-to-end, delete:

- `splitIntoChartBlocks` in `src/lib/html-report.ts`.
- `buildIsolatedChartRunner` in `src/lib/html-report.ts`.
- The `CHART_INIT_PATTERN` + the "keep scripts containing `new Chart(`" branch of the DOMPurify hook (replaced by the `data-forge="forge-chart-init"` attribute check).

Keep:
- `__forgeBanner` helper and `window.error` listener (still useful as a last-line safety net).
- The Chart constructor wrapper that paints a red box on a canvas whose `new Chart(...)` call throws at runtime (still useful — bad `data` shapes can throw, e.g. `data: null`).

## Implementation Plan

Files to touch:

1. **`src/lib/html-report.ts`**
   - Add `parseReportEnvelope(raw: string): { html: string; charts: ChartSpec[] } | null` (returns null if not valid JSON envelope).
   - Add `ChartSpec` type: `{ canvas_id: string; type: "bar"|"line"|"pie"|"doughnut"; data: unknown; options?: unknown }`.
   - Add `generateChartScripts(charts: ChartSpec[]): string` (returns a string of `<script data-forge="forge-chart-init">...</script>` blocks).
   - Add `applyChartDefaults(options: unknown): unknown`.
   - Refactor `prepareHtmlReport(raw)` to:
     - Try `parseReportEnvelope` first; if valid, take the new path.
     - Else fall back to existing path.
   - Update the DOMPurify hook to key off `data-forge` marker rather than `new Chart(` text match (so both `forge-chartjs-lib` and `forge-chart-init` are whitelisted).
   - Leave `splitIntoChartBlocks` / `buildIsolatedChartRunner` in place initially, gated behind the legacy fallback. Delete them once the new path has been confirmed working on at least one live run.

2. **`src/lib/builder.ts`**
   - Rewrite the `HTML REPORT GUIDELINES` portion of the `SYSTEM` string to describe the JSON envelope contract.
   - Include the supported chart types (`bar`, `line`, `pie`, `doughnut`) in the prompt.
   - Give a concrete example envelope (like the one in this spec) so the LLM has a template to follow.

3. **No change needed** to `src/lib/execution-engine.ts`, the `html_report` step handler still calls `prepareHtmlReport(rendered)` — the function's contract widens, not its signature.

4. **No change needed** to the report viewer page (`src/app/agents/[slug]/runs/[run_id]/report/page.tsx`) — it still renders the final HTML in a sandboxed iframe.

## Rebuild flow

Existing agents have plans built under the old contract. They will continue to work via the legacy fallback path. To upgrade one to the new contract, rebuild the agent (which regenerates the plan under the new prompt). The "Rebuild" action is already exposed in the UI (`src/app/api/internal/rebuild-agent/route.ts`).

## Test Plan

Test cases to verify manually after implementation:

1. **Happy path**: rebuild the existing PM Weekly Product Report agent. Run it with the sample Jira CSV. Expect: all charts render, no banner errors, HTML is well-formed.
2. **Bad chart data**: simulate a malformed chart (e.g., `data: null` in one spec) by stubbing an LLM output in a local test. Expect: that chart paints a red "Chart failed" box, other charts render fine, `__forgeBanner` shows the error.
3. **Unknown chart type**: LLM emits `"type": "radar"`. Expect: that chart is dropped server-side (no `<canvas>`-less error), other charts render fine, server log shows a warning.
4. **Canvas mismatch**: `canvas_id` in `charts` doesn't match any `<canvas id>` in `html`. Expect: init script runs, `getElementById` returns null, script returns early (no `new Chart` call, no error).
5. **Legacy fallback**: feed a legacy LLM output (HTML with inline `<script>new Chart(...)</script>`) through `prepareHtmlReport`. Expect: same rendering as today (existing behavior preserved).
6. **Non-JSON output**: LLM returns plain HTML or markdown. Expect: falls through to legacy path cleanly.
7. **Code-fenced JSON**: LLM wraps output in ` ```json ... ``` `. Expect: fence is stripped, envelope parsed, new path taken.

Run `npx tsc --noEmit` after each file change.

## Open Questions

- Do we want to enforce a maximum chart count (e.g. 10) to bound the HTML size? Current behavior is unbounded; can revisit if we see abuse.
- Should `options` be schema-validated (reject unknown Chart.js keys) or passed through as-is? Proposed: pass-through — Chart.js silently ignores unknown options, and strict validation means every Chart.js version bump could break agents. Revisit if we see real attacks or runtime errors from garbage options.
