"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { X } from "lucide-react";
import { BackButton } from "@/components/BackButton";
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
  const [rebuilding, setRebuilding] = useState(false);

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

  async function rebuildAfterFeedback(feedback: string) {
    if (!created) return;
    setRebuilding(true);
    try {
      const res = await fetch("/api/internal/rebuild", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          app_id: created.app_id,
          user_feedback: feedback,
          display_name: form.display_name,
          description: form.description,
          needs_llm: form.needs_llm,
          model: form.model,
          input_type: form.input_type,
          can_send_email: form.can_send_email,
          has_web_access: form.has_web_access,
          output_type: form.output_type,
          success_criteria: form.success_criteria,
          context_text: form.context_text || null,
          verified_email: form.verified_email,
        }),
      });
      if (!res.ok) {
        const body = await res.json();
        alert("Rebuild failed: " + (body.details || body.error));
      }
    } finally {
      setRebuilding(false);
    }
  }

  return (
    <main className="relative min-h-screen">
      <BackButton />

      <div className="mx-auto max-w-2xl px-4 pt-16 pb-12">
        <div className="card relative p-6 md:p-8">
          <button
            type="button"
            className="absolute right-4 top-4 text-[color:var(--color-muted-foreground)] hover:text-[color:var(--color-foreground)]"
            onClick={() => router.push("/")}
            aria-label="Close"
          >
            <X size={18} />
          </button>

          <div className="mb-6 flex items-center justify-between">
            <h1 className="text-xl font-bold">Create Agent</h1>
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
          {step === 4 && !rebuilding && (
            <Step4Build
              form={form}
              onSuccess={(r) => {
                setCreated(r);
                setStep(5);
              }}
              onRetry={() => setStep(3)}
            />
          )}
          {step === 4 && rebuilding && (
            <div className="py-8 text-center text-sm">Rebuilding with your feedback…</div>
          )}
          {step === 5 && created && (
            <Step5Test
              appId={created.app_id}
              slug={created.slug}
              form={form}
              onLive={() => router.push(`/agents/${created.slug}`)}
              onRebuild={async (fb) => {
                setStep(4);
                await rebuildAfterFeedback(fb);
                setStep(5);
              }}
              onAbandon={() => router.push("/")}
            />
          )}
        </div>
      </div>
    </main>
  );
}
