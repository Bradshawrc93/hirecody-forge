"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { MarkdownView } from "./MarkdownView";
import { Waterfall } from "./Waterfall";

interface Props {
  appId: string;
  runId: string;
}

export function LiveRunView({ appId, runId }: Props) {
  const router = useRouter();
  const [terminal, setTerminal] = useState<"completed" | "failed" | null>(null);
  const [output, setOutput] = useState<string | null>(null);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  useEffect(() => {
    if (!terminal) return;
    let cancelled = false;
    (async () => {
      try {
        const res = await fetch(
          `/api/internal/run-status?app_id=${appId}&run_id=${runId}`,
          { cache: "no-store" }
        );
        if (!res.ok) return;
        const data = await res.json();
        if (cancelled) return;
        setOutput(data.output ?? null);
        setErrorMessage(data.error_message ?? null);
      } catch {
        /* ignore — user can refresh */
      } finally {
        if (!cancelled) {
          // Re-render the server page so history, sidebar, and costs
          // reflect the completed run.
          router.refresh();
        }
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [terminal, appId, runId, router]);

  return (
    <>
      <section className="mt-6">
        <h2 className="text-sm font-bold uppercase tracking-wide text-[color:var(--color-muted-foreground)]">
          Output
        </h2>
        <div className="card mt-2 max-h-[400px] overflow-auto p-4">
          {terminal === "completed" && output ? (
            <MarkdownView content={output} />
          ) : terminal === "failed" ? (
            <pre className="whitespace-pre-wrap text-sm">
              {errorMessage ?? "(run failed)"}
            </pre>
          ) : (
            <p className="text-sm text-[color:var(--color-muted-foreground)]">
              Running… output will appear here when the run finishes.
            </p>
          )}
        </div>
      </section>

      <section className="mt-8">
        <h2 className="mb-3 text-sm font-bold uppercase tracking-wide text-[color:var(--color-muted-foreground)]">
          Waterfall
        </h2>
        <Waterfall
          appId={appId}
          runId={runId}
          onTerminal={(s) => setTerminal(s)}
        />
      </section>
    </>
  );
}
