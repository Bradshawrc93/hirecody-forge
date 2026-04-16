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

// Current Chicago ↔ UTC offset in minutes (handles CST vs CDT via the
// runtime's IANA db). Recomputed on every call so DST boundaries pick up
// the correct offset whenever the form is loaded.
function chicagoOffsetMinutes(): number {
  const probe = new Date();
  probe.setUTCMinutes(0, 0, 0);
  const fmt = new Intl.DateTimeFormat("en-US", {
    timeZone: "America/Chicago",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  });
  const [ch, cm] = fmt.format(probe).split(":").map(Number);
  // Normalize "24:00" that some runtimes emit.
  const chicagoMin = (ch % 24) * 60 + cm;
  const utcMin = probe.getUTCHours() * 60 + probe.getUTCMinutes();
  let delta = chicagoMin - utcMin;
  if (delta > 720) delta -= 1440;
  if (delta < -720) delta += 1440;
  return delta; // e.g. -300 (CDT) or -360 (CST)
}

function utcHHMMSSToChicagoHHMM(utc: string): string {
  const [hh, mm] = utc.split(":").map(Number);
  const off = chicagoOffsetMinutes();
  let total = hh * 60 + mm + off;
  total = ((total % 1440) + 1440) % 1440;
  const h = Math.floor(total / 60);
  const m = total % 60;
  return `${String(h).padStart(2, "0")}:${String(m).padStart(2, "0")}`;
}

function chicagoHHMMToUTCHHMMSS(ct: string): string {
  const [hh, mm] = ct.split(":").map(Number);
  const off = chicagoOffsetMinutes();
  let total = hh * 60 + mm - off;
  total = ((total % 1440) + 1440) % 1440;
  const h = Math.floor(total / 60);
  const m = total % 60;
  return `${String(h).padStart(2, "0")}:${String(m).padStart(2, "0")}:00`;
}

// Default: 8:00 AM Central, stored as the UTC wall-clock Obs expects.
const DEFAULT_SCHEDULE_UTC = chicagoHHMMToUTCHHMMSS("08:00");

export function Step2Capabilities({ form, setForm, onNext, onBack }: Props) {
  const emailNeedsVerify = form.can_send_email && !form.verified_email;
  const canContinue = !emailNeedsVerify;

  function setSchedule(cadence: FormState["schedule_cadence"]) {
    setForm({
      ...form,
      schedule_cadence: cadence,
      schedule_time: cadence ? form.schedule_time ?? DEFAULT_SCHEDULE_UTC : null,
      schedule_day_of_week: cadence === "weekly" ? form.schedule_day_of_week ?? 1 : null,
      schedule_day_of_month: cadence === "monthly" ? form.schedule_day_of_month ?? 1 : null,
    });
  }

  return (
    <div className="space-y-6">
      <div>
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
        <p className="mt-1 text-xs text-[color:var(--color-muted-foreground)]">
          The AI model that will power this agent&apos;s reasoning and
          generation.
        </p>
      </div>

      <div>
        <label className="label">What input will this agent depend on?</label>
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
        <p className="mt-1 text-xs text-[color:var(--color-muted-foreground)]">
          Pick &quot;Nothing&quot; for scheduled agents that gather their own
          data (e.g., news digests, monitors).
        </p>
      </div>

      <div>
        <label className="label">Should this agent send you email with results?</label>
        <p className="mb-2 text-xs text-[color:var(--color-muted-foreground)]">
          Turn this on if you want the agent to deliver its output to an
          inbox — useful for scheduled digests, alerts, and reports. Each
          agent sends to a single verified address that you own.
        </p>
        <div className="flex items-center gap-3">
          <button
            type="button"
            className="btn-toggle"
            data-active={form.can_send_email}
            onClick={() => setForm({ ...form, can_send_email: true })}
          >
            Yes
          </button>
          <button
            type="button"
            className="btn-toggle"
            data-active={!form.can_send_email}
            onClick={() =>
              setForm({ ...form, can_send_email: false, verified_email: null })
            }
          >
            No
          </button>
        </div>
        {form.can_send_email && (
          <div className="mt-3 space-y-2">
            <div className="rounded-md border border-[#E5D5B5] bg-[#F7ECD2] px-3 py-2 text-xs text-[#6B4E1A]">
              <strong>Heads up:</strong> you&apos;ll need to verify this email
              with a 6-digit code before you can continue. We store the
              verified address with this agent so it knows where to send
              results — nothing else. We never email you outside of this
              agent&apos;s runs.
            </div>
            <EmailVerify
              verifiedEmail={form.verified_email}
              onVerified={(email) => setForm({ ...form, verified_email: email })}
            />
          </div>
        )}
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
              <label className="label">Time (Central)</label>
              <input
                type="time"
                className="input"
                value={utcHHMMSSToChicagoHHMM(
                  form.schedule_time ?? DEFAULT_SCHEDULE_UTC
                )}
                onChange={(e) =>
                  setForm({
                    ...form,
                    schedule_time: chicagoHHMMToUTCHHMMSS(e.target.value),
                  })
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
