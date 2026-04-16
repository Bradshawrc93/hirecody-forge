import Link from "next/link";
import { notFound } from "next/navigation";
import { AlertTriangle } from "lucide-react";
import { LiveRunView } from "@/components/LiveRunView";
import { MarkdownView } from "@/components/MarkdownView";
import { Waterfall } from "@/components/Waterfall";
import { RunStatusBadge } from "@/components/StatusBadge";
import { findAgentBySlug } from "@/lib/agent-lookup";
import { getRun, getSteps } from "@/lib/obs";
import { getAgentKey } from "@/lib/kv";
import { formatCost, formatDuration, relativeTime } from "@/lib/format";
import { explainFailure } from "@/lib/failure-explainer";

export const dynamic = "force-dynamic";
export const revalidate = 0;

export default async function RunDetailPage({
  params,
}: {
  params: Promise<{ slug: string; run_id: string }>;
}) {
  const { slug, run_id } = await params;
  const lean = await findAgentBySlug(slug);
  if (!lean) notFound();
  const apiKey = await getAgentKey(lean.app_id);
  if (!apiKey) notFound();

  const { run } = await getRun(run_id, apiKey);
  const isLive = run.status === "queued" || run.status === "running";
  const stepsResp = isLive
    ? { steps: [] }
    : await getSteps(run_id, apiKey, 0);

  const failureSummary =
    run.status === "failed"
      ? await explainFailure(stepsResp.steps, run.error_message)
      : null;

  return (
    <main className="relative min-h-screen">
      <div className="mx-auto max-w-4xl px-6 pt-16 pb-16">
        <Link
          href={`/agents/${slug}`}
          className="text-sm font-semibold text-[color:var(--color-primary)] hover:underline"
        >
          ← back to agent
        </Link>

        <header className="mt-4 flex flex-wrap items-center justify-between gap-3 border-b border-[color:var(--color-border)] pb-4">
          <div>
            <h1 className="text-xl font-bold">Run {run_id.slice(0, 8)}…</h1>
            <p className="text-xs text-[color:var(--color-muted-foreground)]">
              {relativeTime(run.created_at)} • {run.run_type}
            </p>
          </div>
          <div className="flex items-center gap-3 text-xs">
            <RunStatusBadge status={run.status} />
            <span>{formatDuration(run.duration_ms)}</span>
            <span>{formatCost(run.cost_usd)}</span>
          </div>
        </header>

        {run.input_text && (
          <section className="mt-6">
            <h2 className="text-sm font-bold uppercase tracking-wide text-[color:var(--color-muted-foreground)]">
              Input
            </h2>
            <pre className="card mt-2 whitespace-pre-wrap p-4 text-sm">{run.input_text}</pre>
          </section>
        )}

        {failureSummary && (
          <div className="mt-6 flex items-start gap-2 rounded-md border border-[#E5BFB5] bg-[#F4D6D2] p-3 text-sm text-[#7A1F1A]">
            <AlertTriangle size={16} className="mt-0.5 shrink-0" />
            <div>
              <div className="font-semibold">Why did this fail?</div>
              <div>{failureSummary}</div>
            </div>
          </div>
        )}

        {isLive ? (
          <LiveRunView appId={lean.app_id} runId={run_id} />
        ) : (
          <>
            <section className="mt-6">
              <h2 className="text-sm font-bold uppercase tracking-wide text-[color:var(--color-muted-foreground)]">
                Output
              </h2>
              <div className="card mt-2 max-h-[400px] overflow-auto p-4">
                {run.status === "completed" && run.output ? (
                  <MarkdownView content={run.output} />
                ) : (
                  <pre className="whitespace-pre-wrap text-sm">
                    {run.output ?? run.error_message ?? "(no output)"}
                  </pre>
                )}
              </div>
            </section>

            <section className="mt-8">
              <h2 className="mb-3 text-sm font-bold uppercase tracking-wide text-[color:var(--color-muted-foreground)]">
                Waterfall
              </h2>
              <Waterfall appId={lean.app_id} runId={run_id} />
            </section>
          </>
        )}
      </div>
    </main>
  );
}
