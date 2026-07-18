import { useEffect, useState } from "react";
import { Pressable, Text, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { BookOpen, RotateCw, Sparkles } from "lucide-react-native";
import { useTheme } from "@/theme/ThemeProvider";
import { dark, light } from "@/theme/tokens";
import { chipFill } from "./colors";

// The status lines cycle while the story is being written, so the wait reads as work happening
// rather than a dead spinner. ~2.5s each — long enough to read, short enough to feel alive.
const STATUS_LINES = ["Reading your week", "Finding the thread", "Writing your story"];

// Shared full-screen shell for every pre-story state (loading / empty / error): the same
// self-coloured surface the slides use (summary amber), so there's no jarring change when the
// real slides mount.
function DigestOverlay({ children }: { children: React.ReactNode }) {
  const { resolved } = useTheme();
  const tokens = resolved === "dark" ? dark : light;
  const insets = useSafeAreaInsets();
  return (
    <View
      style={{
        flex: 1,
        alignItems: "center",
        justifyContent: "center",
        paddingHorizontal: 32,
        paddingTop: insets.top + 24,
        paddingBottom: insets.bottom + 24,
        backgroundColor: tokens.summary,
      }}
    >
      {children}
    </View>
  );
}

function useOn(): string {
  const { resolved } = useTheme();
  return (resolved === "dark" ? dark : light)["summary-on"];
}

export function DigestLoading() {
  const on = useOn();
  const [line, setLine] = useState(0);

  useEffect(() => {
    const id = setInterval(() => setLine((l) => (l + 1) % STATUS_LINES.length), 2500);
    return () => clearInterval(id);
  }, []);

  return (
    <DigestOverlay>
      <Sparkles size={40} color={on} />
      <Text
        aria-live="polite"
        className="font-serif"
        style={{ color: on, fontSize: 28, marginTop: 32, textAlign: "center" }}
      >
        {STATUS_LINES[line]}
      </Text>
      <Text style={{ color: on, opacity: 0.7, fontSize: 14, marginTop: 12, textAlign: "center" }}>
        A recap of what you have been saving.
      </Text>
    </DigestOverlay>
  );
}

// Zero notes: nothing to recap yet. Points back so the user can start saving.
export function DigestEmpty({ onClose }: { onClose: () => void }) {
  const on = useOn();
  return (
    <DigestOverlay>
      <BookOpen size={40} color={on} />
      <Text
        className="font-serif"
        style={{ color: on, fontSize: 28, marginTop: 32, textAlign: "center" }}
      >
        Nothing to recap yet
      </Text>
      <Text
        style={{ color: on, opacity: 0.8, fontSize: 14, marginTop: 12, textAlign: "center", maxWidth: 300 }}
      >
        Save a few links and your digest will start telling the story of your week.
      </Text>
      <Pressable
        accessibilityRole="button"
        onPress={onClose}
        style={({ pressed }) => ({
          marginTop: 32,
          borderRadius: 999,
          paddingHorizontal: 20,
          paddingVertical: 12,
          backgroundColor: chipFill(pressed),
        })}
      >
        <Text style={{ color: on, fontSize: 15, fontWeight: "500" }}>Start saving</Text>
      </Pressable>
    </DigestOverlay>
  );
}

// The build failed outright (network / server) with no data to show. Quiet retry, never blank.
export function DigestError({ onRetry, onClose }: { onRetry: () => void; onClose: () => void }) {
  const on = useOn();
  return (
    <DigestOverlay>
      <Sparkles size={40} color={on} />
      <Text
        className="font-serif"
        style={{ color: on, fontSize: 28, marginTop: 32, textAlign: "center" }}
      >
        Couldn't build your digest
      </Text>
      <Text
        style={{ color: on, opacity: 0.8, fontSize: 14, marginTop: 12, textAlign: "center", maxWidth: 300 }}
      >
        Something went wrong on our end. Give it another try.
      </Text>
      <View style={{ flexDirection: "row", gap: 10, marginTop: 32 }}>
        <Pressable
          accessibilityRole="button"
          onPress={onRetry}
          style={({ pressed }) => ({
            flexDirection: "row",
            alignItems: "center",
            gap: 8,
            borderRadius: 999,
            paddingHorizontal: 20,
            paddingVertical: 12,
            backgroundColor: chipFill(pressed),
          })}
        >
          <RotateCw size={16} color={on} />
          <Text style={{ color: on, fontSize: 15, fontWeight: "500" }}>Try again</Text>
        </Pressable>
        <Pressable
          accessibilityRole="button"
          onPress={onClose}
          style={{ borderRadius: 999, paddingHorizontal: 20, paddingVertical: 12 }}
        >
          <Text style={{ color: on, opacity: 0.7, fontSize: 15 }}>Close</Text>
        </Pressable>
      </View>
    </DigestOverlay>
  );
}
