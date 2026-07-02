import { useRef, useState } from "react";
import { ArrowLeft, Sparkles, Sparkle, Link2, AlignLeft, ImagePlus, Mic } from "lucide-react";
import { VoiceRecorder } from "@/components/VoiceRecorder";
import { FOCUS_RING } from "@/lib/ui";

// The four capture modes shown in the picker. Upload jumps straight to the file dialog
// (no sub-view); the others open a focused sub-view. Tints reuse the note-type theme
// tokens so the icon tiles work in dark mode for free.
const CAPTURE_MODES = [
  {
    key: "link",
    icon: Link2,
    tile: "bg-tech-soft text-tech",
    title: "Paste a link",
    desc: "Article, video, post",
  },
  {
    key: "text",
    icon: AlignLeft,
    tile: "bg-muted text-ink-soft",
    title: "Write a note",
    desc: "Type or paste text",
  },
  {
    key: "upload",
    icon: ImagePlus,
    tile: "bg-itinerary-soft text-itinerary",
    title: "Upload a file",
    desc: "Image, video, audio, PDF, text",
  },
  {
    key: "voice",
    icon: Mic,
    tile: "bg-health-soft text-health",
    title: "Voice note",
    desc: "Record & transcribe",
  },
] as const;

// Shared capture composer used by both the Notes feed and the Library home. Purely
// presentational: the caller supplies the ingest handlers, so each screen wires its own
// optimistic/confirmation behaviour.
export function AddNoteSheet({
  url,
  setUrl,
  onCancel,
  onSubmit,
  onSubmitText,
  onUploadFile,
  onUploadVoice,
}: {
  url: string;
  setUrl: (v: string) => void;
  onCancel: () => void;
  onSubmit: (u: string) => void;
  onSubmitText: (text: string, title?: string, processAI?: boolean) => void;
  onUploadFile: (file: File, kind: "image" | "pdf" | "video" | "voice") => Promise<void>;
  onUploadVoice: (blob: Blob) => Promise<void>;
}) {
  // Menu-first: the sheet opens on the picker, never on an input — so no keyboard springs
  // up and (since we no longer read the clipboard on mount) no desktop "Paste" prompt fires.
  const [view, setView] = useState<"menu" | "link" | "text" | "voice">("menu");
  const [text, setText] = useState("");
  const [title, setTitle] = useState("");
  // Whether a typed note is structured by Clip AI (default) or saved verbatim.
  const [processAI, setProcessAI] = useState(true);
  const [uploading, setUploading] = useState(false);
  const [fileError, setFileError] = useState<string | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);

  const onFilePicked = async (file: File | undefined) => {
    if (!file) return;
    // Plain-text files have no bytes worth uploading — read them client-side and save
    // through the typed-note path (which Clip AI then structures).
    const isTextFile = file.type.startsWith("text/") || /\.(txt|md|markdown)$/i.test(file.name);
    if (isTextFile) {
      setFileError(null);
      setUploading(true);
      try {
        const content = await file.text();
        if (!content.trim()) throw new Error("That file is empty.");
        onSubmitText(content, file.name.replace(/\.(txt|md|markdown)$/i, ""), true); // closes the sheet
      } catch (e) {
        setUploading(false);
        setFileError(e instanceof Error ? e.message : "Couldn't read that file.");
      }
      return;
    }
    const kind: "image" | "pdf" | "video" | "voice" | null = file.type.startsWith("image/")
      ? "image"
      : file.type === "application/pdf"
        ? "pdf"
        : file.type.startsWith("video/")
          ? "video"
          : file.type.startsWith("audio/")
            ? "voice"
            : null;
    if (!kind) {
      setFileError("Pick an image, video, audio file, PDF, or text file.");
      return;
    }
    setFileError(null);
    setUploading(true);
    try {
      await onUploadFile(file, kind); // closes the sheet on success
    } catch (e) {
      setUploading(false);
      setFileError(e instanceof Error ? e.message : "Couldn't add that file.");
    }
  };

  const pick = (key: (typeof CAPTURE_MODES)[number]["key"]) => {
    if (key === "upload") fileRef.current?.click();
    else setView(key);
  };

  // A back arrow that returns to the picker — sub-views are one tap from the menu.
  const Back = () => (
    <button
      type="button"
      onClick={() => setView("menu")}
      aria-label="Back"
      className="-ml-1 inline-flex h-8 w-8 items-center justify-center rounded-full text-ink-soft transition-colors hover:text-ink"
    >
      <ArrowLeft className="h-5 w-5" />
    </button>
  );

  return (
    <div
      data-no-refresh
      className="fixed inset-0 z-50 flex items-center justify-center bg-ink/40 p-4 backdrop-blur-sm"
    >
      <div className="max-h-[88vh] w-full max-w-md overflow-y-auto rounded-3xl border border-border bg-card p-5 shadow-2xl">
        {/* Hidden file input lives at the top level so the "Upload a file" card can trigger it
            from the menu without a dedicated sub-view. */}
        <input
          ref={fileRef}
          type="file"
          accept="image/*,application/pdf,video/*,audio/*,text/plain,text/markdown,.txt,.md,.markdown"
          className="hidden"
          onChange={(e) => onFilePicked(e.target.files?.[0])}
        />

        {view === "menu" && (
          <>
            <h2 className="font-serif text-3xl text-ink">New note</h2>
            <p className="mt-1 text-sm text-ink-soft">What are you saving?</p>
            <div className="mt-4 grid grid-cols-2 gap-3">
              {CAPTURE_MODES.map((m) => {
                const Icon = m.icon;
                const busy = m.key === "upload" && uploading;
                return (
                  <button
                    key={m.key}
                    type="button"
                    onClick={() => pick(m.key)}
                    disabled={busy}
                    className={`flex flex-col gap-3 rounded-2xl border border-border bg-paper p-4 text-left transition-colors hover:bg-accent disabled:opacity-60 ${FOCUS_RING}`}
                  >
                    <span
                      className={`flex h-11 w-11 items-center justify-center rounded-xl ${m.tile}`}
                    >
                      <Icon className="h-5 w-5" />
                    </span>
                    <span>
                      <span className="block font-semibold text-ink">{m.title}</span>
                      <span className="mt-0.5 block text-sm text-ink-soft">
                        {busy ? "Adding…" : m.desc}
                      </span>
                    </span>
                  </button>
                );
              })}
            </div>
            {fileError && <p className="mt-3 text-sm text-red-600">{fileError}</p>}
            <p className="mt-4 flex items-center justify-center gap-1.5 text-center text-sm text-product">
              <Sparkles className="h-4 w-4 shrink-0" />
              Whatever you pick, Clipnote titles and tags it for you
            </p>
          </>
        )}

        {view === "link" && (
          <>
            <div className="flex items-center gap-2">
              <Back />
              <h2 className="font-serif text-2xl text-ink">Paste a link</h2>
            </div>
            <form
              onSubmit={(e) => {
                e.preventDefault();
                if (url.trim()) onSubmit(url.trim());
              }}
              className="mt-4 space-y-3"
            >
              <input
                value={url}
                onChange={(e) => setUrl(e.target.value)}
                placeholder="https://…"
                inputMode="url"
                autoComplete="off"
                spellCheck={false}
                className="w-full rounded-2xl border border-border bg-paper px-4 py-3 text-base outline-none focus:border-ink"
              />
              <button
                type="submit"
                disabled={!url.trim()}
                className="w-full rounded-full bg-ink px-4 py-3 text-sm font-medium text-paper disabled:opacity-50"
              >
                Capture
              </button>
            </form>
          </>
        )}

        {view === "text" && (
          <>
            <div className="flex items-center gap-2">
              <Back />
              <h2 className="font-serif text-2xl text-ink">Write a note</h2>
            </div>
            <form
              onSubmit={(e) => {
                e.preventDefault();
                if (text.trim()) onSubmitText(text.trim(), title.trim() || undefined, processAI);
              }}
              className="mt-4 space-y-3"
            >
              <input
                value={title}
                onChange={(e) => setTitle(e.target.value)}
                placeholder="Title (optional)"
                autoComplete="off"
                className="w-full rounded-2xl border border-border bg-paper px-4 py-3 text-base outline-none focus:border-ink"
              />
              <textarea
                value={text}
                onChange={(e) => setText(e.target.value)}
                placeholder="Type or paste anything…"
                rows={6}
                className="min-h-[34vh] w-full resize-none rounded-2xl border border-border bg-paper px-4 py-3 text-base outline-none focus:border-ink sm:min-h-[9rem]"
              />
              {/* Default: Clip AI titles/tags/structures the note. Toggle off to keep the
                  text exactly as written (still editable later). */}
              <button
                type="button"
                role="switch"
                aria-checked={processAI}
                onClick={() => setProcessAI((v) => !v)}
                className="flex w-full items-center justify-between gap-3 rounded-2xl border border-border bg-paper px-4 py-3 text-left"
              >
                <span className="flex items-center gap-2.5">
                  <Sparkle className="h-4 w-4 shrink-0 text-product" />
                  <span>
                    <span className="block text-sm font-medium text-ink">
                      Let Clip AI structure it
                    </span>
                    <span className="block text-xs text-ink-soft">
                      {processAI
                        ? "Titled, tagged & formatted for you"
                        : "Saved exactly as written"}
                    </span>
                  </span>
                </span>
                <span
                  className={`relative h-6 w-10 shrink-0 rounded-full transition-colors ${processAI ? "bg-ink" : "bg-border"}`}
                >
                  <span
                    className={`absolute top-0.5 h-5 w-5 rounded-full bg-paper shadow transition-transform ${processAI ? "translate-x-[1.125rem]" : "translate-x-0.5"}`}
                  />
                </span>
              </button>
              <button
                type="submit"
                disabled={!text.trim()}
                className="w-full rounded-full bg-ink px-4 py-3 text-sm font-medium text-paper disabled:opacity-50"
              >
                {processAI ? "Save note" : "Save as is"}
              </button>
            </form>
          </>
        )}

        {view === "voice" && (
          <>
            <div className="flex items-center gap-2">
              <Back />
              <h2 className="font-serif text-2xl text-ink">Voice note</h2>
            </div>
            <VoiceRecorder onSave={onUploadVoice} className="mt-4" />
          </>
        )}

        {view === "menu" && (
          <button
            type="button"
            onClick={onCancel}
            className="mt-4 w-full rounded-full border border-border bg-card px-4 py-3 text-sm font-medium text-ink"
          >
            Cancel
          </button>
        )}
      </div>
    </div>
  );
}
