import { useEffect, useRef, useState } from "react";
import { Check, Loader2 } from "lucide-react";
import { updateNote } from "@/lib/api";

type SaveState = "idle" | "saving" | "saved";

// Owner-only "Your thoughts" annotation. A note you've reacted to is one you come back
// to — so this is a first-class editable block, autosaved (debounced) via updateNote.
// Never rendered on the public /p/{id} view (the field is private).
export function ThoughtsBlock({
  noteId,
  value,
  onPatch,
}: {
  noteId: string;
  value: string;
  onPatch?: (patch: { user_note: string }) => void;
}) {
  const [text, setText] = useState(value);
  const [state, setState] = useState<SaveState>("idle");
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const lastSaved = useRef(value);

  // Reset when navigating between notes.
  useEffect(() => {
    setText(value);
    lastSaved.current = value;
    setState("idle");
  }, [noteId, value]);

  useEffect(() => () => void (timer.current && clearTimeout(timer.current)), []);

  const scheduleSave = (next: string) => {
    if (timer.current) clearTimeout(timer.current);
    timer.current = setTimeout(async () => {
      if (next === lastSaved.current) return;
      setState("saving");
      try {
        await updateNote(noteId, { user_note: next });
        lastSaved.current = next;
        onPatch?.({ user_note: next });
        setState("saved");
        setTimeout(() => setState((s) => (s === "saved" ? "idle" : s)), 2000);
      } catch {
        setState("idle"); // keep the text; user can keep editing and it'll retry on next change
      }
    }, 800);
  };

  return (
    <section className="mt-8 rounded-2xl border border-border bg-muted/40 p-4">
      <div className="mb-2 flex items-center justify-between">
        <h2 className="text-sm font-medium text-ink">Your thoughts</h2>
        <span className="flex items-center gap-1 text-[11px] text-ink-soft">
          {state === "saving" && <Loader2 className="h-3 w-3 animate-spin" />}
          {state === "saved" && <Check className="h-3 w-3" />}
          {state === "saving" ? "Saving…" : state === "saved" ? "Saved" : ""}
        </span>
      </div>
      <textarea
        value={text}
        onChange={(e) => {
          setText(e.target.value);
          scheduleSave(e.target.value);
        }}
        onBlur={() => {
          if (timer.current) clearTimeout(timer.current);
          scheduleSave(text);
        }}
        rows={3}
        placeholder="Add a note to your future self: why you saved this, what to try…"
        className="w-full resize-y bg-transparent text-sm leading-relaxed text-ink outline-none placeholder:text-ink-soft"
      />
    </section>
  );
}
