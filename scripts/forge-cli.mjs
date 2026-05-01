#!/usr/bin/env node
// forge-cli — drive the Forge agent build/test/rebuild loop against a
// local dev server. Localhost-only by design; refuses any other host.
//
// Usage:
//   node scripts/forge-cli.mjs <command> [args...]
//
// Commands:
//   create   --json <inline-json | @path>           Build a new agent
//   test     <app_id> [--input "..."] [--file label:path]... [--url ...] [--timeout 180]
//   rebuild  <app_id> --feedback "..." [--run-id <id>]
//   finalize <app_id> --run-id <id> --rating up|down [--feedback "..."]
//   inspect  <app_id> --run-id <id>
//   delete   <app_id>
//   tracked  [--prefix <p>]    List CLI-created agents from local tracking file
//
// Tracking: writes scripts/.forge-cli-agents.json with every agent created
// through this CLI so you can find and clean them up later.

import { readFile, writeFile, access } from "node:fs/promises";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const TRACK_FILE = resolve(__dirname, ".forge-cli-agents.json");
const BASE_URL = (process.env.FORGE_CLI_BASE_URL || "http://localhost:3000").replace(/\/$/, "");
const TEST_PREFIX = process.env.FORGE_CLI_PREFIX || "cli-test-";

if (
  !BASE_URL.startsWith("http://localhost") &&
  !BASE_URL.startsWith("http://127.0.0.1")
) {
  console.error(`[forge-cli] refusing non-local base URL: ${BASE_URL}`);
  process.exit(2);
}

// ---------- argv parsing ----------
function parseArgs(argv) {
  const out = { _: [], flags: {}, multi: {} };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a.startsWith("--")) {
      const key = a.slice(2);
      const next = argv[i + 1];
      if (next !== undefined && !next.startsWith("--")) {
        // multi-value flags
        if (key === "file") {
          (out.multi.file ||= []).push(next);
        } else {
          out.flags[key] = next;
        }
        i++;
      } else {
        out.flags[key] = true;
      }
    } else {
      out._.push(a);
    }
  }
  return out;
}

// ---------- HTTP helpers ----------
async function http(method, path, body) {
  const res = await fetch(`${BASE_URL}${path}`, {
    method,
    headers: body ? { "content-type": "application/json" } : undefined,
    body: body ? JSON.stringify(body) : undefined,
  });
  const text = await res.text();
  let json;
  try {
    json = text ? JSON.parse(text) : null;
  } catch {
    json = { _raw: text };
  }
  if (!res.ok) {
    const err = new Error(`HTTP ${res.status} ${path}`);
    err.status = res.status;
    err.body = json;
    throw err;
  }
  return json;
}

const post = (p, b) => http("POST", p, b);
const get = (p) => http("GET", p);

// ---------- tracking file ----------
async function readTracked() {
  try {
    await access(TRACK_FILE);
  } catch {
    return [];
  }
  const text = await readFile(TRACK_FILE, "utf8");
  try {
    const j = JSON.parse(text);
    return Array.isArray(j) ? j : [];
  } catch {
    return [];
  }
}

async function appendTracked(entry) {
  const list = await readTracked();
  list.push(entry);
  await writeFile(TRACK_FILE, JSON.stringify(list, null, 2));
}

async function markDeleted(app_id) {
  const list = await readTracked();
  const next = list.map((e) =>
    e.app_id === app_id ? { ...e, deleted_at: new Date().toISOString() } : e
  );
  await writeFile(TRACK_FILE, JSON.stringify(next, null, 2));
}

// ---------- json arg loader ----------
async function loadJsonArg(raw) {
  if (!raw) throw new Error("--json is required");
  if (typeof raw !== "string") throw new Error("--json must take a value");
  if (raw.startsWith("@")) {
    const text = await readFile(raw.slice(1), "utf8");
    return JSON.parse(text);
  }
  return JSON.parse(raw);
}

// ---------- file -> base64 (multi-file --file label:path) ----------
async function loadFileSpecs(specs) {
  const out = [];
  for (const spec of specs ?? []) {
    const idx = spec.indexOf(":");
    if (idx < 0) throw new Error(`--file value must be label:path, got: ${spec}`);
    const label = spec.slice(0, idx);
    const path = spec.slice(idx + 1);
    const buf = await readFile(path);
    const filename = path.split("/").pop() ?? "";
    out.push({
      label,
      filename,
      // route handler treats raw text for non-docx, base64 for .docx
      content: filename.endsWith(".docx") ? buf.toString("base64") : buf.toString("utf8"),
    });
  }
  return out;
}

// ---------- diagnostic formatter ----------
function summarizeRun({ run, steps, plan, output }) {
  const lines = [];
  lines.push(`run_id:    ${run?.id ?? "?"}`);
  lines.push(`status:    ${run?.status ?? "?"}`);
  lines.push(`duration:  ${run?.duration_ms ?? "?"}ms`);
  if (run?.error_message) lines.push(`error:     ${run.error_message}`);
  lines.push(`tokens:    in=${run?.input_tokens ?? 0} out=${run?.output_tokens ?? 0}  cost=$${(run?.cost_usd ?? 0).toFixed(4)}`);
  lines.push("");
  lines.push("steps:");
  // group by step_name and find latest event for each
  const byName = new Map();
  for (const s of steps ?? []) {
    const arr = byName.get(s.step_name) ?? [];
    arr.push(s);
    byName.set(s.step_name, arr);
  }
  let i = 1;
  for (const [name, events] of byName) {
    const last = events[events.length - 1];
    const status =
      last.event_type === "complete" ? "ok" :
      last.event_type === "fail" ? "FAIL" : "...";
    const dur = last.duration_ms != null ? ` ${last.duration_ms}ms` : "";
    lines.push(`  ${i}. [${status}] ${name} (${last.service})${dur}`);
    if (last.event_type === "fail") {
      lines.push(`       error: ${last.metadata?.error ?? "(no detail)"}`);
    } else if (last.metadata?.output_preview) {
      const prev = String(last.metadata.output_preview).replace(/\s+/g, " ").slice(0, 200);
      lines.push(`       → ${prev}${last.metadata.output_chars > 200 ? "…" : ""}`);
    }
    i++;
  }
  lines.push("");
  lines.push("output:");
  if (output) {
    const lines2 = String(output).split("\n").slice(0, 30);
    lines.push(lines2.map((l) => "  " + l).join("\n"));
    if (output.split("\n").length > 30) lines.push("  …");
  } else {
    lines.push("  (empty)");
  }
  return lines.join("\n");
}

// ---------- commands ----------
async function cmdCreate(args) {
  const cfg = await loadJsonArg(args.flags.json);
  // Auto-prefix display_name unless explicitly opted out.
  if (!args.flags["no-prefix"]) {
    if (!String(cfg.display_name ?? "").startsWith(TEST_PREFIX)) {
      cfg.display_name = `${TEST_PREFIX}${cfg.display_name ?? ""}`;
    }
  }
  // Sensible defaults so the JSON the caller writes can stay minimal.
  const payload = {
    display_name: cfg.display_name,
    slug: cfg.slug,
    description: cfg.description ?? "",
    needs_llm: cfg.needs_llm ?? true,
    model: cfg.model ?? "claude-sonnet-4-6",
    input_config: cfg.input_config ?? {
      text: { enabled: true, size: "short" },
      url: { enabled: false },
      file: { enabled: false, slots: [] },
    },
    can_send_email: cfg.can_send_email ?? false,
    has_web_access: cfg.has_web_access ?? false,
    schedule_cadence: cfg.schedule_cadence ?? null,
    schedule_time: cfg.schedule_time ?? null,
    schedule_day_of_week: cfg.schedule_day_of_week ?? null,
    schedule_day_of_month: cfg.schedule_day_of_month ?? null,
    verified_email: cfg.verified_email ?? null,
    success_criteria: cfg.success_criteria ?? "",
    output_type: cfg.output_type ?? "text",
    context_text: cfg.context_text ?? null,
    user_feedback: cfg.user_feedback ?? null,
  };
  const res = await post("/api/internal/build-agent", payload);
  await appendTracked({
    app_id: res.app_id,
    slug: res.slug,
    display_name: res.display_name,
    created_at: new Date().toISOString(),
    prefix: TEST_PREFIX,
  });
  console.error(`[forge-cli] created agent: ${res.slug} (${res.app_id})`);
  console.log(JSON.stringify(res, null, 2));
}

async function cmdTest(args) {
  const app_id = args._[1];
  if (!app_id) throw new Error("usage: test <app_id>");
  const files = await loadFileSpecs(args.multi.file);
  const body = {
    app_id,
    run_type: "test",
    input_text: args.flags.input ?? null,
    input_url: args.flags.url ?? null,
    files: files.length ? files : undefined,
  };
  const { run_id } = await post("/api/internal/run", body);
  console.error(`[forge-cli] test started: run_id=${run_id}`);

  const timeoutMs = (Number(args.flags.timeout) || 180) * 1000;
  const start = Date.now();
  let lastSeq = 0;
  let allSteps = [];
  let runStatus = "running";
  while (true) {
    if (Date.now() - start > timeoutMs) {
      console.error(`[forge-cli] timed out after ${timeoutMs}ms`);
      break;
    }
    const data = await get(
      `/api/internal/steps?app_id=${encodeURIComponent(app_id)}&run_id=${encodeURIComponent(run_id)}&since=${lastSeq}`
    );
    runStatus = data.run_status ?? runStatus;
    if (Array.isArray(data.steps) && data.steps.length) {
      allSteps = allSteps.concat(data.steps);
      lastSeq = data.last_seq ?? lastSeq;
      for (const s of data.steps) {
        const tag = s.event_type === "fail" ? "FAIL" : s.event_type;
        console.error(`[forge-cli]   step ${tag}: ${s.step_name} (${s.service})`);
      }
    }
    if (
      runStatus === "completed" ||
      runStatus === "failed" ||
      runStatus === "cancelled"
    ) {
      break;
    }
    await new Promise((r) => setTimeout(r, 800));
  }

  const detail = await get(
    `/api/internal/run-detail?app_id=${encodeURIComponent(app_id)}&run_id=${encodeURIComponent(run_id)}`
  );
  const result = {
    run_id,
    status: detail.run?.status,
    output: detail.run?.output ?? null,
    error_message: detail.run?.error_message ?? null,
    duration_ms: detail.run?.duration_ms ?? null,
    input_tokens: detail.run?.input_tokens ?? 0,
    output_tokens: detail.run?.output_tokens ?? 0,
    cost_usd: detail.run?.cost_usd ?? 0,
    steps: detail.steps ?? allSteps,
  };

  console.error("");
  console.error(summarizeRun({ run: detail.run, steps: detail.steps ?? allSteps, output: result.output }));
  console.log(JSON.stringify(result, null, 2));
  if (result.status !== "completed") process.exit(3);
}

async function cmdRebuild(args) {
  const app_id = args._[1];
  if (!app_id) throw new Error("usage: rebuild <app_id> --feedback ...");
  const feedback = args.flags.feedback;
  if (!feedback) throw new Error("--feedback is required");
  let previous_run = null;
  if (args.flags["run-id"]) {
    const detail = await get(
      `/api/internal/run-detail?app_id=${encodeURIComponent(app_id)}&run_id=${encodeURIComponent(args.flags["run-id"])}`
    );
    if (detail.run) {
      previous_run = {
        status: detail.run.status,
        output: detail.run.output ?? null,
        error_message: detail.run.error_message ?? null,
      };
    }
  }
  const res = await post("/api/internal/rebuild-agent", {
    app_id,
    user_feedback: feedback,
    previous_run,
  });
  console.error(`[forge-cli] rebuilt agent ${app_id}`);
  console.log(JSON.stringify(res, null, 2));
}

async function cmdFinalize(args) {
  const app_id = args._[1];
  if (!app_id) throw new Error("usage: finalize <app_id> --run-id <id> --rating up|down");
  const run_id = args.flags["run-id"];
  const rating = args.flags.rating;
  if (!run_id || !rating) throw new Error("--run-id and --rating are required");
  if (rating !== "up" && rating !== "down") throw new Error("--rating must be 'up' or 'down'");
  const res = await post("/api/internal/finalize", {
    app_id,
    run_id,
    rating,
    feedback: args.flags.feedback,
  });
  console.error(`[forge-cli] finalized run ${run_id} (${rating})`);
  console.log(JSON.stringify(res, null, 2));
}

async function cmdInspect(args) {
  const app_id = args._[1];
  const run_id = args.flags["run-id"];
  if (!app_id || !run_id) throw new Error("usage: inspect <app_id> --run-id <id>");
  const detail = await get(
    `/api/internal/run-detail?app_id=${encodeURIComponent(app_id)}&run_id=${encodeURIComponent(run_id)}`
  );
  console.error(summarizeRun({ run: detail.run, steps: detail.steps, output: detail.run?.output }));
  console.log(JSON.stringify(detail, null, 2));
}

async function cmdDelete(args) {
  const app_id = args._[1];
  if (!app_id) throw new Error("usage: delete <app_id>");
  const res = await post("/api/internal/delete-agent", { app_id });
  await markDeleted(app_id);
  console.error(`[forge-cli] deleted agent ${app_id}`);
  console.log(JSON.stringify(res, null, 2));
}

async function cmdTracked(args) {
  const list = await readTracked();
  const prefix = args.flags.prefix;
  const filtered = prefix ? list.filter((e) => (e.prefix ?? "") === prefix) : list;
  console.log(JSON.stringify(filtered, null, 2));
}

// ---------- entrypoint ----------
const argv = process.argv.slice(2);
const args = parseArgs(argv);
const cmd = args._[0];
const COMMANDS = {
  create: cmdCreate,
  test: cmdTest,
  rebuild: cmdRebuild,
  finalize: cmdFinalize,
  inspect: cmdInspect,
  delete: cmdDelete,
  tracked: cmdTracked,
};

if (!cmd || !COMMANDS[cmd]) {
  console.error("commands: create, test, rebuild, finalize, inspect, delete, tracked");
  process.exit(1);
}

try {
  await COMMANDS[cmd](args);
} catch (e) {
  console.error(`[forge-cli] ${e.message ?? e}`);
  if (e.body) console.error(JSON.stringify(e.body, null, 2));
  process.exit(1);
}
