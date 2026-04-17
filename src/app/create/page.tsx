"use client";

import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { StepIndicator } from "@/components/CreateFlow/StepIndicator";
import { Step1Describe } from "@/components/CreateFlow/Step1Describe";
import { Step2Capabilities } from "@/components/CreateFlow/Step2Capabilities";
import { Step3Success } from "@/components/CreateFlow/Step3Success";
import { Step4Build } from "@/components/CreateFlow/Step4Build";
import { Step5Test } from "@/components/CreateFlow/Step5Test";
import { DEFAULT_FORM, type FormState } from "@/components/CreateFlow/types";

type Step = 1 | 2 | 3 | 4 | 5;

export default function CreatePage() {
  const router = useRouter();
  const [step, setStep] = useState<Step>(1);
  const [form, setForm] = useState<FormState>(DEFAULT_FORM);
  const [created, setCreated] = useState<{ app_id: string; slug: string } | null>(null);
  const [pendingFeedback, setPendingFeedback] = useState<string | null>(null);
  const [buildAttempt, setBuildAttempt] = useState(0);
  const [attemptNumber, setAttemptNumber] = useState<1 | 2>(1);
  const buildPromiseRef = useRef<Promise<{ app_id: string; slug: string } | null> | null>(null);

  async function deleteAgentById(appId: string) {
    try {
      await fetch("/api/internal/delete-agent", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ app_id: appId }),
      });
    } catch {
      /* best-effort cleanup */
    }
  }

  // Clone support: read sessionStorage on mount.
  useEffect(() => {
    try {
      const raw = sessionStorage.getItem("forge_clone");
      if (raw) {
        const cloned = JSON.parse(raw) as Partial<FormState>;
        setForm({
          ...DEFAULT_FORM,
          ...cloned,
          display_name: (cloned.display_name ?? "") + " (copy)",
          slug: "",
        });
        sessionStorage.removeItem("forge_clone");
      }
    } catch {
      /* ignore */
    }
  }, []);

  async function deleteCreatedAgent() {
    if (!created) return;
    await deleteAgentById(created.app_id);
  }

  async function handleRebuild(feedback: string) {
    if (!created) return;
    // In-place rebuild: keep the same app_id/slug. Step4Build will hit
    // the rebuild endpoint, which patches the existing agent's config
    // and posts a new build record as attempt_number 2.
    setPendingFeedback(feedback);
    setAttemptNumber(2);
    setBuildAttempt((n) => n + 1);
    setStep(4);
  }

  async function handleAbandon() {
    await deleteCreatedAgent();
    router.push("/");
  }

  async function handleCancel() {
    if (created) {
      await deleteCreatedAgent();
    } else if (buildPromiseRef.current) {
      // A build is in-flight. Wait for it to land so we can delete the
      // orphaned agent the backend will have created.
      const result = await buildPromiseRef.current.catch(() => null);
      if (result?.app_id) await deleteAgentById(result.app_id);
    }
    router.push("/");
  }

  return (
    <main className="relative min-h-screen">
      <div className="mx-auto max-w-2xl px-6 pt-20 pb-16">
        <div className="card relative p-6 md:p-8">
          <div className="mb-6 space-y-4">
            <div className="flex items-center justify-between gap-3">
              <div>
                <div className="mb-2 flex items-center gap-3">
                  <span className="h-px w-8 bg-[color:var(--color-primary)]" />
                  <span className="text-sm font-medium uppercase tracking-wide text-[color:var(--color-primary)]">
                    New
                  </span>
                </div>
                <h1 className="text-3xl font-semibold leading-tight tracking-tight md:text-4xl">
                  Create Agent
                </h1>
              </div>
              <button
                type="button"
                className="inline-flex items-center gap-2 rounded-lg border border-[color:var(--color-border)] px-4 py-2 text-sm font-medium text-[color:var(--color-foreground)] transition-colors duration-200 hover:bg-[color:var(--color-card)]"
                onClick={handleCancel}
              >
                Cancel
              </button>
            </div>
            <StepIndicator step={step} />
          </div>

          {step === 1 && (
            <Step1Describe
              form={form}
              setForm={setForm}
              onNext={() => setStep(2)}
            />
          )}
          {step === 2 && (
            <Step2Capabilities
              form={form}
              setForm={setForm}
              onNext={() => setStep(3)}
              onBack={() => setStep(1)}
            />
          )}
          {step === 3 && (
            <Step3Success
              form={form}
              setForm={setForm}
              onNext={() => setStep(4)}
              onBack={() => setStep(2)}
            />
          )}
          {step === 4 && (
            <Step4Build
              key={buildAttempt}
              form={form}
              userFeedback={pendingFeedback}
              mode={attemptNumber === 2 ? "rebuild" : "initial"}
              appId={created?.app_id ?? null}
              onBuildStarted={(p) => {
                buildPromiseRef.current = p;
              }}
              onSuccess={(r) => {
                buildPromiseRef.current = null;
                setCreated(r);
                setStep(5);
              }}
              onRetry={() => setStep(3)}
            />
          )}
          {step === 5 && created && (
            <Step5Test
              key={attemptNumber}
              appId={created.app_id}
              slug={created.slug}
              form={form}
              attemptNumber={attemptNumber}
              onLive={() => router.push(`/agents/${created.slug}`)}
              onRebuild={handleRebuild}
              onAbandon={handleAbandon}
            />
          )}
        </div>
      </div>
    </main>
  );
}
