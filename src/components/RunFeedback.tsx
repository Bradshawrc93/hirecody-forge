"use client";

import { useState } from "react";
import { ThumbsUp, ThumbsDown } from "lucide-react";

interface Props {
  appId: string;
  runId: string;
  initialVote: "up" | "down" | null;
}

export function RunFeedback({ appId, runId, initialVote }: Props) {
  const [vote, setVote] = useState<"up" | "down" | null>(initialVote);
  const [busy, setBusy] = useState(false);

  async function submit(e: React.MouseEvent, next: "up" | "down") {
    e.preventDefault();
    e.stopPropagation();
    if (vote || busy) return;
    setBusy(true);
    setVote(next);
    const res = await fetch("/api/internal/feedback", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ app_id: appId, run_id: runId, vote: next }),
    });
    if (!res.ok) setVote(initialVote);
    setBusy(false);
  }

  const baseBtn =
    "inline-flex h-7 w-7 items-center justify-center rounded-md transition-colors duration-150";

  if (vote) {
    const Icon = vote === "up" ? ThumbsUp : ThumbsDown;
    return (
      <span
        className={`${baseBtn} text-[color:var(--color-primary)]`}
        aria-label={vote === "up" ? "Voted up" : "Voted down"}
      >
        <Icon size={14} fill="currentColor" />
      </span>
    );
  }

  return (
    <span className="inline-flex items-center gap-1">
      <button
        type="button"
        onClick={(e) => submit(e, "up")}
        disabled={busy}
        aria-label="Thumbs up"
        className={`${baseBtn} text-[color:var(--color-muted-foreground)] hover:bg-[color:var(--color-border)]/40 hover:text-[color:var(--color-primary)]`}
      >
        <ThumbsUp size={14} />
      </button>
      <button
        type="button"
        onClick={(e) => submit(e, "down")}
        disabled={busy}
        aria-label="Thumbs down"
        className={`${baseBtn} text-[color:var(--color-muted-foreground)] hover:bg-[color:var(--color-border)]/40 hover:text-[color:var(--color-primary)]`}
      >
        <ThumbsDown size={14} />
      </button>
    </span>
  );
}
