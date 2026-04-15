"use client";

import type { FormState } from "./types";
import { RUNTIME_MODELS } from "./types";
import { EmailVerify } from "./EmailVerify";

interface Props {
  form: FormState;
  setForm: (f: FormState) => void;
  onNext: () => void;
  onBack: () => void;
}

export function Step2Capabilities({ form, setForm, onNext, onBack }: Props) {
  const emailNeedsVerify = form.can_send_email && !form.verified_email;
  const canContinue = !emailNeedsVerify;

  function setSchedule(cadence: FormState["schedule_cadence"]) {
    setForm({
      ...form,
      schedule_cadence: cadence,
      schedule_time: cadence ? form.schedule_time ?? "13:00:00" : null,
      schedule_day_of_week: cadence === "weekly" ? form.schedule_day_of_week ?? 1 : null,
      schedule_day_of_month: cadence === "monthly" ? form.schedule_day_of_month ?? 1 : null,
    });
  }

  return (
    <div className="space-y-6">
      <div>
        <label className="label">Does this agent need AI?</label>
        <div className="flex items-center gap-3">
          <button
            type="button"
            className={`btn-secondary ${form.needs_llm ? "border-[#C56A2D] text-[#C56A2D]" : ""}`}
            onClick={() => setForm({ ...form, needs_llm: true })}
          >
            Yes
          </button>
          <button
            type="button"
            className={`btn-secondary ${!form.needs_llm ? "border-[#C56A2D] text-[#C56A2D]" : ""}`}
            onClick={() => setForm({ ...form, needs_llm: false })}
          >
            No
          </button>
        </div>
        {form.needs_llm && (
          <div className="mt-3">
            <label className="label">Model</label>
            <select
              className="input"
              value={form.model}
              onChange={(e) => setForm({ ...form, model: e.target.value })}
            >
              {RUNTIME_MODELS.map((m) => (
                <option key={m.id} value={m.id}>
                  {m.label}
                </option>
              ))}
            </select>
          </div>
        )}
      </div>

      <div>
        <label className="label">What does this agent need to get started?</label>
        <select
          className="input"
          value={form.input_type}
          onChange={(e) =>
            setForm({ ...form, input_type: e.target.value as FormState["input_type"] })
          }
        >
          <option value="none">Nothing — it runs on its own</option>
          <option value="text">Text input (a prompt, a URL, a name, etc.)</option>
          <option value="file">A file upload (.csv or .md only)</option>
          <option value="both">Both text and a file</option>
        </select>
      </div>

      <div>
        <label className="label">Should this agent send you email with results?</label>
        <div className="flex items-center gap-3">
          <button
            type="button"
            className={`btn-secondary ${form.can_send_email ? "border-[#C56A2D] text-[#C56A2D]" : ""}`}
            onClick={() => setForm({ ...form, can_send_email: true })}
          >
            Yes
          </button>
          <button
            type="button"
            className={`btn-secondary ${!form.can_send_email ? "border-[#C56A2D] text-[#C56A2D]" : ""}`}
            onClick={() =>
              setForm({ ...form, can_send_email: false, verified_email: null })
            }
          >
            No
          </button>
        </div>
        {form.can_send_email && (
          <div className="mt-3">
            <EmailVerify
              verifiedEmail={form.verified_email}
              onVerified={(email) => setForm({ ...form, verified_email: email })}
            />
          </div>
        )}
      </div>

      <div>
        <label className="label">Does this agent need web access?</label>
        <div className="flex items-center gap-3">
          <button
            type="button"
            className={`btn-secondary ${form.has_web_access ? "border-[#C56A2D] text-[#C56A2D]" : ""}`}
            onClick={() => setForm({ ...form, has_web_access: true })}
          >
            Yes
          </button>
          <button
            type="button"
            className={`btn-secondary ${!form.has_web_access ? "border-[#C56A2D] text-[#C56A2D]" : ""}`}
            onClick={() => setForm({ ...form, has_web_access: false })}
          >
            No
          </button>
        </div>
      </div>

      <div>
        <label className="label">Run on a schedule?</label>
        <select
          className="input"
          value={form.schedule_cadence ?? "none"}
          onChange={(e) =>
            setSchedule(e.target.value === "none" ? null : (e.target.value as "daily" | "weekly" | "monthly"))
          }
        >
          <option value="none">None</option>
          <option value="daily">Daily</option>
          <option value="weekly">Weekly</option>
          <option value="monthly">Monthly</option>
        </select>

        {form.schedule_cadence && (
          <div className="mt-3 grid grid-cols-1 gap-3 sm:grid-cols-2">
            <div>
              <label className="label">Time (UTC)</label>
              <input
                type="time"
                className="input"
                value={(form.schedule_time ?? "13:00:00").slice(0, 5)}
                onChange={(e) =>
                  setForm({ ...form, schedule_time: `${e.target.value}:00` })
                }
              />
            </div>
            {form.schedule_cadence === "weekly" && (
              <div>
                <label className="label">Day of week</label>
                <select
                  className="input"
                  value={form.schedule_day_of_week ?? 1}
                  onChange={(e) =>
                    setForm({ ...form, schedule_day_of_week: Number(e.target.value) })
                  }
                >
                  {["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"].map((d, i) => (
                    <option key={d} value={i}>
                      {d}
                    </option>
                  ))}
                </select>
              </div>
            )}
            {form.schedule_cadence === "monthly" && (
              <div>
                <label className="label">Day of month (1–28)</label>
                <input
                  type="number"
                  min={1}
                  max={28}
                  className="input"
                  value={form.schedule_day_of_month ?? 1}
                  onChange={(e) =>
                    setForm({
                      ...form,
                      schedule_day_of_month: Math.min(28, Math.max(1, Number(e.target.value))),
                    })
                  }
                />
              </div>
            )}
          </div>
        )}
        <p className="mt-2 text-xs text-[color:var(--color-muted-foreground)]">
          Scheduled agents run automatically. You&apos;ll see results in the
          agent&apos;s run history.
        </p>
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
          Continue
        </button>
      </div>
    </div>
  );
}
