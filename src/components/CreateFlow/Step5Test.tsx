"use client";

import { useEffect, useRef, useState } from "react";
import { ThumbsDown, ThumbsUp } from "lucide-react";
import { Waterfall } from "@/components/Waterfall";
import { MarkdownView } from "@/components/MarkdownView";
import { CsvDownloadBlock } from "@/components/CsvDownloadBlock";
import { parseCsvEnvelope } from "@/lib/csv-report";
import type { FormState } from "./types";

const ACCEPTED_EXTENSIONS = ".txt,.docx,.csv,.md";
const ACCEPTED_EXT_LIST = [".txt", ".docx", ".csv", ".md"];

// Client-side mirror of outputLooksLikeHtmlReport (the server helper lives
// in lib/html-report.ts behind server-only).
function isHtmlReport(output: string | null | undefined): boolean {
  if (!output) return false;
  const head = output.trimStart().slice(0, 200).toLowerCase();
  return head.startsWith("<!doctype html") || head.startsWith("<html");
}

function readFileAsText(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    if (file.name.endsWith(".docx")) {
      reader.onload = () => {
        const base64 = (reader.result as string).split(",")[1] ?? "";
        resolve(base64);
      };
      reader.onerror = reject;
      reader.readAsDataURL(file);
    } else {
      reader.onload = () => resolve(reader.result as string);
      reader.onerror = reject;
      reader.readAsText(file);
    }
  });
}

export interface PreviousRunContext {
  status: "completed" | "failed";
  output: string | null;
  error_message: string | null;
}

interface Props {
  appId: string;
  slug: string;
  form: FormState;
  attemptNumber: 1 | 2;
  onLive: () => void;
  onRebuild: (feedback: string, previousRun: PreviousRunContext | null) => void;
  onAbandon: () => void;
}

export function Step5Test({
  appId,
  slug,
  form,
  attemptNumber,
  onLive,
  onRebuild,
  onAbandon,
}: Props) {
  const [runId, setRunId] = useState<string | null>(null);
  const [inputText, setInputText] = useState("");
  const [inputUrl, setInputUrl] = useState("");
  const [slotFiles, setSlotFiles] = useState<(File | null)[]>(() =>
    form.input_config.file.enabled
      ? form.input_config.file.slots.map(() => null)
      : []
  );
  const [terminal, setTerminal] = useState<"completed" | "failed" | null>(null);
  const [output, setOutput] = useState<string | null>(null);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [thumbsDown, setThumbsDown] = useState(false);
  const [feedback, setFeedback] = useState("");
  const [showTooComplex, setShowTooComplex] = useState(false);
  const startedRef = useRef(false);

  const ic = form.input_config;
  const hasAnyInput = ic.text.enabled || ic.url.enabled || ic.file.enabled;
  const requiredSlotsSatisfied = ic.file.enabled
    ? ic.file.slots.every((s, i) => !s.required || !!slotFiles[i])
    : true;

  async function startRun() {
    if (startedRef.current) return;
    startedRef.current = true;

    const files: { label: string; content: string; filename: string }[] = [];
    if (ic.file.enabled) {
      for (let i = 0; i < ic.file.slots.length; i++) {
        const f = slotFiles[i];
        const slot = ic.file.slots[i];
        if (!f) {
          files.push({ label: slot.label, content: "", filename: "" });
          continue;
        }
        const content = await readFileAsText(f);
        files.push({ label: slot.label, content, filename: f.name });
      }
    }

    const res = await fetch("/api/internal/run", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        app_id: appId,
        run_type: "test",
        input_text: ic.text.enabled ? inputText || null : null,
        input_url: ic.url.enabled ? inputUrl || null : null,
        files: ic.file.enabled ? files : undefined,
      }),
    });
    const body = await res.json();
    if (res.ok) setRunId(body.run_id);
  }

  function handleSlotFileChange(
    idx: number,
    e: React.ChangeEvent<HTMLInputElement>
  ) {
    const f = e.target.files?.[0];
    if (!f) return;
    const ext = f.name.slice(f.name.lastIndexOf(".")).toLowerCase();
    if (!ACCEPTED_EXT_LIST.includes(ext)) {
      alert("Unsupported file type. Supported: .txt, .docx, .csv, .md");
      e.target.value = "";
      return;
    }
    setSlotFiles((prev) => {
      const next = [...prev];
      next[idx] = f;
      return next;
    });
  }

  useEffect(() => {
    if (terminal && runId) {
      // Fetch the run output once it terminates.
      (async () => {
        const res = await fetch(`/api/internal/run-status?app_id=${appId}&run_id=${runId}`);
        if (res.ok) {
          const data = await res.json();
          setOutput(data.output ?? null);
          setErrorMessage(data.error_message ?? null);
        }
      })();
    }
  }, [terminal, runId, appId]);

  // On the second attempt, a failed run leaves no more retries — skip the
  // feedback form entirely and show the too-complex modal.
  useEffect(() => {
    if (terminal === "failed" && attemptNumber === 2) {
      setShowTooComplex(true);
    }
  }, [terminal, attemptNumber]);

  async function thumbsUp() {
    if (!runId) return;
    await fetch("/api/internal/finalize", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        app_id: appId,
        run_id: runId,
        rating: "up",
      }),
    });
    onLive();
  }

  function handleNotQuite() {
    // On the second attempt, don't ask for feedback again — just explain
    // that we've hit the platform's complexity ceiling and clean up.
    if (attemptNumber === 2) {
      setShowTooComplex(true);
      return;
    }
    setThumbsDown(true);
  }

  async function submitThumbsDown() {
    if (!runId) return;
    await fetch("/api/internal/finalize", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        app_id: appId,
        run_id: runId,
        rating: "down",
        feedback,
      }),
    });
    const previousRun: PreviousRunContext | null = terminal
      ? { status: terminal, output, error_message: errorMessage }
      : null;
    onRebuild(feedback, previousRun);
  }

  async function acknowledgeTooComplex() {
    if (runId) {
      await fetch("/api/internal/finalize", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          app_id: appId,
          run_id: runId,
          rating: "down",
          feedback: "(second rejection — abandoned as too complex)",
        }),
      }).catch(() => undefined);
    }
    onAbandon();
  }

  if (!runId) {
    return (
      <div className="space-y-4">
        <div className="card p-4">
          <h3 className="font-semibold">{form.display_name}</h3>
          <p className="mt-1 text-sm text-[color:var(--color-muted-foreground)]">
            {form.description}
          </p>
          <p className="mt-2 text-xs font-mono text-[color:var(--color-muted-foreground)]">
            /agents/{slug}
          </p>
        </div>
        {ic.text.enabled && (
          <div>
            <label className="label">{ic.text.label || "Text input"}</label>
            {ic.text.size === "long" ? (
              <textarea
                className="input min-h-[100px]"
                placeholder="Provide a test input for this run…"
                value={inputText}
                onChange={(e) => setInputText(e.target.value)}
              />
            ) : (
              <input
                className="input"
                placeholder="Provide a test input for this run…"
                value={inputText}
                onChange={(e) => setInputText(e.target.value)}
              />
            )}
          </div>
        )}
        {ic.url.enabled && (
          <div>
            <label className="label">{ic.url.label || "URL"}</label>
            <input
              className="input"
              type="url"
              placeholder="https://"
              value={inputUrl}
              onChange={(e) => setInputUrl(e.target.value)}
            />
          </div>
        )}
        {ic.file.enabled &&
          ic.file.slots.map((slot, idx) => {
            const f = slotFiles[idx];
            const labelText = slot.label || `File ${idx + 1}`;
            return (
              <div key={idx}>
                <label className="label">
                  {labelText}
                  {slot.required ? (
                    <span className="ml-1 text-[#B3413A]">*</span>
                  ) : (
                    <span className="ml-1 text-[color:var(--color-muted-foreground)]">
                      (optional)
                    </span>
                  )}
                </label>
                <input
                  type="file"
                  accept={ACCEPTED_EXTENSIONS}
                  className="input"
                  onChange={(e) => handleSlotFileChange(idx, e)}
                />
                {f && (
                  <p className="mt-1 text-xs text-[color:var(--color-muted-foreground)]">
                    {f.name} — {(f.size / 1024).toFixed(1)} KB
                  </p>
                )}
              </div>
            );
          })}
        {ic.file.enabled && (
          <p className="mt-1 text-xs text-[color:var(--color-muted-foreground)]">
            Supported: .txt, .docx, .csv, .md
          </p>
        )}
        <div className="flex justify-end">
          <button
            type="button"
            className="btn-primary"
            onClick={startRun}
            disabled={!requiredSlotsSatisfied}
          >
            Run Test
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-4">
      <Waterfall
        appId={appId}
        runId={runId}
        onTerminal={(s) => setTerminal(s)}
        truncateNames
      />

      {terminal && (
        <div className="card p-4">
          <h4 className="text-sm font-semibold">
            {terminal === "completed" ? "Output" : "Error"}
          </h4>
          <div className="mt-2 max-h-64 overflow-auto">
            {terminal === "completed" && output == null ? (
              <p className="text-sm text-[color:var(--color-muted-foreground)]">
                (loading…)
              </p>
            ) : terminal === "completed" ? (
              (() => {
                const csv = parseCsvEnvelope(output);
                if (csv) {
                  return (
                    <CsvDownloadBlock
                      envelope={csv}
                      downloadHref={`/agents/${slug}/runs/${runId}/csv`}
                    />
                  );
                }
                if (isHtmlReport(output)) {
                  return (
                    <a
                      href={`/agents/${slug}/runs/${runId}/report`}
                      target="_blank"
                      rel="noopener"
                      className="inline-flex items-center gap-1 text-sm font-semibold text-[color:var(--color-primary)] hover:underline"
                    >
                      View Report →
                    </a>
                  );
                }
                return <MarkdownView content={output ?? ""} />;
              })()
            ) : (
              <pre className="whitespace-pre-wrap text-sm">
                {errorMessage ?? output ?? "(loading…)"}
              </pre>
            )}
          </div>
        </div>
      )}

      {terminal === "completed" && !thumbsDown && !showTooComplex && (
        <div className="space-y-3">
          <div className="text-sm font-medium">Did this work as expected?</div>
          <div className="flex gap-3">
            <button type="button" className="btn-primary" onClick={thumbsUp}>
              <ThumbsUp size={14} className="mr-1 inline" /> Yes, ship it
            </button>
            <button
              type="button"
              className="btn-secondary"
              onClick={handleNotQuite}
            >
              <ThumbsDown size={14} className="mr-1 inline" /> Not quite
            </button>
          </div>
        </div>
      )}

      {(terminal === "failed" || thumbsDown) && !showTooComplex && (
        <div className="space-y-3">
          <label className="label">What wasn&apos;t working?</label>
          <textarea
            className="input min-h-[80px]"
            maxLength={500}
            value={feedback}
            onChange={(e) => setFeedback(e.target.value)}
          />
          <div className="flex justify-end">
            <button
              type="button"
              className="btn-primary"
              onClick={submitThumbsDown}
            >
              Try rebuild
            </button>
          </div>
        </div>
      )}

      {showTooComplex && (
        <div
          role="dialog"
          aria-modal="true"
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4"
        >
          <div className="card max-w-md space-y-4 p-6">
            <h3 className="text-lg font-semibold">
              This may be too complex for the platform
            </h3>
            <p className="text-sm text-[color:var(--color-muted-foreground)]">
              We tried twice and couldn&apos;t land a version you liked. A
              report has been sent to Cody to review — Forge is still early,
              and your feedback helps figure out what to support next.
            </p>
            <p className="text-sm text-[color:var(--color-muted-foreground)]">
              This draft will be cleaned up and you&apos;ll return to the
              Forge homepage.
            </p>
            <div className="flex justify-end">
              <button
                type="button"
                className="btn-primary"
                onClick={acknowledgeTooComplex}
              >
                Got it
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
