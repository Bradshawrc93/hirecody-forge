"use client";

import { useEffect, useRef, useState } from "react";
import { ThumbsDown, ThumbsUp } from "lucide-react";
import { Waterfall } from "@/components/Waterfall";
import { MarkdownView } from "@/components/MarkdownView";
import type { FormState } from "./types";

interface Props {
  appId: string;
  slug: string;
  form: FormState;
  attemptNumber: 1 | 2;
  onLive: () => void;
  onRebuild: (feedback: string) => void;
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
  const [terminal, setTerminal] = useState<"completed" | "failed" | null>(null);
  const [output, setOutput] = useState<string | null>(null);
  const [thumbsDown, setThumbsDown] = useState(false);
  const [feedback, setFeedback] = useState("");
  const [showTooComplex, setShowTooComplex] = useState(false);
  const startedRef = useRef(false);

  const needsInput = form.input_type === "text" || form.input_type === "both";

  async function startRun() {
    if (startedRef.current) return;
    startedRef.current = true;
    const res = await fetch("/api/internal/run", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        app_id: appId,
        run_type: "test",
        input_text: needsInput ? inputText : null,
      }),
    });
    const body = await res.json();
    if (res.ok) setRunId(body.run_id);
  }

  useEffect(() => {
    if (terminal && runId) {
      // Fetch the run output once it terminates.
      (async () => {
        const res = await fetch(`/api/internal/run-status?app_id=${appId}&run_id=${runId}`);
        if (res.ok) {
          const data = await res.json();
          setOutput(data.output ?? data.error_message ?? "");
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
    onRebuild(feedback);
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
        {needsInput && (
          <div>
            <label className="label">Test input</label>
            <textarea
              className="input min-h-[80px]"
              placeholder="Provide a test input for this run…"
              value={inputText}
              onChange={(e) => setInputText(e.target.value)}
            />
          </div>
        )}
        <div className="flex justify-end">
          <button type="button" className="btn-primary" onClick={startRun}>
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
      />

      {terminal && (
        <div className="card p-4">
          <h4 className="text-sm font-semibold">
            {terminal === "completed" ? "Output" : "Error"}
          </h4>
          <div className="mt-2 max-h-64 overflow-auto">
            {output == null ? (
              <p className="text-sm text-[color:var(--color-muted-foreground)]">
                (loading…)
              </p>
            ) : terminal === "completed" ? (
              <MarkdownView content={output} />
            ) : (
              <pre className="whitespace-pre-wrap text-sm">{output}</pre>
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
