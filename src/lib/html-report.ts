// Helpers for the html_report output type. Runs on the server only —
// sanitize-html and fs access make this module server-bound.

import "server-only";
import fs from "node:fs";
import path from "node:path";
import { createRequire } from "node:module";
import sanitizeHtml from "sanitize-html";

const requireFromHere = createRequire(import.meta.url);

let chartJsSourceCache: string | null = null;

function getChartJsSource(): string {
  if (chartJsSourceCache) return chartJsSourceCache;
  // Prefer require.resolve so bundlers trace the asset; fall back to
  // process.cwd() for environments where require.resolve misses it.
  let resolvedPath: string;
  try {
    resolvedPath = requireFromHere.resolve("chart.js/dist/chart.umd.min.js");
  } catch {
    resolvedPath = path.join(
      process.cwd(),
      "node_modules",
      "chart.js",
      "dist",
      "chart.umd.min.js"
    );
  }
  chartJsSourceCache = fs.readFileSync(resolvedPath, "utf-8");
  return chartJsSourceCache;
}

// Markers on our injected <script> tags so downstream code (and humans
// reading the output) can identify them. Two kinds:
//   - forge-chartjs-lib: the Chart.js UMD bundle + runtime shim.
//   - forge-chart-init:  a server-generated per-chart init block (new JSON
//                        envelope path).
const CHARTJS_LIB_MARKER = "forge-chartjs-lib";
const CHART_INIT_MARKER = "forge-chart-init";

// Supported chart types for the JSON envelope contract. Any other `type`
// value gets dropped server-side with a warning (see parseReportEnvelope).
const SUPPORTED_CHART_TYPES: ReadonlySet<string> = new Set([
  "bar",
  "line",
  "pie",
  "doughnut",
]);

export type ChartType = "bar" | "line" | "pie" | "doughnut";

export interface ChartSpec {
  canvas_id: string;
  type: ChartType;
  data: unknown;
  options?: unknown;
}

interface ReportEnvelope {
  html: string;
  charts: ChartSpec[];
}

// Strip code fences like ```html ... ``` that LLMs love to wrap output in.
function stripCodeFences(html: string): string {
  const fenced = html.match(/^\s*```(?:html)?\s*\n([\s\S]*?)\n```\s*$/);
  return fenced ? fenced[1] : html;
}

// Extract just the <html> document if the LLM wrapped it in explanation.
function extractHtmlDocument(raw: string): string {
  const unfenced = stripCodeFences(raw);
  const docMatch = unfenced.match(/<!doctype[\s\S]*$|<html[\s\S]*$/i);
  return docMatch ? docMatch[0] : unfenced;
}

// Runtime shim:
//   1. Sets Chart.js defaults so charts are print-friendly.
//   2. Wraps the Chart constructor so each `new Chart(...)` is independently
//      try/caught. When one chart's config throws at runtime (bad field,
//      unknown type, null canvas), the other charts still render — instead
//      of the remaining charts in the same <script> silently never running.
//      Failed charts paint a red "Chart failed" message on their canvas.
//   3. Installs a window error listener that surfaces any uncaught error
//      (including script parse errors) as a sticky red banner at the top
//      of the report — so failures are visible without opening devtools.
const CHARTJS_RUNTIME_SHIM = `
if (typeof Chart !== 'undefined') {
  Chart.defaults.animation = false;
  Chart.defaults.responsive = true;
  Chart.defaults.maintainAspectRatio = false;
  var __ForgeOriginalChart = Chart;
  function __ForgeChart(ctx, config) {
    try { return new __ForgeOriginalChart(ctx, config); }
    catch (err) {
      console.error('[forge] Chart init failed:', err);
      var canvas = ctx && ctx.canvas ? ctx.canvas : ctx;
      var canvasId = (canvas && canvas.id) || 'chart';
      try {
        if (canvas && canvas.getContext) {
          var c = canvas.getContext('2d');
          var w = canvas.clientWidth || canvas.width || 400;
          var h = canvas.clientHeight || canvas.height || 200;
          canvas.width = w; canvas.height = h;
          c.fillStyle = '#fbe9e7'; c.fillRect(0, 0, w, h);
          c.fillStyle = '#b71c1c'; c.font = '13px sans-serif';
          c.fillText('Chart failed: ' + String(err && err.message || err).slice(0, 90), 12, 24);
        }
      } catch (_) {}
      try {
        if (typeof __forgeBanner === 'function') {
          __forgeBanner('chart ' + canvasId + ': ' + (err && err.message || err));
        }
      } catch (_) {}
      return null;
    }
  }
  __ForgeChart.prototype = __ForgeOriginalChart.prototype;
  Object.getOwnPropertyNames(__ForgeOriginalChart).forEach(function(k) {
    if (['length','name','prototype','arguments','caller'].indexOf(k) === -1) {
      try { __ForgeChart[k] = __ForgeOriginalChart[k]; } catch (_) {}
    }
  });
  window.Chart = __ForgeChart;
}
function __forgeBanner(msg) {
  try {
    var id = '__forge_error_banner';
    function ensure() {
      var b = document.getElementById(id);
      if (!b) {
        b = document.createElement('div');
        b.id = id;
        b.style.cssText = 'position:sticky;top:0;left:0;right:0;background:#ffebee;color:#b71c1c;padding:10px 14px;font:12px ui-monospace,monospace;border-bottom:2px solid #c62828;z-index:99999;white-space:pre-wrap;max-height:200px;overflow:auto;';
        document.body.insertBefore(b, document.body.firstChild);
      }
      return b;
    }
    if (document.body) {
      var b = ensure();
      b.textContent = (b.textContent ? b.textContent + '\\n' : '') + String(msg);
    } else {
      document.addEventListener('DOMContentLoaded', function(){
        var b = ensure();
        b.textContent = (b.textContent ? b.textContent + '\\n' : '') + String(msg);
      });
    }
  } catch (_) {}
}
window.__forgeBanner = __forgeBanner;
window.addEventListener('error', function(e) {
  var where = (e.filename || '').split('/').pop() || 'script';
  __forgeBanner('[' + where + ':' + (e.lineno || '?') + '] ' + (e.message || String(e.error)));
});
// Chart.js with responsive:true + maintainAspectRatio:false measures the
// canvas's parent. When the LLM's CSS sets only max-height (no height) on
// the chart container, the container can collapse and Chart.js renders at
// ~0 tall — charts look blank. If that's happened by the time init runs,
// copy the canvas's intrinsic height attribute onto the parent so the
// chart has something definite to fill.
function __forgeEnsureCanvasHeight(canvas) {
  try {
    if (!canvas) return;
    var p = canvas.parentElement;
    if (!p) return;
    if (p.style && p.style.height) return; // respect an explicit inline height
    if (p.clientHeight >= 40) return;      // parent already has real layout height
    var h = parseInt(canvas.getAttribute('height') || '', 10);
    if (!h || h < 40) h = 260;
    p.style.height = h + 'px';
  } catch (_) {}
}
window.__forgeEnsureCanvasHeight = __forgeEnsureCanvasHeight;
`;

// Inject the Chart.js UMD bundle into <head>, followed by the runtime
// shim above. If <head> is missing (LLM produced a fragment), wrap the
// fragment in a minimal document shell.
function injectChartJs(html: string): string {
  const chartJs = getChartJsSource();
  const tag = `<script data-forge="${CHARTJS_LIB_MARKER}">${chartJs};${CHARTJS_RUNTIME_SHIM}</script>`;
  if (/<head[^>]*>/i.test(html)) {
    return html.replace(/<head([^>]*)>/i, `<head$1>${tag}`);
  }
  if (/<html[^>]*>/i.test(html)) {
    return html.replace(/<html([^>]*)>/i, `<html$1><head>${tag}</head>`);
  }
  return `<!doctype html><html><head><meta charset="utf-8"><title>Report</title>${tag}</head><body>${html}</body></html>`;
}

// Keep <script> tags that look like Chart.js init code (or our injected
// library bundle). Everything else gets stripped.
const CHART_INIT_PATTERN = /new\s+Chart\s*\(/;

// Split an LLM-generated chart init script into { preamble, chartBlocks }.
//
// LLMs typically emit something like:
//   (function() {
//     var navy = '#1a237e';
//     var ctxA = document.getElementById('a').getContext('2d');
//     new Chart(ctxA, {...});
//     var ctxB = document.getElementById('b').getContext('2d');
//     new Chart(ctxB, {...});
//   })();
//
// We strip the outer IIFE if present, then walk the body tracking
// paren/string state to locate each `new Chart(...)` call with balanced
// parens. Everything before the first chart is the "preamble" (shared
// color vars, etc.); each chart call plus the declarations immediately
// preceding it becomes one "chartBlock".
//
// The caller re-runs `preamble + chartBlock[i]` in its own `new Function`
// so each block parses independently. A syntax error in chart 3 can no
// longer prevent charts 1, 2, 4, 5 from rendering.
function splitIntoChartBlocks(scriptText: string): { preamble: string; chartBlocks: string[] } {
  let body = scriptText.trim();
  // Unwrap a common IIFE wrapper: (function(){ ... })();
  const iife = body.match(/^\s*\(\s*function\s*\(\s*\)\s*\{([\s\S]*)\}\s*\)\s*\(\s*\)\s*;?\s*$/);
  if (iife) body = iife[1].trim();

  // Locate each `new Chart(` call end with plain balanced-paren walking.
  // We deliberately DON'T track string literals: if we did, a single bad
  // quote in the LLM's output (e.g. `backgroundColor:#7986cb',`) would
  // send the walker into a phantom string that consumes the rest of the
  // file and depth would never return to 0. Chart.js configs rarely have
  // unmatched parens inside strings, so plain paren counting is robust
  // in practice and — crucially — still finds chart boundaries even when
  // the script has a syntax error we're trying to isolate.
  const callEnds: { start: number; end: number }[] = [];
  const re = /new\s+Chart\s*\(/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(body)) !== null) {
    const start = m.index;
    let depth = 1;
    let i = m.index + m[0].length; // just past the opening paren
    while (i < body.length && depth > 0) {
      const c = body[i];
      if (c === "(") depth++;
      else if (c === ")") depth--;
      i++;
    }
    if (depth !== 0) break; // unbalanced, bail
    // swallow any trailing whitespace and the terminating ;
    while (i < body.length && /\s/.test(body[i])) i++;
    if (body[i] === ";") i++;
    callEnds.push({ start, end: i });
    re.lastIndex = i;
  }

  if (callEnds.length === 0) {
    return { preamble: "", chartBlocks: [] };
  }

  const preamble = body.slice(0, callEnds[0].start).trim();
  const chartBlocks: string[] = [];
  for (let k = 0; k < callEnds.length; k++) {
    const blockStart = k === 0 ? callEnds[0].start : callEnds[k - 1].end;
    chartBlocks.push(body.slice(blockStart, callEnds[k].end).trim());
  }
  return { preamble, chartBlocks };
}

// Build the runtime wrapper that executes each chart block in its own
// `new Function()` call, so parse errors and runtime errors in one chart
// don't take down the rest. The wrapper also defers to DOMContentLoaded
// so canvas lookup succeeds regardless of where the LLM placed the script.
function buildIsolatedChartRunner(scriptText: string): string {
  const { preamble, chartBlocks } = splitIntoChartBlocks(scriptText);
  // Fix collapsed chart-container parents (max-height-only CSS gotcha)
  // before any chart block runs. Idempotent, safe to call from multiple
  // isolated runners on the same page.
  const ensureHeights = `if(typeof __forgeEnsureCanvasHeight==='function'){var __cs=document.querySelectorAll('canvas');for(var __i=0;__i<__cs.length;__i++){__forgeEnsureCanvasHeight(__cs[__i]);}}`;
  if (chartBlocks.length < 2) {
    // Only one chart (or we couldn't split) — keep the simple wrapper. One
    // script still gets its try/catch at runtime via the Chart constructor
    // wrapper in the runtime shim.
    return `(function(){function __init(){${ensureHeights}try{${scriptText}}catch(e){console.error('[forge] chart init failed:',e);__forgeBanner&&__forgeBanner(e);}}if(document.readyState==='loading'){document.addEventListener('DOMContentLoaded',__init);}else{__init();}})();`;
  }
  const preambleLit = JSON.stringify(preamble);
  const blocksLit = "[" + chartBlocks.map((b) => JSON.stringify(b)).join(",") + "]";
  return `(function(){function __init(){${ensureHeights}var preamble=${preambleLit};var blocks=${blocksLit};for(var i=0;i<blocks.length;i++){try{(new Function(preamble+'\\n'+blocks[i]))();}catch(e){console.error('[forge] chart block',i+1,'failed:',e);if(typeof __forgeBanner==='function')__forgeBanner('chart '+(i+1)+': '+(e.message||e));}}}if(document.readyState==='loading'){document.addEventListener('DOMContentLoaded',__init);}else{__init();}})();`;
}

// Try to parse the raw LLM output as a JSON envelope of the form
// { html: string, charts: ChartSpec[] }. Returns null when the output
// isn't JSON or doesn't match the expected shape — the caller falls back
// to the legacy HTML-with-inline-scripts path.
//
// The LLM contract says "output only the JSON object" but we tolerate
// common wrappers: ```json ... ``` fences, and trailing text after the
// final closing brace. Anything else that won't parse is returned as
// null so the legacy path can try.
function parseReportEnvelope(raw: string): ReportEnvelope | null {
  if (!raw) return null;
  let text = raw.trim();
  const fenced = text.match(/^```(?:json)?\s*\n?([\s\S]*?)\n?```\s*$/i);
  if (fenced) text = fenced[1].trim();
  if (!text.startsWith("{")) return null;

  let parsed: unknown;
  try {
    parsed = JSON.parse(repairJsonControlChars(text));
  } catch {
    // Sometimes the LLM adds prose after the JSON. Retry with everything
    // up to the last `}`.
    const last = text.lastIndexOf("}");
    if (last === -1) return null;
    try {
      parsed = JSON.parse(repairJsonControlChars(text.slice(0, last + 1)));
    } catch {
      return null;
    }
  }

  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return null;
  const obj = parsed as Record<string, unknown>;
  if (typeof obj.html !== "string") return null;
  if (!Array.isArray(obj.charts)) return null;

  const charts: ChartSpec[] = [];
  for (const item of obj.charts) {
    if (!item || typeof item !== "object") continue;
    const spec = item as Record<string, unknown>;
    if (typeof spec.canvas_id !== "string" || !spec.canvas_id) {
      console.warn("[forge] html-report: dropping chart with missing canvas_id");
      continue;
    }
    if (typeof spec.type !== "string" || !SUPPORTED_CHART_TYPES.has(spec.type)) {
      console.warn(
        `[forge] html-report: dropping chart ${spec.canvas_id} with unsupported type: ${String(spec.type)}`
      );
      continue;
    }
    if (!("data" in spec)) {
      console.warn(`[forge] html-report: dropping chart ${spec.canvas_id} with missing data`);
      continue;
    }
    charts.push({
      canvas_id: spec.canvas_id,
      type: spec.type as ChartType,
      data: spec.data,
      options: spec.options,
    });
  }

  return { html: obj.html, charts };
}

// LLM outputs sometimes embed raw newlines/tabs inside JSON string values
// (especially long HTML documents). Escape any unescaped control chars
// that fall inside string literals so JSON.parse accepts the output.
function repairJsonControlChars(s: string): string {
  let out = "";
  let inString = false;
  let escape = false;
  for (let i = 0; i < s.length; i++) {
    const c = s[i];
    if (escape) {
      out += c;
      escape = false;
      continue;
    }
    if (c === "\\") {
      out += c;
      escape = true;
      continue;
    }
    if (c === '"') {
      inString = !inString;
      out += c;
      continue;
    }
    if (inString) {
      const code = c.charCodeAt(0);
      if (code < 0x20) {
        switch (c) {
          case "\n": out += "\\n"; break;
          case "\r": out += "\\r"; break;
          case "\t": out += "\\t"; break;
          case "\b": out += "\\b"; break;
          case "\f": out += "\\f"; break;
          default: out += "\\u" + code.toString(16).padStart(4, "0");
        }
      } else {
        out += c;
      }
    } else {
      out += c;
    }
  }
  return out;
}

// Server-applied defaults. Spec options shallow-merge over these; nested
// objects (e.g. `plugins`) replace wholesale rather than deep-merging
// Chart.js's arbitrary option tree.
const CHART_DEFAULTS = {
  animation: false,
  responsive: true,
  maintainAspectRatio: false,
  plugins: { legend: { position: "bottom" } },
};

function applyChartDefaults(options: unknown): Record<string, unknown> {
  if (!options || typeof options !== "object" || Array.isArray(options)) {
    return { ...CHART_DEFAULTS };
  }
  return { ...CHART_DEFAULTS, ...(options as Record<string, unknown>) };
}

// Escape any `</script` occurrences inside the embedded JSON so the
// browser's HTML parser doesn't prematurely close the <script> tag.
function escapeForScriptBody(s: string): string {
  return s.replace(/<\/script/gi, "<\\/script");
}

// Build the per-chart init blocks for the new JSON envelope path. Each
// block is its own <script> so a failure in one doesn't stop the next.
// The DOMPurify hook whitelists these by their `data-forge` marker.
export function generateChartScripts(charts: ChartSpec[]): string {
  return charts
    .map((spec) => {
      const config = {
        type: spec.type,
        data: spec.data,
        options: applyChartDefaults(spec.options),
      };
      const idJson = JSON.stringify(spec.canvas_id);
      const configJson = escapeForScriptBody(JSON.stringify(config));
      // The runtime-shim Chart wrapper handles errors (paints red box +
      // banner). This outer try/catch is a belt-and-suspenders guard for
      // errors that happen before `new Chart` is called (e.g. canvas is
      // null after getElementById).
      return `<script data-forge="${CHART_INIT_MARKER}">
(function(){
  function __init(){
    var canvas = document.getElementById(${idJson});
    if (!canvas) return;
    if (typeof __forgeEnsureCanvasHeight === "function") __forgeEnsureCanvasHeight(canvas);
    try {
      new Chart(canvas.getContext("2d"), ${configJson});
    } catch (e) {
      console.error("[forge] chart " + ${idJson} + " failed:", e);
      if (typeof __forgeBanner === "function") __forgeBanner("chart " + ${idJson} + ": " + (e.message || e));
    }
  }
  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", __init);
  } else {
    __init();
  }
})();
</script>`;
    })
    .join("\n");
}

// Insert the generated chart-init scripts immediately before </body> so
// every <canvas> already exists in the DOM by the time the scripts run.
// If the LLM's html has no </body>, append to the end.
function injectChartInits(html: string, scripts: string): string {
  if (!scripts) return html;
  if (/<\/body\s*>/i.test(html)) {
    return html.replace(/<\/body\s*>/i, `${scripts}\n</body>`);
  }
  return html + "\n" + scripts;
}

// Pull every `<script>...new Chart(...)...</script>` out of the raw HTML
// before sanitization and return the stripped HTML + the extracted
// bodies. This is the legacy path: the LLM hand-authored inline chart
// init. We extract first so the scripts skip DOMPurify entirely (see
// note on prepareHtmlReport for why).
function extractLegacyChartScripts(html: string): { html: string; scripts: string[] } {
  const scripts: string[] = [];
  const stripped = html.replace(
    /<script\b[^>]*>([\s\S]*?)<\/script\s*>/gi,
    (full, body: string) => {
      if (CHART_INIT_PATTERN.test(body)) {
        scripts.push(body);
        return "";
      }
      return full; // non-chart scripts fall through to DOMPurify, which drops them
    }
  );
  return { html: stripped, scripts };
}

// Wrap legacy extracted scripts in our per-chart isolated runners and
// join into a single injectable <script data-forge="..."> blob.
function buildLegacyChartScriptsHtml(scripts: string[]): string {
  if (scripts.length === 0) return "";
  const wrapped = scripts.map(buildIsolatedChartRunner).join("\n");
  return `<script data-forge="${CHART_INIT_MARKER}">\n${wrapped}\n</script>`;
}

// Sanitize and prepare an LLM-generated report for storage. The input
// can be either:
//   1. A JSON envelope `{ html, charts }` (new contract — preferred).
//   2. A full HTML document with inline <script>new Chart(...)</script>
//      blocks (legacy contract, kept for agents built before the
//      envelope refactor).
// The result is a full, self-contained HTML document safe to render
// inside a sandboxed iframe.
//
// We sanitize the USER HTML with scripts fully disallowed, then inject
// our trusted scripts (Chart.js library, runtime shim, server-generated
// or wrapped-legacy chart init) AFTER sanitization. Sanitizing first
// then injecting keeps our known-safe <script> blobs from being mangled
// or dropped by the sanitizer's parser.
export function prepareHtmlReport(rawOutput: string): string {
  const envelope = parseReportEnvelope(rawOutput);

  let userHtml: string;
  let initScriptsHtml: string;

  if (envelope) {
    console.log(
      `[forge] html-report: JSON envelope path (${envelope.charts.length} charts)`
    );
    userHtml = extractHtmlDocument(envelope.html);
    initScriptsHtml = generateChartScripts(envelope.charts);
  } else {
    console.log("[forge] html-report: legacy HTML path");
    const legacy = extractLegacyChartScripts(extractHtmlDocument(rawOutput));
    userHtml = legacy.html;
    initScriptsHtml = buildLegacyChartScriptsHtml(legacy.scripts);
  }

  // Sanitize only the user-authored HTML. Strip ALL scripts — the ones
  // that carry chart init were pulled out above (legacy) or were never
  // present (new envelope path, which forbids them in the contract).
  const clean = sanitizeUserHtml(userHtml);

  // Post-sanitization injection. Library + shim go in <head>; init
  // scripts go right before </body> so canvases exist when they run.
  const withLib = injectChartJs(clean);
  const final = injectChartInits(withLib, initScriptsHtml);

  // Sanitization strips the doctype (it's not a tag). Prepend one so the
  // iframe renders in standards mode.
  return /^\s*<!doctype/i.test(final) ? final : `<!doctype html>${final}`;
}

// sanitize-html is allowlist-based, so we pass a broad tag/attribute
// set that covers what LLMs commonly emit for reports (document shell,
// semantic HTML, tables, images, canvas for charts, <style>). Scripts
// and event-handler attributes are stripped by default.
const REPORT_ALLOWED_TAGS: string[] = [
  "html", "head", "body", "title", "meta", "link", "style", "base",
  "div", "span", "p", "br", "hr", "pre", "blockquote",
  "h1", "h2", "h3", "h4", "h5", "h6",
  "strong", "b", "em", "i", "u", "s", "small", "sub", "sup",
  "code", "kbd", "samp", "var", "mark", "del", "ins", "q", "cite", "abbr", "time",
  "ul", "ol", "li", "dl", "dt", "dd",
  "a", "img", "figure", "figcaption", "picture", "source",
  "table", "thead", "tbody", "tfoot", "tr", "th", "td", "caption", "colgroup", "col",
  "header", "footer", "main", "nav", "section", "article", "aside", "address",
  "details", "summary",
  "canvas",
  "svg", "path", "g", "circle", "rect", "line", "polyline", "polygon", "ellipse", "text", "tspan",
];

function sanitizeUserHtml(html: string): string {
  return sanitizeHtml(html, {
    allowedTags: REPORT_ALLOWED_TAGS,
    allowedAttributes: {
      "*": [
        "id", "class", "style", "data-forge", "lang", "dir", "role", "title",
        "aria-*",
      ],
      a: ["href", "target", "rel", "name"],
      img: ["src", "alt", "width", "height", "loading", "decoding"],
      source: ["src", "srcset", "media", "type"],
      picture: [],
      canvas: ["width", "height"],
      meta: ["charset", "name", "content", "http-equiv", "property"],
      link: ["rel", "href", "type", "media", "sizes"],
      base: ["href", "target"],
      table: ["border", "cellpadding", "cellspacing"],
      td: ["colspan", "rowspan", "align", "valign", "headers"],
      th: ["colspan", "rowspan", "align", "valign", "scope", "headers"],
      col: ["span"],
      colgroup: ["span"],
      html: ["lang", "dir"],
      time: ["datetime"],
      q: ["cite"],
      blockquote: ["cite"],
      svg: ["viewBox", "xmlns", "width", "height", "fill", "stroke", "preserveAspectRatio"],
      path: ["d", "fill", "stroke", "stroke-width", "stroke-linecap", "stroke-linejoin"],
      g: ["fill", "stroke", "transform"],
      circle: ["cx", "cy", "r", "fill", "stroke", "stroke-width"],
      rect: ["x", "y", "width", "height", "fill", "stroke", "rx", "ry"],
      line: ["x1", "y1", "x2", "y2", "stroke", "stroke-width"],
      polyline: ["points", "fill", "stroke", "stroke-width"],
      polygon: ["points", "fill", "stroke", "stroke-width"],
      ellipse: ["cx", "cy", "rx", "ry", "fill", "stroke"],
      text: ["x", "y", "fill", "font-size", "text-anchor"],
      tspan: ["x", "y", "dx", "dy"],
    },
    allowedSchemes: ["http", "https", "mailto", "data", "tel"],
    allowedSchemesByTag: { img: ["http", "https", "data"] },
    // <style> is essential for LLM-generated reports and the output
    // renders in a sandboxed iframe, so CSS-based XSS is contained.
    allowVulnerableTags: true,
    // Leave CSS inside <style> untouched (no property filtering).
    parseStyleAttributes: false,
  });
}

// Heuristic: does this output look like an HTML report? Used by pages
// that don't have the plan handy but have the run's output text.
export function outputLooksLikeHtmlReport(output: string | null | undefined): boolean {
  if (!output) return false;
  const head = output.trimStart().slice(0, 200).toLowerCase();
  return head.startsWith("<!doctype html") || head.startsWith("<html");
}
