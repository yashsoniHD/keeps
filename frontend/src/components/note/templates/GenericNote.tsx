import { Quote, ListChecks } from "lucide-react";
import type { Note } from "@/lib/types";
import { noteAccent } from "@/lib/note-meta";

interface GenericData {
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

// Renders the building blocks the composer prompt emits for AI-invented types,
// with the same visual treatment as the bespoke templates — structure, never a
// wall of bullets.
export function GenericNote({ note }: { note: Note }) {
  const data = note.data as GenericData;
  const accent = noteAccent(note.content_type);

  return (
    <div className="space-y-10">
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
          <p className="font-serif text-lg leading-snug text-ink">"{q.text}"</p>
          {q.attribution && <div className="mt-2 text-xs text-ink-soft">{q.attribution}</div>}
        </blockquote>
      ))}
    </div>
  );
}
