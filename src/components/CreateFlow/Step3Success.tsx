"use client";

import type { FormState } from "./types";

interface Props {
  form: FormState;
  setForm: (f: FormState) => void;
  onNext: () => void;
  onBack: () => void;
}

export function Step3Success({ form, setForm, onNext, onBack }: Props) {
  const canContinue = form.success_criteria.trim().length > 0;
  const ctxLen = form.context_text.length;
  const ctxColor =
    ctxLen > 950
      ? "text-[#7A1F1A]"
      : ctxLen > 800
      ? "text-[#7A3F12]"
      : "text-[color:var(--color-muted-foreground)]";

  return (
    <div className="space-y-6">
      <div>
        <label className="label">What does a successful run look like?</label>
        <textarea
          className="input min-h-[100px]"
          maxLength={300}
          placeholder="e.g., 5 bullet points, each under 200 chars, each linking to a source"
          value={form.success_criteria}
          onChange={(e) => setForm({ ...form, success_criteria: e.target.value })}
        />
        <div className="mt-1 text-xs text-[color:var(--color-muted-foreground)]">
          {form.success_criteria.length}/300
        </div>
      </div>

      <div>
        <label className="label">What should the agent output?</label>
        <select
          className="input"
          value={form.output_type}
          onChange={(e) =>
            setForm({ ...form, output_type: e.target.value as FormState["output_type"] })
          }
        >
          <option value="text">Text response</option>
          <option value="file">A file</option>
          <option value="email">An email to me</option>
          <option value="side-effect">Nothing visible — it performs an action</option>
        </select>
      </div>

      <div>
        <label className="label">Anything else the agent should know?</label>
        <textarea
          className="input min-h-[100px]"
          maxLength={1000}
          placeholder="Optional context, preferences, things to avoid…"
          value={form.context_text}
          onChange={(e) => setForm({ ...form, context_text: e.target.value })}
        />
        <div className={`mt-1 text-xs ${ctxColor}`}>{ctxLen}/1000</div>
      </div>

      <div className="flex justify-between pt-2">
        <button type="button" className="btn-secondary" onClick={onBack}>
          Back
        </button>
        <button
          type="button"
          className="btn-primary"
          disabled={!canContinue}
          onClick={onNext}
        >
          Build agent
        </button>
      </div>
    </div>
  );
}
