const MINUTE = 60_000;
const HOUR = 60 * MINUTE;
const DAY = 24 * HOUR;
const UNITS = ["B", "KB", "MB", "GB", "TB"] as const;

/** Medida legible para cuotas y archivos: el número crudo se guarda, aquí solo se presenta. */
export function formatBytes(bytes: number): string {
  if (!Number.isFinite(bytes) || bytes < 0) return "0 B";
  let value = bytes;
  let unit = 0;
  while (value >= 1024 && unit < UNITS.length - 1) {
    value /= 1024;
    unit += 1;
  }
  const rounded = unit === 0 ? value : Math.round(value * 10) / 10;
  return `${new Intl.NumberFormat("es", { maximumFractionDigits: 1 }).format(rounded)} ${UNITS[unit]}`;
}

export function relativeTime(iso: string): string {
  const then = new Date(iso).getTime();
  if (Number.isNaN(then)) return "—";
  const diff = Date.now() - then;
  const rtf = new Intl.RelativeTimeFormat("es", { numeric: "auto" });
  if (diff < MINUTE) return rtf.format(-Math.round(diff / 1000), "second");
  if (diff < HOUR) return rtf.format(-Math.round(diff / MINUTE), "minute");
  if (diff < DAY) return rtf.format(-Math.round(diff / HOUR), "hour");
  if (diff < 30 * DAY) return rtf.format(-Math.round(diff / DAY), "day");
  return new Intl.DateTimeFormat("es", { dateStyle: "medium" }).format(new Date(then));
}

export function parseTags(raw: string): string[] {
  const seen = new Set<string>();
  for (const part of raw.split(/[,\n]/)) {
    const tag = part.trim();
    if (tag) seen.add(tag);
  }
  return [...seen];
}
