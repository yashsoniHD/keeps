import { useRef, useState } from "react";
import { Sparkle, Sparkles, Paperclip, Mic, ArrowUp, Link2, X } from "lucide-react";
import { VoiceRecorder } from "@/components/VoiceRecorder";
import { FOCUS_RING } from "@/lib/ui";

// One trimmed token that reads as a web address → capture it as a link. Anything with
// whitespace or newlines is a written note. Keeps the composer's link-vs-text decision
// automatic so the user never has to pick a "mode".
function looksLikeUrl(s: string): boolean {
  const t = s.trim();
  if (!t || /\s/.test(t)) return false;
  if (/^https?:\/\//i.test(t)) return true;
  return /^[a-z0-9-]+(\.[a-z0-9-]+)+(\/\S*)?$/i.test(t); // bare domain, e.g. nytimes.com/…
}

// Unified capture composer used by both the Notes feed and the Library home. One field takes a
// link OR free text (auto-detected); attach + voice sit inline. Purely presentational — the
// caller supplies the ingest handlers, so each screen wires its own optimistic/confirm behaviour.
export function AddNoteSheet({
  url,
  onCancel,
  onSubmit,
  onSubmitText,
  onUploadFile,
  onUploadVoice,
}: {
  url: string;
  setUrl: (v: string) => void; // kept for API compatibility; the composer holds its own draft
  onCancel: () => void;
  onSubmit: (u: string) => void;
  onSubmitText: (text: string, title?: string, processAI?: boolean) => void;
  onUploadFile: (file: File, kind: "image" | "pdf" | "video" | "voice") => Promise<void>;
  onUploadVoice: (blob: Blob) => Promise<void>;
}) {
  // Seed the draft from any pre-filled URL (PWA share target / paste), then own it locally.
  const [content, setContent] = useState(url);
  const [title, setTitle] = useState("");
  // Whether a typed note is structured by Clip AI (default) or saved verbatim. Links are always
  // structured, so the toggle only shows in text mode.
  const [processAI, setProcessAI] = useState(true);
  const [voiceOpen, setVoiceOpen] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [fileError, setFileError] = useState<string | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);

  const isUrl = looksLikeUrl(content);
  const isText = content.trim().length > 0 && !isUrl;
  const canSubmit = content.trim().length > 0;

  const submit = () => {
    const v = content.trim();
    if (!v) return;
    if (isUrl)
      onSubmit(v); // link path → shell's CaptureModal
    else onSubmitText(v, title.trim() || undefined, processAI);
  };

  const onFilePicked = async (file: File | undefined) => {
    if (!file) return;
    // Plain-text files have no bytes worth uploading — read them client-side and save through
    // the typed-note path (which Clip AI then structures).
    const isTextFile = file.type.startsWith("text/") || /\.(txt|md|markdown)$/i.test(file.name);
    if (isTextFile) {
      setFileError(null);
      setUploading(true);
      try {
        const text = await file.text();
        if (!text.trim()) throw new Error("That file is empty.");
        onSubmitText(text, file.name.replace(/\.(txt|md|markdown)$/i, ""), true); // closes the sheet
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

  const iconBtn = `inline-flex h-10 w-10 items-center justify-center rounded-full border border-border bg-paper text-ink-soft transition-colors hover:text-ink hover:bg-accent disabled:opacity-50 ${FOCUS_RING}`;

  return (
    <div
      data-no-refresh
      className="fixed inset-0 z-50 flex items-center justify-center bg-ink/40 p-4 backdrop-blur-sm"
    >
      <div className="max-h-[88vh] w-full max-w-md overflow-y-auto rounded-3xl border border-border bg-card p-5 shadow-2xl">
        {/* Hidden file input, triggered by the attach button. */}
        <input
          ref={fileRef}
          type="file"
          accept="image/*,application/pdf,video/*,audio/*,text/plain,text/markdown,.txt,.md,.markdown"
          className="hidden"
          onChange={(e) => onFilePicked(e.target.files?.[0])}
        />

        <div className="flex items-start justify-between">
          <div>
            <h2 className="font-serif text-3xl text-ink">New note</h2>
            <p className="mt-1 text-sm text-ink-soft">Paste a link, write, upload, or record.</p>
          </div>
          <button
            type="button"
            onClick={onCancel}
            aria-label="Close"
            className={`-mr-1 -mt-1 inline-flex h-8 w-8 items-center justify-center rounded-full text-ink-soft transition-colors hover:text-ink ${FOCUS_RING}`}
          >
            <X className="h-5 w-5" />
          </button>
        </div>

        {/* Optional title — only meaningful for a written note. */}
        {isText && (
          <input
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            placeholder="Title (optional)"
            autoComplete="off"
            className="mt-4 w-full rounded-2xl border border-border bg-paper px-4 py-3 text-base outline-none focus:border-ink"
          />
        )}

        {/* The one field: a link or free text. */}
        <div
          className={`mt-3 rounded-2xl border bg-paper transition-colors focus-within:border-ink ${isUrl ? "border-tech/50" : "border-border"}`}
        >
          {/* No autoFocus: opening the sheet must not spring the mobile keyboard (a deliberate
              call from the menu-era design). The field is the obvious tap target. */}
          <textarea
            value={content}
            onChange={(e) => setContent(e.target.value)}
            onKeyDown={(e) => {
              // Enter submits a link (single line); text needs Cmd/Ctrl+Enter so newlines work.
              const submitCombo = isUrl || e.metaKey || e.ctrlKey;
              if (e.key === "Enter" && submitCombo && !e.shiftKey) {
                e.preventDefault();
                submit();
              }
            }}
            placeholder="Paste a link or write a note…"
            inputMode="text"
            spellCheck={!isUrl}
            rows={isText ? 6 : 3}
            className="w-full resize-none rounded-2xl bg-transparent px-4 py-3 text-base outline-none placeholder:text-ink-soft"
          />
          {isUrl && (
            <p className="flex items-center gap-1.5 px-4 pb-2.5 text-xs text-tech">
              <Link2 className="h-3.5 w-3.5" />
              Looks like a link — Clipnote will fetch and structure the page.
            </p>
          )}
        </div>

        {/* Structure toggle — text only; links are always structured. */}
        {isText && (
          <button
            type="button"
            role="switch"
            aria-checked={processAI}
            onClick={() => setProcessAI((v) => !v)}
            className="mt-3 flex w-full items-center justify-between gap-3 rounded-2xl border border-border bg-paper px-4 py-3 text-left"
          >
            <span className="flex items-center gap-2.5">
              <Sparkle className="h-4 w-4 shrink-0 text-product" />
              <span>
                <span className="block text-sm font-medium text-ink">Let Clip AI structure it</span>
                <span className="block text-xs text-ink-soft">
                  {processAI ? "Titled, tagged & formatted for you" : "Saved exactly as written"}
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
        )}

        {/* Inline voice recorder — expands in place; saving it ingests + closes the sheet. */}
        {voiceOpen && (
          <div className="mt-3 rounded-2xl border border-border bg-paper p-4">
            <VoiceRecorder onSave={onUploadVoice} />
          </div>
        )}

        {fileError && <p className="mt-3 text-sm text-destructive">{fileError}</p>}

        {/* Actions: attach + voice on the left, submit on the right. */}
        <div className="mt-4 flex items-center gap-2">
          <button
            type="button"
            onClick={() => fileRef.current?.click()}
            disabled={uploading}
            aria-label="Attach a file"
            title="Attach an image, video, audio, PDF, or text file"
            className={iconBtn}
          >
            <Paperclip className="h-4.5 w-4.5" />
          </button>
          <button
            type="button"
            onClick={() => setVoiceOpen((v) => !v)}
            aria-pressed={voiceOpen}
            aria-label="Record a voice note"
            title="Record a voice note"
            className={`${iconBtn} ${voiceOpen ? "border-transparent bg-health-soft text-health" : ""}`}
          >
            <Mic className="h-4.5 w-4.5" />
          </button>

          <button
            type="button"
            onClick={submit}
            disabled={!canSubmit || uploading}
            className={`ml-auto inline-flex items-center gap-1.5 rounded-full bg-ink px-5 py-2.5 text-sm font-medium text-paper transition-opacity disabled:opacity-40 ${FOCUS_RING}`}
          >
            {uploading
              ? "Adding…"
              : isUrl
                ? "Capture"
                : isText && !processAI
                  ? "Save as is"
                  : "Save"}
            {!uploading && <ArrowUp className="h-4 w-4" />}
          </button>
        </div>

        <p className="mt-4 flex items-center justify-center gap-1.5 text-center text-sm text-product">
          <Sparkles className="h-4 w-4 shrink-0" />
          Whatever you add, Clipnote titles and tags it for you
        </p>
      </div>
    </div>
  );
}
