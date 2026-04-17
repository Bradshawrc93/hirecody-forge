import Link from "next/link";
import { notFound } from "next/navigation";
import { AgentActions } from "@/components/AgentActions";
import { StatusBadge, RunStatusBadge } from "@/components/StatusBadge";
import { findAgentBySlug } from "@/lib/agent-lookup";
import { getAgent, listAgentRuns } from "@/lib/obs";
import { getAgentKey } from "@/lib/kv";
import { formatDuration, relativeTime, formatCost, formatScheduleTimeCT } from "@/lib/format";
import { legacyInputTypeToConfig, normalizeInputConfig } from "@/components/CreateFlow/types";
import { isAgentPlan } from "@/lib/agent-plan";

export const dynamic = "force-dynamic";
export const revalidate = 0;

export default async function AgentDetailPage({
  params,
}: {
  params: Promise<{ slug: string }>;
}) {
  const { slug } = await params;
  const lean = await findAgentBySlug(slug);
  if (!lean) notFound();

  const apiKey = await getAgentKey(lean.app_id);
  if (!apiKey) {
    // Agent exists in Obs but Forge has no key for it (e.g., owner agent
    // seeded directly). Render a read-only view.
    return (
      <main className="relative min-h-screen">
        <div className="mx-auto max-w-5xl px-6 pt-20 pb-16">
          <h1 className="text-3xl font-semibold leading-tight tracking-tight md:text-4xl">
            {lean.apps?.display_name}
          </h1>
          <p className="mt-3 text-sm leading-relaxed text-[color:var(--color-muted-foreground)]">
            {lean.description}
          </p>
          <p className="mt-6 text-xs leading-relaxed text-[color:var(--color-muted-foreground)]">
            This agent is read-only — no api key in Forge KV.
          </p>
        </div>
      </main>
    );
  }

  const [{ app, agent }, runsResp] = await Promise.all([
    getAgent(lean.app_id, apiKey),
    listAgentRuns(lean.app_id, apiKey, { limit: 20 }).catch(() => ({ runs: [] })),
  ]);
  const runs = runsResp.runs;
  const latest = runs[0];

  // Prefer the InputConfig embedded in the plan (includes slot labels).
  // Fall back to the legacy input_type mapping for older agents.
  const planInputConfig = isAgentPlan(agent.config)
    ? agent.config.input_config
    : undefined;
  const inputConfig = planInputConfig
    ? normalizeInputConfig(planInputConfig)
    : legacyInputTypeToConfig(agent.input_type ?? "none");

  // Prefer the plan's embedded output_type over Obs's stored value —
  // Obs only knows the original enum, so csv/html_report agents would
  // otherwise clone as "file" / "text".
  const planOutputType = isAgentPlan(agent.config)
    ? agent.config.output_type
    : undefined;
  const resolvedOutputType = planOutputType ?? agent.output_type;

  return (
    <main className="relative min-h-screen">
      <div className="mx-auto max-w-5xl px-6 pt-20 pb-16">
        <Link
          href="/"
          className="inline-flex items-center gap-2 text-xs font-medium uppercase tracking-[0.2em] text-[color:var(--color-muted-foreground)] transition-colors duration-200 hover:text-[color:var(--color-primary)]"
        >
          ← Back to Forge
        </Link>
        <header className="mt-4 border-b border-[color:var(--color-border)] pb-8">
          <div className="flex flex-wrap items-start justify-between gap-4">
            <div>
              <div className="mb-3 flex items-center gap-3">
                <span className="h-px w-8 bg-[color:var(--color-primary)]" />
                <span className="text-sm font-medium uppercase tracking-wide text-[color:var(--color-primary)]">
                  Agent
                </span>
              </div>
              <h1 className="text-3xl font-semibold leading-tight tracking-tight md:text-4xl">
                {app.display_name}
              </h1>
              <p className="mt-3 max-w-2xl text-sm leading-relaxed text-[color:var(--color-muted-foreground)]">
                {agent.description}
              </p>
              <div className="mt-3 flex flex-wrap items-center gap-2 text-xs">
                <StatusBadge status={agent.status} />
                {agent.schedule_cadence && (
                  <span className="text-[color:var(--color-muted-foreground)]">
                    {agent.schedule_cadence} @ {formatScheduleTimeCT(agent.schedule_time)}
                  </span>
                )}
              </div>
            </div>
            <AgentActions
              appId={app.id}
              slug={app.slug}
              agentName={app.display_name}
              status={agent.status}
              inputConfig={inputConfig}
              formSnapshot={{
                display_name: app.display_name,
                description: agent.description,
                model: agent.model,
                input_config: inputConfig,
                output_type: resolvedOutputType,
                success_criteria: agent.success_criteria,
                context_text: agent.context_text,
                can_send_email: agent.can_send_email,
                has_web_access: agent.has_web_access,
                schedule_cadence: agent.schedule_cadence,
                schedule_time: agent.schedule_time,
                schedule_day_of_week: agent.schedule_day_of_week,
                schedule_day_of_month: agent.schedule_day_of_month,
              }}
            />
          </div>
        </header>

        <div className="mt-10 grid grid-cols-1 gap-10 md:grid-cols-[1fr_240px]">
          <div className="space-y-10">
            <section>
              <h2 className="mb-3 text-sm font-semibold uppercase tracking-wide">
                Latest Run
              </h2>
              {latest ? (
                <Link
                  href={`/agents/${slug}/runs/${latest.id}`}
                  className="card block p-5 transition-all duration-200 hover:bg-[#E4D8C5] hover:shadow-[inset_0_2px_6px_rgba(0,0,0,0.08)]"
                >
                  <div className="flex items-center justify-between">
                    <RunStatusBadge status={latest.status} />
                    <span className="text-xs text-[color:var(--color-muted-foreground)]">
                      {relativeTime(latest.created_at)}
                    </span>
                  </div>
                  <div className="mt-3 flex gap-4 text-xs text-[color:var(--color-muted-foreground)]">
                    <span>{formatDuration(latest.duration_ms)}</span>
                    <span>{formatCost(latest.cost_usd)}</span>
                  </div>
                </Link>
              ) : (
                <p className="text-sm leading-relaxed text-[color:var(--color-muted-foreground)]">
                  No runs yet.
                </p>
              )}
            </section>

            <section>
              <h2 className="mb-3 text-sm font-semibold uppercase tracking-wide">
                Run History
              </h2>
              {runs.length === 0 ? (
                <p className="text-sm leading-relaxed text-[color:var(--color-muted-foreground)]">
                  No history yet.
                </p>
              ) : (
                <ul className="divide-y divide-[color:var(--color-border)]/60 overflow-hidden rounded-xl border border-[color:var(--color-border)] bg-[color:var(--color-card)]">
                  {runs.map((r) => (
                    <li key={r.id}>
                      <Link
                        href={`/agents/${slug}/runs/${r.id}`}
                        className="grid grid-cols-[auto_1fr_auto_auto] items-center gap-3 px-4 py-3 text-sm transition-colors duration-200 hover:bg-[#E4D8C5]"
                      >
                        <RunStatusBadge status={r.status} />
                        <span className="text-[color:var(--color-muted-foreground)]">
                          {r.run_type}
                        </span>
                        <span className="font-mono text-xs">
                          {formatDuration(r.duration_ms)}
                        </span>
                        <span className="text-xs text-[color:var(--color-muted-foreground)]">
                          {relativeTime(r.created_at)}
                        </span>
                      </Link>
                    </li>
                  ))}
                </ul>
              )}
            </section>
          </div>

          <aside className="card h-fit space-y-2 p-5 text-xs leading-relaxed">
            <Row label="Model" value={agent.model ?? "—"} />
            <Row label="Input" value={
              (() => {
                const parts = [
                  inputConfig.text.enabled && "text",
                  inputConfig.url.enabled && "url",
                  inputConfig.file.enabled && "file",
                ].filter(Boolean);
                return parts.length ? parts.join(", ") : "none";
              })()
            } />
            <Row label="Email" value={agent.can_send_email ? "yes" : "no"} />
            <Row label="Created" value={relativeTime(agent.created_at)} />
            <Row label="Expires" value={relativeTime(agent.expires_at)} />
            <Row label="App ID" value={app.id.slice(0, 8)} mono />
          </aside>
        </div>
      </div>
    </main>
  );
}

function Row({ label, value, mono }: { label: string; value: string; mono?: boolean }) {
  return (
    <div className="flex items-baseline justify-between gap-2 whitespace-nowrap">
      <span className="shrink-0 text-[color:var(--color-muted-foreground)]">
        {label}
      </span>
      <span className={`min-w-0 truncate ${mono ? "font-mono" : ""}`}>
        {value}
      </span>
    </div>
  );
}
