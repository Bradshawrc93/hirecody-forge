# Forge

No-code agent builder. The app itself is a Next.js project — `npm run dev`.

## forge-cli (dev tool)

`scripts/forge-cli.mjs` drives the agent build/test/rebuild loop against a
**local** dev server, so a script (or a coding assistant) can build and
exercise an agent end-to-end without clicking through the 5-step UI.

The CLI refuses any base URL that isn't `localhost`/`127.0.0.1`. There is
no production mode.

### Setup

Run a Forge dev server in one terminal:

```sh
PORT=3200 npm run dev
```

(Port 3200 is just an example — pick whatever's free. Default Next.js
port 3000 collides with Obs on this machine.)

Tell the CLI where the server is:

```sh
export FORGE_CLI_BASE_URL=http://localhost:3200
```

### Commands

```
node scripts/forge-cli.mjs <command> [...args]
```

| Command | Purpose |
|---|---|
| `create --json <inline | @path>` | Build a new agent from a JSON spec. Auto-prefixes `display_name` with `cli-test-` so script-created agents are easy to spot in the dashboard. |
| `test <app_id> [--input ...] [--file label:path] [--url ...] [--timeout 180]` | Start a test run, poll the step waterfall, print a diagnostic summary plus full JSON. |
| `rebuild <app_id> --feedback "..." [--run-id <id>]` | Rebuild the plan with feedback. Optional `--run-id` lets the builder see the failed run's output/error. |
| `finalize <app_id> --run-id <id> --rating up|down [--feedback ...]` | Mark a run up/down. `up` activates the agent. |
| `inspect <app_id> --run-id <id>` | Pretty-print a previous run's waterfall + output. |
| `rename <app_id> [--name ...] [--slug ...]` | Rename an agent. **Currently a no-op** — Obs's PATCH endpoint silently drops `display_name`/`slug`. The CLI verifies and exits non-zero so the silent drop is visible. Will work once Obs accepts those fields. |
| `delete <app_id>` | Soft-delete the agent in Obs and remove its KV key. |
| `tracked [--prefix <p>]` | Print the local list of agents created via this CLI. |

### JSON spec for `create`

The minimum required fields:

```json
{
  "display_name": "my-agent",
  "description": "What the agent does, in plain English.",
  "success_criteria": "How you'll judge whether a run passed.",
  "output_type": "text"
}
```

Everything else has sensible defaults. Common optional fields:

| Field | Type | Default | Notes |
|---|---|---|---|
| `model` | string | `claude-sonnet-4-6` | Any value listed in `RUNTIME_MODELS` |
| `needs_llm` | bool | `true` | |
| `has_web_access` | bool | `false` | Required for `web_search` / `web_fetch` |
| `can_send_email` | bool | `false` | |
| `verified_email` | string | `null` | Required when `can_send_email` is true |
| `output_type` | enum | `"text"` | `text \| file \| email \| notification \| html_report \| csv \| side-effect` |
| `input_config` | object | text-only short | See `src/components/CreateFlow/types.ts` |
| `context_text` | string ≤1000 chars | `null` | Persistent context pinned into every run |
| `schedule_cadence` | enum | `null` | `daily \| weekly \| monthly` |

Pass either inline JSON or a `@path` to a file:

```sh
node scripts/forge-cli.mjs create --json @/tmp/my-agent.json
node scripts/forge-cli.mjs create --json '{"display_name":"...","description":"..."}'
```

### Typical loop

```sh
# 1. Build
node scripts/forge-cli.mjs create --json @spec.json
# → captures app_id

# 2. Test
node scripts/forge-cli.mjs test <app_id> --input "..." --file "Doc:/tmp/in.txt"
# → run_id and step waterfall on stderr; full JSON on stdout

# 3a. Pass → finalize
node scripts/forge-cli.mjs finalize <app_id> --run-id <run_id> --rating up

# 3b. Fail → rebuild with targeted feedback, then test again
node scripts/forge-cli.mjs rebuild <app_id> --feedback "step 2 returned empty because ..." --run-id <run_id>
node scripts/forge-cli.mjs test <app_id> ...
```

### Where created agents land

The CLI writes every agent it creates to `scripts/.forge-cli-agents.json`
(gitignored). Use `forge-cli.mjs tracked` to list them. The auto-prefix
makes them easy to filter out of the main dashboard.

Note: even though the CLI only talks to `localhost`, the local dev server
uses `.env.local` which typically points at the same Obs and Upstash KV
that production uses. Created agents are real records on the shared
backend — that's why the prefix exists. Clean up with the `delete` command
or by deleting the prefixed rows in the dashboard.

### Output convention

- **stdout**: machine-readable JSON only. Pipe it to `jq`, redirect, or parse it.
- **stderr**: human-readable progress (`[forge-cli] ...`) and the diagnostic summary on `test`.

Most commands exit 0 on success and 1 on transport failure. `test` exits
3 if the run failed; `rename` exits 4 if Obs accepted but ignored the
patch.
