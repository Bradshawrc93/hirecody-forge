// Helpers for the csv output type. Mirrors the two-step pattern used by
// html-report.ts: the LLM emits a strict JSON envelope of columns+rows,
// and this module deterministically renders it to an RFC 4180 CSV string.
//
// LLMs cannot reliably produce raw CSV (quoting, escaping, encoding all
// break in practice), so all of that happens here — not in the prompt.

export const CSV_ROW_LIMIT = 500;

// Marker we use to detect a CSV envelope stored as run.output. The JSON
// starts with `{"forge_output_type":"csv"` so detection is unambiguous
// against markdown output and html_report output (which starts with
// `<!doctype html>`).
export const CSV_ENVELOPE_MARKER = '"forge_output_type":"csv"';

export interface CsvEnvelope {
  forge_output_type: "csv";
  filename: string;
  row_count: number;
  column_count: number;
  columns: string[];
  truncated: boolean;
  csv: string;
}

interface RawCsvPayload {
  columns: string[];
  rows: unknown[][];
}

// Tolerate the same LLM wrappers html-report tolerates: ```json fences
// and trailing prose after the final brace.
function parseLlmCsvEnvelope(raw: string): RawCsvPayload {
  if (!raw) throw new Error("csv_report: empty LLM output");
  let text = raw.trim();
  const fenced = text.match(/^```(?:json)?\s*\n?([\s\S]*?)\n?```\s*$/i);
  if (fenced) text = fenced[1].trim();

  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch {
    const last = text.lastIndexOf("}");
    if (last === -1) throw new Error("csv_report: LLM output is not JSON");
    parsed = JSON.parse(text.slice(0, last + 1));
  }

  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
    throw new Error("csv_report: envelope must be a JSON object");
  }
  const obj = parsed as Record<string, unknown>;
  if (!Array.isArray(obj.columns) || obj.columns.length === 0) {
    throw new Error("csv_report: `columns` must be a non-empty array of strings");
  }
  const columns: string[] = [];
  for (const c of obj.columns) {
    if (typeof c !== "string") {
      throw new Error("csv_report: every column must be a string");
    }
    columns.push(c);
  }
  if (!Array.isArray(obj.rows)) {
    throw new Error("csv_report: `rows` must be an array");
  }
  const rows: unknown[][] = [];
  for (const r of obj.rows) {
    if (!Array.isArray(r)) {
      throw new Error("csv_report: every row must be an array of cell values");
    }
    rows.push(r);
  }
  return { columns, rows };
}

// Coerce arbitrary LLM cell values to strings. Nullish → empty. Booleans
// stringify. Numbers stringify (so NaN/Infinity → "NaN"/"Infinity", which
// is still more informative than an empty cell). Objects/arrays go to
// JSON so bad shapes don't silently collapse to "[object Object]".
function coerceCell(v: unknown): string {
  if (v === null || v === undefined) return "";
  if (typeof v === "string") return v;
  if (typeof v === "number" || typeof v === "boolean") return String(v);
  try {
    return JSON.stringify(v);
  } catch {
    return String(v);
  }
}

// RFC 4180 field serializer: wrap in double quotes and double any
// internal quotes when the field contains a quote, comma, CR, or LF.
function escapeField(raw: string): string {
  if (/[",\r\n]/.test(raw)) {
    return `"${raw.replace(/"/g, '""')}"`;
  }
  return raw;
}

function serializeCsv(columns: string[], rows: unknown[][]): string {
  const lines: string[] = [];
  lines.push(columns.map((c) => escapeField(c)).join(","));
  for (const r of rows) {
    const cells: string[] = [];
    for (let i = 0; i < columns.length; i++) {
      cells.push(escapeField(coerceCell(r[i])));
    }
    lines.push(cells.join(","));
  }
  // RFC 4180 line endings + UTF-8 BOM. The BOM makes Excel on Windows
  // render UTF-8 correctly instead of falling back to Windows-1252.
  return "\uFEFF" + lines.join("\r\n") + "\r\n";
}

// Deterministic filename: <agent_slug>-<YYYY-MM-DD>.csv. The run page
// fallback suffix `-<short_run_id>` is applied by the caller when it has
// a run_id available (so tests that re-run on the same day don't collide
// in downloaded-files folders).
export function buildCsvFilename(
  slug: string | null | undefined,
  when: Date
): string {
  const safeSlug = (slug && slug.trim()) || "agent";
  // Format in America/Chicago so the filename date matches the
  // scheduling convention users already see on the run page.
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: "America/Chicago",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(when);
  const y = parts.find((p) => p.type === "year")?.value ?? "1970";
  const m = parts.find((p) => p.type === "month")?.value ?? "01";
  const d = parts.find((p) => p.type === "day")?.value ?? "01";
  return `${safeSlug}-${y}-${m}-${d}.csv`;
}

// Parse the LLM envelope, apply the 500-row cap, render the CSV, and
// package everything the UI and download endpoint need into a single
// Forge envelope serialized as a string — that string goes into run.output.
export function buildCsvEnvelope(params: {
  llmOutput: string;
  slug: string | null | undefined;
  completedAt?: Date;
}): CsvEnvelope {
  const { columns, rows } = parseLlmCsvEnvelope(params.llmOutput);

  let effectiveRows = rows;
  let truncated = false;
  if (rows.length > CSV_ROW_LIMIT) {
    truncated = true;
    effectiveRows = rows.slice(0, CSV_ROW_LIMIT);
    console.warn(
      `[forge] csv_report: truncated ${rows.length} rows to ${CSV_ROW_LIMIT}`
    );
  }

  const csv = serializeCsv(columns, effectiveRows);
  const filename = buildCsvFilename(params.slug, params.completedAt ?? new Date());
  return {
    forge_output_type: "csv",
    filename,
    row_count: effectiveRows.length,
    column_count: columns.length,
    columns,
    truncated,
    csv,
  };
}

// Fast path used by UI code that only has a run.output string: is this a
// Forge CSV envelope? Cheap string check before committing to JSON.parse.
export function outputLooksLikeCsvEnvelope(
  output: string | null | undefined
): boolean {
  if (!output) return false;
  const head = output.trimStart().slice(0, 80);
  return head.startsWith("{") && head.includes(CSV_ENVELOPE_MARKER);
}

// Safely parse a run.output string as a Forge CSV envelope. Returns null
// when the string isn't a CSV envelope or any required field is missing.
// Never throws — callers typically fall back to markdown/HTML rendering.
export function parseCsvEnvelope(
  output: string | null | undefined
): CsvEnvelope | null {
  if (!outputLooksLikeCsvEnvelope(output)) return null;
  let parsed: unknown;
  try {
    parsed = JSON.parse(output as string);
  } catch {
    return null;
  }
  if (!parsed || typeof parsed !== "object") return null;
  const o = parsed as Record<string, unknown>;
  if (o.forge_output_type !== "csv") return null;
  if (typeof o.filename !== "string") return null;
  if (typeof o.row_count !== "number") return null;
  if (typeof o.column_count !== "number") return null;
  if (!Array.isArray(o.columns)) return null;
  if (typeof o.truncated !== "boolean") return null;
  if (typeof o.csv !== "string") return null;
  return {
    forge_output_type: "csv",
    filename: o.filename,
    row_count: o.row_count,
    column_count: o.column_count,
    columns: o.columns.filter((c): c is string => typeof c === "string"),
    truncated: o.truncated,
    csv: o.csv,
  };
}
