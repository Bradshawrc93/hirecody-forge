"use client";

import { ArrowLeft } from "lucide-react";
import { useEffect, useState } from "react";

export function BackButton() {
  const [show, setShow] = useState(true);
  useEffect(() => {
    if (typeof window !== "undefined" && window.self !== window.top) {
      setShow(false);
    }
  }, []);
  if (!show) return null;
  return (
    <a
      href="https://www.hirecody.dev/apps#probes"
      className="shrink-0 inline-flex items-center gap-2 rounded-md bg-[color:var(--color-primary)] px-3 py-1.5 text-sm font-bold text-[color:var(--color-primary-foreground)] transition-colors hover:bg-[#24624A]"
      aria-label="Back to hirecody.dev/apps"
    >
      <ArrowLeft size={16} className="shrink-0" />
      <span>Back</span>
    </a>
  );
}
