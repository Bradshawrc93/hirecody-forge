"use client";

import { useEffect, useRef, useState } from "react";
import type { FormState } from "./types";
import type { PreviousRunContext } from "./Step5Test";

interface Props {
  form: FormState;
  userFeedback?: string | null;
  previousRun?: PreviousRunContext | null;
  onSuccess: (result: { app_id: string; slug: string }) => void;
  onRetry: () => void;
  onBuildStarted?: (
    promise: Promise<{ app_id: string; slug: string } | null>
  ) => void;
  // When rebuilding an existing agent in place, set mode="rebuild" and
  // pass the existing appId. The component will hit the rebuild endpoint
  // instead of creating a new agent.
  mode?: "initial" | "rebuild";
  appId?: string | null;
}

// Turn anything the build endpoint might return into a displayable string.
// Obs 4xx responses occasionally include a ZodError flatten blob
// ({ formErrors, fieldErrors }) under `details`, which crashes React if
// rendered as a child.
function formatBuildError(body: unknown): string {
  if (!body || typeof body !== "object") return "The builder hit an error.";
  const b = body as Record<string, unknown>;
  const detail = b.details;
  if (typeof detail === "string" && detail.trim()) return detail;
  if (detail && typeof detail === "object") {
    const d = detail as { formErrors?: unknown; fieldErrors?: unknown };
    const pieces: string[] = [];
    if (Array.isArray(d.formErrors)) {
      for (const m of d.formErrors) {
        if (typeof m === "string") pieces.push(m);
      }
    }
    if (d.fieldErrors && typeof d.fieldErrors === "object") {
      for (const [field, msgs] of Object.entries(
        d.fieldErrors as Record<string, unknown>
      )) {
        if (Array.isArray(msgs)) {
          for (const m of msgs) {
            if (typeof m === "string") pieces.push(`${field}: ${m}`);
          }
        }
      }
    }
    if (pieces.length) return pieces.join(" • ");
    try {
      return JSON.stringify(detail);
    } catch {
      /* fall through */
    }
  }
  if (typeof b.error === "string" && b.error.trim()) return b.error;
  return "The builder hit an error.";
}

const PULSE_PHRASES = [
  "Good things come to those who wait…",
  "Measuring twice, cutting once…",
  "Teaching the robot some manners…",
  "Brewing something good…",
  "Almost there — hang tight…",
  "Turning vibes into JSON…",
];

export function Step4Build({
  form,
  userFeedback,
  previousRun,
  onSuccess,
  onRetry,
  onBuildStarted,
  mode = "initial",
  appId,
}: Props) {
  const [phraseIdx, setPhraseIdx] = useState(0);
  const [elapsed, setElapsed] = useState(0);
  const [error, setError] = useState<string | null>(null);
  const startedRef = useRef(false);

  useEffect(() => {
    const t = setInterval(() => {
      setPhraseIdx((i) => (i + 1) % PULSE_PHRASES.length);
    }, 2800);
    return () => clearInterval(t);
  }, []);

  useEffect(() => {
    const startedAt = Date.now();
    const t = setInterval(() => {
      setElapsed(Math.floor((Date.now() - startedAt) / 1000));
    }, 1000);
    return () => clearInterval(t);
  }, []);

  useEffect(() => {
    if (startedRef.current) return;
    startedRef.current = true;
    // Note: we intentionally do NOT gate onSuccess / setError on a
    // closure-captured `cancelled` flag. React 18 Strict Mode runs the
    // cleanup between the two dev-mode effect invocations, which would
    // stick `cancelled = true` even though the component is still mounted,
    // hanging the spinner forever when the fetch eventually resolves.
    // Real cancellation is handled by the parent via the onBuildStarted
    // promise ref — it awaits the in-flight build and deletes any orphan.
    const promise = (async () => {
      try {
        const endpoint =
          mode === "rebuild"
            ? "/api/internal/rebuild-agent"
            : "/api/internal/build-agent";
        const payload =
          mode === "rebuild"
            ? {
                app_id: appId,
                user_feedback: userFeedback ?? "",
                previous_run: previousRun ?? null,
              }
            : { ...form, user_feedback: userFeedback ?? null };
        const res = await fetch(endpoint, {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify(payload),
        });
        const body = await res.json();
        if (!res.ok) {
          setError(formatBuildError(body));
          return null;
        }
        const result = { app_id: body.app_id, slug: body.slug };
        onSuccess(result);
        return result;
      } catch (e) {
        setError(String(e));
        return null;
      }
    })();
    onBuildStarted?.(promise);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  if (error) {
    return (
      <div className="space-y-4 text-center">
        <h3 className="text-lg font-semibold">The build hit an error</h3>
        <p className="text-sm text-[color:var(--color-muted-foreground)]">{error}</p>
        <button type="button" className="btn-primary" onClick={onRetry}>
          Try again
        </button>
      </div>
    );
  }

  const slow = elapsed >= 45;
  const veryLong = elapsed >= 120;

  return (
    <div className="space-y-6 py-12 text-center">
      <p
        key={phraseIdx}
        className="text-base font-medium animate-pulse-text"
      >
        {PULSE_PHRASES[phraseIdx]}
      </p>
      <p className="text-xs text-[color:var(--color-muted-foreground)]">
        This usually takes 10–20 seconds, but may take up to a couple minutes.
      </p>
      <p className="font-mono text-xs text-[color:var(--color-muted-foreground)]">
        still working · {elapsed}s elapsed
      </p>
      {slow && !veryLong && (
        <p className="text-xs text-[#C56A2D]">
          Taking longer than usual — still connected, hang tight.
        </p>
      )}
      {veryLong && (
        <p className="text-xs text-[#B3413A]">
          Over 2 minutes. The builder may be hung — you can cancel and retry.
        </p>
      )}
    </div>
  );
}
