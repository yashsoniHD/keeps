import type { Timestamp } from "firebase/firestore";

export interface Note {
  id: string;
  user_id: string;
  content_type: string; // editable category — drives icon/colour/filter, NOT the render template
  template?: string; // immutable structural schema the `data` map was built for (render selector)
  title: string;
  ai_summary: string;
  user_note?: string; // owner's private annotation — never shown on public /p/{id}
  source_url: string;
  source_domain: string;
  source: "web" | "shortcut" | "pwa";
  cover_image_url: string | null;
  data: Record<string, unknown>;
  acquisition?: string;
  is_fallback?: boolean; // salvage "bookmark" note — content couldn't be processed
  is_public?: boolean; // owner shared it — readable via /p/{id} without login

  created_at: Timestamp;
  updated_at: Timestamp;
}

export interface Job {
  id: string;
  user_id: string;
  url: string;
  status: "pending" | "processing" | "completed" | "failed";
  note_id: string | null;
  error: string | null;
  attempt_count: number;
  created_at: Timestamp;
  updated_at?: Timestamp;
}
