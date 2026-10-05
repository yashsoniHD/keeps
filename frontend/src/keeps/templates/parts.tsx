// Shared building blocks for the per-type note templates. Text only (never HTML from the
// model); every outbound link goes through OutLink's scheme check.
import { useState, type ReactNode } from "react";
import type { LucideIcon } from "lucide-react";
import type { R } from "../toView";
import type { NoteView } from "../view";

export interface TemplateProps {
  view: NoteView;
  data: R;
}

const ICON = { size: 19, strokeWidth: 1.65, "aria-hidden": true } as const;

export function Section({
  title,
  icon: Ico,
  className = "",
  children,
}: {
  title: string;
  icon?: LucideIcon;
  className?: string;
  children: ReactNode;
}) {
  return (
    <section className={`knowledge-block ${className}`}>
      <h2>
        {Ico && <Ico {...ICON} />}
        {title}
      </h2>
      {children}
    </section>
  );
}

/** "At a glance" chips; "Label: value" strings render the label small above the value. */
export function Glance({ facts, title = "At a glance" }: { facts: string[]; title?: string }) {
  if (!facts.length) return null;
  return (
    <Section title={title} className="block-facts">
      <div className="facts glance">
        {facts.map((f, i) => {
          const at = f.indexOf(": ");
          return at > 0 ? (
            <span key={i}>
              <em>{f.slice(0, at)}</em>
              {f.slice(at + 2)}
            </span>
          ) : (
            <span key={i}>{f}</span>
          );
        })}
      </div>
    </Section>
  );
}

/** Tap a row to tick it off. State is local (resets per note; the page keys the body by note). */
export function Checklist({ items }: { items: string[] }) {
  const [done, setDone] = useState<Set<number>>(() => new Set());
  const toggle = (i: number) =>
    setDone((old) => {
      const next = new Set(old);
      if (!next.delete(i)) next.add(i);
      return next;
    });
  return (
    <ul className="ingredient-list">
      {items.map((item, i) => (
        <li key={i}>
          <label className={done.has(i) ? "checked" : ""}>
            <input type="checkbox" checked={done.has(i)} onChange={() => toggle(i)} />
            <span>{item}</span>
          </label>
        </li>
      ))}
    </ul>
  );
}

export function Steps({ items }: { items: string[] }) {
  return (
    <ol className="t-steps">
      {items.map((x, i) => (
        <li key={i}>
          <span className="step-number" aria-hidden="true">
            {i + 1}
          </span>
          <span>{x}</span>
        </li>
      ))}
    </ol>
  );
}

export function Bullets({ items }: { items: string[] }) {
  return (
    <ul>
      {items.map((x, i) => (
        <li key={i}>{x}</li>
      ))}
    </ul>
  );
}

export function Chips({ items, icon: Ico }: { items: string[]; icon?: LucideIcon }) {
  if (!items.length) return null;
  return (
    <ul className="t-chips">
      {Ico && <Ico size={16} strokeWidth={1.65} aria-hidden="true" className="t-chips-icon" />}
      {items.map((x, i) => (
        <li key={i}>{x}</li>
      ))}
    </ul>
  );
}

export function LabelValues({ rows }: { rows: { label: string; value: string }[] }) {
  if (!rows.length) return null;
  return (
    <dl className="t-specs">
      {rows.map((r, i) => (
        <div key={i}>
          <dt>{r.label}</dt>
          <dd>{r.value}</dd>
        </div>
      ))}
    </dl>
  );
}

export function PullQuotes({ quotes }: { quotes: { text: string; by: string }[] }) {
  return (
    <div className="t-quotes">
      {quotes.map((q, i) => (
        <blockquote key={i} className="t-quote">
          <p>{q.text}</p>
          {q.by && <cite>{q.by}</cite>}
        </blockquote>
      ))}
    </div>
  );
}

export function Callout({
  title,
  icon,
  children,
}: {
  title: string;
  icon?: LucideIcon;
  children: ReactNode;
}) {
  return (
    <Section title={title} icon={icon} className="t-callout">
      {children}
    </Section>
  );
}

// http(s) and tel: only; anything else (javascript:, data:, intent:) renders nothing.
const SAFE_HREF = /^(https?:\/\/|tel:)/i;

export function OutLink({
  href,
  className,
  label,
  children,
}: {
  href: string;
  className?: string;
  label?: string;
  children: ReactNode;
}) {
  const h = typeof href === "string" ? href.trim() : "";
  if (!SAFE_HREF.test(h)) return null;
  const external = !/^tel:/i.test(h);
  return (
    <a
      className={className}
      href={h}
      aria-label={label}
      {...(external ? { target: "_blank", rel: "noopener noreferrer" } : {})}
    >
      {children}
    </a>
  );
}

/** Image that removes itself if it fails to load (hot-linked CDN URLs expire). */
export function Img({ src, alt, className }: { src: string; alt: string; className?: string }) {
  const [failed, setFailed] = useState(false);
  if (!src || failed) return null;
  return (
    <img className={className} src={src} alt={alt} loading="lazy" onError={() => setFailed(true)} />
  );
}
