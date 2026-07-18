import Markdown from "react-native-markdown-display";
import * as Linking from "expo-linking";
import { useTokens } from "@/components/note/colors";

// Note refs arrive from Ask AI as a bare uuid or a `notes/<uuid>` href — grounded citations
// rendered inline in the answer. Mirrors frontend/src/lib/markdown.tsx NOTE_HREF_RE.
const UUID = "[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}";
const NOTE_HREF_RE = new RegExp(`^(?:notes/)?(${UUID})$`);

// A note-link-aware markdown renderer for the Ask AI answer. Same token-styled subset as
// note/Markdown.tsx (NoteMarkdown can't take a link handler, so this is the Ask variant), but
// its onLinkPress classifies the href: http(s) → open externally; a note id → in-app
// navigation via onNoteClick; anything else → swallowed (never a live link).
export function AskMarkdown({
  children,
  onNoteClick,
}: {
  children: string;
  onNoteClick?: (noteId: string) => void;
}) {
  const t = useTokens();
  const heading = { color: t.ink, fontWeight: "600" as const, fontSize: 15, marginTop: 4 };
  const styles = {
    body: { color: t.ink, fontSize: 15, lineHeight: 23 },
    paragraph: { marginTop: 0, marginBottom: 8 },
    heading1: heading,
    heading2: heading,
    heading3: heading,
    heading4: heading,
    heading5: heading,
    heading6: heading,
    strong: { fontWeight: "700" as const, color: t.ink },
    em: { fontStyle: "italic" as const },
    bullet_list: { marginBottom: 4 },
    ordered_list: { marginBottom: 4 },
    list_item: { marginBottom: 2 },
    link: { color: t.summary, textDecorationLine: "underline" as const },
    code_inline: {
      color: t.ink,
      backgroundColor: t.muted,
      borderRadius: 4,
      paddingHorizontal: 4,
      fontFamily: "monospace" as const,
    },
    fence: {
      color: t.ink,
      backgroundColor: t.muted,
      borderColor: t.border,
      borderRadius: 12,
      padding: 12,
      fontFamily: "monospace" as const,
    },
    code_block: {
      color: t.ink,
      backgroundColor: t.muted,
      borderColor: t.border,
      borderRadius: 12,
      padding: 12,
      fontFamily: "monospace" as const,
    },
    blockquote: {
      backgroundColor: t.card,
      borderColor: t.border,
      borderLeftColor: t.summary,
      borderLeftWidth: 3,
      borderRadius: 8,
      paddingHorizontal: 12,
      paddingVertical: 8,
    },
    hr: { backgroundColor: t.border, height: 1 },
  };
  return (
    <Markdown
      style={styles}
      onLinkPress={(url) => {
        const note = url.match(NOTE_HREF_RE);
        if (note && onNoteClick) {
          onNoteClick(note[1]);
          return false;
        }
        if (/^https?:\/\//i.test(url)) Linking.openURL(url).catch(() => {});
        return false; // suppress the library's own default handler either way
      }}
    >
      {children}
    </Markdown>
  );
}
