import { Pressable, Share, Text, View } from "react-native";
import { Share2 } from "lucide-react-native";

import { interopIcon } from "@/lib/note-meta";

// className styling on SVG icons requires interop registration (see note-meta / settings).
[Share2].forEach(interopIcon);

// Where the app lives + the invite copy, kept in lockstep with the web Settings "Share the app".
const APP_URL = "https://clipnote.web.app";
const APP_SHARE_TEXT =
  "Clipnote: save any link as a beautifully structured note you'll actually re-read.";

// A single row that opens the native share sheet with the app link. Dismissing the sheet is
// a no-op (the RN Share promise resolves with a dismissed action), so nothing surfaces on cancel.
export function ShareApp() {
  const onShare = async () => {
    try {
      await Share.share({
        title: "Clipnote",
        // iOS uses `url` for the link chip; Android has no separate url field, so the link is
        // also folded into the message so it's there either way.
        message: `${APP_SHARE_TEXT}\n\n${APP_URL}`,
        url: APP_URL,
      });
    } catch {
      // Share sheet failed to open — nothing actionable to show the user.
    }
  };

  return (
    <Pressable
      onPress={onShare}
      accessibilityRole="button"
      className="mt-6 flex-row items-center gap-3 rounded-2xl border border-border bg-card p-4 active:opacity-80"
    >
      <View className="h-10 w-10 items-center justify-center rounded-full bg-product-soft">
        <Share2 size={18} className="text-product-chip" />
      </View>
      <View className="min-w-0 flex-1">
        <Text className="text-base font-medium text-ink">Share the app</Text>
        <Text className="text-sm text-ink-soft">Send Clipnote to a friend.</Text>
      </View>
    </Pressable>
  );
}
