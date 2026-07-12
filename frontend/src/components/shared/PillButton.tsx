// The house primary CTA: a rounded-full ink pill. This is the single source of truth for
// that pattern (previously hand-rolled ~30x with drifting padding + missing focus rings).
//
//   variant: "primary"   → bg-ink text-paper           (the main call to action)
//            "secondary" → border bg-card text-ink     (paired/neutral action)
//   size:    "sm"  → px-3.5 py-1.5   ·  "md" → px-5 py-2.5   (both text-sm)
//
// Every pill always carries FOCUS_RING (keyboard focus is visible) and the reduced-motion-safe
// `press` utility. Layout utilities (w-full, flex-1, ml-auto, mt-*, shrink-0) and — for the few
// documented exceptions — padding overrides are passed via `className` and win through tailwind-merge.
import { createLink } from "@tanstack/react-router";
import { forwardRef } from "react";
import type { AnchorHTMLAttributes, ButtonHTMLAttributes, ReactNode } from "react";
import { cn } from "@/lib/utils";
import { FOCUS_RING, PRESS } from "@/lib/ui";

export type PillVariant = "primary" | "secondary";
export type PillSize = "sm" | "md";

const VARIANT: Record<PillVariant, string> = {
  primary: "bg-ink text-paper hover:opacity-90 disabled:opacity-50",
  secondary: "border border-border bg-card text-ink hover:bg-accent disabled:opacity-50",
};

const SIZE: Record<PillSize, string> = {
  sm: "px-3.5 py-1.5",
  md: "px-5 py-2.5",
};

// Exported so call sites that must stay raw (custom element/props) can share the exact classes.
export function pillClasses(
  variant: PillVariant = "primary",
  size: PillSize = "md",
  extra?: string,
) {
  return cn(
    "inline-flex items-center justify-center gap-1.5 rounded-full text-sm font-medium transition-[transform,opacity,color,background-color,box-shadow]",
    PRESS,
    FOCUS_RING,
    VARIANT[variant],
    SIZE[size],
    extra,
  );
}

type SharedProps = {
  variant?: PillVariant;
  size?: PillSize;
  className?: string;
  children: ReactNode;
};

export function PillButton({
  variant = "primary",
  size = "md",
  className,
  children,
  ...rest
}: SharedProps & ButtonHTMLAttributes<HTMLButtonElement>) {
  return (
    <button className={pillClasses(variant, size, className)} {...rest}>
      {children}
    </button>
  );
}

// createLink wraps our styled anchor so TanStack keeps full `to`/`params`/`search` type inference
// (a plain wrapper component collapses the router generics and breaks typed params).
type PillAnchorProps = SharedProps & Omit<AnchorHTMLAttributes<HTMLAnchorElement>, "className">;

const PillAnchor = forwardRef<HTMLAnchorElement, PillAnchorProps>(
  ({ variant = "primary", size = "md", className, children, ...rest }, ref) => (
    <a ref={ref} className={pillClasses(variant, size, className)} {...rest}>
      {children}
    </a>
  ),
);
PillAnchor.displayName = "PillAnchor";

export const PillLink = createLink(PillAnchor);
