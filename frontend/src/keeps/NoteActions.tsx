import { useEffect, useRef, useState } from "react";
import { Loader2 } from "lucide-react";
import { useAuth } from "@/contexts/auth-context";
import { useCapture } from "@/components/CaptureProvider";
import { ApiError, deleteNote, reextractNote, updateNote } from "@/lib/api";
import { getUserCategories, slugifyCategory } from "@/lib/firestore";
import type { Note } from "@/lib/types";
import { Icon, Sheet, Toast, type IconName } from "./ui";
import type { NoteView } from "./view";

type Mode = "menu" | "edit" | "regenerate" | "delete";
const TITLES: Record<Mode, string> = {
  menu: "Note actions",
  edit: "Edit note",
  regenerate: "Regenerate note",
  delete: "Delete note",
};

export function NoteActions({
  view,
  onClose,
  onDeleted,
  onUpdated,
  onReextract,
}: {
  view: NoteView;
  onClose: () => void;
  onDeleted?: () => void;
  onUpdated?: (patch: Partial<Note>) => void;
  onReextract?: () => void;
}) {
  const { user } = useAuth();
  const { notify } = useCapture();
  const [mode, setMode] = useState<Mode>("menu");
  const [title, setTitle] = useState(view.title);
  const [summary, setSummary] = useState(view.summary);
  const [category, setCategory] = useState(view.categorySlug);
  const [categories, setCategories] = useState<string[]>([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [toast, setToast] = useState("");

  // Sheet only focuses on first mount; refocus when the mode switches so focus stays in the trap.
  const bodyRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    bodyRef.current?.querySelector<HTMLElement>("[data-initial-focus]")?.focus();
  }, [mode]);

  const closeTimer = useRef<ReturnType<typeof setTimeout>>(undefined);
  useEffect(() => () => clearTimeout(closeTimer.current), []);

  // The confirm button opens under the pointer that tapped "Delete note"; stay disarmed
  // briefly so a double-tap can't delete.
  const [armed, setArmed] = useState(false);
  useEffect(() => {
    if (mode !== "delete") return setArmed(false);
    const t = setTimeout(() => setArmed(true), 600);
    return () => clearTimeout(t);
  }, [mode]);

  useEffect(() => {
    if (user)
      getUserCategories(user.uid)
        .then(setCategories)
        .catch(() => {});
  }, [user]);

  const back = () => {
    setError("");
    setMode("menu");
  };
  const fail = (e: unknown, fallback: string) =>
    setError(
      (typeof navigator !== "undefined" && !navigator.onLine ? "You're offline. " : "") +
        (e instanceof ApiError ? e.message : fallback),
    );

  async function save(e: React.FormEvent) {
    e.preventDefault();
    const patch: Partial<Note> = {};
    if (title.trim() && title.trim() !== view.title) patch.title = title.trim();
    if (summary.trim() !== view.summary) patch.ai_summary = summary.trim();
    const slug = slugifyCategory(category);
    if (slug && slug !== view.categorySlug) patch.content_type = slug;
    if (!Object.keys(patch).length) return onClose();
    setBusy(true);
    setError("");
    try {
      await updateNote(view.id, patch);
      onUpdated?.(patch);
      notify("Saved");
      onClose();
    } catch (err) {
      fail(err, "Couldn't update the note.");
      setBusy(false);
    }
  }

  async function regenerate() {
    if (onReextract) {
      onReextract();
      return onClose();
    }
    setBusy(true);
    setError("");
    try {
      await reextractNote(view.id);
      setBusy(false);
      setToast("Regenerating. The note will update when it's ready.");
      closeTimer.current = setTimeout(onClose, 1800);
    } catch (err) {
      fail(err, "Couldn't regenerate this note. Please try again.");
      setBusy(false);
    }
  }

  async function remove() {
    setBusy(true);
    setError("");
    try {
      await deleteNote(view.id);
      onDeleted?.();
      notify("Note deleted");
      onClose();
    } catch (err) {
      fail(err, "Couldn't delete the note.");
      setBusy(false);
    }
  }

  const menu: [Exclude<Mode, "menu"> | "open", string, IconName][] = [
    ["edit", "Edit note", "BookOpen"],
    ["regenerate", "Regenerate note", "RotateCcw"],
    ["open", "Open original", "ExternalLink"],
    ["delete", "Delete note", "Trash2"],
  ];

  return (
    <Sheet title={TITLES[mode]} onClose={onClose}>
      <div ref={bodyRef}>
        {mode === "menu" ? (
          <div className="action-list">
            {menu.map(([key, label, icon], i) => (
              <button
                key={key}
                type="button"
                className={key === "delete" ? "danger" : ""}
                data-initial-focus={i === 0 ? "" : undefined}
                onClick={() => {
                  if (key !== "open") return setMode(key);
                  window.open(view.url, "_blank", "noopener,noreferrer");
                  onClose();
                }}
              >
                <Icon name={icon} />
                {label}
                <Icon name="ChevronRight" size={16} />
              </button>
            ))}
          </div>
        ) : mode === "edit" ? (
          <form onSubmit={save}>
            <label className="field-label">
              Title
              <input
                required
                maxLength={300}
                value={title}
                onChange={(e) => setTitle(e.target.value)}
                data-initial-focus
              />
            </label>
            <label className="field-label">
              In short
              <textarea
                rows={4}
                maxLength={2000}
                value={summary}
                onChange={(e) => setSummary(e.target.value)}
              />
            </label>
            <label className="field-label">
              Category
              <input
                list="keeps-categories"
                value={category}
                onChange={(e) => setCategory(e.target.value)}
              />
              <datalist id="keeps-categories">
                {categories.map((c) => (
                  <option key={c} value={c} />
                ))}
              </datalist>
            </label>
            {error && (
              <p className="error-text" role="alert">
                {error}
              </p>
            )}
            <div className="row">
              <button type="submit" className="primary" disabled={busy}>
                {busy ? "Saving…" : "Save changes"}
              </button>
              <button type="button" className="secondary" onClick={back}>
                Cancel
              </button>
            </div>
          </form>
        ) : mode === "regenerate" ? (
          <>
            <p className="sheet-description">
              The note is rebuilt from the original source and replaces what is here now. This
              counts toward your daily limit.
            </p>
            {error && (
              <p className="error-text" role="alert">
                {error}
              </p>
            )}
            <div className="row">
              <button
                type="button"
                className="primary"
                disabled={busy}
                onClick={regenerate}
                data-initial-focus
              >
                {busy ? "Starting…" : "Regenerate"}
              </button>
              <button type="button" className="secondary" onClick={back}>
                Cancel
              </button>
            </div>
            {toast && <Toast message={toast} onDismiss={onClose} />}
          </>
        ) : (
          <>
            <p className="sheet-description">“{view.title}” will be permanently deleted.</p>
            {error && (
              <p className="error-text" role="alert">
                {error}
              </p>
            )}
            <div className="row confirm-stack">
              <button type="button" className="secondary" onClick={back} data-initial-focus>
                Keep it
              </button>
              <button
                type="button"
                className="primary danger-button"
                disabled={busy || !armed}
                onClick={remove}
              >
                {busy ? <Loader2 size={16} className="spin" aria-hidden="true" /> : "Delete note"}
              </button>
            </div>
          </>
        )}
      </div>
    </Sheet>
  );
}
