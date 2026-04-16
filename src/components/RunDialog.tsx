"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import type { InputConfig } from "@/components/CreateFlow/types";

const ACCEPTED_EXTENSIONS = ".txt,.docx,.csv,.md";
const ACCEPTED_EXT_LIST = [".txt", ".docx", ".csv", ".md"];

function readFileAsText(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    if (file.name.endsWith(".docx")) {
      reader.onload = () => {
        const base64 = (reader.result as string).split(",")[1] ?? "";
        resolve(base64);
      };
      reader.onerror = reject;
      reader.readAsDataURL(file);
    } else {
      reader.onload = () => resolve(reader.result as string);
      reader.onerror = reject;
      reader.readAsText(file);
    }
  });
}

interface Props {
  appId: string;
  slug: string;
  agentName: string;
  inputConfig: InputConfig;
  onClose: () => void;
}

export function RunDialog({ appId, slug, agentName, inputConfig, onClose }: Props) {
  const router = useRouter();
  const [inputText, setInputText] = useState("");
  const [inputUrl, setInputUrl] = useState("");
  const [slotFiles, setSlotFiles] = useState<(File | null)[]>(() =>
    inputConfig.file.enabled ? inputConfig.file.slots.map(() => null) : []
  );
  const [busy, setBusy] = useState(false);

  const hasAnyInput =
    inputConfig.text.enabled || inputConfig.url.enabled || inputConfig.file.enabled;

  // Gate "Run" on required slots having a file.
  const requiredSlotsSatisfied = inputConfig.file.enabled
    ? inputConfig.file.slots.every((s, i) => !s.required || !!slotFiles[i])
    : true;

  async function handleRun() {
    setBusy(true);
    try {
      const files: { label: string; content: string; filename: string }[] = [];
      if (inputConfig.file.enabled) {
        for (let i = 0; i < inputConfig.file.slots.length; i++) {
          const f = slotFiles[i];
          const slot = inputConfig.file.slots[i];
          if (!f) {
            // Optional slot, left empty. Send an empty marker so the
            // runtime can still expose the slot's label.
            files.push({ label: slot.label, content: "", filename: "" });
            continue;
          }
          const content = await readFileAsText(f);
          files.push({ label: slot.label, content, filename: f.name });
        }
      }

      const res = await fetch("/api/internal/run", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          app_id: appId,
          run_type: "manual",
          input_text: inputConfig.text.enabled ? inputText || null : null,
          input_url: inputConfig.url.enabled ? inputUrl || null : null,
          files: inputConfig.file.enabled ? files : undefined,
        }),
      });
      const body = await res.json();
      if (res.ok) {
        router.push(`/agents/${slug}/runs/${body.run_id}`);
      } else {
        alert(body.error || "Run failed");
      }
    } finally {
      setBusy(false);
    }
  }

  function handleSlotFileChange(
    idx: number,
    e: React.ChangeEvent<HTMLInputElement>
  ) {
    const f = e.target.files?.[0];
    if (!f) return;
    const ext = f.name.slice(f.name.lastIndexOf(".")).toLowerCase();
    if (!ACCEPTED_EXT_LIST.includes(ext)) {
      alert("Unsupported file type. Supported: .txt, .docx, .csv, .md");
      e.target.value = "";
      return;
    }
    setSlotFiles((prev) => {
      const next = [...prev];
      next[idx] = f;
      return next;
    });
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4">
      <div className="card w-full max-w-lg space-y-4 p-6">
        <h3 className="text-lg font-semibold">{agentName} — Run</h3>

        {!hasAnyInput && (
          <p className="text-sm text-[color:var(--color-muted-foreground)]">
            This agent runs on its own — no input needed.
          </p>
        )}

        {inputConfig.text.enabled && (
          <div>
            <label className="label">
              {inputConfig.text.label || "Text input"}
            </label>
            {inputConfig.text.size === "long" ? (
              <textarea
                className="input min-h-[120px]"
                value={inputText}
                onChange={(e) => setInputText(e.target.value)}
              />
            ) : (
              <input
                className="input"
                value={inputText}
                onChange={(e) => setInputText(e.target.value)}
              />
            )}
          </div>
        )}

        {inputConfig.url.enabled && (
          <div>
            <label className="label">
              {inputConfig.url.label || "URL"}
            </label>
            <input
              className="input"
              type="url"
              placeholder="https://"
              value={inputUrl}
              onChange={(e) => setInputUrl(e.target.value)}
            />
          </div>
        )}

        {inputConfig.file.enabled &&
          inputConfig.file.slots.map((slot, idx) => {
            const file = slotFiles[idx];
            const labelText = slot.label || `File ${idx + 1}`;
            return (
              <div key={idx}>
                <label className="label">
                  {labelText}
                  {slot.required ? (
                    <span className="ml-1 text-[#B3413A]">*</span>
                  ) : (
                    <span className="ml-1 text-[color:var(--color-muted-foreground)]">
                      (optional)
                    </span>
                  )}
                </label>
                <input
                  type="file"
                  accept={ACCEPTED_EXTENSIONS}
                  className="input"
                  onChange={(e) => handleSlotFileChange(idx, e)}
                />
                {file && (
                  <p className="mt-1 text-xs text-[color:var(--color-muted-foreground)]">
                    {file.name} — {(file.size / 1024).toFixed(1)} KB
                  </p>
                )}
              </div>
            );
          })}

        {inputConfig.file.enabled && (
          <p className="text-xs text-[color:var(--color-muted-foreground)]">
            Supported: .txt, .docx, .csv, .md
          </p>
        )}

        <div className="flex justify-end gap-2 pt-2">
          <button
            type="button"
            className="btn-secondary"
            onClick={onClose}
            disabled={busy}
          >
            Cancel
          </button>
          <button
            type="button"
            className="btn-primary"
            onClick={handleRun}
            disabled={busy || !requiredSlotsSatisfied}
          >
            {busy ? "Starting…" : "Run Agent"}
          </button>
        </div>
      </div>
    </div>
  );
}
