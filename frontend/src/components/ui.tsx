"use client";

import type { GlossaryKey } from "@/lib/glossary";
import { Term } from "./InfoTip";
import type { ButtonHTMLAttributes, InputHTMLAttributes, ReactNode, SelectHTMLAttributes } from "react";

const cx = (...classes: (string | false | null | undefined)[]) => classes.filter(Boolean).join(" ");

export function PageHeader({ title, subtitle, actions }: { title: ReactNode; subtitle?: ReactNode; actions?: ReactNode }) {
  return (
    <div className="mb-6 flex flex-wrap items-end justify-between gap-4">
      <div>
        <h1 className="text-2xl font-semibold text-white">{title}</h1>
        {subtitle && <p className="mt-1 text-sm text-slate-400">{subtitle}</p>}
      </div>
      {actions && <div className="flex flex-wrap items-center gap-2">{actions}</div>}
    </div>
  );
}

export function Card({ title, actions, children, className, term }: { title?: ReactNode; actions?: ReactNode; children: ReactNode; className?: string; term?: GlossaryKey }) {
  return (
    <section className={cx("rounded-xl border border-slate-800 bg-slate-900/60 p-4", className)}>
      {(title || actions) && (
        <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
          {title && <h2 className="text-sm font-semibold uppercase tracking-wide text-slate-400">{term ? <Term term={term}>{title}</Term> : title}</h2>}
          {actions}
        </div>
      )}
      {children}
    </section>
  );
}

export function Stat({ label, value, hint, className, term, info }: { label: string; value: ReactNode; hint?: ReactNode; className?: string; term?: GlossaryKey; info?: ReactNode }) {
  return (
    <div className="rounded-lg border border-slate-800 bg-slate-900 px-4 py-3">
      <div className="text-xs uppercase tracking-wide text-slate-500">
        {term || info ? (
          <Term term={term} text={info}>
            {label}
          </Term>
        ) : (
          label
        )}
      </div>
      <div className={cx("tabular mt-1 text-xl font-semibold text-white", className)}>{value}</div>
      {hint && <div className="mt-0.5 text-xs text-slate-500">{hint}</div>}
    </div>
  );
}

type ButtonProps = ButtonHTMLAttributes<HTMLButtonElement> & { variant?: "primary" | "secondary" | "ghost" | "danger"; size?: "sm" | "md" };

export function Button({ variant = "secondary", size = "md", className, ...props }: ButtonProps) {
  return (
    <button
      {...props}
      className={cx(
        "inline-flex items-center justify-center gap-1.5 rounded-md font-medium transition disabled:cursor-not-allowed disabled:opacity-50",
        size === "sm" ? "px-2.5 py-1 text-xs" : "px-3.5 py-2 text-sm",
        variant === "primary" && "bg-sky-600 text-white hover:bg-sky-500",
        variant === "secondary" && "border border-slate-700 bg-slate-800 text-slate-200 hover:bg-slate-700",
        variant === "ghost" && "text-slate-400 hover:bg-slate-800 hover:text-slate-200",
        variant === "danger" && "text-rose-400 hover:bg-rose-500/10",
        className,
      )}
    />
  );
}

export function Input({ className, ...props }: InputHTMLAttributes<HTMLInputElement>) {
  return (
    <input
      {...props}
      className={cx(
        "rounded-md border border-slate-700 bg-slate-950 px-3 py-2 text-sm text-slate-100 placeholder:text-slate-600 focus:border-sky-500 focus:outline-none",
        className,
      )}
    />
  );
}

export function Select({ className, children, ...props }: SelectHTMLAttributes<HTMLSelectElement>) {
  return (
    <select
      {...props}
      className={cx("rounded-md border border-slate-700 bg-slate-950 px-3 py-2 text-sm text-slate-100 focus:border-sky-500 focus:outline-none", className)}
    >
      {children}
    </select>
  );
}

export function Field({ label, children, className, term }: { label: string; children: ReactNode; className?: string; term?: GlossaryKey }) {
  return (
    <label className={cx("flex flex-col gap-1 text-xs text-slate-400", className)}>
      {term ? <Term term={term}>{label}</Term> : label}
      {children}
    </label>
  );
}

/** Pill-style single choice, used for periods and frequency toggles. */
export function Segmented<T extends string>({ options, value, onChange }: { options: { value: T; label: string }[]; value: T; onChange: (v: T) => void }) {
  return (
    <div className="inline-flex rounded-md border border-slate-700 bg-slate-950 p-0.5">
      {options.map((o) => (
        <button
          key={o.value}
          type="button"
          onClick={() => onChange(o.value)}
          className={cx(
            "rounded px-2.5 py-1 text-xs font-medium transition",
            o.value === value ? "bg-slate-700 text-white" : "text-slate-400 hover:text-slate-200",
          )}
        >
          {o.label}
        </button>
      ))}
    </div>
  );
}

/** Page links (0-based pages): first, last and a window around the current one. */
export function Pager({ page, pages, onPage }: { page: number; pages: number; onPage: (p: number) => void }) {
  if (pages <= 1) return null;
  // First, last, and a window around the current page.
  const shown = [...new Set([0, pages - 1, page - 2, page - 1, page, page + 1, page + 2])].filter((p) => p >= 0 && p < pages).sort((a, b) => a - b);
  return (
    <nav className="flex flex-wrap items-center gap-1" aria-label="Pagination">
      <Button size="sm" variant="ghost" disabled={page === 0} onClick={() => onPage(page - 1)} aria-label="Previous page">
        ‹ Prev
      </Button>
      {shown.map((p, i) => (
        <span key={p} className="flex items-center">
          {i > 0 && p - shown[i - 1] > 1 && <span className="px-1 text-slate-600">…</span>}
          <button
            onClick={() => onPage(p)}
            aria-current={p === page ? "page" : undefined}
            className={cx("min-w-8 rounded px-2 py-1 text-xs tabular", p === page ? "bg-sky-600 text-white" : "text-slate-400 hover:bg-slate-800")}
          >
            {p + 1}
          </button>
        </span>
      ))}
      <Button size="sm" variant="ghost" disabled={page >= pages - 1} onClick={() => onPage(page + 1)} aria-label="Next page">
        Next ›
      </Button>
    </nav>
  );
}

export function Spinner({ label = "Loading…" }: { label?: string }) {
  return (
    <div className="flex items-center gap-2 py-6 text-sm text-slate-400">
      <span className="h-4 w-4 animate-spin rounded-full border-2 border-slate-600 border-t-sky-400" />
      {label}
    </div>
  );
}

export function ErrorBox({ error }: { error: unknown }) {
  if (!error) return null;
  const message = error instanceof Error ? error.message : String(error);
  return <div className="rounded-md border border-rose-900 bg-rose-950/40 px-3 py-2 text-sm text-rose-300">{message}</div>;
}

export function Empty({ children }: { children: ReactNode }) {
  return <div className="rounded-lg border border-dashed border-slate-800 px-4 py-8 text-center text-sm text-slate-500">{children}</div>;
}

export { cx };
