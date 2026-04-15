"use client";

import { useEffect, useState } from "react";
import { Check, Mail } from "lucide-react";

interface Props {
  verifiedEmail: string | null;
  onVerified: (email: string) => void;
}

export function EmailVerify({ verifiedEmail, onVerified }: Props) {
  const [email, setEmail] = useState("");
  const [code, setCode] = useState("");
  const [stage, setStage] = useState<"idle" | "code" | "done">(
    verifiedEmail ? "done" : "idle"
  );
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [expiresAt, setExpiresAt] = useState<number | null>(null);
  const [now, setNow] = useState(Date.now());

  useEffect(() => {
    if (stage !== "code") return;
    const t = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(t);
  }, [stage]);

  const remaining =
    expiresAt && stage === "code" ? Math.max(0, Math.floor((expiresAt - now) / 1000)) : 0;

  async function sendCode() {
    setError(null);
    setBusy(true);
    try {
      const res = await fetch("/api/internal/email/send", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ email }),
      });
      const body = await res.json();
      if (!res.ok) {
        setError(body.error || "Failed to send code");
        return;
      }
      setExpiresAt(Date.now() + (body.expires_in_seconds ?? 600) * 1000);
      setStage("code");
    } finally {
      setBusy(false);
    }
  }

  async function verifyCode() {
    setError(null);
    setBusy(true);
    try {
      const res = await fetch("/api/internal/email/verify", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ email, code }),
      });
      const body = await res.json();
      if (!res.ok) {
        setError(
          res.status === 410
            ? "Code expired — request a new one"
            : res.status === 429
            ? "Too many attempts — try again later"
            : body.error || "Wrong code"
        );
        return;
      }
      setStage("done");
      onVerified(email);
    } finally {
      setBusy(false);
    }
  }

  if (stage === "done") {
    return (
      <div className="flex items-center gap-2 rounded-md bg-[#D9EBD7] px-3 py-2 text-sm font-medium text-[#27592A]">
        <Check size={16} />
        Verified: {verifiedEmail || email}
      </div>
    );
  }

  return (
    <div className="space-y-2">
      <div className="flex gap-2">
        <input
          type="email"
          className="input"
          placeholder="you@example.com"
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          disabled={stage !== "idle"}
        />
        {stage === "idle" && (
          <button
            type="button"
            className="btn-primary whitespace-nowrap"
            onClick={sendCode}
            disabled={!email || busy}
          >
            <Mail size={14} className="mr-1 inline" /> Send code
          </button>
        )}
      </div>
      {stage === "code" && (
        <div className="space-y-2">
          <div className="flex gap-2">
            <input
              type="text"
              inputMode="numeric"
              maxLength={6}
              className="input font-mono tracking-widest"
              placeholder="123456"
              value={code}
              onChange={(e) => setCode(e.target.value.replace(/\D/g, ""))}
            />
            <button
              type="button"
              className="btn-primary"
              onClick={verifyCode}
              disabled={code.length !== 6 || busy}
            >
              Verify
            </button>
          </div>
          <div className="text-xs text-[color:var(--color-muted-foreground)]">
            {remaining > 0
              ? `Expires in ${Math.floor(remaining / 60)}:${String(remaining % 60).padStart(2, "0")}`
              : "Code expired"}
          </div>
        </div>
      )}
      {error && <div className="text-xs text-[#7A1F1A]">{error}</div>}
    </div>
  );
}
