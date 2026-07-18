import { Pressable, Text } from "react-native";
import * as Linking from "expo-linking";
import { Image } from "expo-image";
import { ExternalLink } from "lucide-react-native";
import { sourceLabel } from "@/lib/note-meta";
import { useTokens } from "./colors";

// Port of frontend/src/components/note/SourcePill.tsx — tappable pill that opens the original.
// Typed-note / uploaded captures have no web source, so it renders nothing rather than a dead
// link. Favicon comes from Google's s2 service, same as web.
export function SourcePill({ domain, url }: { domain: string; url: string }) {
  const t = useTokens();
  if (!url || !domain) return null;
  return (
    <Pressable
      accessibilityRole="link"
      onPress={() => Linking.openURL(url).catch(() => {})}
      className="flex-row items-center gap-2 rounded-full border border-border bg-card px-3 py-1.5 active:opacity-70"
    >
      <Image
        source={{ uri: `https://www.google.com/s2/favicons?domain=${domain}&sz=32` }}
        style={{ width: 14, height: 14, borderRadius: 2 }}
        contentFit="contain"
      />
      <Text className="text-xs capitalize text-ink-soft">{sourceLabel(domain)}</Text>
      <ExternalLink size={12} color={t["ink-soft"]} />
    </Pressable>
  );
}
