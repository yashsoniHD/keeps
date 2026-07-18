import { useCallback, useEffect, useRef, useState } from "react";
import {
  KeyboardAvoidingView,
  Platform,
  Pressable,
  ScrollView,
  Switch,
  Text,
  TextInput,
  View,
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { Stack, useRouter } from "expo-router";
import * as ExpoClipboard from "expo-clipboard";
import { ArrowUp, Clipboard as ClipboardIcon, Sparkles, X } from "lucide-react-native";
import type { Job } from "@clipnote/shared";
import { ApiError, ingest, ingestMedia, ingestText, ingestVoice } from "@/lib/api";
import { watchJob } from "@/lib/firestore";
import { enqueueCapture, isQueueableError, startCaptureReplay } from "@/lib/capture-queue";
import { useTheme } from "@/theme/ThemeProvider";
import { dark, light } from "@/theme/tokens";
import { ModeToggle, type CaptureMode } from "@/components/capture/ModeToggle";
import { MediaPicker, type PickedFile } from "@/components/capture/MediaPicker";
import { VoiceRecorder } from "@/components/capture/VoiceRecorder";
import { JobProgress } from "@/components/capture/JobProgress";

// Replay any queue that piled up while offline the moment connectivity returns. Wired once at
// module scope (app lifetime) so it runs regardless of whether the capture sheet is open. A
// permanently-rejected queued link is logged, not surfaced — the feed's failed-job card owns
// that feedback.
let replayWired = false;
if (!replayWired) {
  replayWired = true;
  startCaptureReplay((url, message) => console.warn("Dropped queued capture", url, message));
}

// One trimmed token that reads as a web address → treat as a link. Mirrors the web composer's
// looksLikeUrl so the link/text validation stays identical across platforms.
function looksLikeUrl(s: string): boolean {
  const t = s.trim();
  if (!t || /\s/.test(t)) return false;
  if (/^https?:\/\//i.test(t)) return true;
  return /^[a-z0-9-]+(\.[a-z0-9-]+)+(\/\S*)?$/i.test(t);
}

function domainOf(rawUrl: string): string | null {
  try {
    const withScheme = /^https?:\/\//i.test(rawUrl) ? rawUrl : `https://${rawUrl}`;
    return new URL(withScheme).hostname.replace(/^www\./, "");
  } catch {
    return null;
  }
}

type Phase = "compose" | "working" | "queued";

export default function CaptureScreen() {
  const router = useRouter();
  const { resolved } = useTheme();
  const tokens = resolved === "dark" ? dark : light;

  const [mode, setMode] = useState<CaptureMode>("link");
  const [url, setUrl] = useState("");
  const [urlFromClipboard, setUrlFromClipboard] = useState(false);
  const [text, setText] = useState("");
  const [processAI, setProcessAI] = useState(true);

  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const [phase, setPhase] = useState<Phase>("compose");
  const [jobId, setJobId] = useState<string | null>(null);
  const [jobStatus, setJobStatus] = useState<Job["status"]>("pending");
  const [domain, setDomain] = useState<string | null>(null);

  const dismiss = useCallback(() => {
    if (router.canGoBack()) router.back();
    else router.replace("/");
  }, [router]);

  // Auto-paste preload: once per modal open, check the clipboard for a URL and prefill Link
  // mode with it (visually marked as "From clipboard" so the user knows it wasn't typed).
  // iOS exposes a URL-typed clipboard API (hasUrlAsync/getUrlAsync) that never triggers the
  // generic paste-permission prompt for plain text; Android/other platforms fall back to
  // getStringAsync + our own URL check. A mount-only effect is "once per open" by
  // construction — this screen unmounts when dismissed and remounts fresh next time.
  const clipboardCheckedRef = useRef(false);
  useEffect(() => {
    if (clipboardCheckedRef.current) return;
    clipboardCheckedRef.current = true;
    if (mode !== "link" || url.trim().length > 0) return;
    (async () => {
      try {
        let candidate: string | null = null;
        if (Platform.OS === "ios" && ExpoClipboard.hasUrlAsync && ExpoClipboard.getUrlAsync) {
          if (await ExpoClipboard.hasUrlAsync()) candidate = await ExpoClipboard.getUrlAsync();
        } else {
          const str = (await ExpoClipboard.getStringAsync()).trim();
          if (looksLikeUrl(str)) candidate = str;
        }
        if (candidate && looksLikeUrl(candidate)) {
          setUrl(candidate);
          setUrlFromClipboard(true);
        }
      } catch {
        // Clipboard read failed or permission denied — leave the input empty, no error shown.
      }
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const onUrlChange = (v: string) => {
    setUrl(v);
    setUrlFromClipboard(false); // manual edit — the "From clipboard" hint no longer applies
  };

  // Watch the job once ingest hands us an id: navigate to the finished note, or drop to the
  // failed state (JobProgress renders retry + close) if the worker gave up.
  useEffect(() => {
    if (!jobId) return;
    const unsub = watchJob(jobId, (job) => {
      if (job.status) setJobStatus(job.status);
      if (job.status === "completed") {
        const noteId = job.destination?.note_id ?? job.note_id;
        if (noteId) router.replace(`/note/${noteId}`);
      }
    });
    return unsub;
  }, [jobId, router]);

  const startWatching = (id: string) => {
    setJobId(id);
    setJobStatus("pending");
    setPhase("working");
  };

  const submitLink = async () => {
    const raw = url.trim();
    if (!looksLikeUrl(raw)) {
      setError("That doesn't look like a link.");
      return;
    }
    const normalized = /^https?:\/\//i.test(raw) ? raw : `https://${raw}`;
    setError(null);
    setBusy(true);
    setDomain(domainOf(normalized));
    try {
      const { job_id } = await ingest(normalized);
      startWatching(job_id);
    } catch (e) {
      // Offline / 5xx → park it for replay when the connection returns, then dismiss.
      if (isQueueableError(e)) {
        enqueueCapture(normalized);
        setPhase("queued");
      } else {
        setError(e instanceof ApiError || e instanceof Error ? e.message : "Couldn't start the capture.");
      }
    } finally {
      setBusy(false);
    }
  };

  const submitText = async () => {
    const body = text.trim();
    if (!body) return;
    setError(null);
    setBusy(true);
    setDomain(null);
    try {
      const { job_id } = await ingestText(body, undefined, processAI);
      startWatching(job_id);
    } catch (e) {
      // The replay queue only holds URLs, so a typed note can't be queued — surface the error.
      setError(e instanceof ApiError || e instanceof Error ? e.message : "Couldn't save the note.");
    } finally {
      setBusy(false);
    }
  };

  // Picked file (photo/document) or a finished recording → same multipart upload path, then
  // watch the returned job exactly like link/text. Uploads can't be parked for offline replay
  // (the queue only holds URLs), so a failure surfaces inline.
  const submitMedia = async (picked: PickedFile) => {
    setError(null);
    setBusy(true);
    setDomain(null);
    try {
      const { job_id } = await ingestMedia(picked.file, picked.inputType);
      startWatching(job_id);
    } catch (e) {
      setError(e instanceof ApiError || e instanceof Error ? e.message : "Couldn't add that file.");
    } finally {
      setBusy(false);
    }
  };

  const submitVoice = async (recording: { uri: string; durationSec: number }) => {
    setError(null);
    setBusy(true);
    setDomain(null);
    try {
      const { job_id } = await ingestVoice(recording);
      startWatching(job_id);
    } catch (e) {
      // Re-throw so the recorder returns to its "recorded" state and shows the error itself.
      const message =
        e instanceof ApiError || e instanceof Error ? e.message : "Couldn't save the recording.";
      throw new Error(message);
    } finally {
      setBusy(false);
    }
  };

  const handleSubmit = () => {
    setError(null);
    if (mode === "link") void submitLink();
    else if (mode === "text") void submitText();
    // photo/file/voice submit from their own components, not the footer button.
  };

  // The footer Capture/Save button only applies to link + text; media modes drive their own
  // actions (pick a file, record) and don't use it.
  const canSubmit =
    mode === "link"
      ? url.trim().length > 0
      : mode === "text"
        ? text.trim().length > 0
        : false;
  const showFooterButton = mode === "link" || mode === "text";

  // Auto-dismiss shortly after parking an offline capture so the user lands back where they were.
  useEffect(() => {
    if (phase !== "queued") return;
    const t = setTimeout(dismiss, 1600);
    return () => clearTimeout(t);
  }, [phase, dismiss]);

  return (
    <View className="flex-1 bg-card">
      <Stack.Screen options={{ presentation: "modal", headerShown: false, animation: "slide_from_bottom" }} />
      <SafeAreaView className="flex-1" edges={["top", "bottom"]}>
        <KeyboardAvoidingView
          className="flex-1"
          behavior={Platform.OS === "ios" ? "padding" : undefined}
        >
          <View className="flex-row items-start justify-between px-5 pt-4">
            <View>
              <Text className="text-2xl font-semibold text-ink">New note</Text>
              <Text className="mt-1 text-sm text-ink-soft">
                {phase === "compose" ? "Paste a link, write, upload, or record." : "Clipnote is on it."}
              </Text>
            </View>
            <Pressable
              accessibilityRole="button"
              accessibilityLabel="Close"
              onPress={dismiss}
              className="h-9 w-9 items-center justify-center rounded-full"
            >
              <X size={22} color={tokens["ink-soft"]} />
            </Pressable>
          </View>

          <ScrollView
            contentContainerClassName="gap-4 px-5 pb-6 pt-5"
            keyboardShouldPersistTaps="handled"
          >
            {phase === "queued" ? (
              <View className="items-center gap-3 py-10">
                <Text className="text-center text-lg font-semibold text-ink">Saved to queue</Text>
                <Text className="text-center text-sm text-ink-soft">
                  This link will upload when you are back online.
                </Text>
              </View>
            ) : phase === "working" ? (
              <JobProgress
                status={jobStatus}
                domain={domain}
                error={error}
                onRetry={handleSubmit}
                onClose={dismiss}
              />
            ) : (
              <>
                <ModeToggle mode={mode} onChange={setMode} disabled={busy} />

                {mode === "link" ? (
                  <View className="gap-2">
                    <TextInput
                      autoFocus
                      value={url}
                      onChangeText={onUrlChange}
                      onSubmitEditing={handleSubmit}
                      placeholder="https://…"
                      placeholderTextColor={tokens["ink-soft"]}
                      autoCapitalize="none"
                      autoCorrect={false}
                      keyboardType="url"
                      returnKeyType="go"
                      editable={!busy}
                      className="rounded-2xl border border-border bg-paper px-4 py-3 text-base text-ink"
                    />
                    {urlFromClipboard && (
                      <View className="flex-row items-center gap-1.5 self-start rounded-full bg-muted px-2.5 py-1">
                        <ClipboardIcon size={12} color={tokens["ink-soft"]} />
                        <Text className="text-xs text-ink-soft">From clipboard</Text>
                      </View>
                    )}
                  </View>
                ) : mode === "text" ? (
                  <>
                    <TextInput
                      autoFocus
                      value={text}
                      onChangeText={setText}
                      placeholder="Write a note…"
                      placeholderTextColor={tokens["ink-soft"]}
                      multiline
                      textAlignVertical="top"
                      editable={!busy}
                      className="min-h-[140px] rounded-2xl border border-border bg-paper px-4 py-3 text-base text-ink"
                    />
                    <Pressable
                      accessibilityRole="switch"
                      accessibilityState={{ checked: processAI }}
                      onPress={() => setProcessAI((v) => !v)}
                      disabled={busy}
                      className="flex-row items-center justify-between gap-3 rounded-2xl border border-border bg-paper px-4 py-3"
                    >
                      <View className="flex-1 flex-row items-center gap-2.5">
                        <Sparkles size={18} color={tokens.product} />
                        <View className="flex-1">
                          <Text className="text-sm font-medium text-ink">
                            Let Clip AI structure it
                          </Text>
                          <Text className="text-xs text-ink-soft">
                            {processAI ? "Titled, tagged and formatted for you" : "Saved exactly as written"}
                          </Text>
                        </View>
                      </View>
                      <Switch
                        value={processAI}
                        onValueChange={setProcessAI}
                        disabled={busy}
                      />
                    </Pressable>
                  </>
                ) : mode === "voice" ? (
                  <VoiceRecorder onSave={submitVoice} disabled={busy} />
                ) : (
                  <MediaPicker
                    mode={mode}
                    onPicked={submitMedia}
                    onError={setError}
                    disabled={busy}
                  />
                )}

                {error && <Text className="text-sm text-destructive">{error}</Text>}

                {showFooterButton && (
                <Pressable
                  accessibilityRole="button"
                  onPress={handleSubmit}
                  disabled={!canSubmit || busy}
                  className={`mt-1 flex-row items-center justify-center gap-2 rounded-full py-3.5 ${
                    !canSubmit || busy ? "bg-muted" : "bg-ink"
                  }`}
                >
                  <Text
                    className={`text-base font-medium ${
                      !canSubmit || busy ? "text-ink-soft" : "text-paper"
                    }`}
                  >
                    {busy
                      ? "Saving…"
                      : mode === "link"
                        ? "Capture"
                        : processAI
                          ? "Save"
                          : "Save as is"}
                  </Text>
                  {!busy && (
                    <ArrowUp size={18} color={!canSubmit ? tokens["ink-soft"] : tokens.paper} />
                  )}
                </Pressable>
                )}
              </>
            )}
          </ScrollView>
        </KeyboardAvoidingView>
      </SafeAreaView>
    </View>
  );
}
