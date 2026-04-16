"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Pause, Play, Play as PlayIcon, Trash2, Copy } from "lucide-react";
import type { AgentRecord } from "@/lib/obs";
import type { InputConfig } from "@/components/CreateFlow/types";
import { DEFAULT_INPUT_CONFIG } from "@/components/CreateFlow/types";
import { RunDialog } from "./RunDialog";

interface Props {
  appId: string;
  slug: string;
  agentName: string;
  status: AgentRecord["status"];
  inputConfig?: InputConfig;
  formSnapshot?: Record<string, unknown>;
}

export function AgentActions({ appId, slug, agentName, status, inputConfig, formSnapshot }: Props) {
  const router = useRouter();
  const [optimisticStatus, setOptimisticStatus] = useState(status);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [showRunDialog, setShowRunDialog] = useState(false);
  const [busy, setBusy] = useState(false);

  const resolvedConfig = inputConfig ?? DEFAULT_INPUT_CONFIG;
  const hasAnyInput = resolvedConfig.text.enabled || resolvedConfig.url.enabled || resolvedConfig.file.enabled;

  function runNow() {
    if (hasAnyInput) {
      setShowRunDialog(true);
    } else {
      fireRun();
    }
  }

  async function fireRun() {
    setBusy(true);
    try {
      const res = await fetch("/api/internal/run", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ app_id: appId, run_type: "manual" }),
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

  async function togglePause() {
    const next = optimisticStatus === "active" ? "paused" : "active";
    setOptimisticStatus(next);
    const res = await fetch("/api/internal/toggle-pause", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ app_id: appId, target: next }),
    });
    if (!res.ok) setOptimisticStatus(status);
    else router.refresh();
  }

  function clone() {
    if (formSnapshot) {
      sessionStorage.setItem("forge_clone", JSON.stringify(formSnapshot));
    }
    router.push("/create?clone=" + slug);
  }

  async function doDelete() {
    setBusy(true);
    const res = await fetch("/api/internal/delete-agent", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ app_id: appId }),
    });
    setBusy(false);
    if (res.ok) router.push("/");
    else alert("Delete failed");
  }

  const isActive = optimisticStatus === "active";
  const canRun = isActive || optimisticStatus === "awaiting_test" || optimisticStatus === "paused";

  return (
    <div className="flex flex-wrap items-center gap-2">
      {canRun && (
        <button
          type="button"
          className="btn-primary"
          onClick={runNow}
          disabled={busy}
        >
          <PlayIcon size={14} className="mr-1 inline" /> Run Now
        </button>
      )}
      {(isActive || optimisticStatus === "paused") && (
        <button
          type="button"
          className="btn-secondary"
          onClick={togglePause}
        >
          {isActive ? (
            <>
              <Pause size={14} className="mr-1 inline" /> Pause
            </>
          ) : (
            <>
              <Play size={14} className="mr-1 inline" /> Resume
            </>
          )}
        </button>
      )}
      <button type="button" className="btn-secondary" onClick={clone}>
        <Copy size={14} className="mr-1 inline" /> Clone
      </button>
      <button
        type="button"
        className="btn-secondary"
        onClick={() => setConfirmDelete(true)}
      >
        <Trash2 size={14} className="mr-1 inline" /> Delete
      </button>

      {showRunDialog && (
        <RunDialog
          appId={appId}
          slug={slug}
          agentName={agentName}
          inputConfig={resolvedConfig}
          onClose={() => setShowRunDialog(false)}
        />
      )}

      {confirmDelete && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40">
          <div className="card w-full max-w-md p-6">
            <h3 className="text-lg font-semibold">Delete this agent?</h3>
            <p className="mt-2 text-sm text-[color:var(--color-muted-foreground)]">
              This cannot be undone. The agent and its api key will be
              removed.
            </p>
            <div className="mt-5 flex justify-end gap-2">
              <button
                type="button"
                className="btn-secondary"
                onClick={() => setConfirmDelete(false)}
              >
                Cancel
              </button>
              <button
                type="button"
                className="btn-primary"
                style={{ background: "#B3413A" }}
                onClick={doDelete}
                disabled={busy}
              >
                Delete agent
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
