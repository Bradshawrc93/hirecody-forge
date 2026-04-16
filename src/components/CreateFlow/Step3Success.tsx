"use client";

import type { FormState } from "./types";

interface Props {
  form: FormState;
  setForm: (f: FormState) => void;
  onNext: () => void;
  onBack: () => void;
}

type OutputOption = {
  value: FormState["output_type"];
  label: string;
  helper?: string;
  emailHelper?: string;
};

// Order matches the CSV spec's Step 3 layout. `notification` and
// `side-effect` exist in the FormState union for Obs compatibility but
// have no engine behavior yet, so they're omitted from the picker.
const OUTPUT_OPTIONS: OutputOption[] = [
  { value: "text", label: "Text / markdown" },
  { value: "file", label: "File" },
  {
    value: "csv",
    label: "CSV — spreadsheet file",
    helper:
      "Your agent will produce a CSV file (openable in Excel/Sheets). The LLM decides the columns based on your success criteria.",
    emailHelper: "CSV will be attached to the notification email.",
  },
  { value: "html_report", label: "HTML report" },
  { value: "email", label: "Email" },
];

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
        <div className="mt-1 space-y-2">
          {OUTPUT_OPTIONS.map((opt) => {
            const selected = form.output_type === opt.value;
            return (
              <label
                key={opt.value}
                className="flex cursor-pointer items-start gap-2 text-sm"
              >
                <input
                  type="radio"
                  className="mt-1"
                  name="output_type"
                  value={opt.value}
                  checked={selected}
                  onChange={() => setForm({ ...form, output_type: opt.value })}
                />
                <span>
                  <span>{opt.label}</span>
                  {selected && opt.helper && (
                    <span className="mt-1 block text-xs text-[color:var(--color-muted-foreground)]">
                      {opt.helper}
                    </span>
                  )}
                  {selected && opt.emailHelper && form.can_send_email && (
                    <span className="mt-1 block text-xs text-[color:var(--color-muted-foreground)]">
                      {opt.emailHelper}
                    </span>
                  )}
                </span>
              </label>
            );
          })}
        </div>
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
