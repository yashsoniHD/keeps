// Keeps UI primitives. Styled by ./keeps.css; consume NoteView/Block from ./view.
import {
  useEffect,
  useRef,
  useState,
  type PointerEvent as RPointerEvent,
  type ReactNode,
} from "react";
import {
  ArrowUpRight,
  BookOpen,
  Bookmark,
  Check,
  CheckCircle2,
  ChevronLeft,
  ChevronRight,
  Copy,
  ExternalLink,
  HelpCircle,
  Link,
  Loader2,
  MoreHorizontal,
  Play,
  Plus,
  RotateCcw,
  Search,
  Settings,
  Share2,
  Trash2,
  WifiOff,
  X,
} from "lucide-react";
import { noteAccent, noteIcon, noteLabel } from "@/lib/note-meta";
import type { Block, NoteView } from "./view";

const icons = {
  ArrowUpRight,
  BookOpen,
  Bookmark,
  Check,
  CheckCircle2,
  ChevronLeft,
  ChevronRight,
  Copy,
  ExternalLink,
  HelpCircle,
  Link,
  Loader2,
  MoreHorizontal,
  Play,
  Plus,
  RotateCcw,
  Search,
  Settings,
  Share2,
  Trash2,
  WifiOff,
  X,
};
export type IconName = keyof typeof icons;

export function Icon({
  name,
  size = 20,
  className,
}: {
  name: IconName;
  size?: number;
  className?: string;
}) {
  const C = icons[name];
  return <C size={size} strokeWidth={1.65} aria-hidden="true" className={className} />;
}

export function IconButton({
  icon,
  label,
  onClick,
  active = false,
}: {
  icon: IconName;
  label: string;
  onClick: () => void;
  active?: boolean;
}) {
  return (
    <button
      type="button"
      className={`icon-button ${active ? "active" : ""}`}
      aria-label={label}
      title={label}
      onClick={onClick}
    >
      <Icon name={icon} />
    </button>
  );
}

export function Logo() {
  return (
    <span className="brand">
      <span className="brand-symbol">
        <Bookmark size={21} strokeWidth={2} aria-hidden="true" />
      </span>
      keeps<span className="brand-dot">.</span>
    </span>
  );
}

export function Thumbnail({ note, large = false }: { note: NoteView; large?: boolean }) {
  const [failed, setFailed] = useState(false);
  useEffect(() => setFailed(false), [note.image]);
  return (
    <div className={`thumbnail ${large ? "large" : ""}`}>
      {note.image && !failed ? (
        <img src={note.image} alt="" loading="lazy" onError={() => setFailed(true)} />
      ) : (
        <Icon name="BookOpen" size={28} />
      )}
      {large && note.duration && (
        <span className="play-overlay">
          <Icon name="Play" size={18} />
        </span>
      )}
    </div>
  );
}

const PLATFORM_GLYPH: Record<string, string> = { instagram: "◎", youtube: "▶", tiktok: "♪" };

export function Source({ note }: { note: NoteView }) {
  const key = note.platform.toLowerCase();
  return (
    <span className="source">
      <span className={`platform ${key}`}>
        {Object.hasOwn(PLATFORM_GLYPH, key) ? PLATFORM_GLYPH[key] : "↗"}
      </span>
      {note.platform}
      <span className="meta-dot">·</span>
      {note.age}
    </span>
  );
}

/** Coloured category pill: palette + icon come from the slug (stable for AI-invented slugs). */
export function CategoryChip({ slug, label }: { slug: string; label?: string }) {
  const Ico = noteIcon(slug);
  return (
    <span className={`category-tag ${noteAccent(slug).chip}`}>
      <Ico size={13} strokeWidth={1.65} aria-hidden="true" />
      {label ?? noteLabel(slug)}
    </span>
  );
}

export function NoteRow({
  note,
  onOpen,
  onActions,
  description,
}: {
  note: NoteView;
  onOpen: (note: NoteView) => void;
  onActions: (note: NoteView) => void;
  description?: ReactNode;
}) {
  return (
    <article
      className="note-row"
      onClick={(e) => {
        // Mouse convenience for the row padding; keyboard/AT use the real button below.
        if (!(e.target as HTMLElement).closest("button")) onOpen(note);
      }}
    >
      <button type="button" className="note-open" onClick={() => onOpen(note)}>
        <Thumbnail note={note} />
        <div className="note-copy">
          <h3>{note.title}</h3>
          <p>{description ?? note.summary}</p>
          <div className="note-meta">
            <CategoryChip slug={note.categorySlug} label={note.category} />
            {note.thin && <span className="note-thin">Caption only</span>}
          </div>
        </div>
      </button>
      <IconButton
        icon="MoreHorizontal"
        label={`Actions for ${note.title}`}
        onClick={() => onActions(note)}
      />
    </article>
  );
}

export function SearchInput({
  value,
  onChange,
  placeholder,
  autoFocus = false,
}: {
  value: string;
  onChange: (v: string) => void;
  placeholder: string;
  autoFocus?: boolean;
}) {
  return (
    <div className="search-field">
      <Icon name="Search" />
      <input
        type="search"
        aria-label={placeholder}
        placeholder={placeholder}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        autoFocus={autoFocus}
      />
      {value && <IconButton icon="X" label="Clear search" onClick={() => onChange("")} />}
    </div>
  );
}

export function EmptyState({
  title,
  description,
  children,
}: {
  title: string;
  description: string;
  children?: ReactNode;
}) {
  return (
    <div className="empty-state">
      <span className="empty-mark">
        <Icon name="Bookmark" size={30} />
      </span>
      <h2>{title}</h2>
      <p>{description}</p>
      {children}
    </div>
  );
}

let lastSheetTrigger: HTMLElement | null = null;
const FOCUSABLE =
  "button:not([disabled]),input:not([disabled]),select:not([disabled]),textarea:not([disabled]),a[href]";

/** Modal bottom sheet: focus trap, Escape/backdrop close, restores focus on close.
 *  Put `data-initial-focus` on the element that should receive focus first. */
export function Sheet({
  title,
  children,
  onClose,
}: {
  title: string;
  children: ReactNode;
  onClose: () => void;
}) {
  const ref = useRef<HTMLDivElement>(null);
  const onCloseRef = useRef(onClose);
  onCloseRef.current = onClose;
  const drag = useRef<{ id: number; y0: number; t0: number; y: number; t: number } | null>(null);
  const reduced = () => window.matchMedia("(prefers-reduced-motion: reduce)").matches;
  // Drag-down-to-dismiss from the handle/header (touch + pen). Follows the finger; closes past
  // 100px or on a fast flick, otherwise springs back.
  const zone = {
    onPointerDown: (e: RPointerEvent) => {
      if (drag.current) return; // a second finger must not hijack the active drag
      if (e.pointerType === "mouse" || (e.target as HTMLElement).closest("button")) return;
      e.currentTarget.setPointerCapture(e.pointerId);
      drag.current = {
        id: e.pointerId,
        y0: e.clientY,
        t0: e.timeStamp,
        y: e.clientY,
        t: e.timeStamp,
      };
      if (ref.current) ref.current.style.transition = "none";
    },
    onPointerMove: (e: RPointerEvent) => {
      const d = drag.current;
      if (!d || d.id !== e.pointerId || !ref.current) return;
      d.y = e.clientY;
      d.t = e.timeStamp;
      ref.current.style.transform = `translateY(${Math.max(0, e.clientY - d.y0)}px)`;
    },
    onPointerUp: (e: RPointerEvent) => {
      const d = drag.current;
      const el = ref.current;
      drag.current = null;
      if (!d || !el) return;
      const dy = Math.max(0, e.clientY - d.y0);
      const v = dy / Math.max(1, e.timeStamp - d.t0);
      const motion = !reduced();
      if (dy > 100 || (dy > 30 && v > 0.6)) {
        if (!motion) return onCloseRef.current();
        el.style.transition = "transform 0.18s ease-in";
        el.style.transform = "translateY(100%)";
        window.setTimeout(() => onCloseRef.current(), 170);
      } else {
        el.style.transition = motion ? "transform 0.3s cubic-bezier(0.2, 0.9, 0.3, 1.2)" : "none";
        el.style.transform = "";
      }
    },
    onPointerCancel: () => {
      drag.current = null;
      if (ref.current) {
        ref.current.style.transition = reduced()
          ? "none"
          : "transform 0.3s cubic-bezier(0.2, 0.9, 0.3, 1.2)";
        ref.current.style.transform = "";
      }
    },
  };
  useEffect(() => {
    const previous = document.activeElement as HTMLElement | null;
    if (
      previous &&
      previous !== document.body &&
      previous.isConnected &&
      !previous.closest('[role="dialog"]')
    ) {
      lastSheetTrigger = previous;
    }
    const returnTo = lastSheetTrigger;
    const original = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    (ref.current?.querySelector<HTMLElement>("[data-initial-focus]") || ref.current)?.focus();
    const handler = (e: KeyboardEvent) => {
      if (e.key === "Escape") onCloseRef.current();
      if (e.key !== "Tab") return;
      const els = ref.current?.querySelectorAll<HTMLElement>(FOCUSABLE);
      if (!els?.length) return;
      const first = els[0];
      const last = els[els.length - 1];
      const active = document.activeElement;
      if (e.shiftKey && (active === first || active === ref.current)) {
        e.preventDefault();
        last.focus();
      } else if (!e.shiftKey && (active === last || active === ref.current)) {
        e.preventDefault();
        first.focus();
      }
    };
    document.addEventListener("keydown", handler);
    return () => {
      document.body.style.overflow = original;
      document.removeEventListener("keydown", handler);
      if (returnTo?.isConnected) returnTo.focus();
    };
  }, []);
  return (
    <div
      className="sheet-backdrop"
      onMouseDown={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div
        className="sheet"
        role="dialog"
        aria-modal="true"
        aria-label={title}
        tabIndex={-1}
        ref={ref}
      >
        <div className="sheet-handle sheet-handle-zone" {...zone} />
        <header className="sheet-handle-zone" {...zone}>
          <h2>{title}</h2>
          <IconButton icon="X" label="Close dialog" onClick={onClose} />
        </header>
        {children}
      </div>
    </div>
  );
}

function Checklist({ items }: { items: string[] }) {
  const [checked, setChecked] = useState<number[]>([]);
  return (
    <ul className="ingredient-list">
      {items.map((item, i) => (
        <li key={i}>
          <label className={checked.includes(i) ? "checked" : ""}>
            <input
              type="checkbox"
              checked={checked.includes(i)}
              onChange={() =>
                setChecked((old) => (old.includes(i) ? old.filter((x) => x !== i) : [...old, i]))
              }
            />
            <span>{item}</span>
          </label>
        </li>
      ))}
    </ul>
  );
}

export function KnowledgeBlock({ block }: { block: Block }) {
  return (
    <section className={`knowledge-block block-${block.kind}`}>
      {block.heading && <h2>{block.heading}</h2>}
      {block.image && <img className="block-image" src={block.image} alt="" loading="lazy" />}
      {block.kind === "table" ? (
        <div
          className="document-table-scroll"
          role="region"
          aria-label={block.heading || "Comparison"}
          tabIndex={0}
        >
          <table>
            <thead>
              <tr>
                {block.columns?.map((column, i) => (
                  <th key={i} scope="col">
                    {column}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {block.rows?.map((row, i) => (
                <tr key={i}>
                  {row.map((cell, j) => (
                    <td key={j}>{cell}</td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : block.kind === "quote" ? (
        <blockquote>
          {block.items.map((item, i) => (
            <p key={i}>{item}</p>
          ))}
        </blockquote>
      ) : block.kind === "code" ? (
        <pre>
          <code>{block.items.join("\n")}</code>
        </pre>
      ) : block.kind === "facts" ? (
        <div className="facts">
          {block.items.map((x, i) => {
            const at = x.indexOf(": ");
            return at > 0 ? (
              <span key={i}>
                <em>{x.slice(0, at)}</em>
                {x.slice(at + 2)}
              </span>
            ) : (
              <span key={i}>{x}</span>
            );
          })}
        </div>
      ) : block.kind === "checklist" ? (
        <Checklist items={block.items} />
      ) : block.kind === "steps" ? (
        <ol>
          {block.items.map((x, i) => (
            <li key={i}>
              <span className="step-number">{i + 1}</span>
              <span>{x}</span>
            </li>
          ))}
        </ol>
      ) : block.kind === "list" ? (
        <ul>
          {block.items.map((x, i) => (
            <li key={i}>{x}</li>
          ))}
        </ul>
      ) : (
        block.items.map((x, i) => <p key={i}>{x}</p>)
      )}
      {block.links && block.links.length > 0 && (
        <div className="block-links">
          {block.links.map((l) => (
            <a
              key={l.url}
              className="block-link"
              href={l.url}
              target="_blank"
              rel="noopener noreferrer"
            >
              {l.label}
              <Icon name="ArrowUpRight" size={14} />
            </a>
          ))}
        </div>
      )}
      {block.credit && <small className="block-credit">{block.credit}</small>}
    </section>
  );
}

export function Toggle({
  label,
  value,
  onChange,
  description,
}: {
  label: string;
  value: boolean;
  onChange: () => void;
  description?: string;
}) {
  return (
    <div className="setting-row">
      <span>
        {label}
        {description && <small>{description}</small>}
      </span>
      <button
        type="button"
        role="switch"
        aria-checked={value}
        aria-label={label}
        className={`toggle ${value ? "on" : ""}`}
        onClick={onChange}
      >
        <span />
      </button>
    </div>
  );
}

/** Transient message. Render conditionally; the caller owns the auto-dismiss timer (errors should persist). */
export function Toast({
  message,
  onDismiss,
  icon = "CheckCircle2",
  error = false,
}: {
  message: string;
  onDismiss: () => void;
  icon?: IconName;
  error?: boolean;
}) {
  return (
    <div className="toast" role={error ? "alert" : "status"}>
      <Icon name={icon} size={18} />
      {message}
      <button type="button" aria-label="Dismiss message" onClick={onDismiss}>
        <Icon name="X" size={15} />
      </button>
    </div>
  );
}
