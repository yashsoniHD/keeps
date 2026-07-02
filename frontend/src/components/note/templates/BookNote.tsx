import { BookOpen, Lightbulb, Users } from "lucide-react";
import type { Note } from "@/lib/types";
import { noteAccent } from "@/lib/note-meta";

// Matches the backend `book` schema (services/gemini.py TYPE_PROMPTS["book"]).
interface BookData {
  author?: string;
  genre?: string;
  pages?: string;
  published?: string;
  facts?: { label: string; value: string }[];
  premise?: string;
  keyIdeas?: string[];
  whoShouldRead?: string;
}

export function BookNote({ note }: { note: Note }) {
  const data = note.data as BookData;
  const accent = noteAccent(note.content_type);

  const meta = [data.author, data.genre, data.published, data.pages && `${data.pages} pages`]
    .filter(Boolean)
    .join(" · ");

  return (
    <div className="space-y-10">
      {meta && <div className="text-ink-soft">{meta}</div>}

      {data.premise && <p className="text-lg leading-relaxed text-ink">{data.premise}</p>}

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

      {data.keyIdeas && data.keyIdeas.length > 0 && (
        <section>
          <h2 className="inline-flex items-center gap-2 font-serif text-2xl text-ink">
            <BookOpen className={`h-5 w-5 ${accent.text}`} /> Key ideas
          </h2>
          <ul className="mt-4 space-y-3">
            {data.keyIdeas.map((item, i) => (
              <li key={i} className="flex items-start gap-3 text-ink">
                <span className={`mt-2 h-1.5 w-1.5 shrink-0 rounded-full ${accent.dot}`} />
                <span className="leading-relaxed">{item}</span>
              </li>
            ))}
          </ul>
        </section>
      )}

      {data.whoShouldRead && (
        <section className="rounded-2xl border border-border bg-card p-5">
          <h2 className="inline-flex items-center gap-2 font-serif text-xl text-ink">
            <Users className={`h-4 w-4 ${accent.text}`} /> Who should read it
          </h2>
          <p className="mt-2 leading-relaxed text-ink">{data.whoShouldRead}</p>
        </section>
      )}
    </div>
  );
}
