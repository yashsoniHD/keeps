import { useEffect, useRef, useState } from "react";
import { Mic, Square, Trash2, Loader2, AlertCircle } from "lucide-react";
import { PillButton } from "@/components/shared/PillButton";

// Picks an audio container the browser can actually record. Chrome/Android do webm/opus;
// Safari/iOS (14.3+) only do mp4/aac. Empty string lets MediaRecorder choose its default.
function pickMimeType(): string {
  const candidates = ["audio/webm", "audio/mp4", "audio/ogg"];
  if (typeof MediaRecorder === "undefined" || !MediaRecorder.isTypeSupported) return "";
  return candidates.find((t) => MediaRecorder.isTypeSupported(t)) ?? "";
}

function fmt(seconds: number): string {
  const m = Math.floor(seconds / 60);
  const s = seconds % 60;
  return `${m}:${s.toString().padStart(2, "0")}`;
}

type Phase = "idle" | "recording" | "recorded" | "saving" | "denied" | "unsupported";

// Self-contained voice recorder: tap to record, stop, then Save (uploads the audio Blob for
// transcription) or discard and re-record. Mic access is requested on the first tap (a user
// gesture), so opening the view never triggers a permission prompt on its own.
export function VoiceRecorder({
  onSave,
  className = "",
}: {
  onSave: (blob: Blob) => Promise<void>;
  className?: string;
}) {
  const [phase, setPhase] = useState<Phase>("idle");
  const [elapsed, setElapsed] = useState(0);
  const [error, setError] = useState<string | null>(null);

  const recorderRef = useRef<MediaRecorder | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const chunksRef = useRef<BlobPart[]>([]);
  const blobRef = useRef<Blob | null>(null);
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const stopTracks = () => {
    streamRef.current?.getTracks().forEach((t) => t.stop());
    streamRef.current = null;
    if (timerRef.current) clearInterval(timerRef.current);
    timerRef.current = null;
  };

  // Release the mic if the component unmounts mid-recording (sheet closed, navigation).
  useEffect(() => () => stopTracks(), []);

  const start = async () => {
    setError(null);
    if (typeof MediaRecorder === "undefined" || !navigator.mediaDevices?.getUserMedia) {
      setPhase("unsupported");
      return;
    }
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      streamRef.current = stream;
      const mimeType = pickMimeType();
      const rec = new MediaRecorder(stream, mimeType ? { mimeType } : undefined);
      chunksRef.current = [];
      rec.ondataavailable = (e) => {
        if (e.data.size > 0) chunksRef.current.push(e.data);
      };
      rec.onstop = () => {
        blobRef.current = new Blob(chunksRef.current, { type: rec.mimeType || "audio/webm" });
        stopTracks();
        setPhase("recorded");
      };
      recorderRef.current = rec;
      rec.start();
      setElapsed(0);
      setPhase("recording");
      timerRef.current = setInterval(() => setElapsed((s) => s + 1), 1000);
    } catch {
      // Permission denied, or no mic available.
      setPhase("denied");
      stopTracks();
    }
  };

  const stop = () => recorderRef.current?.stop();

  const reset = () => {
    blobRef.current = null;
    chunksRef.current = [];
    setElapsed(0);
    setPhase("idle");
  };

  const save = async () => {
    if (!blobRef.current) return;
    setPhase("saving");
    try {
      await onSave(blobRef.current); // closes the sheet on success
    } catch (e) {
      setError(e instanceof Error ? e.message : "Couldn't save the recording.");
      setPhase("recorded");
    }
  };

  if (phase === "denied" || phase === "unsupported") {
    return (
      <div className={className}>
        <div className="flex items-start gap-3 rounded-2xl bg-destructive/10 p-4 text-sm text-destructive">
          <AlertCircle className="mt-0.5 h-4 w-4 shrink-0" />
          <span>
            {phase === "denied"
              ? "Microphone access is needed to record. Allow it in your browser, then try again."
              : "Recording isn't supported in this browser."}
          </span>
        </div>
        {phase === "denied" && (
          <PillButton
            type="button"
            variant="secondary"
            onClick={() => setPhase("idle")}
            className="mt-3 w-full"
          >
            Try again
          </PillButton>
        )}
      </div>
    );
  }

  return (
    <div className={className}>
      <div className="flex flex-col items-center gap-4 rounded-2xl border border-border bg-paper p-6">
        <div className="flex items-center gap-2 text-2xl font-medium tabular-nums text-ink">
          {phase === "recording" && (
            <span className="h-2.5 w-2.5 animate-pulse rounded-full bg-health" aria-hidden />
          )}
          {fmt(elapsed)}
        </div>

        {phase === "idle" && (
          <button
            type="button"
            onClick={start}
            className="inline-flex h-16 w-16 items-center justify-center rounded-full bg-health text-health-on transition-opacity hover:opacity-90"
            aria-label="Start recording"
          >
            <Mic className="h-7 w-7" />
          </button>
        )}

        {phase === "recording" && (
          <button
            type="button"
            onClick={stop}
            className="inline-flex h-16 w-16 items-center justify-center rounded-full bg-ink text-paper transition-opacity hover:opacity-90"
            aria-label="Stop recording"
          >
            <Square className="h-6 w-6 fill-current" />
          </button>
        )}

        <p className="text-sm text-ink-soft">
          {phase === "idle"
            ? "Tap to start recording"
            : phase === "recording"
              ? "Recording… tap to stop"
              : "Tap Save to transcribe & structure it"}
        </p>
      </div>

      {error && <p className="mt-3 text-sm text-destructive">{error}</p>}

      {(phase === "recorded" || phase === "saving") && (
        <div className="mt-3 flex gap-2">
          <PillButton
            type="button"
            variant="secondary"
            onClick={reset}
            disabled={phase === "saving"}
            className="flex-1"
          >
            <Trash2 className="h-4 w-4" />
            Re-record
          </PillButton>
          <PillButton type="button" onClick={save} disabled={phase === "saving"} className="flex-1">
            {phase === "saving" ? (
              <>
                <Loader2 className="h-4 w-4 animate-spin" />
                Saving…
              </>
            ) : (
              "Save"
            )}
          </PillButton>
        </div>
      )}
    </div>
  );
}
