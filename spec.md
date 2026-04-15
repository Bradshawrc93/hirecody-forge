# Obs Forge — Spec

## Overview

Obs Forge is a public agent playground hosted at `forge.hirecody.dev`. Visitors describe an automation in plain English, Forge generates a working AI agent, the visitor watches it execute live with full step-by-step telemetry, and once it passes a thumbs-up test run it goes live — runnable on demand or on a schedule. Every Forge agent is also an Obs "app," so cost, token, and latency telemetry flows automatically to the Obs dashboard at `obs.hirecody.dev`. This is a proof of concept, not a commercial product: expected traffic is 20–30 visitors and ~10 community-built agents alongside 3–5 owner-curated agents.

## Goals

- Let a non-technical visitor go from idea to live agent in under five minutes.
- Make invisible LLM work visible — the live waterfall during test runs is the hero moment.
- Demonstrate the Obs platform end-to-end (agent ↔ app pairing, dual telemetry, cost rollups) without writing a separate showcase.
- Keep Forge stateless except for the one piece of state it must own: a KV map of `app_id → api_key` for scheduled-run authentication.
- Hard-fence scope: single-purpose agents, 1–5 steps, LLM + web fetch + file processing + email + scheduling. Anything beyond that gets gracefully rejected at creation time.

## Tech Stack

- **Framework:** Next.js (App Router) on Vercel at `forge.hirecody.dev`. Node runtime, no Python.
- **Orchestration:** OpenAI Agents SDK (TypeScript) running inside Vercel serverless functions.
- **LLM providers:** Anthropic (Claude) and OpenAI. Visitor picks the model during creation.
- **Builder model:** `claude-sonnet-4-6` (locked).
- **Guardrail/safety/explainer model:** `claude-haiku-4-5` (locked).
- **State:** Vercel KV (or Upstash) — single namespace, single key shape: `agent:<app_id> → api_key`. Nothing else.
- **Integration with Obs:** All run, step, build, agent, and telemetry data lives in Obs. Forge talks to Obs via the endpoints in `FORGE_INTEGRATION.md`. That document is the source of truth for every API call this app makes.
- **Real-time progress:** Polling, not SSE — `GET /api/forge/runs/[id]/steps?since=<last_seq>` every ~750ms (see integration doc §7.4).
- **Styling:** Tailwind v4 (`@import 'tailwindcss'`) with CSS variables exposed via `@theme inline`. Palette inherited from `hirecody-chatbot`:
  - `--background: #FAF7F2`, `--foreground: #2B2B2B`
  - `--card: #F1E9DD`, `--border: #E5DDD0`, `--input: #E5DDD0`
  - `--primary / --accent / --ring: #C56A2D` (signature orange)
  - `--primary-foreground: #FAF7F2`, `--muted-foreground: #6B6B6B`
  - `--radius: 0.75rem`
  - Fonts: Inter (sans), Geist Mono (mono)
  - Reuse the `fadein` and `pulse-bar` keyframe utilities from the chatbot for new-card reveals and building-card pulsing.

## Critical Integration Details (must follow)

Read `FORGE_INTEGRATION.md` thoroughly before building. Key constraints:

### Auth
- Every agent gets one `obs_...` api key, returned exactly once from `POST /api/forge/agents`. There is no recovery endpoint.
- That same key authenticates all Forge endpoints AND `POST /api/events` for LLM telemetry.
- Forge stores it in the KV namespace immediately after creation. KV is the only place the key lives long-term.
- Header: `x-api-key: obs_<key>`.

### Dual telemetry streams
- **LLM calls** → `POST /api/events` (the existing Obs collector). Free cost/token/latency observability on the Obs dashboard.
- **Step waterfall events** (start/complete/fail for tool calls, web fetches, phase markers) → `POST /api/forge/runs/[id]/steps`.
- **LLM steps appear in BOTH streams.** When a step is an LLM call: log to `/api/events` first, capture the returned `event_uuid`, then post the step to `/api/forge/runs/[id]/steps` with `event_ref: <event_uuid>`. This links the waterfall row to its full cost record.

### Polling protocol
- Cursor poll only. `?since=4` returns `seq > 4` (exclusive). Save `last_seq` between polls in case of a network blip.
- Loop terminates when `run_status` is `completed` or `failed`.

### Agent ↔ app relationship
- Every Forge agent is also an Obs `apps` row with `type='forge'`. URLs and API calls use `apps.id` (UUID), not the slug.
- Slug is a friendly display handle — provided at creation, used in Forge's own URL paths.
- `creator_type` is not settable via public API. Visitors implicitly create `visitor` agents. Owner agents are seeded internally.

### State machine
- Obs enforces valid status transitions (see integration doc §4). Invalid transitions return `409`.
- Build with `status=success` auto-advances `building → awaiting_test`. Build with `status=failed` advances `building → build_failed`. Forge does not need to PATCH for these.
- `expired` is reachable only via Obs's nightly cron — Forge cannot set it.

### Scheduled run execution (Forge's responsibility)
- Obs cron creates `queued` runs every 15 minutes for agents whose `next_run_at` has passed. Forge must pick them up and execute them.
- Forge runs its own Vercel cron every 5 minutes that hits an internal route, queries Obs for queued runs Forge owns (filtered by KV membership), and executes them serially. Bail before approaching the 60s function limit; remaining runs are picked up on the next tick.

### Obs-side changes required for v1
These are NOT in `FORGE_INTEGRATION.md` today and need to land on the Obs side before/while Forge is built:

1. **`GET /api/forge/agents/[id]/runs`** — paginated run history endpoint scoped to one agent. Required by the agent detail view.
2. **`schedule_day_of_week` and `schedule_day_of_month`** fields on the agent record, plus updates to the cron dispatch logic so weekly and monthly cadences fire on the correct day rather than just on cadence+time alone.

A separate prompt is being prepared for the Obs side covering both. Do not start Forge until these are merged or stub them with feature flags.

---

## Core Features

### 1. Agent Grid (public landing)
- **What:** The `/` page renders a public list of all non-deleted agents.
- **Why:** The shop window. Showcases what Forge is and what's been built.
- **How it works:** Calls `GET /api/forge/agents` (unauthenticated). Filters/sections client-side into "Built by Cody" (`creator_type=owner`) and "Community Agents" (`creator_type=visitor`). Excludes `expired` and `deleted`.
- **UI/UX:** Two stacked sections with distinct treatment — owner cards have a featured ribbon or border highlight; community cards are a responsive grid (collapsing to a single column on mobile). Each card shows `display_name`, truncated description (~100 chars), status badge, creator badge, schedule icon, rating icon, and a bottom strip: **"Delivered • 2h ago"** if the most recent run had email output, **"Completed • 2h ago"** otherwise. Cards in `building` or `awaiting_test` render greyed with a `pulse-bar` animation and no bottom strip.

### 2. Five-Step Creation Flow
- **What:** A guided modal at `/create` (full-screen on mobile) that walks a visitor from prompt to live agent.
- **Why:** Structured steps make agent authoring feel guided, not freeform — and let Forge insert guardrails between steps.
- **How it works:** Sequential panels with a 1→5 progress indicator. State persists across step navigation. Each step gates the next.
- **UI/UX:** See "UX & UI" section for per-step layout.

### 3. Complexity Guardrail
- **What:** A debounced background LLM call (1.5s after the user stops typing) that classifies the agent description as `simple | moderate | complex`.
- **Why:** Hard scope fence. Protects Forge from multi-system orchestration requests it physically cannot fulfill.
- **How it works:** Calls `claude-haiku-4-5` with the system prompt below. If `feasibility=complex`, blocks Step 1 advancement with a friendly inline message and the model's reason. The call also returns `needs_llm` and `suggested_input`, which pre-fill Step 2's defaults.
- **UI/UX:** Silent while passing. On block, shows: "This sounds like a pretty ambitious automation — Forge works best with focused, single-purpose agents. Could you simplify the scope a bit? [reason from model]."

Guardrail system prompt:
```
You are evaluating whether a user's agent description is feasible for a lightweight automation platform. The platform supports: single-purpose agents with 1-5 steps, LLM calls (text generation, summarization, classification, extraction), web fetching (GET requests to public URLs), file processing (.csv and .md files — reading, transforming, generating), email sending (to a single verified address), and scheduled execution (daily/weekly/monthly).

The platform does NOT support: multi-system orchestration requiring authentication to external services (other than the provided email), database connections, long-running processes (over 2 minutes), agents that need to maintain state across runs, real-time monitoring or streaming data, image/video/audio processing, or interactions with desktop applications.

Evaluate the description and respond with ONLY a JSON object:
{
  "feasibility": "simple" | "moderate" | "complex",
  "needs_llm": "unlikely" | "maybe" | "likely",
  "suggested_input": "none" | "text" | "file" | "both",
  "reason": "one sentence explanation if complex"
}

User's agent description: "{user_prompt}"
```

### 4. Content Safety Check
- **What:** A second silent `claude-haiku-4-5` call at submission time on `display_name` + `description`.
- **Why:** The public grid is unauthenticated and unmoderated. Cheap profanity/abuse filter.
- **How it works:** Same JSON-only response pattern as the guardrail. If flagged, blocks creation with a friendly message.
- **UI/UX:** Silent while passing. On block: "This doesn't look like a good fit for Forge. Try rephrasing without offensive language."

### 5. Builder Pipeline
- **What:** Generates a runnable OpenAI Agents SDK (TypeScript) agent definition from the visitor's form data and description.
- **Why:** The meta-AI step. Turns a prompt into something executable.
- **How it works:**
  1. `POST /api/forge/agents` with all form data → receive `{ app, agent, api_key }`. Write `api_key` to KV under `agent:<app_id>` immediately.
  2. Send the prompt + form snapshot + success criteria to `claude-sonnet-4-6` with a system prompt instructing it to produce an Agents SDK config that uses only the enabled capabilities and the selected runtime model. The generated config is persisted via `PATCH /api/forge/agents/[id]` into the agent's `config` field on Obs.
  3. `POST /api/forge/agents/[id]/builds` with `attempt_number`, `prompt`, `form_snapshot`, `generated_config`, `builder_model: "claude-sonnet-4-6"`, `input_tokens`, `output_tokens`, `duration_ms`, `status`. Success auto-advances the agent to `awaiting_test`. Failure auto-advances to `build_failed`.
- **UI/UX:** Full-screen Step 4 panel with cycling status messages: "Analyzing your request..." → "Designing agent steps..." → "Generating configuration..." → "Wiring up telemetry..." Failure shows the error inline with a "Try again" button.

### 6. Email Verification
- **What:** Inline 6-digit code verification flow inside Step 2 of creation.
- **Why:** Required for the `email` output type and for the `can_send_email` capability — and the most common automation request.
- **How it works:** `POST /api/forge/email/send` → user enters code → `POST /api/forge/email/verify`. Verified email passed as `verified_email` on agent creation. Handles all error states from the integration doc: `404` (no pending code), `410` (expired), `429` (rate limit / too many wrong attempts), `401` (wrong code).
- **UI/UX:** Email input + "Send code" button. On send, reveals the 6-digit code field with a 10-minute countdown. Green checkmark on success. Inline error text on failure with retry hint. Cooldown message after max attempts.

### 7. Execution Engine (TS Agents SDK)
- **What:** Runs the generated agent definition inside a Vercel Node serverless function.
- **Why:** The runtime. Without it, agents are just JSON.
- **How it works:** For every step in the agent, the engine emits this telemetry pattern:
  ```
  1. POST /api/forge/runs/<run_id>/steps → { event_type: "start", step_name, service }
  2. Execute the step
  3. If LLM call: POST /api/events → capture event_uuid
  4. POST /api/forge/runs/<run_id>/steps → { event_type: "complete"|"fail", duration_ms, event_ref?: event_uuid }
  ```
- **UI/UX:** No direct UI — execution happens server-side. Visible to the user via the live waterfall (#8) and run detail page (#13).

### 8. Live Waterfall (polling)
- **What:** Real-time visualization of an executing run's step timeline.
- **Why:** The hero moment. Makes the value of telemetry tangible — a non-technical visitor can see exactly what their agent is doing.
- **How it works:** While a run is executing, the client polls `GET /api/forge/runs/[id]/steps?since=<last_seq>` every ~750ms. Each response's `last_seq` becomes the next poll's cursor. The loop terminates when `run_status` is `completed` or `failed`. Steps render in order with durations, services, and pass/fail indicators. LLM steps with an `event_ref` are click-throughs to the Obs event detail page.
- **UI/UX:** Two-pane layout — left side is the growing step timeline, right side shows current step details (service, duration, metadata). Smooth `fadein` for each new step row.

### 9. Test-Run Gate
- **What:** Every agent must pass a thumbs-up test run before transitioning to `active`.
- **Why:** The only quality bar Forge has. Prevents broken agents from cluttering the grid.
- **How it works:**
  1. `POST /api/forge/runs` with `run_type: "test"` and optional input → returns `run_id`.
  2. `PATCH /api/forge/runs/[id]` → `status: "running"`, `started_at: now()`.
  3. Execution engine runs the agent; live waterfall plays alongside.
  4. `PATCH /api/forge/runs/[id]` → `status: "completed"`, `duration_ms`, `output`, `cost_usd`, token counts.
  5. Show output and prompt: "Did this work as expected?" with thumbs up/down.
  - **Thumbs up:** `PATCH run` with `user_rating: "up"`, `success_criteria_met: true`. `PATCH agent` with `status: "active"`. Card goes full color. Toast: "Your agent is live!"
  - **Thumbs down (1st attempt):** Show "What wasn't working?" textarea (max 500 chars). `PATCH run` with `user_rating: "down"`. `PATCH agent` to `test_failed`, then `building`. `POST /builds` with `attempt_number: 2`, `user_feedback: "<text>"`, and the new generated config. Same build animation, same test flow.
  - **Thumbs down (2nd attempt):** Message: "Thanks for trying this out. I've been notified and will look into improving things. If you'd like me to follow up, leave your email below." Optional `POST /api/forge/feedback` with `agent_id`, `email`, `feedback_text`. Agent stays in `test_failed`. Card fades from grid.
- **UI/UX:** Thumbs up/down lives below the test output on the Step 5 panel. Rebuild reuses the Step 4 animation.

### 10. Forge KV (app_id → api_key)
- **What:** A Vercel KV (or Upstash) namespace storing `agent:<app_id> → api_key`. The only state Forge owns.
- **Why:** Without it, scheduled runs can't authenticate days or weeks after creation.
- **How it works:** Written immediately after `POST /api/forge/agents` returns. Read by the scheduled-run worker, the manual "Run Now" handler, the delete handler (for cleanup), and the test-run flow. Never exposed to the client.
- **UI/UX:** Invisible.

### 11. Scheduled Run Worker
- **What:** Forge-side cron that picks up queued scheduled runs from Obs and executes them.
- **Why:** Obs's dispatch cron only creates `queued` runs — somebody has to actually run them.
- **How it works:** Vercel cron fires every 5 minutes → calls an internal `/api/internal/dispatch` route → for each KV-known agent, calls Obs to find queued scheduled runs (or uses a planned `GET /api/forge/runs?status=queued` query) → executes serially using the same execution engine as test/manual runs → bails before approaching the 60s function timeout. Skipped runs are picked up on the next tick.
- **UI/UX:** No direct UI. Results appear in the agent's run history and on the grid card's bottom strip.

### 12. Agent Detail View
- **What:** Per-agent page at `/agents/[slug]` (slug resolved to UUID server-side).
- **Why:** Post-creation home for each agent — see metadata, run history, execute manual runs, manage state.
- **How it works:** Fetches `GET /api/forge/agents/[id]` plus the new `GET /api/forge/agents/[id]/runs` for paginated history. "Run Now" creates a `manual` run via `POST /api/forge/runs` and pipes through the same waterfall. Pause/resume hits `PATCH /api/forge/agents/[id]` with `status: paused` or `active` (optimistic UI, revert on error).
- **UI/UX:** See "UX & UI" section.

### 13. Run Detail Page (shareable)
- **What:** Standalone page at `/agents/[slug]/runs/[run_id]` showing one run's full record.
- **Why:** A proof of concept needs shareable artifacts. One URL beats a screenshot.
- **How it works:** Fetches the run + its steps (full waterfall replay). For failed runs, makes a single `claude-haiku-4-5` call to summarize the failure into one plain-English sentence using the step trace as context.
- **UI/UX:** Header strip with back link, timestamp, status, duration, cost. Input section. Type-aware output rendering. Failure explainer (when applicable). Full waterfall with click-throughs to Obs event detail for LLM steps.

### 14. Soft Delete
- **What:** Visitor-initiated removal of their own agent.
- **Why:** Visitors need a way out, and the integration doc makes clear that the api key stops working immediately on delete.
- **How it works:** `DELETE /api/forge/agents/[id]` → on success, remove the KV entry. Card disappears from grid on the next refresh.
- **UI/UX:** Two-step confirm modal. "Delete this agent? This cannot be undone."

### 15. Universal Back-to-Hirecody Nav
- **What:** Orange "Back" button in the top-left corner of every page.
- **Why:** Forge is one app on a larger personal site. Visitors need to navigate back.
- **How it works:** Lifted verbatim from `Bradshawrc93/hirecody-chatbot/src/components/Chat.tsx:237-246`:
  ```tsx
  import { ArrowLeft } from "lucide-react";

  <a
    href="https://hirecody.dev"
    className="absolute left-3 top-1/2 -translate-y-1/2 z-10 shrink-0 inline-flex items-center gap-2 rounded-md bg-[#C56A2D] px-3 py-1.5 text-sm font-bold text-white transition-colors hover:bg-[#A85A24]"
    aria-label="Back to hirecody.dev"
  >
    <ArrowLeft size={16} className="shrink-0" />
    <span>Back</span>
  </a>
  ```
  Hidden when `window.self !== window.top` (iframe embed detection — same pattern as the chatbot).
- **UI/UX:** Same orange (`#C56A2D`), same hover (`#A85A24`), same arrow icon, same position on every page.

## Suggested Features (Approved)

### Clone Agent
- **What:** "Clone this agent" button on the agent detail view that pre-fills `/create` Step 1 with the original's form data.
- **Why:** At 20–30 visitors and ~15 total agents, remixing is the natural way to learn the platform.
- **How it works:** Button writes the original's form snapshot to `sessionStorage` and navigates to `/create?clone=<slug>`. Step 1 picks it up on mount and pre-fills name (with " (copy)" suffix), description, and downstream defaults. Visitor still walks through the full flow.
- **UI/UX:** Subtle secondary button on the agent detail header, next to "Run Now."

### Type-Aware Last-Run Indicator on Grid Cards
- **What:** Bottom strip on each grid card showing **"Delivered • 2h ago"** for email-output agents and **"Completed • 2h ago"** for everything else.
- **Why:** Makes the grid feel alive. Avoids leaking private content (e.g., a user's daily newsletter body) onto a public page.
- **How it works:** Reads from the lean list response. No content preview — just delivery status and relative timestamp.
- **UI/UX:** Single muted line at the bottom of each card. Full output viewable on the agent detail and run detail pages.

### Shareable Run Link
- **What:** Standalone `/agents/[slug]/runs/[run_id]` page (Core Feature #13 covers this).
- **Why:** Already approved as a core feature. Listed here for completeness — it started as a suggested feature.
- **How it works:** See Core Feature #13.
- **UI/UX:** See Core Feature #13.

### "Why did this fail?" Explainer
- **What:** Plain-English failure summary on run detail pages where `status=failed`.
- **Why:** The waterfall is great for engineers; visitors need a human-readable "here's what went wrong."
- **How it works:** Single `claude-haiku-4-5` call with the step trace as context, returning one sentence. Cached on the run record so it only fires once per run.
- **UI/UX:** Subtle distinct callout above the waterfall, prefixed with a small warning icon.

### Pause/Resume Toggle
- **What:** One-click pause/resume on the agent detail header.
- **Why:** Near-zero-cost escape hatch for a visitor whose scheduled agent is misbehaving without forcing a delete.
- **How it works:** `PATCH /api/forge/agents/[id]` with `status: paused` or `active`. Optimistic UI update, revert on error. Already supported by the state machine.
- **UI/UX:** Toggle switch or paired button next to "Run Now" on the agent detail header.

---

## UX & UI

### Page structure

1. `/` — Landing + agent grid (public)
2. `/create` — Creation flow (modal overlay on `/`, full page on mobile)
3. `/agents/[slug]` — Agent detail (public read, auth-gated mutating actions)
4. `/agents/[slug]/runs/[run_id]` — Single-run detail (shareable link)
5. `/api/internal/*` — Forge's internal routes (KV writes, scheduled-run worker). Not user-facing.

### Layout details

#### `/` — Landing

- **Universal nav:** Orange "Back" button top-left (Core Feature #15).
- **Header strip:** "Obs Forge" wordmark left-of-center, "View telemetry on Obs →" link right.
- **Hero block:** Title "Obs Forge" + one-line subtitle "A playground for building and running custom agents. Build one, watch it work, see the telemetry." Prominent **"Create Agent"** CTA in the signature orange.
- **Section 1 — "Built by Cody":** Horizontal row of 3–5 owner cards with a featured-ribbon visual treatment.
- **Section 2 — "Community Agents":** Responsive card grid below. Mobile collapses to single column.
- **Card contents:** display_name (title), truncated description, status badge, creator badge, schedule icon (if `schedule_cadence` set), rating icon (if any rated runs), and the bottom strip ("Delivered • 2h ago" or "Completed • 2h ago"). Building / awaiting_test cards render greyed with `pulse-bar` animation and no bottom strip.
- **Footer:** "Agents are automatically removed after 6 months" + "This is a proof of concept — complex automations may not work perfectly."

#### `/create` — Creation flow (modal)

- **Top:** Step indicator (1 → 2 → 3 → 4 → 5), current step highlighted in orange. Back arrow to previous step preserves state.
- **Step 1 — Describe Your Agent:**
  - Agent name (text, required, max 60 chars). Becomes `display_name`.
  - Slug (auto-generated kebab-case, editable). Becomes `slug`.
  - "What should this agent do?" (textarea, required, max 500 chars, live counter). Placeholder: "e.g., Every Monday, summarize the top 5 Hacker News posts and email me the highlights." Becomes `description`.
  - Complexity guardrail fires 1.5s after the description stops changing. Pass → Continue enabled. Fail → inline friendly message, Continue disabled until revised. Content safety check fires silently on submit; blocks with its own friendly message if it trips.
- **Step 2 — Configure Capabilities:**
  - "Does this agent need AI?" toggle. Subtle text shows the guardrail's `needs_llm` recommendation. Yes reveals the model dropdown:
    - Claude Sonnet 4.6 (`claude-sonnet-4-6`)
    - Claude Haiku 4.5 (`claude-haiku-4-5`)
    - GPT-5.4 (`gpt-5.4`)
    - GPT-5.4-mini (`gpt-5.4-mini`)
    - GPT-5.4-nano (`gpt-5.4-nano`)
  - "What does this agent need to get started?" single-select → `input_type`:
    - "Nothing — it runs on its own" → `none`
    - "Text input (a prompt, a URL, a name, etc.)" → `text`
    - "A file upload (.csv or .md only)" → `file`
    - "Both text and a file" → `both`
  - "Should this agent send you email with results?" toggle → `can_send_email`. Yes reveals the inline email verification UI: email input → "Send verification code" button → 6-digit code field → green checkmark on success.
  - "Does this agent need web access?" toggle → `has_web_access`.
  - "Run on a schedule?" dropdown: None / Daily / Weekly / Monthly → `schedule_cadence`.
    - Daily reveals a time picker → `schedule_time` as `HH:MM:00` UTC.
    - Weekly reveals a day-of-week picker + time picker → `schedule_day_of_week` (new Obs field) + `schedule_time`.
    - Monthly reveals a day-of-month picker (1–28) + time picker → `schedule_day_of_month` (new Obs field) + `schedule_time`.
    - Note: "Scheduled agents run automatically. You'll see results in the agent's run history."
- **Step 3 — Define Success:**
  - "What does a successful run look like?" textarea, required, max 300 chars → `success_criteria`.
  - "What should the agent output?" single-select → `output_type`:
    - "Text response" → `text`
    - "A file" → `file`
    - "An email to me" → `email`
    - "Nothing visible — it performs an action" → `side-effect`
  - "Anything else the agent should know?" textarea, optional, max 1000 chars with live counter (orange at 800, red at 950) → `context_text`.
- **Step 4 — Build:** Full-screen animated panel. Card appears greyed/pulsing in the grid behind the modal immediately. Status text cycles: "Analyzing your request..." → "Designing agent steps..." → "Generating configuration..." → "Wiring up telemetry..." Failure shows inline error and a "Try again" button.
- **Step 5 — Required test run:** Agent summary, input field(s) if `input_type` requires them, "Run Test" button. On run, the modal swaps to the live waterfall (left: growing step timeline, right: current step details). Terminal status reveals the output and the thumbs up/down prompt. Thumbs down handling per Core Feature #9.

#### `/agents/[slug]` — Agent detail

- **Universal nav:** Orange "Back" button top-left.
- **Header:** display_name, description, status badge, creator badge, schedule strip, "Run Now" button (active agents only), pause/resume toggle, "Clone this agent" button, delete button (with two-step confirm modal).
- **Latest Run section:** Type-aware preview. Text → output rendered inline (markdown-friendly). Email → "📧 Sent to user@example.com at 8:03 AM" (metadata only). File → download button + filename/size. Side-effect → "✓ Completed at 8:03 AM." Thumbs indicator. "View full run →" link to run detail page.
- **Run History section:** Paginated list via `GET /api/forge/agents/[id]/runs`. Each row: timestamp, status, duration, rating. Click → run detail page.
- **Metadata sidebar (desktop) / collapsed section (mobile):** model, input type, output type, created date, expires date, `app_id` (copyable for debugging).

#### `/agents/[slug]/runs/[run_id]` — Run detail

- **Universal nav:** Orange "Back" button top-left.
- **Page header:** "← back to agent" link, run timestamp, status, duration, cost.
- **Input section:** Text input shown verbatim, file shown as filename + size.
- **Output section:** Type-aware rendering, full-length (no truncation).
- **Failure explainer:** For failed runs, a callout above the waterfall with the Haiku-generated plain-English summary.
- **Waterfall:** Full step timeline with durations, services, event_ref click-throughs to Obs event detail.

### Key interactions

- **Polling cursor:** Every poll response's `last_seq` is the next poll's `since`. On network blip, save `last_seq` in component state and resume. Loop terminates on `run_status` = `completed` or `failed`.
- **Test-run thumbs down (first time):** Inline text field → rebuild cycle with the same Step 4 build animation. Second-try failure → feedback capture + agent fades from grid.
- **Delete confirmation:** Two-step modal. On confirm: `DELETE /api/forge/agents/[id]` → KV cleanup → card fades on next grid refresh.
- **Clone:** Button writes the original agent's form snapshot to sessionStorage, navigates to `/create?clone=<slug>`, Step 1 picks it up and pre-fills (name suffixed " (copy)").
- **Pause/resume:** One-click toggle on the agent detail header. PATCH to Obs, optimistic UI, revert on error.
- **Iframe detection:** `window.self !== window.top` hides the universal back button (matches `hirecody-chatbot` behavior).

### Visual approach

- Forge inherits the hirecody warm-cream + orange palette from the chatbot. Same typographic system, same radius, same fade/pulse motion vocabulary. Forge's identity comes from layout density (more cards, more data) and the waterfall hero — not from a divergent palette.
- Cards feel like living objects — soft shadows, subtle hover lifts, status pulses on building/awaiting_test rows.
- The build animation is purposeful: status messages cycle as if the system is actually working (because it is).
- The live waterfall is the hero moment — generous whitespace, clear step transitions, visible time scale, smooth `fadein` on each new step.
- Mobile-responsive: grid → single column, creation modal → full screen, waterfall → vertical timeline.

---

## Technical Approach

### Stack
- Next.js (App Router) on Vercel
- Node serverless runtime
- Tailwind v4 with the `hirecody-chatbot` CSS variable palette
- OpenAI Agents SDK (TypeScript)
- Anthropic SDK + OpenAI SDK
- Vercel KV (or Upstash Redis if KV pricing is awkward)
- `lucide-react` for icons (matching the chatbot)

### Environment variables
```
# Obs integration
OBS_API_BASE_URL=https://obs.hirecody.dev
OBS_INTERNAL_SECRET=<shared secret if Obs adds an internal endpoint Forge needs>

# LLM providers
ANTHROPIC_API_KEY=<key>
OPENAI_API_KEY=<key>

# Forge KV
KV_REST_API_URL=<from Vercel KV / Upstash>
KV_REST_API_TOKEN=<from Vercel KV / Upstash>

# Cron auth (for Forge's own scheduled-run worker)
FORGE_CRON_SECRET=<random string>
```

### Data model
Forge owns no relational data. The only persistent state is the KV namespace:
- Key: `agent:<app_id>` (UUID)
- Value: `obs_<32 hex chars>` (the api key returned at agent creation)

Everything else lives in Obs and is fetched on demand.

### Key architectural decisions
- **Stateless except for KV.** Forge does not cache agent metadata or run history. Every page fetches from Obs. KV exists only because the api key is unrecoverable and scheduled runs need it days later.
- **Polling, not SSE.** Per integration doc — Vercel function-duration limits make long-lived streams awkward, and a cursor poll is trivial to reconnect.
- **Builder model is locked.** `claude-sonnet-4-6` for build, `claude-haiku-4-5` for guardrail / safety check / failure explainer. Visitor model selection only applies to the runtime agent.
- **TS Agents SDK only.** No Python service. One runtime, one deploy target.
- **Serial scheduled execution.** The 5-minute Forge cron processes runs serially and bails before the 60s function timeout. Skipped runs are picked up next tick.
- **Universal back button is verbatim from `hirecody-chatbot`.** Same component, same colors, same iframe detection — keeps the family of apps visually coherent.

### Build order
1. Tailwind setup with the `hirecody-chatbot` palette + universal back button component.
2. Forge KV adapter (`get`, `set`, `delete`).
3. Obs API client (typed wrappers around every endpoint in `FORGE_INTEGRATION.md` plus the two new ones).
4. Agent grid (`/`) — read-only first.
5. Creation flow Step 1 (describe + complexity guardrail + content safety).
6. Creation flow Steps 2–3 (capabilities + define success + email verification).
7. Builder pipeline (Step 4) — `POST /agents`, KV write, builder LLM call, `PATCH /agents` with config, `POST /builds`.
8. Execution engine (TS Agents SDK wrapper with dual-telemetry emission).
9. Live waterfall + Step 5 test-run gate + thumbs up/down rebuild loop.
10. Agent detail page (`/agents/[slug]`) — needs the new `GET /api/forge/agents/[id]/runs`.
11. Run detail page (`/agents/[slug]/runs/[run_id]`) + failure explainer.
12. Pause/resume + clone agent.
13. Scheduled run worker (Vercel cron + `/api/internal/dispatch`).
14. Soft delete + KV cleanup.
15. Polish pass — mobile responsiveness, loading states, error handling, empty states.

---

## Out of Scope (v1)

- **Script agents (no LLM).** All agents use an LLM. Cheap models (`claude-haiku-4-5`, `gpt-5.4-nano`) are fine for tasks like CSV transformations. Avoids code-gen, sandboxing, and eval complexity entirely.
- **Multi-step orchestration across external services** (Slack, Notion, Salesforce, etc.). Only the documented capabilities: LLM, web fetch, file processing, email, scheduled execution.
- **Multi-user accounts, login, ownership.** Visitors are anonymous. Forge does not track who created what beyond `creator_type`.
- **Agent editing after creation.** Visitors create or delete. No "edit description" / "swap model" UI in v1.
- **Cost dashboards on Forge.** Cost telemetry already lives on Obs. Forge links out instead of duplicating it.
- **Push notifications, browser alerts.** The grid card timestamp and the agent detail page are the notification mechanism.
- **Custom domain per agent, embed widgets, public APIs.** Forge is one app; agents do not get their own URLs beyond the `/agents/[slug]` path.
- **A/B testing, run comparison, evals.** Out of scope — the test-run gate is the only quality bar.
- **Image / video / audio inputs or outputs.** Text + .csv + .md only.

---

## Open Questions

1. **Vercel KV vs. Upstash.** Vercel KV is simplest but pricier per request than Upstash Redis at small scale. Decision can be deferred until step 2 of the build order, but pick one before writing the adapter.
2. **Cron secret for Forge's internal dispatch route.** Should it use a separate `FORGE_CRON_SECRET` env var, or piggyback on Vercel's built-in cron header (`x-vercel-cron`)? Built-in is simpler — recommend that unless there's a reason to add a second secret.
3. **What does Forge do with a run that's still `running` when the worker cron fires again 5 minutes later?** Recommended: skip it — Obs already has the run, the original execution either completes or fails. Avoid re-execution at all costs (no idempotency on the Obs side).
4. **Where does the failure explainer's cached sentence live?** Two options: (a) Forge requests Obs add a `failure_summary` field on `forge_runs`, or (b) Forge generates it on every page view (cheap with Haiku, ~$0.0001 per call). Recommend (b) for v1.
5. **Email body storage for email-output agents.** Currently the spec assumes the run's `output` field stores what was sent. Confirm with Obs that email body content gets stored there at the time of delivery — otherwise the agent detail page has nothing to show beyond "delivered."
6. **OpenAI Agents SDK (TypeScript) maturity.** Verify it's stable enough for v1 before locking in. If not, fall back to a thin custom orchestrator over the Anthropic / OpenAI SDKs that follows the same dual-telemetry pattern.
7. **Slug uniqueness.** The integration doc requires unique slugs but doesn't document the failure mode on conflict. Confirm — does `POST /api/forge/agents` return `409` on a duplicate slug, and how should Forge handle it (auto-suffix `-2`, or prompt the user)?
