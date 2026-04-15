"use client";

import { useEffect, useRef, useState } from "react";
import type { RunStep, RunStatus } from "@/lib/obs";
import { formatDuration } from "@/lib/format";

interface Props {
  appId: string;
  runId: string;
  onTerminal?: (status: "completed" | "failed") => void;
}

export function Waterfall({ appId, runId, onTerminal }: Props) {
  const [steps, setSteps] = useState<RunStep[]>([]);
  const [status, setStatus] = useState<RunStatus>("queued");
  const [selected, setSelected] = useState<RunStep | null>(null);
  const sinceRef = useRef(0);
  const stoppedRef = useRef(false);

  useEffect(() => {
    stoppedRef.current = false;
    let timer: ReturnType<typeof setTimeout> | null = null;

    async function tick() {
      if (stoppedRef.current) return;
      try {
        const res = await fetch(
          `/api/internal/steps?app_id=${appId}&run_id=${runId}&since=${sinceRef.current}`,
          { cache: "no-store" }
        );
        if (res.ok) {
          const data = (await res.json()) as {
            run_status: RunStatus;
            steps: RunStep[];
            last_seq: number;
          };
          if (data.steps.length > 0) {
            setSteps((prev) => [...prev, ...data.steps]);
            sinceRef.current = data.last_seq;
          }
          setStatus(data.run_status);
          if (data.run_status === "completed" || data.run_status === "failed") {
            stoppedRef.current = true;
            onTerminal?.(data.run_status);
            return;
          }
        }
      } catch {
        // swallow — we'll retry next tick
      }
      timer = setTimeout(tick, 750);
    }
    tick();
    return () => {
      stoppedRef.current = true;
      if (timer) clearTimeout(timer);
    };
  }, [appId, runId, onTerminal]);

  const grouped = groupSteps(steps);

  return (
    <div className="grid grid-cols-1 gap-4 md:grid-cols-[1fr_280px]">
      <div className="card max-h-[60vh] overflow-y-auto p-4">
        <div className="mb-3 flex items-center justify-between text-xs">
          <span className="font-mono text-[color:var(--color-muted-foreground)]">
            run {runId.slice(0, 8)}…
          </span>
          <span className="font-semibold capitalize">{status}</span>
        </div>
        {grouped.length === 0 && (
          <p className="text-sm text-[color:var(--color-muted-foreground)]">
            Waiting for first step…
          </p>
        )}
        <ol className="space-y-2">
          {grouped.map((g) => {
            const stateColor =
              g.state === "fail"
                ? "border-[#B3413A]"
                : g.state === "complete"
                ? "border-[#4F8A4F]"
                : "border-[#C56A2D]";
            return (
              <li
                key={g.name + g.startSeq}
                className={`animate-fadein cursor-pointer rounded-md border-l-4 bg-[color:var(--color-background)] px-3 py-2 ${stateColor} ${
                  selected?.id === g.startEvent.id ? "ring-2 ring-[#C56A2D]" : ""
                }`}
                onClick={() => setSelected(g.completeEvent ?? g.startEvent)}
              >
                <div className="flex items-center justify-between text-sm">
                  <span className="font-semibold">{g.name}</span>
                  <span className="font-mono text-xs text-[color:var(--color-muted-foreground)]">
                    {g.duration != null ? formatDuration(g.duration) : "…"}
                  </span>
                </div>
                <div className="text-xs text-[color:var(--color-muted-foreground)]">
                  {g.service}
                </div>
              </li>
            );
          })}
        </ol>
      </div>

      <aside className="card p-4 text-sm">
        {selected ? (
          <div className="space-y-2">
            <div className="font-semibold">{selected.step_name}</div>
            <div className="text-xs text-[color:var(--color-muted-foreground)]">
              {selected.service} • {selected.event_type}
            </div>
            {selected.duration_ms != null && (
              <div className="text-xs">
                Duration: {formatDuration(selected.duration_ms)}
              </div>
            )}
            {selected.event_ref && (
              <a
                href={`https://obs.hirecody.dev/events/${selected.event_ref}`}
                target="_blank"
                rel="noreferrer"
                className="inline-block text-xs font-semibold text-[color:var(--color-primary)] hover:underline"
              >
                View on Obs →
              </a>
            )}
            {selected.metadata && (
              <pre className="mt-2 max-h-48 overflow-auto rounded bg-[color:var(--color-card)] p-2 text-[10px]">
                {JSON.stringify(selected.metadata, null, 2)}
              </pre>
            )}
          </div>
        ) : (
          <p className="text-xs text-[color:var(--color-muted-foreground)]">
            Click a step to see details.
          </p>
        )}
      </aside>
    </div>
  );
}

interface GroupedStep {
  name: string;
  service: string;
  state: "start" | "complete" | "fail";
  duration: number | null;
  startSeq: number;
  startEvent: RunStep;
  completeEvent: RunStep | null;
}

function groupSteps(steps: RunStep[]): GroupedStep[] {
  const out: GroupedStep[] = [];
  const open: Record<string, GroupedStep> = {};
  for (const s of steps) {
    if (s.event_type === "start") {
      const g: GroupedStep = {
        name: s.step_name,
        service: s.service,
        state: "start",
        duration: null,
        startSeq: s.seq,
        startEvent: s,
        completeEvent: null,
      };
      open[s.step_name] = g;
      out.push(g);
    } else {
      const g = open[s.step_name];
      if (g) {
        g.state = s.event_type;
        g.duration = s.duration_ms ?? null;
        g.completeEvent = s;
        delete open[s.step_name];
      } else {
        out.push({
          name: s.step_name,
          service: s.service,
          state: s.event_type,
          duration: s.duration_ms ?? null,
          startSeq: s.seq,
          startEvent: s,
          completeEvent: s,
        });
      }
    }
  }
  return out;
}
