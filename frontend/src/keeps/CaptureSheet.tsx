import { useEffect, useState } from "react";
import { getNote } from "@/lib/firestore";
import { Icon, Sheet, Thumbnail } from "./ui";
import { toView } from "./toView";
import type { NoteView } from "./view";

// One trimmed token that reads as a web address: http(s) URL or a bare domain/path.
const looksLikeUrl = (s: string) =>
  /^https?:\/\/\S+$/i.test(s) || /^[a-z0-9-]+(\.[a-z0-9-]+)+(\/\S*)?$/i.test(s);

/** The "Save a link" sheet. Links only; calls onSubmit with the trimmed raw value. */
export function CaptureSheet({
  onSubmit,
  onClose,
}: {
  onSubmit: (raw: string) => void;
  onClose: () => void;
}) {
  const [url, setUrl] = useState("");
  const [error, setError] = useState("");
  return (
    <Sheet title="Save a link" onClose={onClose}>
      <p className="muted sheet-description">Articles, posts, videos, or any web page.</p>
      <form
        onSubmit={(e) => {
          e.preventDefault();
          const v = url.trim();
          if (!looksLikeUrl(v)) {
            setError("Enter a web link, such as example.com/article.");
            return;
          }
          onSubmit(v);
        }}
      >
        <label className="field-label">
          Link
          <input
            type="text"
            inputMode="url"
            autoCapitalize="off"
            autoCorrect="off"
            spellCheck={false}
            placeholder="https://…"
            value={url}
            onChange={(e) => setUrl(e.target.value)}
            required
            data-initial-focus
          />
        </label>
        {error && (
          <p className="error-text" role="alert">
            {error}
          </p>
        )}
        <button className="primary wide" type="submit">
          <Icon name="Plus" size={18} />
          Save link
        </button>
      </form>
    </Sheet>
  );
}

/** Duplicate-capture notice: the link is already a note. Loads the note for context. */
export function SavedSheet({
  noteId,
  onClose,
  onView,
}: {
  noteId: string;
  onClose: () => void;
  onView: () => void;
}) {
  const [view, setView] = useState<NoteView | null>(null);
  useEffect(() => {
    let live = true;
    getNote(noteId)
      .then((n) => live && n && setView(toView(n)))
      .catch(() => {});
    return () => {
      live = false;
    };
  }, [noteId]);
  return (
    <Sheet title="Already saved" onClose={onClose}>
      <div className="saved-state">
        <span className="saved-check">
          <Icon name="Check" size={30} />
        </span>
        <h2>Already in your library</h2>
        <p>{view ? `Saved ${view.age.toLowerCase()}` : "You already saved this link."}</p>
        {view && (
          <div className="saved-source">
            <Thumbnail note={view} />
            <span>
              {view.title}
              <small>{view.platform}</small>
            </span>
          </div>
        )}
        <button type="button" className="primary wide" onClick={onView} data-initial-focus>
          View note
          <Icon name="ChevronRight" size={17} />
        </button>
      </div>
    </Sheet>
  );
}
