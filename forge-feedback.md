# Forge — Feedback Instrumentation Sub-spec

## Context

This spec is a handoff from the Obs (observability dashboard) project. Obs needs a per-run success signal from Forge so it can compute cost-per-successful-run, thumbs-up rate per agent, and a "Failing Agents" callout.

You (the implementer) do not need Obs context beyond this document. Everything Obs needs is captured in the event contract below.

## Goal

Add a single thumbs-up / thumbs-down control next to each agent's **latest run**. Anyone can click, first click wins, no auth check. Emit a feedback event to Obs.

## Non-goals (v1)

- No user identity, no auth check on the vote. The user's own agent can be voted on by anyone who sees the page. This is explicitly accepted for v1.
- No thumbs on earlier (non-latest) runs. Only the latest run gets a vote.
- No changing / undoing a vote. First click wins, locked.
- No aggregated feedback UI inside Forge — Forge emits, Obs displays.

## UX

- On each agent's detail/card, next to the latest run (the top of the run list, the "last run" card, whichever pattern the UI already uses): render an icon-only thumbs-up / thumbs-down pair.
- Before vote: both icons present, both clickable. No login prompt — anyone loading the page can vote.
- On click: the clicked icon fills in, the other disappears, the filled icon becomes disabled.
- No toast. Visual state change is the confirmation.
- When a new run completes (manual trigger or scheduled fire), the "latest run" slot flips to the new run. The new run starts unvoted. The *previous* run's vote is frozen — it just no longer has the thumbs UI because it's no longer the latest.
- Reload behavior: if the latest run already has a vote in the database, render the locked/voted UI immediately — do not show clickable thumbs.

## Data & contract

### Identifying the entity

Each run has a stable `run_id`. The vote is tied to `run_id`, not to `agent_id`. A new run = a new voteable entity.

### Local persistence

Add to the runs table:

- `feedback_vote`: `null` | `'up'` | `'down'`.
- `feedback_voted_at`: nullable timestamp.

### Server enforcement

The vote endpoint must:

1. Accept the vote only if the target `run_id` is currently the **latest** run for its agent. Reject with 400 otherwise (prevents late votes on stale runs if the client is out of sync).
2. Reject with 409 if `feedback_vote` is already non-null for that `run_id`.
3. Otherwise, set `feedback_vote` and `feedback_voted_at` in a single transaction.
4. Emit to Obs *after* the local write succeeds.

No auth on this endpoint — that's the explicit v1 call. Rate limit by IP to prevent button-mashing abuse (e.g. 10 votes/min per IP), but do not persist IPs.

### Obs emission

`POST https://<obs-host>/api/feedback`

Headers:
- `Content-Type: application/json`
- `x-api-key: <FORGE_OBS_API_KEY>` — store in env.

Body:

```json
{
  "app_slug": "forge",
  "entity_type": "forge_run",
  "entity_id": "<run_id>",
  "vote": "up" | "down",
  "model": "<model_name_used_in_the_run, if known, else null>"
}
```

Expected responses:
- `201` — recorded.
- `409` — Obs already has a vote for this entity. Log and move on.
- `401` — bad/missing key. Log loudly.
- `400` — contract break. Log loudly.

Timeouts: 5s. On timeout, log and move on. Never block the UI on Obs.

## Environment

- `FORGE_OBS_API_KEY` — provisioned by Obs. Add to `.env.local`, `.env.example`, and deployment secrets.
- `OBS_BASE_URL` — e.g. `https://obs.example.com`.

## Testing

- Unit: vote on non-latest run → 400. Vote on latest run with no prior vote → 200, correct Obs payload. Second vote on same run → 409.
- UI: clicking a thumb locks the UI. Reloading shows the locked state.
- Run-progression: when a new run completes, verify the latest-run card shows unvoted thumbs and the previous run's vote is still stored but no longer rendered.
- Rate limit: 11th vote in a minute from same IP → 429.

## Out of scope

- Vote changes / undoing.
- Voting on earlier (non-latest) runs.
- Aggregated feedback display inside Forge.
- Auth on the vote action.
- Persisting voter identity of any kind.

## Handoff deliverables

When done:
1. Env vars `FORGE_OBS_API_KEY` and `OBS_BASE_URL` in `.env.example`.
2. Schema migration adding `feedback_vote` + `feedback_voted_at` to runs.
3. Thumbs UI on latest-run display for each agent.
4. Vote endpoint with: latest-run guard, one-vote-per-run enforcement, IP rate limit, Obs emission.
5. Tests covering the above.
6. A one-line note back to Cody confirming the Obs API key is in the deployment secret store.
