# CSV Output Type — Spec

## Overview

Adds a new `csv` output type to the Forge agent builder, alongside the existing `text`, `file`, `email`, `notification`, `html_report`, and `side-effect` types. When a user selects CSV, the built agent produces a downloadable `.csv` file (RFC 4180, UTF-8 with BOM) that opens cleanly in Excel, Google Sheets, or Numbers. Columns and rows are determined by the LLM based on the agent's success criteria — the feature is generic and reusable by any future agent, not specific to any one use case. The first intended consumer is an "events near me" agent, but no events-specific logic is built.

## Goals

- Let builders pick "CSV" as an output type on Step 3 of the create flow.
- Produce a valid CSV file that opens cleanly in Excel/Sheets without mangled characters, broken columns, or quoting errors.
- Surface the CSV on the run page via a single download button, with enough context (filename, row count, column list) for the user to know what they got without previewing.
- When email is enabled, attach the CSV to the completion email.
- Cap output at 500 rows to protect against runaway generations, with a visible truncation notice when the cap is hit.

## Core Features

### 1. New `csv` value in the `output_type` union
- **What:** Extend the `output_type` union in `src/components/CreateFlow/types.ts` and the mirror in `src/lib/builder.ts` to include `"csv"`.
- **Why:** The option has to exist in the type system, builder API, and Obs record before anything downstream can react to it.
- **How it works:** Union becomes `"text" | "file" | "email" | "notification" | "html_report" | "csv" | "side-effect"`. Any code that narrows on this union needs a `csv` branch or an explicit `default` fallback.
- **UI/UX:** Not directly visible; enables the radio option in Feature 2.

### 2. "CSV — spreadsheet file" radio option on Step 3
- **What:** Add a new radio button to the output-type picker on Step 3 of the create flow, labeled **"CSV — spreadsheet file"**, placed between `file` and `html_report`.
- **Why:** Primary user-facing entry point for the feature.
- **How it works:** When selected, the form stores `output_type: "csv"`. No other form fields change.
- **UI/UX:**
  - Helper line below the radio: *"Your agent will produce a CSV file (openable in Excel/Sheets). The LLM decides the columns based on your success criteria."*
  - Additional helper line (only if `can_send_email` is already toggled on): *"CSV will be attached to the notification email."*

### 3. `csv_report` terminal step in the agent plan
- **What:** New terminal step type in the agent-plan schema, analogous to `html_report`. Its template is literally `{{csv_data}}` — nothing else.
- **Why:** LLMs cannot reliably produce raw CSV (quoting, escaping, encoding all break). The `html_report` pattern already solves this for HTML by forcing the LLM to emit structured JSON first, then rendering deterministically. Same pattern, same reason.
- **How it works:** Two-step terminal flow identical in shape to `html_report`:
  1. An `llm` step produces a strict JSON envelope:
     ```json
     {
       "columns": ["event_name", "date", "venue", "city", "price_range", "url"],
       "rows": [
         ["Concert A", "2026-05-01", "Venue 1", "Chicago", "$50-$100", "https://..."]
       ]
     }
     ```
     Stored in `output_var: "csv_data"` with `max_tokens` sized for the expected row count (default 16000).
  2. A `csv_report` step whose template is `{{csv_data}}`. The execution engine intercepts this step, parses the JSON, and renders a CSV file (see Feature 5).
- **UI/UX:** Not directly visible; consumed by the engine.

### 4. Builder prompt updates
- **What:** Update the agent-plan generator prompt in `src/lib/builder.ts` to teach the planning LLM when to choose `csv_report` and how to structure the JSON envelope.
- **Why:** Without this, the builder will never emit valid CSV plans when users pick that output type.
- **How it works:** Add a `CSV REPORT GUIDELINES` section to the existing builder prompt, mirroring the existing `HTML REPORT GUIDELINES` section. Guidelines include:
  - The two-step envelope contract (JSON first, then `csv_report` terminal step).
  - Column naming: lowercase, `snake_case`, no spaces or punctuation.
  - Dates in ISO 8601 (`YYYY-MM-DD`), times in `HH:MM` 24-hour.
  - One logical entity per row.
  - Keep free-text fields concise; do not put multi-paragraph content in cells.
  - Terminal step must be `csv_report` when `output_type === "csv"` — never `output` or `html_report`.
- **UI/UX:** Not directly visible.

### 5. CSV rendering in the execution engine
- **What:** New handler in `src/lib/execution-engine.ts` (and/or a new `src/lib/csv-report.ts` module parallel to `src/lib/html-report.ts`) that converts the JSON envelope to a CSV file.
- **Why:** Deterministic rendering is the only way to guarantee the file opens cleanly. LLM-emitted raw CSV is unreliable.
- **How it works:**
  - Parse `{{csv_data}}` as JSON, validate shape (`columns: string[]`, `rows: unknown[][]`, row length matches column count).
  - Enforce the 500-row cap (Feature 6).
  - Serialize to CSV with RFC 4180 rules:
    - Comma delimiter, `\r\n` line endings.
    - Fields containing comma, double-quote, or CR/LF are wrapped in double quotes.
    - Embedded double-quotes are doubled (`"` → `""`).
    - Header row always included.
  - Prepend UTF-8 BOM (`\uFEFF`) so Excel renders Unicode correctly on Windows.
  - Coerce non-string cell values: numbers → string, `null`/`undefined` → empty string, booleans → `"true"`/`"false"`, objects/arrays → `JSON.stringify`.
  - Store the resulting file as a run artifact; record `output_type: "csv"`, filename, row count, column list, and truncation flag in the run metadata.
- **UI/UX:** Not directly visible; downstream of this.

### 6. 500-row cap with truncation metadata
- **What:** Hard cap of 500 rows enforced by the engine.
- **Why:** Protects against runaway outputs and matches the stated constraint.
- **How it works:** If `rows.length > 500`, truncate to the first 500 and record `truncated: true` in run metadata. Log at `warn` level.
- **UI/UX:** Surfaces as a truncation notice on the run page (Feature 8).

### 7. File storage and naming
- **What:** CSV files stored alongside other run artifacts; filename derived from agent slug + run date.
- **Why:** Predictable, non-conflicting filenames when users save multiple runs.
- **How it works:** Filename format: `<agent_slug>-<YYYY-MM-DD>.csv`. Slug is already sanitized by the create flow (lowercase, hyphens). Date derived from run completion timestamp in the user's timezone (America/Chicago, matching the scheduling convention). If a filename collision would occur in storage, append `-<short_run_id>`.
- **UI/UX:** Filename appears in the run-page download block and as the attachment name in email.

### 8. Run page download block
- **What:** Replaces the markdown/HTML render area with a download block when `output_type === "csv"`.
- **Why:** Primary consumption surface for the CSV.
- **How it works:** Updates to `src/components/LiveRunView.tsx` and the server-rendered `src/app/agents/[slug]/runs/[run_id]/page.tsx`:
  - When the completed run's `output_type === "csv"`, render the download block inside the existing Output card instead of `MarkdownView` or the HTML-report link.
  - Block contents, top to bottom:
    1. Filename headline (bold).
    2. Row/column count (muted).
    3. Column list (muted, truncates with ellipsis if very wide; full list on hover via `title`).
    4. Truncation notice (only when `truncated === true`, warning-colored).
    5. `Download CSV` primary button linking to the artifact URL.
  - A new download endpoint or direct artifact-URL route serves the file with `Content-Type: text/csv; charset=utf-8` and `Content-Disposition: attachment; filename="..."`.
- **UI/UX:** See UX & UI section below for layout details.

### 9. Email attachment when `can_send_email` is on
- **What:** When the agent has email enabled, send a short completion email with the CSV attached.
- **Why:** Requested feature; parallel to existing `html_report` email behavior.
- **How it works:**
  - Engine-generated (not LLM-generated) body: `"Your CSV is attached. <N> rows, <M> columns."`.
  - Subject remains LLM-defined from the `email` step's `subject_template` — same contract as today, same rules (single line, no newlines, under ~80 chars).
  - Attachment is the same CSV file served from the download button, with the same filename.
  - The agent-plan generator prompt is updated: for CSV agents with email enabled, the `email` step's `body_template` can be any short string — it will be replaced by the engine, same as `html_report`.
- **UI/UX:** No new UI; email appears in the user's inbox.

### 10. Clone and rebuild paths respect `csv`
- **What:** Cloning an existing CSV agent or rebuilding one preserves `output_type: "csv"`.
- **Why:** Matches existing `html_report` behavior; prevents silent regressions.
- **How it works:** Audit `src/app/api/internal/rebuild-agent/route.ts` and any clone/session-storage code paths to confirm `output_type` is passed through unchanged. Add the `csv` branch anywhere `html_report` is explicitly handled.
- **UI/UX:** Not directly visible; prevents bugs.

## Suggested Features (Approved)

### 11. Column list on the run page
- **What:** Muted one-liner above the download button showing the columns the LLM chose: `Columns: event_name, date, venue, city, price, url`.
- **Why:** No preview means users can't tell what's inside without downloading. A column list gives a "did this do what I wanted?" signal at near-zero cost — especially valuable because columns are LLM-decided.
- **How it works:** Rendered as part of the download block (Feature 8). Truncates with ellipsis beyond a sensible width; full list exposed via `title` attribute on hover.
- **UI/UX:** Third line in the download block.

### 12. Truncation notice
- **What:** Visible warning on the run page when the 500-row cap was hit.
- **Why:** Silent truncation is a classic "why is my data incomplete?" support issue.
- **How it works:** Renders only when `truncated === true` in run metadata. Warning-colored small text inside the download block.
- **UI/UX:** Fourth line in the download block (above the button).

### 13. Builder-prompt guardrails for CSV agents
- **What:** Specific prompt nudges in the builder guidelines section (Feature 4) covering column naming, ISO date/time formats, and "one entity per row" discipline.
- **Why:** Without guardrails, LLMs will emit `Event Name` (title case, space) and `April 16th, 2026` (unsortable), breaking downstream sort/filter in Sheets.
- **How it works:** Part of the prompt additions in Feature 4. Listed here separately because it's an intentional quality investment, not a correctness requirement.
- **UI/UX:** Not directly visible.

### 14. Clone/rebuild preservation (already listed as Feature 10)
- Kept under Core because it's a correctness requirement, not a nice-to-have.

## UX & UI

### Page Structure
No new pages are added. Two existing surfaces gain new rendering branches:
- **Step 3 of the create flow** (`src/components/CreateFlow/Step3...tsx`) — new radio option for CSV.
- **Run page / Live run view** (`src/app/agents/[slug]/runs/[run_id]/page.tsx` and `src/components/LiveRunView.tsx`) — new download block inside the existing Output card.

### Layout Details

**Step 3 output-type picker:**
The existing vertical radio list gains a new option between `file` and `html_report`:

```
( ) Text / markdown
( ) File
(•) CSV — spreadsheet file
    Your agent will produce a CSV file (openable in Excel/Sheets).
    The LLM decides the columns based on your success criteria.
    [If email is on:] CSV will be attached to the notification email.
( ) HTML report
( ) Email
( ) Notification
( ) Side-effect
```

**Run page Output card (CSV completed run):**
The existing Output card (max-height 400px, card-style container) contains, top to bottom:

```
events-near-me-2026-04-16.csv                  ← bold filename
47 rows · 6 columns                            ← muted
Columns: event_name, date, venue, city, ...    ← muted, truncates
Truncated to 500 rows — agent produced more.   ← only if truncated
[ Download CSV ]                               ← primary button
```

For non-CSV runs the card renders unchanged (markdown, HTML-report link, loading, or error state).

### Key Interactions

1. **Create a CSV agent:** User progresses through the create flow, picks "CSV — spreadsheet file" on Step 3. No extra fields. Completes flow. Builder emits a plan with a `csv_report` terminal step.
2. **Run a CSV agent:** User triggers a run (manual or scheduled). Waterfall streams steps exactly like today. On completion, the Output card flips from the running state to the download block.
3. **Download:** User clicks `Download CSV`. Browser downloads the file directly from the artifact URL. No intermediate modal.
4. **Email:** If `can_send_email` is on, the user also receives an email with the CSV attached.
5. **Clone:** User clones a CSV agent. New agent inherits `output_type: "csv"`.

## Technical Approach

### Stack
No new dependencies required. CSV serialization is ~30 lines of hand-written code (RFC 4180 is small); no library needed. Email attachment uses whatever email provider the existing `html_report` flow uses (no change).

### Data model
- Extend `output_type` union in `src/components/CreateFlow/types.ts` to include `"csv"`.
- Extend `output_type` union in `src/lib/builder.ts` to match.
- Extend the plan-step type discriminator (wherever `"html_report"` is defined as a valid `step.type`) to include `"csv_report"`.
- Run metadata gains: `filename: string`, `row_count: number`, `column_count: number`, `columns: string[]`, `truncated: boolean`. These can hang off the same metadata blob the engine already writes for `html_report`.

### Key architectural decisions
- **Mirror the `html_report` pattern exactly.** Two-step terminal flow (structured JSON → deterministic render) is already proven in this codebase and solves the same class of problem (LLMs are bad at emitting escaped text formats).
- **Deterministic CSV rendering lives in the engine, not the LLM.** The LLM only emits JSON; all quoting/escaping/encoding is engine code. This is the core correctness invariant of the feature.
- **UTF-8 with BOM.** Explicit choice for Excel compatibility. Without the BOM, Excel on Windows misreads UTF-8 as Windows-1252 and mangles accented characters. The BOM is standard practice for "Excel-friendly CSV."
- **500-row cap enforced server-side.** Truncation is a policy decision, not an LLM behavior — the LLM may emit more, the engine trims. This keeps the cap reliable regardless of model behavior.
- **Filename derived from slug + date, not from LLM output.** Predictable, sanitized, and avoids a whole class of LLM-injection filename bugs.

## Out of Scope (v1)

- **No retrofit for existing agents.** Only newly created agents can be CSV agents. Confirmed acceptable by the user.
- **No CSV preview on the run page.** Only filename, row count, and column list.
- **No user-specified column schemas in the builder UI.** Columns are entirely LLM-decided from the success criteria.
- **No alternative delimiters** (TSV, semicolon, pipe). Comma only.
- **No multi-sheet / XLSX output.** Single-file CSV only; XLSX would require a different renderer and a binary format decision.
- **No live-stream of rows.** The full CSV is produced in a single LLM step, not streamed incrementally.
- **No in-place editing of a completed CSV.** Users re-run the agent to get a new file.
- **No compression / ZIP** for large files — 500-row cap keeps files small enough that this is irrelevant.

## Open Questions

1. **Storage location for CSV artifacts.** Where does `html_report` currently store its rendered HTML? The CSV should follow the same path. (Implementation-time decision; check `src/lib/html-report.ts` and the run-artifact storage layer.)
2. **Download endpoint vs direct blob URL.** Does the codebase already expose a generic artifact-download route, or does each output type get its own (`/agents/[slug]/runs/[run_id]/report` exists for HTML)? CSV could follow the same pattern with `.../csv` or use a generic `.../download`.
3. **Email provider attachment support.** Confirm the existing email integration supports attachments and what the size limit is. (If attachments are not supported, fall back to a link-to-download email — but 500 rows × reasonable column width should be well under any attachment limit.)
4. **Concurrency on filename collisions.** Two runs on the same day produce the same base filename. The spec says "append short run_id" — worth confirming whether the existing artifact store already handles this via unique keys, making the suffix unnecessary for storage and only relevant for display.
5. **Clone path behavior.** Does cloning currently copy `html_report` cleanly? If yes, CSV is a straightforward extension. If there are known gaps, they need to be fixed for both types together.
