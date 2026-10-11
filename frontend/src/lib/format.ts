type N = number | null | undefined;

const isNum = (v: N): v is number => typeof v === "number" && Number.isFinite(v);

export function pct(v: N, digits = 2): string {
  return isNum(v) ? `${(v * 100).toFixed(digits)}%` : "—";
}

/** For values already expressed in percent (e.g. Yahoo's regularMarketChangePercent). */
export function pctRaw(v: N, digits = 2): string {
  return isNum(v) ? `${v.toFixed(digits)}%` : "—";
}

export function num(v: N, digits = 2): string {
  return isNum(v) ? v.toLocaleString(undefined, { minimumFractionDigits: digits, maximumFractionDigits: digits }) : "—";
}

export function compact(v: N, digits = 2): string {
  if (!isNum(v)) return "—";
  return new Intl.NumberFormat(undefined, { notation: "compact", maximumFractionDigits: digits }).format(v);
}

export function money(v: N, currency?: string | null, digits = 2): string {
  if (!isNum(v)) return "—";
  try {
    return new Intl.NumberFormat(undefined, {
      style: "currency",
      currency: currency || "USD",
      minimumFractionDigits: digits,
      maximumFractionDigits: digits,
    }).format(v);
  } catch {
    return num(v, digits);
  }
}

export function compactMoney(v: N, currency?: string | null): string {
  if (!isNum(v)) return "—";
  try {
    return new Intl.NumberFormat(undefined, {
      style: "currency",
      currency: currency || "USD",
      notation: "compact",
      maximumFractionDigits: 2,
    }).format(v);
  } catch {
    return compact(v);
  }
}

/** Tailwind text color for a signed value. */
export function signColor(v: N): string {
  if (!isNum(v) || v === 0) return "";
  return v > 0 ? "text-emerald-400" : "text-rose-400";
}

export const PERIODS = [
  { value: "1mo", label: "1M" },
  { value: "3mo", label: "3M" },
  { value: "6mo", label: "6M" },
  { value: "ytd", label: "YTD" },
  { value: "1y", label: "1Y" },
  { value: "2y", label: "2Y" },
  { value: "5y", label: "5Y" },
  { value: "10y", label: "10Y" },
  { value: "max", label: "Max" },
];

export const PALETTE = ["#60a5fa", "#f59e0b", "#34d399", "#f472b6", "#a78bfa", "#22d3ee", "#fb7185", "#a3e635", "#fbbf24", "#94a3b8"];
