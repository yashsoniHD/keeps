import Markdown from "react-native-markdown-display";
import * as Linking from "expo-linking";
import { useTokens } from "./colors";

// Token-styled wrapper over react-native-markdown-display, for the constrained markdown subset
// the note body / composer prose uses (paragraphs, "- " bullets, numbered lists, ### headings,
// **bold** / *italic*, links). Mirrors frontend/src/lib/markdown.tsx: web renders every heading
// level as a small semibold line, links in the summary accent, so we match that here. Links open
// through expo-linking (returning false suppresses the library's own default handler).
export function NoteMarkdown({ children }: { children: string }) {
  const t = useTokens();
  const heading = { color: t.ink, fontWeight: "600" as const, fontSize: 15, marginTop: 4 };
  const styles = {
    body: { color: t.ink, fontSize: 14, lineHeight: 22 },
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
        Linking.openURL(url).catch(() => {});
        return false;
      }}
    >
      {children}
    </Markdown>
  );
}
