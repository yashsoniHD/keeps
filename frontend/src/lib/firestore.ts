import {
  collection,
  query,
  where,
  orderBy,
  limit,
  getDoc,
  doc,
  onSnapshot,
  type Unsubscribe,
} from "firebase/firestore";
import { db } from "@/integrations/firebase/client";
import type { Note, Job } from "@/lib/types";

// Real-time feed: notes appear/update without a manual refetch. Returns an unsubscribe fn.
export function watchNotes(
  userId: string,
  callback: (notes: Note[]) => void,
  max = 50,
): Unsubscribe {
  const q = query(
    collection(db, "notes"),
    where("user_id", "==", userId),
    orderBy("created_at", "desc"),
    limit(max),
  );
  return onSnapshot(q, (snap) => {
    callback(snap.docs.map((d) => ({ id: d.id, ...d.data() }) as Note));
  });
}

export async function getNote(noteId: string): Promise<Note | null> {
  const snap = await getDoc(doc(db, "notes", noteId));
  if (!snap.exists()) return null;
  return { id: snap.id, ...snap.data() } as Note;
}

export function watchJob(jobId: string, callback: (job: Partial<Job>) => void): Unsubscribe {
  return onSnapshot(doc(db, "jobs", jobId), (snap) => {
    if (snap.exists()) callback(snap.data() as Partial<Job>);
  });
}

// One doc read against users/{uid}.categories — never scan the notes collection.
export async function getUserCategories(userId: string): Promise<string[]> {
  const snap = await getDoc(doc(db, "users", userId));
  return snap.exists() ? ((snap.data().categories ?? []) as string[]).sort() : [];
}
