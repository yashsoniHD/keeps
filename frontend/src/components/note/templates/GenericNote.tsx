import { useEffect, useRef, useState } from "react";
import { Quote, ListChecks, Pencil } from "lucide-react";
import type { Note } from "@/lib/types";
import { noteAccent } from "@/lib/note-meta";
import { renderMarkdown } from "@/lib/markdown";
import { updateNote } from "@/lib/api";

interface GenericData {
  body?: string; // free-text note body (save-as-is typed notes) — rendered as prose, editable
  facts?: { label: string; value: string }[];
  sections?: { heading: string; items: string[] }[];
  steps?: string[];
  // Firestore can't store arrays-in-arrays, so the backend wraps each row as
  // {cells: [...]} at the write boundary (services/firebase.py firestore_safe).
  table?: { columns: string[]; rows: (string[] | { cells: string[] })[] };
  checklist?: string[];
  quotes?: { text: string; attribution?: string }[];
}

function rowCells(row: string[] | { cells: string[] }): string[] {
  return Array.isArray(row) ? row : (row.cells ?? []);
}

// A short plain-text preview from the body, kept in sync with the feed-card summary.
function bodyExcerpt(body: string): string {
  const flat = body.replace(/\s+/g, " ").trim();
  return flat.length > 200 ? `${flat.slice(0, 200)}…` : flat;
}

// Grow a textarea to fit its content (mirrors NoteHeader's autosize).
function autosize(el: HTMLTextAreaElement) {
  el.style.height = "auto";
  el.style.height = `${el.scrollHeight}px`;
}

// The free-text body of a save-as-is / typed note. Read-only when no onPatch is wired
// (public view); click-to-edit for the owner, mirroring EditableTitle: optimistic onPatch,
// revert on failure, Escape cancels. Editing also refreshes the card excerpt (ai_summary).
function NoteBodyBlock({
  note,
  body,
  onPatch,
}: {
  note: Note;
  body: string;
  onPatch?: (patch: Partial<Note>) => void;
}) {
  const [editing, setEditing] = useState(false);
  const [value, setValue] = useState(body);
  const ref = useRef<HTMLTextAreaElement>(null);

  useEffect(() => {
    if (!editing) setValue(body);
  }, [body, editing]);

  useEffect(() => {
    if (!editing) return;
    const ta = ref.current;
    if (ta) {
      ta.focus();
      const end = ta.value.length;
      ta.setSelectionRange(end, end);
      autosize(ta);
    }
  }, [editing]);

  const commit = async () => {
    const next = value.trim();
    setEditing(false);
    if (!next || next === body) {
      setValue(body); // empty or unchanged → no-op
      return;
    }
    const nextData = { ...(note.data as Record<string, unknown>), body: next };
    const nextSummary = bodyExcerpt(next);
    onPatch?.({ data: nextData, ai_summary: nextSummary }); // optimistic
    try {
      await updateNote(note.id, { data: nextData, ai_summary: nextSummary });
    } catch {
      onPatch?.({ data: note.data, ai_summary: note.ai_summary }); // revert
      setValue(body);
    }
  };

  if (!onPatch) {
    // Read-only (public view).
    return <section>{renderMarkdown(body)}</section>;
  }

  if (editing) {
    return (
      <textarea
        ref={ref}
        value={value}
        rows={6}
        onChange={(e) => {
          setValue(e.target.value);
          autosize(e.currentTarget);
        }}
        onKeyDown={(e) => {
          if (e.key === "Escape") {
            setValue(body);
            setEditing(false);
          }
        }}
        onBlur={commit}
        aria-label="Edit note"
        className="w-full resize-none overflow-hidden rounded-2xl border border-border bg-paper p-4 text-sm leading-relaxed text-ink outline-none focus:border-ink"
      />
    );
  }

  return (
    <section
      onClick={() => setEditing(true)}
      title="Edit note"
      className="group/body relative cursor-text rounded-2xl border border-transparent p-4 -m-4 transition-colors hover:border-border hover:bg-card"
    >
      <Pencil className="absolute right-3 top-3 h-4 w-4 text-ink-soft opacity-0 transition-opacity group-hover/body:opacity-100" />
      {renderMarkdown(body)}
    </section>
  );
}

// Renders the building blocks the composer prompt emits for AI-invented types,
// with the same visual treatment as the bespoke templates — structure, never a
// wall of bullets.
export function GenericNote({
  note,
  onPatch,
}: {
  note: Note;
  onPatch?: (patch: Partial<Note>) => void;
}) {
  const data = note.data as GenericData;
  const accent = noteAccent(note.content_type);

  return (
    <div className="space-y-10">
      {typeof data.body === "string" && data.body.trim() && (
        <NoteBodyBlock note={note} body={data.body} onPatch={onPatch} />
      )}

      {data.facts && data.facts.length > 0 && (
        <section className={`rounded-2xl border border-border p-5 ${accent.soft}`}>
          <dl className="divide-y divide-border/60">
            {data.facts.map((f, i) => (
              <div key={i} className="flex items-baseline justify-between gap-4 py-2.5">
                <dt className="text-sm text-ink-soft">{f.label}</dt>
                <dd className="text-right text-sm font-medium text-ink">{f.value}</dd>
              </div>
            ))}
          </dl>
        </section>
      )}

      {(data.sections ?? []).map((sec, i) => (
        <section key={i}>
          <h2 className="font-serif text-2xl text-ink">{sec.heading}</h2>
          <ul className="mt-4 space-y-3">
            {(sec.items ?? []).map((item, j) => (
              <li key={j} className="flex items-start gap-3 text-ink">
                <span className={`mt-2 h-1.5 w-1.5 shrink-0 rounded-full ${accent.dot}`} />
                <span className="leading-relaxed">{item}</span>
              </li>
            ))}
          </ul>
        </section>
      ))}

      {data.table && data.table.columns?.length > 0 && (
        <section className="overflow-x-auto rounded-2xl border border-border">
          <table className="w-full text-sm">
            <thead>
              <tr className={accent.soft}>
                {data.table.columns.map((col, i) => (
                  <th key={i} className="px-4 py-3 text-left font-medium text-ink">
                    {col}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody className="divide-y divide-border">
              {(data.table.rows ?? []).map((row, i) => (
                <tr key={i}>
                  {rowCells(row).map((cell, j) => (
                    <td key={j} className="px-4 py-3 text-ink">
                      {cell}
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </section>
      )}

      {data.steps && data.steps.length > 0 && (
        <section>
          <h2 className="font-serif text-2xl text-ink">Steps</h2>
          <ol className="mt-4 space-y-4">
            {data.steps.map((step, i) => (
              <li key={i} className="flex gap-4">
                <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-ink text-sm font-medium text-paper">
                  {i + 1}
                </span>
                <p className="pt-0.5 leading-relaxed text-ink">{step}</p>
              </li>
            ))}
          </ol>
        </section>
      )}

      {data.checklist && data.checklist.length > 0 && (
        <section className="rounded-2xl border border-border bg-card p-5">
          <h2 className="inline-flex items-center gap-2 font-serif text-xl text-ink">
            <ListChecks className={`h-4 w-4 ${accent.text}`} /> Checklist
          </h2>
          <ul className="mt-3 space-y-2.5">
            {data.checklist.map((item, i) => (
              <li key={i} className="flex items-start gap-3 text-ink">
                <span className="mt-1 inline-flex h-4 w-4 shrink-0 items-center justify-center rounded border border-border" />
                <span>{item}</span>
              </li>
            ))}
          </ul>
        </section>
      )}

      {(data.quotes ?? []).map((q, i) => (
        <blockquote key={i} className="relative rounded-2xl border border-border bg-card p-5 pl-12">
          <Quote className={`absolute left-4 top-5 h-5 w-5 ${accent.text}`} />
          <p className="text-[15px] italic leading-relaxed text-ink md:text-base">"{q.text}"</p>
          {q.attribution && <div className="mt-2 text-xs text-ink-soft">{q.attribution}</div>}
        </blockquote>
      ))}
    </div>
  );
}
