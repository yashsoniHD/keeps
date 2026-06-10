import type { Timestamp } from "firebase/firestore";

export interface Note {
  id: string;
  user_id: string;
  content_type: string;
  title: string;
  ai_summary: string;
  source_url: string;
  source_domain: string;
  source: "web" | "shortcut" | "pwa";
  cover_image_url: string | null;
  data: Record<string, unknown>;
  acquisition?: string;
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
}
