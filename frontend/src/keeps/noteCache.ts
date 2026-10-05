// In-memory note cache: the library primes it from its live listener so opening a note
// renders instantly instead of waiting on getNote(). The note page still revalidates.
import type { Note } from "@/lib/types";

const notes = new Map<string, Note>();

export function primeNotes(list: Note[]): void {
  for (const n of list) notes.set(n.id, n);
}

export function clearNotes(): void {
  notes.clear();
}

export function peekNote(id: string): Note | undefined {
  return notes.get(id);
}
