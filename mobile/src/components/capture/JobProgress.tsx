import { ActivityIndicator, Pressable, Text, View } from "react-native";
import { AlertCircle, RotateCw } from "lucide-react-native";
import type { Job } from "@clipnote/shared";
import { useTheme } from "@/theme/ThemeProvider";
import { dark, light } from "@/theme/tokens";

// The post-submit view: a live spinner while the worker runs, or a retryable error card if
// the job failed. Completion is handled by the screen (it navigates to the note), so this
// only renders the in-flight and failed states.
export function JobProgress({
  status,
  domain,
  error,
  onRetry,
  onClose,
}: {
  status: Job["status"];
  domain: string | null;
  error: string | null;
  onRetry: () => void;
  onClose: () => void;
}) {
  const { resolved } = useTheme();
  const tokens = resolved === "dark" ? dark : light;

  if (status === "failed") {
    return (
      <View className="items-center gap-5 py-6">
        <View className="h-14 w-14 items-center justify-center rounded-full bg-destructive/10">
          <AlertCircle size={26} color={tokens.destructive} />
        </View>
        <View className="gap-1">
          <Text className="text-center text-lg font-semibold text-ink">Capture failed</Text>
          <Text className="text-center text-sm text-ink-soft">
            {error || "Something went wrong. Please try again."}
          </Text>
        </View>
        <View className="w-full flex-row gap-3">
          <Pressable
            accessibilityRole="button"
            onPress={onClose}
            className="flex-1 items-center rounded-full border border-border py-3"
          >
            <Text className="text-sm font-medium text-ink-soft">Close</Text>
          </Pressable>
          <Pressable
            accessibilityRole="button"
            onPress={onRetry}
            className="flex-1 flex-row items-center justify-center gap-2 rounded-full bg-ink py-3"
          >
            <RotateCw size={16} color={tokens.paper} />
            <Text className="text-sm font-medium text-paper">Retry</Text>
          </Pressable>
        </View>
      </View>
    );
  }

  const label = status === "deferred" ? "Queued" : "Working on it";
  return (
    <View className="items-center gap-5 py-10">
      <ActivityIndicator size="large" color={tokens.ink} />
      <View className="gap-1">
        <Text className="text-center text-lg font-semibold text-ink">{label}</Text>
        <Text className="text-center text-sm text-ink-soft">
          {domain ? `Reading ${domain}` : "Structuring your note"}
        </Text>
      </View>
    </View>
  );
}
