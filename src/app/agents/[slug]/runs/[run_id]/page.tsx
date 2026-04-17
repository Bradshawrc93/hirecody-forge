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
import { outputLooksLikeHtmlReport } from "@/lib/html-report";
import { parseCsvEnvelope } from "@/lib/csv-report";
import { CsvDownloadBlock } from "@/components/CsvDownloadBlock";

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
      <div className="mx-auto max-w-5xl px-6 pt-20 pb-16">
        <Link
          href={`/agents/${slug}`}
          className="inline-flex items-center gap-2 text-xs font-medium uppercase tracking-[0.2em] text-[color:var(--color-muted-foreground)] transition-colors duration-200 hover:text-[color:var(--color-primary)]"
        >
          ← Back to Agent
        </Link>

        <header className="mt-4 flex flex-wrap items-center justify-between gap-3 border-b border-[color:var(--color-border)] pb-6">
          <div>
            <div className="mb-2 flex items-center gap-3">
              <span className="h-px w-8 bg-[color:var(--color-primary)]" />
              <span className="text-sm font-medium uppercase tracking-wide text-[color:var(--color-primary)]">
                Run
              </span>
            </div>
            <h1 className="text-3xl font-semibold leading-tight tracking-tight md:text-4xl">
              {run_id.slice(0, 8)}…
            </h1>
            <p className="mt-2 text-xs leading-relaxed text-[color:var(--color-muted-foreground)]">
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
          <section className="mt-8">
            <h2 className="mb-3 text-sm font-semibold uppercase tracking-wide">
              Input
            </h2>
            <pre className="card whitespace-pre-wrap p-5 text-sm leading-relaxed">{run.input_text}</pre>
          </section>
        )}

        {failureSummary && (
          <div className="mt-6 flex items-start gap-2 rounded-xl border border-[#E5BFB5] bg-[#F4D6D2] p-4 text-sm leading-relaxed text-[#7A1F1A]">
            <AlertTriangle size={16} className="mt-0.5 shrink-0" />
            <div>
              <div className="font-semibold">Why did this fail?</div>
              <div>{failureSummary}</div>
            </div>
          </div>
        )}

        {isLive ? (
          <LiveRunView appId={lean.app_id} runId={run_id} slug={slug} />
        ) : (
          <>
            <section className="mt-8">
              <h2 className="mb-3 text-sm font-semibold uppercase tracking-wide">
                Output
              </h2>
              <div className="card max-h-[400px] overflow-auto p-5">
                {run.status === "completed" && run.output ? (
                  (() => {
                    const csv = parseCsvEnvelope(run.output);
                    if (csv) {
                      return (
                        <CsvDownloadBlock
                          envelope={csv}
                          downloadHref={`/agents/${slug}/runs/${run_id}/csv`}
                        />
                      );
                    }
                    if (outputLooksLikeHtmlReport(run.output)) {
                      return (
                        <div className="space-y-2">
                          <Link
                            href={`/agents/${slug}/runs/${run_id}/report`}
                            className="inline-flex items-center gap-2 text-sm font-medium text-[color:var(--color-primary)] transition-colors duration-200 hover:underline"
                          >
                            View Report →
                          </Link>
                          <p className="text-xs leading-relaxed text-[color:var(--color-muted-foreground)]">
                            HTML report with charts — generated{" "}
                            {relativeTime(run.completed_at)}
                          </p>
                        </div>
                      );
                    }
                    return <MarkdownView content={run.output} />;
                  })()
                ) : (
                  <pre className="whitespace-pre-wrap text-sm leading-relaxed">
                    {run.output ?? run.error_message ?? "(no output)"}
                  </pre>
                )}
              </div>
            </section>

            <section className="mt-10">
              <h2 className="mb-3 text-sm font-semibold uppercase tracking-wide">
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
