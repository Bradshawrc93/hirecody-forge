"use client";

import { useEffect, useRef, useState } from "react";
import { ThumbsDown, ThumbsUp } from "lucide-react";
import { Waterfall } from "@/components/Waterfall";
import type { FormState } from "./types";

interface Props {
  appId: string;
  slug: string;
  form: FormState;
  onLive: () => void;
  onRebuild: (feedback: string) => void;
  onAbandon: () => void;
}

export function Step5Test({ appId, slug, form, onLive, onRebuild, onAbandon }: Props) {
  const [runId, setRunId] = useState<string | null>(null);
  const [inputText, setInputText] = useState("");
  const [terminal, setTerminal] = useState<"completed" | "failed" | null>(null);
  const [output, setOutput] = useState<string | null>(null);
  const [thumbsDown, setThumbsDown] = useState(false);
  const [feedback, setFeedback] = useState("");
  const [secondTry, setSecondTry] = useState(false);
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
    if (secondTry) {
      onAbandon();
    } else {
      setSecondTry(true);
      onRebuild(feedback);
    }
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
          <pre className="mt-2 max-h-64 overflow-auto whitespace-pre-wrap text-sm">
            {output ?? "(loading…)"}
          </pre>
        </div>
      )}

      {terminal === "completed" && !thumbsDown && (
        <div className="space-y-3">
          <div className="text-sm font-medium">Did this work as expected?</div>
          <div className="flex gap-3">
            <button type="button" className="btn-primary" onClick={thumbsUp}>
              <ThumbsUp size={14} className="mr-1 inline" /> Yes, ship it
            </button>
            <button
              type="button"
              className="btn-secondary"
              onClick={() => setThumbsDown(true)}
            >
              <ThumbsDown size={14} className="mr-1 inline" /> Not quite
            </button>
          </div>
        </div>
      )}

      {(terminal === "failed" || thumbsDown) && (
        <div className="space-y-3">
          <label className="label">
            {secondTry
              ? "Thanks for trying this out. If you'd like a follow-up, leave your email below (optional)."
              : "What wasn't working?"}
          </label>
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
              {secondTry ? "Done" : "Try rebuild"}
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
