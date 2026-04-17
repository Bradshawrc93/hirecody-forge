import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { findAgentBySlug } from "@/lib/agent-lookup";
import { getRun } from "@/lib/obs";
import { getAgentKey } from "@/lib/kv";
import { outputLooksLikeHtmlReport } from "@/lib/html-report";

export const dynamic = "force-dynamic";
export const revalidate = 0;

export default async function ReportViewerPage({
  params,
  searchParams,
}: {
  params: Promise<{ slug: string; run_id: string }>;
  searchParams: Promise<{ raw?: string }>;
}) {
  const { slug, run_id } = await params;
  const { raw } = await searchParams;
  const lean = await findAgentBySlug(slug);
  if (!lean) notFound();
  const apiKey = await getAgentKey(lean.app_id);
  if (!apiKey) notFound();

  const { run } = await getRun(run_id, apiKey);

  // No HTML report on this run → fall back to the normal run detail page.
  if (!outputLooksLikeHtmlReport(run.output)) {
    redirect(`/agents/${slug}/runs/${run_id}`);
  }

  const html = run.output ?? "";

  // Debug mode: dump the raw HTML as plain text so you can grep for
  // <canvas>, <script>, chart init calls, etc.
  if (raw === "1") {
    return (
      <pre className="m-0 whitespace-pre-wrap break-words p-4 font-mono text-xs">
        {html}
      </pre>
    );
  }

  const agentName = lean.apps?.display_name ?? "Agent";

  return (
    <main className="flex h-screen flex-col bg-[color:var(--color-background)]">
      <header className="flex items-center justify-between border-b border-[color:var(--color-border)] bg-[color:var(--color-card)] px-6 py-3 text-sm">
        <Link
          href={`/agents/${slug}/runs/${run_id}`}
          className="inline-flex items-center gap-2 text-xs font-medium uppercase tracking-[0.2em] text-[color:var(--color-muted-foreground)] transition-colors duration-200 hover:text-[color:var(--color-primary)]"
        >
          ← Back to Run
        </Link>
        <span className="truncate text-xs uppercase tracking-[0.2em] text-[color:var(--color-muted-foreground)]">
          {agentName} — Report
        </span>
        <Link
          href="/"
          className="text-xs font-medium uppercase tracking-[0.2em] text-[color:var(--color-muted-foreground)] transition-colors duration-200 hover:text-[color:var(--color-primary)]"
        >
          Forge
        </Link>
      </header>
      <iframe
        title={`${agentName} report`}
        srcDoc={html}
        sandbox="allow-scripts"
        className="flex-1 w-full border-0 bg-white"
      />
    </main>
  );
}
