import { ActivityIndicator, Pressable, Text, View } from "react-native";
import { AlertCircle, X } from "lucide-react-native";
import { interopIcon } from "@/lib/note-meta";

// className styling on SVG icons requires interop registration (see note-meta).
[AlertCircle, X].forEach(interopIcon);
import type { Job } from "@clipnote/shared";
import { sourceLabel } from "@clipnote/shared";

// Hostname of a captured URL, for the processing/failed card's source line.
function jobDomain(url: string): string {
  try {
    return new URL(url).hostname.replace(/^www\./, "");
  } catch {
    return "link";
  }
}

// Human-readable elapsed time since a capture started, so a pending card reads as "working",
// not stuck. `now` is passed in so the parent can tick it while any capture is in flight.
function elapsed(job: Job, now: number): string {
  const started = job.created_at?.toMillis?.() ?? now;
  const secs = Math.max(0, Math.round((now - started) / 1000));
  if (secs < 60) return "just now";
  const mins = Math.round(secs / 60);
  return `${mins}m`;
}

// An in-flight capture (pending / processing / deferred). A URL has a jobs/{id} doc within
// ~50ms but no note for 12–70s; this stands in for that gap so the capture reads as received.
export function ProcessingCard({ job, now }: { job: Job; now: number }) {
  const domain = jobDomain(job.url);
  const label = job.status === "deferred" ? "Queued, high demand" : "Saving";
  return (
    <View className="rounded-2xl border border-dashed border-border bg-card p-4">
      <View className="flex-row items-center justify-between">
        <View className="flex-row items-center gap-2">
          <ActivityIndicator size="small" />
          <Text className="text-xs font-medium text-ink-soft">{label}</Text>
        </View>
        <Text className="text-[11px] text-ink-soft">{elapsed(job, now)}</Text>
      </View>
      <Text className="mt-3 text-sm capitalize text-ink" numberOfLines={1}>
        {sourceLabel(domain)}
      </Text>
      <Text className="mt-0.5 text-xs text-ink-soft" numberOfLines={1}>
        {job.url}
      </Text>
    </View>
  );
}

// A capture that failed must say so — a vanishing processing card reads as data loss.
export function FailedCard({ job, onDismiss }: { job: Job; onDismiss: (jobId: string) => void }) {
  const domain = jobDomain(job.url);
  return (
    <View className="rounded-2xl border border-destructive/30 bg-destructive/5 p-4">
      <View className="flex-row items-center justify-between">
        <View className="flex-row items-center gap-1.5">
          <AlertCircle size={13} className="text-destructive" />
          <Text className="text-xs font-medium text-destructive">Couldn't save</Text>
        </View>
        <Pressable
          onPress={() => onDismiss(job.id)}
          hitSlop={8}
          accessibilityRole="button"
          accessibilityLabel="Dismiss"
        >
          <X size={16} className="text-ink-soft" />
        </Pressable>
      </View>
      <Text className="mt-3 text-sm font-medium text-ink" numberOfLines={2}>
        {job.url}
      </Text>
      <Text className="mt-1.5 text-xs text-ink-soft" numberOfLines={2}>
        {job.error || "Something went wrong while processing this link."}
      </Text>
      <Text className="mt-3 text-[11px] capitalize text-ink-soft">{sourceLabel(domain)}</Text>
    </View>
  );
}
