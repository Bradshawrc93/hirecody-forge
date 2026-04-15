# Forge ↔ Obs integration spec

This document is the **only** reference Forge needs in order to talk to Obs. It covers every endpoint, the auth model, the agent and run lifecycles, the polling-based live-progress protocol, CORS, and example payloads for the common flows. Another developer or AI agent should be able to build the entire Forge client from this file alone.

- **Obs base URL (prod):** `https://obs.hirecody.dev`
- **Forge base URL:** `https://forge.hirecody.dev`
- All endpoints documented here are rooted at `/api/forge/...` unless otherwise noted.

---

## 1. Mental model

Every Forge agent is also an Obs "app" (a row in `public.apps` with `type='forge'`) that has a paired `forge_agents` sidecar row holding the agent-specific fields. This has three practical consequences:

1. **One API key per agent.** When you create an agent, Obs returns a single `obs_...` key. That same key authenticates every subsequent call — both the Forge-specific endpoints below and the existing `POST /api/events` LLM-telemetry collector. Forge never needs to juggle a separate token.
2. **LLM calls get free observability.** Any LLM call an agent makes during a run should be logged via `POST /api/events` using the agent's key. Those rows land in the `events` table and appear automatically on the Obs dashboard under `/apps/<slug>` — cost charts, live tail, model breakdown, etc. — with no additional work.
3. **Step-level waterfall events are a separate stream.** Non-LLM steps (tool calls, web fetches, file I/O, phase markers) are written to `forge_run_steps` via the endpoints below. LLM steps may appear in *both* places: as an `events` row (for cost/token telemetry) and as a `forge_run_steps` row (for the waterfall). When you do both, include the `event_ref` UUID on the step so the waterfall can link out.

---

## 2. Authentication

All `/api/forge/*` endpoints that mutate an agent require:

```
x-api-key: obs_<32 hex chars>
```

The key is returned exactly once from `POST /api/forge/agents`. There is no way to recover a lost key — you'd have to delete the agent and create a new one.

Auth rules:

- The key must match an `apps` row whose `type='forge'` (manual apps can't use Forge endpoints).
- For agent-scoped endpoints (`/api/forge/agents/[id]/...`, `/api/forge/runs/[id]/...`), the key must own the resource being accessed. Cross-tenant access returns `401 unauthorized` (or `404 run not found` where appropriate).
- Unauthenticated endpoints (by design): `POST /api/forge/agents`, `POST /api/forge/email/send`, `POST /api/forge/email/verify`, `POST /api/forge/feedback`.

---

## 3. CORS

Every `/api/forge/*` route responds to `OPTIONS` preflight and echoes the allowed origin when the request comes from one of:

- `https://forge.hirecody.dev`
- `http://localhost:3000`
- `http://localhost:3001`

Allowed headers: `content-type, x-api-key`
Allowed methods: `GET, POST, PATCH, DELETE, OPTIONS`
Credentials: not used.

Calls from any other origin still succeed (the API is open) but the browser will block the response. For server-to-server calls from Forge's backend, CORS is irrelevant.

---

## 4. Agent lifecycle state machine

```
building ──► awaiting_test ──► active ◄──► paused
    │              │              │
    │              │              │
    ▼              ▼              ▼
build_failed   test_failed     expired ──► deleted
    │              │              ▲
    └──retry──►building           │
                                  │
                            (6-month TTL)
```

Status values: `building`, `build_failed`, `awaiting_test`, `test_failed`, `active`, `paused`, `expired`, `deleted`.

Valid transitions:

| From | Allowed to |
|---|---|
| `building` | `awaiting_test`, `build_failed` |
| `build_failed` | `building`, `deleted` |
| `awaiting_test` | `active`, `test_failed`, `deleted` |
| `test_failed` | `building`, `deleted` |
| `active` | `paused`, `expired`, `deleted` |
| `paused` | `active`, `expired`, `deleted` |
| `expired` | `deleted` |
| `deleted` | *(terminal)* |

Obs enforces this on `PATCH /api/forge/agents/[id]` — an invalid transition returns `409 invalid status transition`.

Some transitions are automatic:
- `POST /api/forge/agents/[id]/builds` with `status='success'` advances a `building` agent to `awaiting_test`.
- `POST /api/forge/agents/[id]/builds` with `status='failed'` advances a `building` agent to `build_failed`.
- The nightly `expire` cron flips `active`/`paused`/`awaiting_test` agents past their `expires_at` to `expired`.

---

## 5. Run lifecycle

```
queued ──► running ──► completed
            │
            └──────► failed
```

Transitions enforced by `PATCH /api/forge/runs/[id]`: `queued → running | failed`, `running → completed | failed`. Terminal states can't transition further.

---

## 6. Error response shape

All endpoints return JSON. Errors:

```json
{ "error": "short machine-readable error code", "details": "optional human text or object" }
```

Standard status codes:

| Code | Meaning |
|---|---|
| 200 | success |
| 201 | resource created |
| 400 | validation failed (`details` is a zod flatten) or invalid json |
| 401 | missing/invalid api key, or key doesn't own the resource |
| 403 | admin/cron route called without proper auth |
| 404 | resource not found (or cross-tenant access disguised) |
| 409 | invalid state transition |
| 410 | verification code expired |
| 429 | rate limited (email sends, verify attempts) |
| 500 | database or internal failure |
| 502 | upstream service (email provider) failed |

There are no per-route rate limits beyond the email-verification guards described below.

---

## 7. Endpoint reference

### 7.1 Agents

#### `POST /api/forge/agents` — create agent

Unauthenticated. Creates both the `apps` row and the `forge_agents` sidecar atomically (the `apps` row is rolled back if the sidecar insert fails). Returns the plaintext api key **exactly once**.

Request:

```json
{
  "slug": "news-digest",
  "display_name": "Daily News Digest",
  "description": "Summarizes top 5 tech stories each morning",
  "config": { "system_prompt": "...", "tools": ["web-fetch"] },
  "needs_llm": true,
  "model": "claude-opus-4-6",
  "input_type": "none",
  "can_send_email": true,
  "has_web_access": true,
  "success_criteria": "5 bullet points, each under 200 chars, each linking to a source",
  "output_type": "email",
  "context_text": "My interests: LLM eval, devtools, startups. Avoid crypto.",
  "schedule_cadence": "daily",
  "schedule_time": "13:00:00",
  "schedule_day_of_week": null,
  "schedule_day_of_month": null,
  "verified_email": "user@example.com"
}
```

Public callers cannot set `creator_type` — every agent created via this endpoint is implicitly `creator_type='visitor'`. Owner agents are seeded via an internal admin flow.

Required: `slug`, `display_name`, `description`. Everything else is optional with the defaults shown below:

| Field | Default |
|---|---|
| `config` | `{}` |
| `needs_llm` | `true` |
| `input_type` | `"none"` (valid: `none`, `text`, `file`, `both`) |
| `can_send_email` | `false` |
| `has_web_access` | `false` |
| `output_type` | `"text"` (valid: `text`, `file`, `email`, `notification`, `side-effect`) |

`schedule_cadence` must be one of `daily`, `weekly`, `monthly`. `schedule_time` is a UTC wall-clock in `HH:MM:SS` format. If both are provided, `next_run_at` is computed server-side.

**Day fields for weekly / monthly cadence:**

| Field | Type | Valid range | When it applies |
|---|---|---|---|
| `schedule_day_of_week` | integer, nullable | `0..6` (0=Sunday, 6=Saturday) | only when `schedule_cadence='weekly'` |
| `schedule_day_of_month` | integer, nullable | `1..28` | only when `schedule_cadence='monthly'` |

The upper bound of 28 for `schedule_day_of_month` is intentional — it guarantees the day exists in every month, so we never need to fall back to "last day of the month" for short months like February. If you need end-of-month semantics, send `28` (or use a different cadence).

Day fields interact with `schedule_cadence` and `schedule_time` as follows when computing `next_run_at`:

- **daily**: day fields are ignored. The next run is the next occurrence of `schedule_time`.
- **weekly + `schedule_day_of_week`**: the next occurrence of that weekday at `schedule_time`, strictly in the future. If the target weekday is today and `schedule_time` has already passed, it rolls to next week.
- **weekly + no `schedule_day_of_week`** *(legacy)*: the first multiple of 7 days past "now" at `schedule_time`. Retained for backward compatibility with agents created before this field existed — new agents should always send `schedule_day_of_week` for weekly cadence.
- **monthly + `schedule_day_of_month`**: the next occurrence of that day-of-month at `schedule_time`, strictly in the future. If the target day is today and the time has already passed, it rolls to next month.
- **monthly + no `schedule_day_of_month`** *(legacy)*: interpreted as "same day-of-month as the agent's first scheduled run", with clamping to the last day of short months. Also retained for backward compatibility — new agents should always send `schedule_day_of_month`.

Response (`201 Created`):

```json
{
  "app": {
    "id": "a4d2...-uuid",
    "slug": "news-digest",
    "display_name": "Daily News Digest",
    "created_at": "2026-04-14T19:00:00Z"
  },
  "agent": {
    "app_id": "a4d2...-uuid",
    "description": "Summarizes top 5 tech stories each morning",
    "status": "building",
    "expires_at": "2026-10-14T19:00:00Z",
    "next_run_at": "2026-04-15T13:00:00Z",
    ...
  },
  "api_key": "obs_4e8a7b2c1d..."
}
```

**Store `api_key` immediately.** It's a bcrypt hash at rest — Obs cannot retrieve it later.

#### `GET /api/forge/agents` — list agents

Unauthenticated. Returns a lean list of all non-deleted agents. Optional query params: `creator_type=owner|visitor`, `status=<status>`.

Response:

```json
{
  "agents": [
    {
      "app_id": "...",
      "description": "...",
      "status": "active",
      "creator_type": "visitor",
      "output_type": "email",
      "schedule_cadence": "daily",
      "next_run_at": "2026-04-15T13:00:00Z",
      "last_run_at": "2026-04-14T13:00:00Z",
      "expires_at": "2026-10-14T00:00:00Z",
      "created_at": "2026-04-14T00:00:00Z",
      "apps": { "slug": "news-digest", "display_name": "Daily News Digest" }
    }
  ]
}
```

#### `GET /api/forge/agents/[id]` — agent detail

Requires `x-api-key`. `id` is the `apps.id` UUID (not the slug). Returns the full agent record plus an array of build attempts.

Response:

```json
{
  "app": { "id": "...", "slug": "news-digest", ... },
  "agent": { "app_id": "...", "config": {...}, "status": "active", ... },
  "builds": [
    { "id": "...", "attempt_number": 1, "status": "success", "error_message": null, "created_at": "..." }
  ]
}
```

#### `PATCH /api/forge/agents/[id]` — update agent

Requires `x-api-key`. Any subset of these fields may be provided:

```json
{
  "status": "paused",
  "config": {...},
  "schedule_cadence": "weekly",
  "schedule_time": "09:00:00",
  "schedule_day_of_week": 1,
  "schedule_day_of_month": null,
  "verified_email": "user@example.com",
  "last_run_at": "2026-04-14T13:00:00Z"
}
```

Allowed status values in PATCH: `building`, `build_failed`, `awaiting_test`, `test_failed`, `active`, `paused`, `deleted`. **`expired` is not user-settable** — it is only reachable via the nightly expiry cron. If the transition isn't valid, returns `409`. A second concurrent PATCH that loses a status race also returns `409 status changed under us` — retry with a fresh GET. If any scheduling field changes (`schedule_cadence`, `schedule_time`, `schedule_day_of_week`, or `schedule_day_of_month`), `next_run_at` is recomputed using the patched value merged over whatever the agent already had.

#### `DELETE /api/forge/agents/[id]` — soft-delete

Requires `x-api-key`. Flips status to `deleted`. The row is not physically removed; subsequent auth calls using its key will return `401`.

#### `GET /api/forge/agents/[id]/runs` — list runs for an agent

Requires `x-api-key`. Paginated, lean list of historical runs belonging to this agent. Use this to render the run history table on the agent detail view. It intentionally omits large fields (`input_text`, `input_file_path`, `output`) and all step data — for the full run record, call `GET /api/forge/runs/[run_id]`, and for step events call `GET /api/forge/runs/[run_id]/steps`.

Query params (all optional):

| Param | Type | Default | Notes |
|---|---|---|---|
| `status` | `queued` \| `running` \| `completed` \| `failed` | — | filter by run status |
| `run_type` | `test` \| `scheduled` \| `manual` | — | filter by run type |
| `limit` | integer | `20` | clamped to `[1, 100]` |
| `offset` | integer | `0` | clamped to `>= 0` |

Ordered by `created_at` **descending** (most recent first). An invalid `status` or `run_type` value returns `400`.

Example:

```
GET /api/forge/agents/a4d2.../runs?status=completed&run_type=scheduled&limit=10&offset=0
x-api-key: obs_...
```

Response (`200`):

```json
{
  "runs": [
    {
      "id": "r-001",
      "run_type": "scheduled",
      "status": "completed",
      "started_at": "2026-04-14T13:00:01Z",
      "completed_at": "2026-04-14T13:00:12Z",
      "duration_ms": 11000,
      "user_rating": "up",
      "success_criteria_met": true,
      "cost_usd": 0.032,
      "error_message": null,
      "created_at": "2026-04-14T13:00:00Z"
    },
    {
      "id": "r-002",
      "run_type": "test",
      "status": "failed",
      "started_at": "2026-04-13T11:00:01Z",
      "completed_at": "2026-04-13T11:00:04Z",
      "duration_ms": 3000,
      "user_rating": null,
      "success_criteria_met": false,
      "cost_usd": 0.0,
      "error_message": "web-fetch timed out",
      "created_at": "2026-04-13T11:00:00Z"
    }
  ],
  "limit": 10,
  "offset": 0
}
```

To paginate, bump `offset` by `limit` on each subsequent call. (This endpoint uses offset-based paging rather than cursor-based because the list is short-lived and sorted by `created_at` — if your agent is generating enough runs that offset drift matters, you probably want the daily rollup table instead.)

### 7.2 Builds

#### `POST /api/forge/agents/[id]/builds`

Requires `x-api-key`. Log a build attempt.

```json
{
  "attempt_number": 1,
  "prompt": "The original user prompt used to generate this agent",
  "form_snapshot": { "...": "the form state at build time" },
  "generated_config": { "...": "the config the builder model produced" },
  "builder_model": "claude-opus-4-6",
  "input_tokens": 4500,
  "output_tokens": 1200,
  "duration_ms": 3400,
  "status": "success",
  "error_message": null,
  "user_feedback": null
}
```

`attempt_number` must be `1` or `2` (enforced by a CHECK constraint — the 3rd attempt is a DB error). `status` must be `pending`, `success`, or `failed`. When the agent is in `building`, a `success`/`failed` build auto-advances agent status as described above. On retry, pass the user's text explanation as `user_feedback` on the *second* attempt.

### 7.3 Runs

#### `POST /api/forge/runs`

Requires `x-api-key`. Creates a run in `queued` status.

```json
{
  "run_type": "test",
  "input_text": "optional user input",
  "input_file_path": null
}
```

`run_type` must be one of `test`, `scheduled`, `manual`.

Response (`201`): `{ "run": { "id": "...", "status": "queued", ... } }`

#### `GET /api/forge/runs/[id]`

Requires `x-api-key`. Returns the run record. `404` if the run doesn't exist or belongs to a different agent (cross-tenant reads are disguised to avoid leaking run ids).

#### `PATCH /api/forge/runs/[id]`

Requires `x-api-key`. Update any subset:

```json
{
  "status": "running",
  "started_at": "2026-04-14T13:00:01Z",
  "completed_at": "2026-04-14T13:00:12Z",
  "duration_ms": 11000,
  "output": "Here are today's top 5 stories...",
  "input_tokens": 1200,
  "output_tokens": 850,
  "cost_usd": 0.032,
  "user_rating": "up",
  "success_criteria_met": true,
  "error_message": null
}
```

Invalid state transitions return `409`. When a run enters `completed` or `failed` and the agent is `active`, Obs also bumps `agent.last_run_at`.

### 7.4 Run steps (the waterfall)

#### `POST /api/forge/runs/[id]/steps`

Requires `x-api-key`. Append a step event. `seq` is assigned server-side as `max(seq)+1` for the run — callers should not pass it.

```json
{
  "step_name": "fetch_news",
  "service": "web-fetch",
  "event_type": "start",
  "started_at": "2026-04-14T13:00:01.250Z",
  "metadata": { "url": "https://news.ycombinator.com" }
}
```

```json
{
  "step_name": "fetch_news",
  "service": "web-fetch",
  "event_type": "complete",
  "completed_at": "2026-04-14T13:00:02.100Z",
  "duration_ms": 850,
  "metadata": { "status": 200, "bytes": 45000 }
}
```

`event_type` ∈ `start | complete | fail`. `event_ref` is an optional `events.id` UUID to cross-link an LLM step that was also logged via `POST /api/events`.

Response: `{ "step": { "id": "...", "seq": 3, ... } }`

#### `GET /api/forge/runs/[id]/steps?since=<seq>` — **the polling endpoint**

Requires `x-api-key`. Returns every step with `seq > since`, ordered ascending. Forge polls this to drive the live waterfall view.

Response:

```json
{
  "run_status": "running",
  "steps": [
    { "id": "...", "seq": 3, "step_name": "fetch_news", "event_type": "start", ... },
    { "id": "...", "seq": 4, "step_name": "fetch_news", "event_type": "complete", ... }
  ],
  "last_seq": 4
}
```

**Recommended polling loop (Forge-side):**

```ts
let since = 0;
while (true) {
  const r = await fetch(`${OBS}/api/forge/runs/${runId}/steps?since=${since}`, {
    headers: { "x-api-key": apiKey }
  });
  const { run_status, steps, last_seq } = await r.json();
  for (const step of steps) renderStep(step);
  since = last_seq;
  if (run_status === "completed" || run_status === "failed") break;
  await sleep(750); // ~1s is fine; down to 500ms is fine too
}
```

Why polling and not SSE: the scale is small (one writer per run, tens of runs a day), Vercel function-duration limits make long-lived streams awkward, and a cursor poll is trivial to reconnect after a network blip. `last_seq` is your cursor — save it in case you need to reconnect.

### 7.5 Email verification

#### `POST /api/forge/email/send`

Unauthenticated. Issues a 6-digit code.

```json
{ "email": "user@example.com" }
```

Response: `{ "ok": true, "expires_in_seconds": 600 }`

Rate limit: max **3 codes per email per 10-minute window** → `429`.

The code is bcrypt-hashed at rest. In production, Obs sends it via Resend (if `RESEND_API_KEY` is set in env); in dev it is logged to stderr.

#### `POST /api/forge/email/verify`

Unauthenticated.

```json
{ "email": "user@example.com", "code": "123456" }
```

Response: `{ "ok": true, "email": "user@example.com" }`

Errors: `404` (no pending code), `410` (expired), `429` (>5 wrong tries on a single code), `401` (wrong code). After verifying, pass the email to `PATCH /api/forge/agents/[id]` as `verified_email` to persist it on the agent.

#### `POST /api/forge/email/send-result`

**Authenticated.** Sends an email to the agent's `verified_email`, using the same Resend sender as the verification flow. Intended to be called from inside an agent run (e.g., a news-digest agent emailing its output to the creator).

Request:

```json
{
  "subject": "Your Daily News Digest",
  "body": "Here are today's top 5 stories...",
  "format": "text"
}
```

- `subject` — required, 1–200 chars.
- `body` — required, 1–200,000 chars.
- `format` — optional, `"text"` (default) or `"html"`. When `"html"`, `body` is delivered as the HTML body of the email.

No attachments, CC, or BCC — a single email to the verified address.

Response:

```json
{ "ok": true, "message_id": "<resend-message-id>" }
```

Errors:

| Status | Meaning |
|---|---|
| `401` | Missing/invalid `x-api-key`, or key doesn't belong to a Forge agent. |
| `400` | Missing/invalid `subject`, `body`, or `format`. |
| `403` | Agent does not have `can_send_email` enabled, or has no `verified_email` set. |
| `429` | Rate limit exceeded (see below). |
| `502` | Resend delivery failed. The send did not happen; safe to retry after fixing the root cause. |

Rate limit: **max 10 emails per agent per rolling 24-hour window** → `429`. This is a hard guardrail against a runaway scheduled agent spamming the creator's inbox. There is no way to raise the limit per-agent — if you hit it, the agent design needs to change (batch multiple results into one email, send weekly instead of daily, etc.).

### 7.6 Feedback

#### `POST /api/forge/feedback`

Unauthenticated. Collect build-failure feedback (or anything else).

```json
{
  "agent_id": "<uuid-or-null>",
  "email": "optional@example.com",
  "feedback_text": "The builder kept generating tools I didn't ask for."
}
```

Required: `feedback_text` (1–5000 chars). `agent_id` and `email` are optional.

### 7.7 LLM telemetry (reuse of existing endpoint)

#### `POST /api/events`

Not a Forge-specific endpoint — this is the collector Obs has always had, but Forge agents use it with their per-agent `x-api-key` exactly like any other app. Schema:

```json
{
  "model": "claude-opus-4-6",
  "provider": "anthropic",
  "inputTokens": 1200,
  "outputTokens": 850,
  "latencyMs": 4300,
  "status": "success",
  "sessionId": "<run_id — recommended>",
  "metadata": { "run_id": "<uuid>", "step_name": "summarize" }
}
```

Response: `{ "id": "<event_uuid>", "cost_usd": 0.032 }`

Take that `id` and include it as `event_ref` on the corresponding `forge_run_steps` row so the waterfall can link LLM steps back to their full cost/latency record.

---

## 8. Cron endpoints (internal)

These are called by Vercel Cron and are not part of the Forge API surface. They require `authorization: Bearer $CRON_SECRET` or `x-cron-key: $CRON_SECRET`.

- `POST /api/forge/cron/dispatch` — every 15 minutes. Finds `active` agents with `next_run_at` in the past, creates a `scheduled` run, and advances `next_run_at` by one cadence step.
- `POST /api/forge/cron/rollup` — daily at 00:10 UTC. Aggregates yesterday's `forge_runs` into `forge_daily_metrics`.
- `POST /api/forge/cron/expire` — daily at 00:20 UTC. Flips agents past their 6-month TTL to `expired`.

Forge should **not** call these. Dispatch just creates queued runs — it's Forge's responsibility to pick up queued `scheduled` runs and execute them (e.g., via its own worker polling `GET /api/forge/runs` filtered by `status=queued`).

---

## 9. Example flows

### 9.1 Happy-path agent build & test

```
1. POST /api/forge/agents                     → returns { app, agent, api_key }
2. POST /api/forge/agents/<id>/builds         → attempt_number=1, status=success
   (agent auto-transitions building → awaiting_test)
3. POST /api/forge/runs                       → run_type=test, returns run_id
4. PATCH /api/forge/runs/<run_id>             → status=running
5. POST /api/forge/runs/<run_id>/steps        × N (with x-api-key)
6. POST /api/events                           × M (per LLM call, with same key)
7. PATCH /api/forge/runs/<run_id>             → status=completed, cost_usd, output
8. PATCH /api/forge/agents/<id>               → status=active
```

### 9.2 Failed build with retry + feedback

```
1. POST /api/forge/agents                     → building
2. POST /api/forge/agents/<id>/builds         → attempt_number=1, status=failed
   (auto-transition → build_failed)
3. PATCH /api/forge/agents/<id>               → status=building
4. POST /api/forge/agents/<id>/builds         → attempt_number=2, user_feedback="...", status=failed
5. POST /api/forge/feedback                   → capture user's exit feedback
```

### 9.3 Live waterfall while a run executes

Forge polls `GET /api/forge/runs/<run_id>/steps?since=<last>` every ~750ms. Server returns any new steps and the current `run_status`. Loop exits when `run_status` is terminal.

---

## 10. Gotchas

- **`id` is a UUID, not a slug.** Agent endpoints all key off `apps.id`. The slug is a friendly display handle only.
- **The api key is returned once.** There is no endpoint to fetch it later. Lose it and you'll have to delete and recreate the agent.
- **LLM step rows are duplicated intentionally.** LLM calls go into `events` (for cost/observability) and *also* into `forge_run_steps` (for the waterfall). Link them via `event_ref`.
- **`next_run_at` is computed only when you send `schedule_cadence` and `schedule_time` together.** A PATCH that touches one without the other will use the existing value for the other.
- **Deleted agents look non-existent.** `authenticateForgeAgent` returns null for `status='deleted'`, so their api key stops working immediately after soft-delete.
- **Cursor polling is exclusive.** `?since=4` returns `seq > 4`, not `seq >= 4`. Always pass the `last_seq` from the previous response.
