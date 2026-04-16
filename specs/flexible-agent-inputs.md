# Flexible Agent Input System — Spec

## Overview
Forge agents currently accept input through a single dropdown (`none`, `text`, `file`, `both`). This spec replaces that with a multi-select checkbox system supporting three distinct input types — text, URL, and file upload — that creators can mix and match. It also expands file support to `.docx` and `.txt`, adds creator-defined labels for input fields, and surfaces the correct input fields at run time for manual (non-scheduled) agents. All changes are backwards-compatible with existing agents.

## Goals
- Creators can configure any combination of text, URL, and file inputs per agent
- Users running a manual agent see exactly the input fields the creator enabled
- File uploads support `.txt`, `.docx`, `.csv`, and `.md`
- Existing agents with the old `input_type` schema continue to work without modification
- No changes to scheduled agent behavior, the builder LLM system prompt, or the execution engine's step types

## Core Features

### 1. Multi-Select Input Types
- **What:** Replace the `input_type` dropdown in Step 2 (Capabilities) with three checkboxes: Text input, URL, File upload
- **Why:** Different agents need different input combos. A meeting-notes agent needs text + file, a web scraper needs URL only, a data enricher needs file only. The dropdown can't express these combinations
- **How it works:** The `FormState.input_type` field changes from a single enum to a structured object:
  ```ts
  input_config: {
    text: { enabled: boolean; size: "short" | "long"; label?: string };
    url:  { enabled: boolean; label?: string };
    file: { enabled: boolean; label?: string };
  }
  ```
  When passed to the builder LLM, this replaces the old `input_type` field. The builder sees which inputs are enabled and generates plan steps that reference `{{input_text}}`, `{{input_url}}`, and/or `{{file_text}}` accordingly.
- **UI/UX:** Three checkboxes in a horizontal row under the "What input will this agent need?" label. Helper text: "Check all that apply. Leave all unchecked for agents that gather their own data (e.g., scheduled digests)." When a checkbox is checked, its configuration options appear inline below it.

### 2. Text Input Size Hint
- **What:** When "Text input" is checked, a toggle appears: Short (a name, a question) vs. Long (meeting notes, transcripts)
- **Why:** A 45-minute meeting transcription pasted into a single-line input is a bad experience. This controls whether the run-time UI renders an `<input>` or a `<textarea>`
- **How it works:** Stored as `input_config.text.size` — either `"short"` (default) or `"long"`. Consumed only by the run-time input UI, not by the execution engine
- **UI/UX:** Two toggle buttons (like the existing Yes/No email toggle) appearing when the Text checkbox is checked

### 3. Input Field Labels
- **What:** Each checked input type gets an optional label field the creator can customize
- **Why:** Community-facing agents need clear guidance. "Paste your meeting transcript here" is better than "Text input" for someone who didn't create the agent
- **How it works:** Stored as `input_config.{text,url,file}.label`. Falls back to defaults: "Text input", "URL", "Upload a file"
- **UI/UX:** A small text input below each checked checkbox, with placeholder showing the default label

### 4. Expanded File Type Support
- **What:** Accept `.txt`, `.docx`, `.csv`, and `.md` file uploads. Parse `.docx` server-side to extract plain text
- **Why:** Meeting transcripts commonly export as `.txt` or `.docx`. The current `.csv`/`.md` restriction is too narrow
- **How it works:** Client-side file picker restricts to `.txt,.docx,.csv,.md`. For `.docx`, the upload handler uses a library (e.g., `mammoth`) to extract text content before passing it to the execution engine as `file_text`. For `.txt`, read as plain text. `.csv` and `.md` continue as-is
- **UI/UX:** Helper text below the file upload field: "Supported: .txt, .docx, .csv, .md"

### 5. Run-Time Input Fields for Manual Agents
- **What:** When a user clicks "Run" on a non-scheduled agent, the UI shows input fields matching the creator's configuration
- **Why:** Currently there's no clear path for users to provide input when manually running an agent
- **How it works:** The run dialog reads the agent's `input_config` and renders fields in order: text (input or textarea based on size hint), URL (single-line input with https:// placeholder), file upload (file picker with format restrictions). Each field uses the creator's custom label or the default. The "Run Agent" button submits all provided values to `/api/internal/run`
- **UI/UX:** Fields appear in the order: text, URL, file. If no inputs are configured, show: "This agent runs on its own — no input needed." with the Run button

### 6. Backwards-Compatible Schema Migration
- **What:** Old agents with `input_type: "none" | "text" | "file" | "both"` must continue to work
- **Why:** Existing agents can't break
- **How it works:** A mapping function converts old values to the new structure:
  - `"none"` → all inputs disabled
  - `"text"` → text enabled (short, default label), url and file disabled
  - `"file"` → file enabled (default label), text and url disabled
  - `"both"` → text enabled (short) + file enabled, url disabled
  
  This runs at read time (when loading an agent's config), not as a data migration. Old agents are never rewritten — they're interpreted through the new model.

## UX & UI

### Page Structure
No new pages. Changes are confined to:
- **Step 2 (Capabilities)** in the creation flow — input section replacement
- **Agent run dialog/trigger** — input fields for manual agents

### Layout Details

**Step 2 — Input Section (replaces the dropdown)**

```
What input will this agent need?
[checkbox row: ☐ Text input   ☐ URL   ☐ File upload]
"Check all that apply. Leave all unchecked for agents that gather 
their own data (e.g., scheduled digests)."

[if Text checked]
  Expected length:  [Short] [Long]     ← toggle buttons
  Label (optional): [________________________]
                     placeholder: "e.g., Paste your meeting transcript here"

[if URL checked]
  Label (optional): [________________________]
                     placeholder: "e.g., Enter the webpage URL to analyze"

[if File checked]
  Label (optional): [________________________]
                     placeholder: "e.g., Upload your meeting recording transcript"
  "Supported formats: .txt, .docx, .csv, .md"
```

Everything else on Step 2 stays as-is (model picker, email toggle, schedule picker).

**Run Dialog — Manual Agent Input**

```
[Agent Name] — Run

[if text enabled, short]
  "Paste your meeting transcript here"    ← creator label or default
  [single-line input___________________]

[if text enabled, long]
  "Paste your meeting transcript here"    ← creator label or default
  [                                     ]
  [          textarea ~6 rows           ]
  [                                     ]

[if url enabled]
  "Enter the webpage URL to analyze"      ← creator label or default
  [https://____________________________]

[if file enabled]
  "Upload your meeting recording transcript" ← creator label or default
  [Choose file...]  "Supported: .txt, .docx, .csv, .md"
  (after selection: "notes.docx — 24 KB")

                                    [Run Agent]
```

If no inputs configured: "This agent runs on its own — no input needed." + [Run Agent]

### Key Interactions
- Checking/unchecking an input checkbox immediately shows/hides its configuration section
- File upload validates extension client-side before accepting
- `.docx` files are parsed to plain text on upload (server-side), before execution
- The "Run Agent" button is always enabled — unfilled optional inputs pass as null
- Run-time input fields are read from the agent's stored `input_config`

## Technical Approach

### Data Model
- `FormState.input_type` replaced by `FormState.input_config` (structured object as described above)
- `BuilderInput.input_type` updated to pass the new config to the builder LLM
- Builder system prompt updated to understand three input variables: `{{input_text}}`, `{{input_url}}`, `{{file_text}}`
- `ExecutionInput` gains `inputUrl?: string | null`
- Template variable bag in execution engine adds `input_url`

### .docx Parsing
- Add `mammoth` (or similar lightweight library) as a dependency
- Parse happens in the `/api/internal/run` route (or a shared util) before passing to the execution engine
- Extract text only — no formatting, images, or styles needed

### Backwards Compatibility
- Read-time adapter function: `legacyInputTypeToConfig(input_type: string): InputConfig`
- Applied whenever loading agent config from Obs API
- No data migration, no rewriting stored agents
- Builder LLM system prompt accepts both old and new formats gracefully

### Files Likely Modified
- `src/components/CreateFlow/types.ts` — FormState + InputConfig type
- `src/components/CreateFlow/Step2Capabilities.tsx` — checkbox UI
- `src/lib/builder.ts` — BuilderInput type + system prompt update
- `src/lib/execution-engine.ts` — add `input_url` to variable bag
- `src/app/api/internal/run/route.ts` — accept `input_url`, handle `.docx` parsing
- Run trigger UI component (wherever the "Run" button + dialog lives)

### Files NOT Modified
- `src/lib/agent-plan.ts` — step types unchanged
- `src/app/api/internal/dispatch/route.ts` — scheduled flow unchanged
- Step 1, Step 3, Step 4, Step 5 components — unchanged
- Agent detail/history pages — unchanged

## Out of Scope (v1)
- File content preview after upload
- Drag-and-drop file upload
- Multiple file uploads in a single run
- Dynamic input fields that change based on previous input
- Email to arbitrary addresses (stays verified-only)
- PDF, Excel, or other file format support
- URL auto-fetch as a built-in input behavior (the builder LLM generates a `web_fetch` step if needed — the URL input is just a text field with URL validation)

## Open Questions
1. **Max text input size** — Should we cap the textarea at a character limit? A 45-min transcript could be 10,000+ words. The execution engine passes it through to the LLM, which has its own token limit, but we may want a client-side warning.
2. **mammoth bundle size** — Need to verify `mammoth` is reasonable for a Next.js serverless function. If too heavy, consider a lighter `.docx` parser or API-based extraction.
