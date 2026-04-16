export function StepIndicator({ step }: { step: 1 | 2 | 3 | 4 | 5 }) {
  const labels = ["Describe", "Capabilities", "Success", "Build", "Test"];
  return (
    <div className="flex w-full flex-wrap items-center gap-x-2 gap-y-2">
      {labels.map((label, i) => {
        const idx = i + 1;
        const active = idx === step;
        const done = idx < step;
        return (
          <div key={label} className="flex items-center gap-2">
            <div
              className={`flex h-6 w-6 shrink-0 items-center justify-center rounded-full text-[11px] font-bold transition-colors ${
                active
                  ? "bg-[#C56A2D] text-white"
                  : done
                  ? "bg-[#C56A2D]/30 text-[#7A3F12]"
                  : "bg-[color:var(--color-card)] text-[color:var(--color-muted-foreground)]"
              }`}
            >
              {idx}
            </div>
            <span
              className={`text-xs ${
                active
                  ? "font-semibold text-[color:var(--color-foreground)]"
                  : "text-[color:var(--color-muted-foreground)]"
              }`}
            >
              {label}
            </span>
            {idx < 5 && (
              <div className="h-px w-3 shrink-0 bg-[color:var(--color-border)] sm:w-5" />
            )}
          </div>
        );
      })}
    </div>
  );
}
