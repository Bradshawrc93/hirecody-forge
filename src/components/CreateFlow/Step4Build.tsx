"use client";

import { useEffect, useState } from "react";
import type { FormState } from "./types";

interface Props {
  form: FormState;
  onSuccess: (result: { app_id: string; slug: string }) => void;
  onRetry: () => void;
}

const STATUS_MESSAGES = [
  "Analyzing your request...",
  "Designing agent steps...",
  "Generating configuration...",
  "Wiring up telemetry...",
];

export function Step4Build({ form, onSuccess, onRetry }: Props) {
  const [statusIdx, setStatusIdx] = useState(0);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const t = setInterval(() => {
      setStatusIdx((i) => (i + 1) % STATUS_MESSAGES.length);
    }, 1400);
    return () => clearInterval(t);
  }, []);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const res = await fetch("/api/internal/build-agent", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify(form),
        });
        const body = await res.json();
        if (cancelled) return;
        if (!res.ok) {
          setError(
            body.details || body.error || "The builder hit an error."
          );
          return;
        }
        onSuccess({ app_id: body.app_id, slug: body.slug });
      } catch (e) {
        if (!cancelled) setError(String(e));
      }
    })();
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  if (error) {
    return (
      <div className="space-y-4 text-center">
        <div className="text-2xl">😬</div>
        <h3 className="text-lg font-semibold">The build hit an error</h3>
        <p className="text-sm text-[color:var(--color-muted-foreground)]">{error}</p>
        <button type="button" className="btn-primary" onClick={onRetry}>
          Try again
        </button>
      </div>
    );
  }

  return (
    <div className="space-y-6 py-8 text-center">
      <div className="mx-auto h-2 w-48 overflow-hidden rounded-full bg-[color:var(--color-card)]">
        <div className="h-full w-1/3 animate-pulse-bar bg-[#C56A2D]" />
      </div>
      <p className="text-base font-medium animate-fadein" key={statusIdx}>
        {STATUS_MESSAGES[statusIdx]}
      </p>
      <p className="text-xs text-[color:var(--color-muted-foreground)]">
        Sonnet 4.6 is generating your agent. This usually takes 10–20 seconds.
      </p>
    </div>
  );
}
