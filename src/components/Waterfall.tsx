"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import type { RunStep, RunStatus } from "@/lib/obs";
import { formatDuration } from "@/lib/format";

interface Props {
  appId: string;
  runId: string;
  onTerminal?: (status: "completed" | "failed") => void;
  truncateNames?: boolean;
}

export function Waterfall({ appId, runId, onTerminal, truncateNames = false }: Props) {
  const [steps, setSteps] = useState<RunStep[]>([]);
  const [status, setStatus] = useState<RunStatus>("queued");
  const [selectedName, setSelectedName] = useState<string | null>(null);
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

  const grouped = useMemo(() => groupSteps(steps), [steps]);
  const selected = grouped.find((g) => g.name === selectedName) ?? null;

  return (
    <div className="grid grid-cols-1 gap-4 md:grid-cols-[1fr_320px]">
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
                : "border-[color:var(--color-primary)]";
            return (
              <li
                key={g.name + g.startSeq}
                className={`animate-fadein cursor-pointer rounded-md border-l-4 bg-[color:var(--color-background)] px-3 py-2 ${stateColor} ${
                  selectedName === g.name ? "ring-2 ring-[color:var(--color-primary)]" : ""
                }`}
                onClick={() => setSelectedName(g.name)}
              >
                <div className="flex items-center justify-between text-sm">
                  <span className="font-semibold" title={g.name}>
                    {truncateNames && g.name.length > 18
                      ? g.name.slice(0, 18) + "…"
                      : g.name}
                  </span>
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

      <aside className="card max-h-[60vh] overflow-auto p-4 text-sm">
        {selected ? (
          <StepDetail group={selected} />
        ) : (
          <p className="text-xs text-[color:var(--color-muted-foreground)]">
            Click a step to see details.
          </p>
        )}
      </aside>
    </div>
  );
}

function StepDetail({ group }: { group: GroupedStep }) {
  const completeMeta = (group.completeEvent?.metadata ?? {}) as Record<
    string,
    unknown
  >;
  const startMeta = (group.startEvent.metadata ?? {}) as Record<string, unknown>;
  const meta = { ...startMeta, ...completeMeta };
  const service = group.service;
  const stateLabel =
    group.state === "complete"
      ? "completed"
      : group.state === "fail"
      ? "failed"
      : "running";

  return (
    <div className="space-y-3">
      <div>
        <div className="font-semibold">{group.name}</div>
        <div className="text-xs text-[color:var(--color-muted-foreground)]">
          {service} • {stateLabel}
          {group.duration != null && <> • {formatDuration(group.duration)}</>}
        </div>
      </div>

      {service === "llm" && (
        <>
          {typeof meta.model === "string" && (
            <DetailRow label="Model" value={meta.model} mono />
          )}
          {typeof meta.prompt_preview === "string" && (
            <DetailBlock label="Prompt" text={meta.prompt_preview} />
          )}
          {typeof meta.output_preview === "string" && (
            <DetailBlock label="Output" text={meta.output_preview} />
          )}
        </>
      )}

      {service === "web_fetch" && (
        <>
          {typeof meta.url === "string" && (
            <DetailRow label="URL" value={meta.url} mono wrap />
          )}
          {typeof meta.output_chars === "number" && (
            <DetailRow label="Bytes" value={String(meta.output_chars)} />
          )}
          {typeof meta.output_preview === "string" && (
            <DetailBlock label="Response" text={meta.output_preview} />
          )}
        </>
      )}

      {service === "web_search" && (
        <>
          {typeof meta.query === "string" && (
            <DetailRow label="Query" value={meta.query} wrap />
          )}
          {typeof meta.max_results === "number" && (
            <DetailRow label="Results" value={String(meta.max_results)} />
          )}
          {typeof meta.output_preview === "string" && (
            <DetailBlock label="Results" text={meta.output_preview} />
          )}
        </>
      )}

      {service === "email" && (
        <>
          {meta.to != null && (
            <DetailRow label="To" value={String(meta.to)} mono />
          )}
          {typeof meta.subject_preview === "string" && (
            <DetailRow label="Subject" value={meta.subject_preview} />
          )}
          {typeof meta.output_preview === "string" && (
            <DetailBlock label="Body" text={meta.output_preview} />
          )}
        </>
      )}

      {(service === "output" || service === "file_read") && (
        <>
          {typeof meta.output_preview === "string" && (
            <DetailBlock label="Output" text={meta.output_preview} />
          )}
          {typeof meta.template_preview === "string" &&
            !meta.output_preview && (
              <DetailBlock label="Template" text={meta.template_preview} />
            )}
        </>
      )}

      {group.state === "fail" && typeof meta.error === "string" && (
        <DetailBlock label="Error" text={meta.error} tone="error" />
      )}

      {group.completeEvent?.event_ref && (
        <a
          href={`https://obs.hirecody.dev/events/${group.completeEvent.event_ref}`}
          target="_blank"
          rel="noreferrer"
          className="inline-block text-xs font-semibold text-[color:var(--color-primary)] hover:underline"
        >
          View on Obs →
        </a>
      )}
    </div>
  );
}

function DetailRow({
  label,
  value,
  mono,
  wrap,
}: {
  label: string;
  value: string;
  mono?: boolean;
  wrap?: boolean;
}) {
  return (
    <div className="text-xs">
      <div className="font-semibold text-[color:var(--color-muted-foreground)]">
        {label}
      </div>
      <div
        className={`${mono ? "font-mono" : ""} ${wrap ? "break-all" : "truncate"}`}
      >
        {value}
      </div>
    </div>
  );
}

function DetailBlock({
  label,
  text,
  tone,
}: {
  label: string;
  text: string;
  tone?: "error";
}) {
  return (
    <div>
      <div className="text-xs font-semibold text-[color:var(--color-muted-foreground)]">
        {label}
      </div>
      <pre
        className={`mt-1 max-h-48 overflow-auto whitespace-pre-wrap rounded p-2 font-mono text-[11px] ${
          tone === "error"
            ? "bg-[#F4D6D2] text-[#7A1F1A]"
            : "bg-[color:var(--color-card)]"
        }`}
      >
        {text}
      </pre>
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
