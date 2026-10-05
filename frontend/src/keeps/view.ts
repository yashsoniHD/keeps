// Keeps UI view model. Every screen renders a NoteView, never the raw Firestore Note:
// toView() (below) maps the backend's per-template `data` map into document blocks, so
// old and new notes render through one layout. The UI never edits blocks; writes go
// through lib/api (title / ai_summary / content_type).
import type { Note } from "@/lib/types";

export interface BlockLink {
  label: string;
  url: string;
}

export interface Block {
  heading: string;
  kind: "list" | "steps" | "text" | "code" | "facts" | "checklist";
  items: string[];
  links?: BlockLink[]; // rendered as outbound buttons under the items (place actions, etc.)
  image?: string; // optional poster/thumbnail for the section (entertainment titles)
  credit?: string; // required attribution line, e.g. "Streaming data by JustWatch"
}

export interface NoteView {
  id: string;
  title: string;
  summary: string;
  categorySlug: string; // note.content_type
  category: string; // display label (noteLabel)
  platform: string; // "Instagram", "YouTube", "nytimes.com", ...
  creator?: string;
  image?: string; // cover_image_url
  url: string; // source_url
  age: string; // "2 hours ago", "Yesterday", "3 Oct"
  duration?: string; // "0:58" when the data carries a video length
  thin: boolean; // salvage / caption-only note (is_fallback)
  facts: string[]; // "At a glance" chips: "25 minutes", "Serves 2"
  blocks: Block[];
  tags: string[];
  createdAt: number; // ms epoch
  note: Note; // the raw note, for API calls
}

export { toView } from "./toView";
