"use client";

import { useEffect, useRef, useState } from "react";
import { slugify } from "@/lib/format";
import type { FormState } from "./types";

interface Props {
  form: FormState;
  setForm: (f: FormState) => void;
  onNext: () => void;
}

interface GuardrailResult {
  feasibility: "simple" | "moderate" | "complex";
  needs_llm: "unlikely" | "maybe" | "likely";
  suggested_input: "none" | "text" | "file" | "both";
  reason?: string;
}

export function Step1Describe({ form, setForm, onNext }: Props) {
  const [guardrail, setGuardrail] = useState<GuardrailResult | null>(null);
  const [checking, setChecking] = useState(false);
  const [slugTouched, setSlugTouched] = useState(false);
  const debounceRef = useRef<NodeJS.Timeout | null>(null);

  useEffect(() => {
    if (debounceRef.current) clearTimeout(debounceRef.current);
    if (form.description.trim().length < 10) {
      setGuardrail(null);
      return;
    }
    debounceRef.current = setTimeout(async () => {
      setChecking(true);
      try {
        const res = await fetch("/api/internal/guardrail", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ description: form.description }),
        });
        if (res.ok) {
          const data = (await res.json()) as GuardrailResult;
          setGuardrail(data);
        }
      } finally {
        setChecking(false);
      }
    }, 1500);
    return () => {
      if (debounceRef.current) clearTimeout(debounceRef.current);
    };
  }, [form.description]);

  const blocked = guardrail?.feasibility === "complex";
  const canContinue =
    form.display_name.trim().length > 0 &&
    form.description.trim().length >= 10 &&
    !blocked &&
    !checking;

  return (
    <div className="space-y-5">
      <div>
        <label className="label">Agent name</label>
        <input
          className="input"
          maxLength={60}
          placeholder="Daily News Digest"
          value={form.display_name}
          onChange={(e) => {
            const v = e.target.value;
            setForm({
              ...form,
              display_name: v,
              slug: slugTouched ? form.slug : slugify(v),
            });
          }}
        />
      </div>

      <div>
        <label className="label">Slug</label>
        <input
          className="input font-mono"
          value={form.slug}
          onChange={(e) => {
            setSlugTouched(true);
            setForm({ ...form, slug: slugify(e.target.value) });
          }}
        />
      </div>

      <div>
        <label className="label">What should this agent do?</label>
        <textarea
          className="input min-h-[120px]"
          maxLength={500}
          placeholder="e.g., Every Monday, summarize the top 5 Hacker News posts and email me the highlights."
          value={form.description}
          onChange={(e) => setForm({ ...form, description: e.target.value })}
        />
        <div className="mt-1 flex items-center justify-between text-xs text-[color:var(--color-muted-foreground)]">
          <span>{form.description.length}/500</span>
          {checking && <span>Checking feasibility…</span>}
        </div>
      </div>

      {blocked && (
        <div className="rounded-md border border-[#E5BFB5] bg-[#F4D6D2] px-3 py-2 text-sm text-[#7A1F1A]">
          This sounds like a pretty ambitious automation — Forge works best
          with focused, single-purpose agents. Could you simplify the scope a
          bit?{" "}
          {guardrail?.reason && <span className="italic">{guardrail.reason}</span>}
        </div>
      )}

      <div className="flex justify-end pt-2">
        <button
          type="button"
          className="btn-primary"
          disabled={!canContinue}
          onClick={() => {
            // Pre-fill Step 2 defaults from the guardrail.
            if (guardrail) {
              setForm({
                ...form,
                needs_llm: guardrail.needs_llm !== "unlikely",
                input_type: guardrail.suggested_input,
              });
            }
            onNext();
          }}
        >
          Continue
        </button>
      </div>
    </div>
  );
}
