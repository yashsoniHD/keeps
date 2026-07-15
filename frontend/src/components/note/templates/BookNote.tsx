import { BookOpen, Users } from "lucide-react";
import type { Note } from "@/lib/types";
import { noteAccent } from "@/lib/note-meta";
import { SectionHeader } from "../SectionHeader";
import { FactsBlock } from "../FactsBlock";

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

      <FactsBlock facts={data.facts} accent={accent} />

      {data.keyIdeas && data.keyIdeas.length > 0 && (
        <section>
          <SectionHeader icon={BookOpen} iconClassName={accent.text}>
            Key ideas
          </SectionHeader>
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
          <SectionHeader icon={Users} iconClassName={accent.text}>
            Who should read it
          </SectionHeader>
          <p className="mt-2 leading-relaxed text-ink">{data.whoShouldRead}</p>
        </section>
      )}
    </div>
  );
}
