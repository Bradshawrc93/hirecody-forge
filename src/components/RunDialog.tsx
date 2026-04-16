"use client";

import { useRef, useState } from "react";
import { useRouter } from "next/navigation";
import type { InputConfig } from "@/components/CreateFlow/types";

const ACCEPTED_EXTENSIONS = ".txt,.docx,.csv,.md";

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
  const [file, setFile] = useState<File | null>(null);
  const [busy, setBusy] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);

  const hasAnyInput = inputConfig.text.enabled || inputConfig.url.enabled || inputConfig.file.enabled;

  async function handleRun() {
    setBusy(true);
    try {
      let fileText: string | null = null;
      let fileName: string | null = null;
      if (file) {
        fileText = await readFileAsText(file);
        fileName = file.name;
      }

      const res = await fetch("/api/internal/run", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          app_id: appId,
          run_type: "manual",
          input_text: inputConfig.text.enabled ? inputText || null : null,
          input_url: inputConfig.url.enabled ? inputUrl || null : null,
          file_text: fileText,
          file_name: fileName,
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

  function handleFileChange(e: React.ChangeEvent<HTMLInputElement>) {
    const f = e.target.files?.[0];
    if (!f) return;
    const ext = f.name.slice(f.name.lastIndexOf(".")).toLowerCase();
    if (![".txt", ".docx", ".csv", ".md"].includes(ext)) {
      alert("Unsupported file type. Supported: .txt, .docx, .csv, .md");
      e.target.value = "";
      return;
    }
    setFile(f);
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

        {inputConfig.file.enabled && (
          <div>
            <label className="label">
              {inputConfig.file.label || "Upload a file"}
            </label>
            <input
              ref={fileRef}
              type="file"
              accept={ACCEPTED_EXTENSIONS}
              className="input"
              onChange={handleFileChange}
            />
            {file && (
              <p className="mt-1 text-xs text-[color:var(--color-muted-foreground)]">
                {file.name} — {(file.size / 1024).toFixed(1)} KB
              </p>
            )}
            <p className="mt-1 text-xs text-[color:var(--color-muted-foreground)]">
              Supported: .txt, .docx, .csv, .md
            </p>
          </div>
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
            disabled={busy}
          >
            {busy ? "Starting…" : "Run Agent"}
          </button>
        </div>
      </div>
    </div>
  );
}
