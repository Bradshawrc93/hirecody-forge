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
      className={`card block p-5 transition-all hover:-translate-y-0.5 hover:shadow-md animate-fadein ${
        isPulsing ? "animate-pulse-bar" : ""
      }`}
    >
      <div className="flex items-start justify-between gap-3">
        <h3 className="text-lg font-semibold leading-tight">{display}</h3>
        <StatusBadge status={agent.status} />
      </div>
      <p className="mt-2 text-sm text-[color:var(--color-muted-foreground)]">
        {truncate(agent.description, 110)}
      </p>
      <div className="mt-3 flex flex-wrap items-center gap-2 text-xs text-[color:var(--color-muted-foreground)]">
        {agent.creator_type === "owner" && (
          <span className="rounded-full bg-[#C56A2D] px-2 py-0.5 font-semibold text-white">
            Built by Cody
          </span>
        )}
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
        <div className="mt-4 border-t border-[color:var(--color-border)] pt-3 text-xs text-[color:var(--color-muted-foreground)]">
          {lastRunStrip}
        </div>
      )}
    </Link>
  );
}
