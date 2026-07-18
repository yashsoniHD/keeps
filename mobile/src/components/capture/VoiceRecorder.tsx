import { useState } from "react";
import { Pressable, Text, View } from "react-native";
import {
  RecordingPresets,
  requestRecordingPermissionsAsync,
  setAudioModeAsync,
  useAudioRecorder,
  useAudioRecorderState,
} from "expo-audio";
import { AlertCircle, Mic, Square, Trash2 } from "lucide-react-native";
import { useTheme } from "@/theme/ThemeProvider";
import { dark, light } from "@/theme/tokens";

function fmt(seconds: number): string {
  const m = Math.floor(seconds / 60);
  const s = seconds % 60;
  return `${m}:${s.toString().padStart(2, "0")}`;
}

type Phase = "idle" | "recording" | "recorded" | "saving" | "denied";

// Self-contained voice recorder: tap to record, stop, then Save (uploads the .m4a for
// transcription) or discard and re-record. Mic access is requested on the first tap (a user
// gesture), so mounting the view never triggers a permission prompt on its own. No hard max
// duration — mirrors the web recorder, which also lets the user record freely.
export function VoiceRecorder({
  onSave,
  disabled,
}: {
  onSave: (recording: { uri: string; durationSec: number }) => Promise<void>;
  disabled?: boolean;
}) {
  const { resolved } = useTheme();
  const tokens = resolved === "dark" ? dark : light;

  const recorder = useAudioRecorder(RecordingPresets.HIGH_QUALITY);
  const recorderState = useAudioRecorderState(recorder);

  const [phase, setPhase] = useState<Phase>("idle");
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<{ uri: string; durationSec: number } | null>(null);

  const elapsed =
    phase === "recording"
      ? Math.floor((recorderState.durationMillis ?? 0) / 1000)
      : result
        ? Math.round(result.durationSec)
        : 0;

  const start = async () => {
    setError(null);
    try {
      const perm = await requestRecordingPermissionsAsync();
      if (!perm.granted) {
        setPhase("denied");
        return;
      }
      await setAudioModeAsync({ allowsRecording: true, playsInSilentMode: true });
      await recorder.prepareToRecordAsync();
      recorder.record();
      setPhase("recording");
    } catch {
      setError("Couldn't start recording. Please try again.");
      setPhase("idle");
    }
  };

  const stop = async () => {
    try {
      const durationSec = (recorderState.durationMillis ?? 0) / 1000;
      await recorder.stop();
      const uri = recorder.uri;
      if (!uri) {
        setError("The recording came out empty. Please try again.");
        setPhase("idle");
        return;
      }
      setResult({ uri, durationSec });
      setPhase("recorded");
    } catch {
      setError("Couldn't stop the recording. Please try again.");
      setPhase("idle");
    }
  };

  const reset = () => {
    setResult(null);
    setError(null);
    setPhase("idle");
  };

  const save = async () => {
    if (!result) return;
    setPhase("saving");
    try {
      await onSave(result); // closes the sheet / flips to job progress on success
    } catch (e) {
      setError(e instanceof Error ? e.message : "Couldn't save the recording.");
      setPhase("recorded");
    }
  };

  if (phase === "denied") {
    return (
      <View className="gap-3">
        <View className="flex-row items-start gap-3 rounded-2xl bg-destructive/10 p-4">
          <AlertCircle size={16} color={tokens.destructive} style={{ marginTop: 2 }} />
          <Text className="flex-1 text-sm text-destructive">
            Microphone access is off. Turn it on in Settings, then try again.
          </Text>
        </View>
        <Pressable
          accessibilityRole="button"
          onPress={reset}
          className="items-center rounded-full border border-border py-3"
        >
          <Text className="text-sm font-medium text-ink-soft">Try again</Text>
        </Pressable>
      </View>
    );
  }

  return (
    <View className="gap-3">
      <View className="items-center gap-4 rounded-2xl border border-border bg-paper p-6">
        <View className="flex-row items-center gap-2">
          {phase === "recording" && (
            <View className="h-2.5 w-2.5 rounded-full bg-health" accessibilityElementsHidden />
          )}
          <Text className="text-2xl font-medium text-ink">{fmt(elapsed)}</Text>
        </View>

        {phase === "idle" && (
          <Pressable
            accessibilityRole="button"
            accessibilityLabel="Start recording"
            disabled={disabled}
            onPress={start}
            className="h-16 w-16 items-center justify-center rounded-full bg-health"
          >
            <Mic size={28} color={tokens["health-on"]} />
          </Pressable>
        )}

        {phase === "recording" && (
          <Pressable
            accessibilityRole="button"
            accessibilityLabel="Stop recording"
            onPress={stop}
            className="h-16 w-16 items-center justify-center rounded-full bg-ink"
          >
            <Square size={22} color={tokens.paper} fill={tokens.paper} />
          </Pressable>
        )}

        <Text className="text-sm text-ink-soft">
          {phase === "idle"
            ? "Tap to start recording"
            : phase === "recording"
              ? "Recording… tap to stop"
              : "Tap Save to transcribe and structure it"}
        </Text>
      </View>

      {error && <Text className="text-sm text-destructive">{error}</Text>}

      {(phase === "recorded" || phase === "saving") && (
        <View className="flex-row gap-2">
          <Pressable
            accessibilityRole="button"
            onPress={reset}
            disabled={phase === "saving"}
            className="flex-1 flex-row items-center justify-center gap-2 rounded-full border border-border py-3"
          >
            <Trash2 size={16} color={tokens["ink-soft"]} />
            <Text className="text-sm font-medium text-ink-soft">Re-record</Text>
          </Pressable>
          <Pressable
            accessibilityRole="button"
            onPress={save}
            disabled={phase === "saving"}
            className="flex-1 items-center justify-center rounded-full bg-ink py-3"
          >
            <Text className="text-sm font-medium text-paper">
              {phase === "saving" ? "Saving…" : "Save"}
            </Text>
          </Pressable>
        </View>
      )}
    </View>
  );
}
