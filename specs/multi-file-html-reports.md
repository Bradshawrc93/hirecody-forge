# Multi-File Input & HTML Report Output — Spec

## Overview

Platform-level additions to Forge that enable a new class of data analysis agents. Two capabilities are added: (1) agents can accept multiple labeled file uploads as input, and (2) agents can produce rich HTML reports with Chart.js visualizations as output. Together, these unlock comparison-style workflows like "upload this week's Jira export and last week's — get a visual report of what changed."

This spec covers the platform changes only, not any specific template agent.

Reference the `/design` skill when implementing any UI changes described here.

## Goals

- Agent creators can define 1–5 named file upload slots with custom labels and required/optional toggles
- End users see labeled file fields at runtime and can attach files to each
- Agents can produce self-contained HTML reports with inline Chart.js visualizations
- Reports are stored as run output in Obs and served via a shareable, stable URL
- Email-enabled agents link to the hosted report instead of inlining heavy HTML
- The builder LLM knows about these capabilities and generates plans that use them

## Core Features

### 1. Multi-File Input Config

- **What:** Agent creators define 1–5 named file upload slots during Step 2 (Capabilities). Each slot has a custom label and a required/optional toggle.
- **Why:** Enables comparison-style agents where the LLM needs to know what each file represents (e.g., "Current Week" vs "Previous Week").
- **How it works:**
  - `InputConfig.file` changes from `{ enabled: boolean; label?: string }` to `{ enabled: boolean; slots: FileSlot[] }` where `FileSlot` is `{ label: string; required: boolean }`.
  - When file input is toggled on, one slot appears by default (required, empty label).
  - "+ Add file slot" adds another, up to 5. Each slot after the first has a remove button.
  - Backwards compatibility: existing agents with the old `file.enabled` boolean are migrated at read time to a single unnamed slot (same pattern as `legacyInputTypeToConfig()`).
- **UI/UX:** See [Agent Creation Flow — Step 2](#agent-creation-flow-step-2--capabilities) in the UX section.

### 2. Multi-File Upload at Runtime

- **What:** When running an agent, users see each creator-defined file slot as a separate labeled upload field. Required slots must have a file before the run can start.
- **Why:** The input mechanism that feeds multiple files into the execution engine with clear labels.
- **How it works:**
  - The run dialog renders one file picker per slot, labeled with the creator's custom label. Required slots show a red asterisk; optional slots show "(optional)".
  - The "Run" button is disabled until all required slots have a file attached.
  - File content is read client-side (same as today — `.docx` base64-encoded, others as text). Each file is sent to `/api/internal/run` as an array of `{ label, content, filename }` objects.
  - The execution engine maps files to template variables: `{{file_1}}`, `{{file_2}}`, etc. The label is available as `{{file_1_label}}` for the LLM to reference.
  - Accepted file types remain `.txt`, `.docx`, `.csv`, `.md`.
- **UI/UX:** See [Agent Run Dialog](#agent-run-dialog-runtime-input) in the UX section.

### 3. HTML Report Output Type

- **What:** New output mode where the LLM generates a self-contained HTML page with inline CSS and inlined Chart.js, stored as the run's output in Obs.
- **Why:** Markdown can't support charts or rich visual layouts. HTML reports unlock data visualization agents.
- **How it works:**
  - A new plan step type is added: `{ type: "html_report"; name: string; template: string }`. This replaces the standard `output` step when the agent is configured for report output.
  - The execution engine captures the LLM-generated HTML as the run's `output` field, with a metadata flag `output_type: "html_report"` on the run record.
  - Chart.js source is inlined in the HTML (not CDN-linked) so reports work offline and when printed to PDF.
  - Before storage, the HTML is sanitized using DOMPurify (server-side via `isomorphic-dompurify`). All `<script>` tags are stripped except those that match a Chart.js initialization pattern (i.e., `new Chart(...)` blocks). This closes XSS vectors from LLM-generated content served via a public URL.
- **UI/UX:** See [Run Detail Page](#run-detail-page--report-output) in the UX section.

### 4. Report Viewer Route

- **What:** A dedicated page at `/agents/[slug]/runs/[run_id]/report` that serves the HTML report.
- **Why:** Gives each report a stable, shareable URL. Works as the link target from email and the run detail page.
- **How it works:**
  - The page fetches the run's output from Obs (same as the run detail page).
  - If `output_type` is `html_report`, the sanitized HTML is rendered in a sandboxed iframe via `srcdoc`.
  - Minimal Forge chrome: a small top bar with "Back to run" link and the Forge logo. The iframe fills the rest of the viewport.
  - Browser native print (Ctrl/Cmd+P) handles PDF export — no custom button needed.
  - If the run doesn't exist or isn't an HTML report, redirect to the run detail page.
- **UI/UX:** See [Report Viewer Page](#report-viewer-page) in the UX section.

### 5. Report Link in Email

- **What:** When email is enabled and output type is `html_report`, the email contains a brief text notification with a link to the report viewer instead of inlining the report.
- **Why:** Email clients mangle complex HTML and can't execute Chart.js. A link is reliable and keeps emails lightweight.
- **How it works:**
  - The `email` step in the execution engine checks `output_type`. If `html_report`, it sends a short email: "Your [Agent Name] report is ready." with a styled "View Report" button linking to the report viewer URL.
  - The report viewer URL is constructed from the agent slug and run ID, which are available in the execution context.
- **UI/UX:** Clean, simple email — one line of text, one button. No charts, no heavy HTML.

### 6. Builder LLM Awareness

- **What:** Update the builder system prompt to know about multi-file inputs and HTML report output so it can generate plans that use them.
- **Why:** The builder won't use capabilities it doesn't know about.
- **How it works:**
  - The builder system prompt (in `builder.ts`) is extended with documentation about:
    - Named file variables (`{{file_1}}`, `{{file_2}}`, `{{file_1_label}}`, etc.) and when to use them
    - The `html_report` output step type and how to structure self-contained HTML with inline Chart.js
    - Guidelines for Chart.js usage: prefer simple chart types (bar, line, pie, doughnut), use the data extracted in prior LLM steps, keep the HTML clean and print-friendly
  - The builder receives the agent's `InputConfig` (including file slot labels) so it can reference files by their semantic meaning in the plan.

## Suggested Features (Approved)

### Report Output Sanitization

- **What:** All LLM-generated HTML is run through DOMPurify before storage. `<script>` tags are stripped except for Chart.js initialization blocks.
- **Why:** LLM-generated HTML served via a public URL is an XSS vector. Lightweight to implement, closes a real risk even for a POC.
- **How it works:** Server-side sanitization using `isomorphic-dompurify` in the execution engine, applied before the output is persisted to Obs. A custom DOMPurify hook allows `<script>` tags whose content matches `/new\s+Chart\(/` and strips all others.
- **UI/UX:** Invisible to the user. If sanitization strips something that breaks the report, it shows up as a rendering issue — the step waterfall will still show the raw output for debugging.

### File Slot Required/Optional Toggle

- **What:** Each file slot can be marked required or optional by the agent creator.
- **Why:** Supports first-run scenarios where comparison data doesn't exist yet (e.g., "last week's export" is optional on the first run). One agent handles both cases.
- **How it works:** The `FileSlot` type includes `required: boolean`. The run dialog disables the Run button only if required slots are empty. Optional slots with no file produce an empty string for their template variable, and the builder prompt instructs the LLM to handle missing optional files gracefully.
- **UI/UX:** Radio toggle (Required / Optional) below each file slot label in the creation flow. At runtime, optional slots show "(optional)" after the label.

## UX & UI

### Agent Creation Flow — Step 2 (Capabilities)

The current single file toggle and label field is replaced with a repeatable slot group:

- Toggle "File Input" on → one file slot appears with a label text field and a required/optional radio toggle (default: required)
- Below the slots, a "+ Add file slot" link. Clicking adds a new slot. Max 5. Counter shows remaining: "3 of 5 remaining".
- Each slot after the first has an "×" remove button
- Slots are numbered visually ("File 1", "File 2") but the creator's custom label is what end users see at runtime

```
┌─ File Input ──────────────────────── [ON] ─┐
│                                             │
│  File 1                                     │
│  Label: [This Week's Jira Export    ]       │
│  ○ Required  ○ Optional                     │
│                                             │
│  File 2                                     │
│  Label: [Last Week's Jira Export    ]       │
│  ○ Required  ○ Optional                     │
│                                             │
│  + Add file slot (3 of 5 remaining)         │
└─────────────────────────────────────────────┘
```

### Agent Run Dialog (Runtime Input)

Each creator-defined file slot renders as a separate labeled upload field:

- Required slots show a red asterisk after the label
- Optional slots show "(optional)" after the label
- The "Run Agent" button is disabled until all required slots have a file
- Text and URL inputs (if enabled) appear above the file slots, same as today

```
┌─ Run Agent ─────────────────────────────────┐
│                                              │
│  This Week's Jira Export *                   │
│  [Choose file] board-export-apr-16.csv       │
│                                              │
│  Last Week's Jira Export (optional)          │
│  [Choose file] No file chosen                │
│                                              │
│  [Cancel]                        [Run Agent] │
└──────────────────────────────────────────────┘
```

### Run Detail Page — Report Output

When the run's `output_type` is `html_report`:

- The markdown output section is replaced with a "View Report" button/link
- Below the button: "HTML report with charts — generated [timestamp]"
- The step waterfall renders normally above — no changes

```
┌─ Run Detail ────────────────────────────────┐
│                                              │
│  Status: Completed · 12s · $0.03             │
│                                              │
│  ┌─ Steps ────────────────────────────────┐  │
│  │ 1. Read files ·········· 0.1s  done    │  │
│  │ 2. Analyze & compare ··· 8.2s  done    │  │
│  │ 3. Generate report ····· 3.4s  done    │  │
│  └────────────────────────────────────────┘  │
│                                              │
│  ┌─ Output ───────────────────────────────┐  │
│  │                                        │  │
│  │   View Report  →                       │  │
│  │                                        │  │
│  │   HTML report with charts              │  │
│  │   Generated Apr 16, 2026              │  │
│  └────────────────────────────────────────┘  │
└──────────────────────────────────────────────┘
```

### Report Viewer Page

`/agents/[slug]/runs/[run_id]/report`

- Minimal top bar: "← Back to run" link on the left, Forge logo on the right
- Below the bar, the HTML report fills the viewport in a sandboxed iframe (`srcdoc`)
- The iframe sandbox allows scripts (for Chart.js rendering) but blocks navigation, forms, and popups
- Browser print (Ctrl/Cmd+P) is the PDF export path — no custom UI for this

### Email Output

When `output_type` is `html_report` and email is enabled:

- Subject: "[Agent Name] — Report Ready"
- Body: One line of text ("Your [Agent Name] report is ready."), followed by a styled "View Report" button linking to the report viewer URL
- No charts, no heavy HTML, no inline report content

## Technical Approach

### Data Model Changes

**InputConfig (in `types.ts`):**
```typescript
interface FileSlot {
  label: string
  required: boolean
}

interface InputConfig {
  text: { enabled: boolean; size: "short" | "long"; label?: string }
  url: { enabled: boolean; label?: string }
  file: { enabled: boolean; slots: FileSlot[] }
}
```

**Backwards compatibility:** Add a `legacyFileConfigToSlots()` migration function. Old agents with `file: { enabled: true, label: "..." }` become `file: { enabled: true, slots: [{ label: "...", required: true }] }`. Called at read time alongside existing `legacyInputTypeToConfig()`.

**PlanStep (in `agent-plan.ts`):**
```typescript
// Add to PlanStep union:
| { type: "html_report"; name: string; template: string }
```

**Run record (in Obs):**
- Add optional `output_type: "markdown" | "html_report"` field (default: `"markdown"` for backwards compat)

### API Route Changes

**`/api/internal/run` (route.ts):**
- Accept `files: Array<{ label: string; content: string; filename: string }>` in the request body (replacing the single `fileText` field)
- Map to execution engine variables: `file_1`, `file_2`, `file_1_label`, `file_2_label`, etc.
- Backwards compat: if the old `fileText` field is present, treat as a single-file array

**New route: `/agents/[slug]/runs/[run_id]/report` (page.tsx):**
- Fetch run from Obs, check `output_type === "html_report"`
- Render the sanitized HTML in a sandboxed iframe
- Redirect to run detail if not an HTML report run

### Execution Engine Changes

**`execution-engine.ts`:**
- Handle `html_report` step type: execute like an `output` step but set `output_type: "html_report"` on the run record
- Before persisting: sanitize HTML via `isomorphic-dompurify` with custom hook for Chart.js scripts
- For email steps: check `output_type` — if `html_report`, send notification email with report link instead of inline content

### Builder Prompt Changes

**`builder.ts`:**
- Extend system prompt with multi-file variable documentation and examples
- Add `html_report` step type documentation with Chart.js guidelines
- Pass file slot labels into the builder context so plans reference files semantically

### New Dependencies

- `isomorphic-dompurify` — server-side HTML sanitization (small, well-maintained)
- Chart.js source file — bundled as a static asset for inlining into reports (not a runtime dependency)

### Key Decisions

- **Chart.js inlined, not CDN** — Reports work offline and in print-to-PDF. The Chart.js minified source (~200KB) is stored as a static asset and injected into the HTML template by the execution engine.
- **Iframe sandboxing** — The report viewer uses `sandbox="allow-scripts"` on the iframe. This lets Chart.js execute but prevents navigation, form submission, and popup creation.
- **No new storage layer** — HTML reports are stored as the run's `output` text field in Obs, same as markdown outputs. No blob storage needed.
- **Sanitization is server-side** — Applied once before storage, not on every render. Clean HTML is served directly.

## Out of Scope (v1)

- Specific template agents (Jira report, etc.) — this spec covers platform capabilities only
- Server-side PDF generation (Puppeteer, etc.) — browser print handles this
- File-to-file diffing logic — the LLM handles comparison; no structural diff engine
- File size limits or preprocessing — not needed for POC scale
- Persistent file storage between runs (agent "memory") — users upload files each time
- New file type support beyond `.txt`, `.docx`, `.csv`, `.md`

## Open Questions

1. **Chart.js version** — Which version to bundle? v4 (latest, ESM-native) vs v3 (wider browser compat)? Recommendation: v4, since the iframe is a controlled environment.
2. **Obs `output_type` field** — Does this need an Obs API change, or can it piggyback on an existing metadata/config field on the run record? Need to check the Obs schema.
3. **Report URL auth** — Are report viewer URLs public (anyone with the link can view) or gated behind the agent's API key? For POC, public is simpler. Flag for future if reports contain sensitive data.
