import {
  createContext,
  useContext,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
  type ReactNode,
} from "react";
import { createPortal } from "react-dom";
import { Check, ChevronRight, FolderInput, Trash2 } from "lucide-react";
import type { Note } from "@/lib/types";
import { deleteNote, updateNote } from "@/lib/api";
import { noteIcon, noteLabel } from "@/lib/note-meta";

// Per-card menu context: the user's category slugs (for "Recategorise"), provided once by the
// feed so every card's menu has them without prop-drilling. Safe default: no targets.
type MenuCtx = { categories: string[] };
const MenuContext = createContext<MenuCtx>({ categories: [] });

export function NoteMenuProvider({
  categories,
  children,
}: {
  categories: string[];
  children: ReactNode;
}) {
  return <MenuContext.Provider value={{ categories }}>{children}</MenuContext.Provider>;
}

// Wraps a feed card and opens a context menu on right-click (desktop) or long-press (touch).
// Uses `display: contents` so it adds no box of its own — the wrapped <Link> stays the grid
// item / flex row, preserving equal-height cards and the row dividers.
export function WithNoteMenu({ note, children }: { note: Note; children: ReactNode }) {
  const { categories } = useContext(MenuContext);
  const [menu, setMenu] = useState<{ x: number; y: number } | null>(null);
  const suppressClick = useRef(false);
  const longPress = useRef<number | null>(null);
  const touchStart = useRef<{ x: number; y: number } | null>(null);

  const cancelLong = () => {
    if (longPress.current) {
      clearTimeout(longPress.current);
      longPress.current = null;
    }
  };
  useEffect(() => cancelLong, []);

  const onContextMenu = (e: React.MouseEvent) => {
    e.preventDefault();
    e.stopPropagation();
    setMenu({ x: e.clientX, y: e.clientY });
  };

  const onTouchStart = (e: React.TouchEvent) => {
    if (e.touches.length !== 1) return;
    const t = e.touches[0];
    touchStart.current = { x: t.clientX, y: t.clientY };
    longPress.current = window.setTimeout(() => {
      suppressClick.current = true; // swallow the click that follows finger-lift
      navigator.vibrate?.(10);
      setMenu({ x: t.clientX, y: t.clientY });
    }, 450);
  };
  const onTouchMove = (e: React.TouchEvent) => {
    const s = touchStart.current;
    if (!s) return;
    const t = e.touches[0];
    if (Math.hypot(t.clientX - s.x, t.clientY - s.y) > 10) cancelLong(); // it's a scroll, not a hold
  };
  // Capture-phase: if a long-press just opened the menu, cancel the card's navigation click.
  const onClickCapture = (e: React.MouseEvent) => {
    if (suppressClick.current) {
      e.preventDefault();
      e.stopPropagation();
      suppressClick.current = false;
    }
  };

  return (
    <div
      className="contents"
      onContextMenu={onContextMenu}
      onTouchStart={onTouchStart}
      onTouchMove={onTouchMove}
      onTouchEnd={cancelLong}
      onTouchCancel={cancelLong}
      onClickCapture={onClickCapture}
    >
      {children}
      {menu && (
        <NoteMenu note={note} categories={categories} pos={menu} onClose={() => setMenu(null)} />
      )}
    </div>
  );
}

function MenuItem({
  icon: Icon,
  label,
  onClick,
  danger,
  trailing,
}: {
  icon: typeof Trash2;
  label: string;
  onClick: () => void;
  danger?: boolean;
  trailing?: ReactNode;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={`flex w-full items-center gap-2.5 rounded-xl px-2.5 py-2 text-left text-sm transition-colors ${
        danger ? "text-destructive hover:bg-destructive/10" : "text-ink hover:bg-ink/5"
      }`}
    >
      <Icon className="h-4 w-4 shrink-0" />
      <span className="flex-1 truncate">{label}</span>
      {trailing}
    </button>
  );
}

function NoteMenu({
  note,
  categories,
  pos,
  onClose,
}: {
  note: Note;
  categories: string[];
  pos: { x: number; y: number };
  onClose: () => void;
}) {
  const [view, setView] = useState<"main" | "recat">("main");
  const [confirmDelete, setConfirmDelete] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  const [coords, setCoords] = useState(pos);

  // Clamp the menu inside the viewport once its real size is known (and again if the view
  // swaps to the taller category list).
  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    const { width, height } = el.getBoundingClientRect();
    const pad = 8;
    setCoords({
      x: Math.max(pad, Math.min(pos.x, window.innerWidth - width - pad)),
      y: Math.max(pad, Math.min(pos.y, window.innerHeight - height - pad)),
    });
  }, [pos, view]);

  // A page scroll or resize invalidates the anchor — close rather than float in the wrong spot.
  // But ignore scrolls that originate *inside* the menu (e.g. the recategorise list's own
  // overflow), otherwise scrolling to a category below the fold instantly closes the menu.
  useEffect(() => {
    const onScroll = (e: Event) => {
      if (ref.current && e.target instanceof Node && ref.current.contains(e.target)) return;
      onClose();
    };
    window.addEventListener("scroll", onScroll, true);
    window.addEventListener("resize", onClose);
    return () => {
      window.removeEventListener("scroll", onScroll, true);
      window.removeEventListener("resize", onClose);
    };
  }, [onClose]);

  const recategorise = async (slug: string) => {
    onClose();
    try {
      await updateNote(note.id, { content_type: slug }); // feed onSnapshot reflects the change
    } catch {
      /* leave it; the user can retry */
    }
  };

  const del = async () => {
    if (!confirmDelete) {
      setConfirmDelete(true);
      return;
    }
    onClose();
    await deleteNote(note.id).catch(() => {}); // feed onSnapshot removes the card
  };

  const recatTargets = categories.filter((c) => c !== note.content_type);

  return createPortal(
    <>
      {/* Outside-tap catcher — also swallows a right-click so it closes instead of opening
          the browser menu over the notes behind it. */}
      <div
        className="fixed inset-0 z-[70]"
        aria-hidden
        onClick={onClose}
        onContextMenu={(e) => {
          e.preventDefault();
          onClose();
        }}
      />
      <div
        ref={ref}
        role="menu"
        style={{ top: coords.y, left: coords.x }}
        className="fixed z-[71] w-56 overflow-hidden rounded-2xl border border-border bg-popover p-1.5 shadow-2xl"
      >
        {view === "main" ? (
          <>
            {recatTargets.length > 0 && (
              <MenuItem
                icon={FolderInput}
                label="Recategorise"
                onClick={() => setView("recat")}
                trailing={<ChevronRight className="h-4 w-4 shrink-0 text-ink-soft" />}
              />
            )}
            <MenuItem
              icon={Trash2}
              label={confirmDelete ? "Tap again to delete" : "Delete"}
              onClick={del}
              danger
            />
          </>
        ) : (
          <div className="max-h-64 overflow-y-auto">
            <div className="px-2.5 py-1.5 text-xs font-medium uppercase tracking-wide text-ink-soft">
              Move to
            </div>
            {recatTargets.map((c) => {
              const Icon = noteIcon(c);
              return (
                <button
                  key={c}
                  type="button"
                  onClick={() => recategorise(c)}
                  className="flex w-full items-center gap-2.5 rounded-xl px-2.5 py-2 text-left text-sm capitalize text-ink transition-colors hover:bg-ink/5"
                >
                  <Icon className="h-4 w-4 shrink-0 text-ink-soft" />
                  <span className="flex-1 truncate">{noteLabel(c)}</span>
                  {c === note.content_type && <Check className="h-4 w-4 shrink-0 text-ink" />}
                </button>
              );
            })}
          </div>
        )}
      </div>
    </>,
    document.body,
  );
}
