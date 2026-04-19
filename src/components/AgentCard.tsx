import Link from "next/link";
import { Calendar, Mail } from "lucide-react";
import type { AgentRecord } from "@/lib/obs";
import { relativeTime, truncate } from "@/lib/format";
import { StatusBadge } from "./StatusBadge";

export function AgentCard({ agent }: { agent: AgentRecord }) {
  const slug = agent.apps?.slug ?? "";
  const display = agent.apps?.display_name ?? slug;
  const isPulsing =
    agent.status === "building" || agent.status === "awaiting_test";
  const lastRun = agent.last_run_at;
  const lastRunStrip = lastRun
    ? agent.can_send_email
      ? `Delivered • ${relativeTime(lastRun)}`
      : `Completed • ${relativeTime(lastRun)}`
    : null;

  return (
    <Link
      href={`/agents/${slug}`}
      className={`card animate-fadein block p-5 transition-all duration-200 hover:bg-[#C2D6C9] hover:shadow-[inset_0_2px_6px_rgba(0,0,0,0.08)] ${
        isPulsing ? "animate-pulse-bar" : ""
      }`}
    >
      <div className="flex items-start justify-between gap-3">
        <h3 className="text-sm font-semibold leading-snug">{display}</h3>
        <StatusBadge status={agent.status} />
      </div>
      <p className="mt-2 text-sm leading-relaxed text-[color:var(--color-muted-foreground)]">
        {truncate(agent.description, 110)}
      </p>
      <div className="mt-3 flex flex-wrap items-center gap-2 text-xs text-[color:var(--color-muted-foreground)]">
        {agent.schedule_cadence && (
          <span className="inline-flex items-center gap-1">
            <Calendar size={12} /> {agent.schedule_cadence}
          </span>
        )}
        {agent.can_send_email && (
          <span className="inline-flex items-center gap-1">
            <Mail size={12} /> email
          </span>
        )}
      </div>
      {lastRunStrip && !isPulsing && (
        <div className="mt-1 border-t border-[color:var(--color-border)]/60 pt-3 text-xs text-[color:var(--color-muted-foreground)]">
          {lastRunStrip}
        </div>
      )}
    </Link>
  );
}
