export function relativeTime(iso?: string | null): string {
  if (!iso) return "—";
  const then = new Date(iso).getTime();
  const now = Date.now();
  const diffMs = then - now;
  const future = diffMs > 0;
  const suffix = future ? "" : " ago";
  const prefix = future ? "in " : "";
  const abs = Math.abs(diffMs);
  const sec = Math.floor(abs / 1000);
  if (sec < 60) return `${prefix}${sec}s${suffix}`;
  const min = Math.floor(sec / 60);
  if (min < 60) return `${prefix}${min}m${suffix}`;
  const hr = Math.floor(min / 60);
  if (hr < 24) return `${prefix}${hr}h${suffix}`;
  const day = Math.floor(hr / 24);
  if (day < 30) return `${prefix}${day}d${suffix}`;
  const mo = Math.floor(day / 30);
  if (mo < 12) return `${prefix}${mo}mo${suffix}`;
  const yr = Math.floor(day / 365);
  return `${prefix}${yr}y${suffix}`;
}

export function truncate(s: string | null | undefined, n: number): string {
  if (!s) return "";
  return s.length > n ? s.slice(0, n - 1) + "…" : s;
}

export function slugify(s: string): string {
  return s
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 60);
}

export function formatCost(usd?: number | null): string {
  if (usd == null) return "—";
  if (usd < 0.01) return `$${usd.toFixed(4)}`;
  return `$${usd.toFixed(2)}`;
}

// Convert a UTC "HH:MM" or "HH:MM:SS" wall-clock string into a Chicago-local
// 12-hour display like "8:00 PM CT". DST-aware via the IANA tz database.
export function formatScheduleTimeCT(utc?: string | null): string {
  if (!utc) return "—";
  const [hhStr, mmStr] = utc.split(":");
  const hh = Number(hhStr);
  const mm = Number(mmStr);
  if (Number.isNaN(hh) || Number.isNaN(mm)) return utc;
  const probe = new Date();
  probe.setUTCHours(hh, mm, 0, 0);
  return (
    new Intl.DateTimeFormat("en-US", {
      timeZone: "America/Chicago",
      hour: "numeric",
      minute: "2-digit",
      hour12: true,
    }).format(probe) + " CT"
  );
}

export function formatDuration(ms?: number | null): string {
  if (ms == null) return "—";
  if (ms < 1000) return `${ms}ms`;
  const s = ms / 1000;
  if (s < 60) return `${s.toFixed(1)}s`;
  const m = Math.floor(s / 60);
  const rem = Math.floor(s % 60);
  return `${m}m ${rem}s`;
}
