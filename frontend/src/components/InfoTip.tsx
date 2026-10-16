"use client";

import { type ReactNode, useCallback, useId, useLayoutEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { GLOSSARY, type GlossaryKey } from "@/lib/glossary";

const WIDTH = 280;
const MARGIN = 8;

interface Props {
  /** A glossary entry, or free text. */
  term?: GlossaryKey;
  text?: ReactNode;
  className?: string;
}

/**
 * Small "i" badge that explains a value on hover or keyboard focus.
 * Rendered in a portal with fixed positioning so scrollable tables don't clip it.
 */
export function InfoTip({ term, text, className }: Props) {
  const entry = term ? GLOSSARY[term] : null;
  const body = text ?? entry?.text;
  const id = useId();
  const anchor = useRef<HTMLSpanElement>(null);
  const bubble = useRef<HTMLDivElement>(null);
  const [open, setOpen] = useState(false);
  const [pos, setPos] = useState<{ top: number; left: number } | null>(null);

  const place = useCallback(() => {
    const a = anchor.current?.getBoundingClientRect();
    const height = bubble.current?.offsetHeight ?? 0;
    if (!a) return;
    const left = Math.min(Math.max(MARGIN, a.left + a.width / 2 - WIDTH / 2), window.innerWidth - WIDTH - MARGIN);
    const above = a.top - height - 6;
    setPos({ left, top: above >= MARGIN ? above : a.bottom + 6 });
  }, []);

  useLayoutEffect(() => {
    if (open) place();
  }, [open, place]);

  if (!body) return null;

  return (
    <>
      <span
        ref={anchor}
        tabIndex={0}
        role="button"
        aria-describedby={open ? id : undefined}
        aria-label={entry?.title ? `About ${entry.title}` : "More information"}
        onMouseEnter={() => setOpen(true)}
        onMouseLeave={() => setOpen(false)}
        onFocus={() => setOpen(true)}
        onBlur={() => setOpen(false)}
        onClick={(e) => e.stopPropagation()}
        className={`ml-1 inline-flex h-3.5 w-3.5 shrink-0 cursor-help select-none items-center justify-center rounded-full border border-slate-600 align-middle text-[9px] font-semibold normal-case leading-none tracking-normal text-slate-400 hover:border-sky-400 hover:text-sky-300 focus:border-sky-400 focus:text-sky-300 focus:outline-none ${className ?? ""}`}
      >
        i
      </span>
      {open &&
        createPortal(
          <div
            ref={bubble}
            id={id}
            role="tooltip"
            style={{ width: WIDTH, top: pos?.top ?? -9999, left: pos?.left ?? -9999 }}
            className="pointer-events-none fixed z-50 rounded-lg border border-slate-700 bg-slate-900 px-3 py-2 text-left text-xs font-normal normal-case leading-relaxed tracking-normal text-slate-300 shadow-xl"
          >
            {entry?.title && <div className="mb-0.5 font-semibold text-slate-100">{entry.title}</div>}
            {body}
          </div>,
          document.body,
        )}
    </>
  );
}

/** Label followed by an info badge, for table headers and stat labels. */
export function Term({ children, term, text }: { children: ReactNode; term?: GlossaryKey; text?: ReactNode }) {
  return (
    <span className="inline-flex items-center">
      {children}
      <InfoTip term={term} text={text} />
    </span>
  );
}
