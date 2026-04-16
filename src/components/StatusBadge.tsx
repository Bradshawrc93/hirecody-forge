import type { AgentStatus, RunStatus } from "@/lib/obs";

const AGENT_STYLES: Record<AgentStatus, { label: string; bg: string; fg: string }> = {
  building: { label: "Building", bg: "#FCE9D5", fg: "#7A3F12" },
  build_failed: { label: "Build failed", bg: "#F4D6D2", fg: "#7A1F1A" },
  awaiting_test: { label: "Awaiting test", bg: "#F4E7C8", fg: "#6B4F11" },
  test_failed: { label: "Test failed", bg: "#F4D6D2", fg: "#7A1F1A" },
  active: { label: "Active", bg: "#D9EBD7", fg: "#27592A" },
  paused: { label: "Paused", bg: "#E5DDD0", fg: "#5A5042" },
  expired: { label: "Expired", bg: "#E5DDD0", fg: "#6B6B6B" },
  deleted: { label: "Deleted", bg: "#E5DDD0", fg: "#6B6B6B" },
};

const RUN_STYLES: Record<RunStatus, { label: string; bg: string; fg: string }> = {
  queued: { label: "Queued", bg: "#F4E7C8", fg: "#6B4F11" },
  running: { label: "Running", bg: "#FCE9D5", fg: "#7A3F12" },
  completed: { label: "Completed", bg: "#D9EBD7", fg: "#27592A" },
  failed: { label: "Failed", bg: "#F4D6D2", fg: "#7A1F1A" },
};

export function StatusBadge({ status }: { status: AgentStatus }) {
  const s = AGENT_STYLES[status];
  return (
    <span
      className="inline-flex shrink-0 items-center whitespace-nowrap rounded-full px-2 py-0.5 text-xs font-semibold"
      style={{ backgroundColor: s.bg, color: s.fg }}
    >
      {s.label}
    </span>
  );
}

export function RunStatusBadge({ status }: { status: RunStatus }) {
  const s = RUN_STYLES[status];
  return (
    <span
      className="inline-flex shrink-0 items-center whitespace-nowrap rounded-full px-2 py-0.5 text-xs font-semibold"
      style={{ backgroundColor: s.bg, color: s.fg }}
    >
      {s.label}
    </span>
  );
}
