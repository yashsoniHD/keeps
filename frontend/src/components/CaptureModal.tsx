import { useEffect, useRef, useState } from "react";
import { useNavigate } from "@tanstack/react-router";
import { Sparkles, X, Link2, AlertCircle } from "lucide-react";
import { ingest } from "@/lib/api";
import { watchJob } from "@/lib/firestore";
import { goToDestination } from "@/lib/nav";

const stages = [
  "Fetching the content…",
  "Reading & watching…",
  "Detecting structure…",
  "Drafting your note…",
];

export function CaptureModal({ url, onClose }: { url: string; onClose: () => void }) {
  const navigate = useNavigate();
  const [stage, setStage] = useState(0);
  const [done, setDone] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const unsubRef = useRef<(() => void) | null>(null);

  useEffect(() => {
    // The stage animation is paced for the real pipeline (12–70s) and parks on the
    // last stage until the Firestore job listener reports completion.
    const timers: ReturnType<typeof setTimeout>[] = stages.map((_, i) =>
      setTimeout(() => setStage(i), i * 2500),
    );

    ingest(url)
      .then(({ job_id }) => {
        unsubRef.current = watchJob(job_id, (job) => {
          if (job.status === "completed" && (job.destination || job.note_id)) {
            unsubRef.current?.();
            setDone(true);
            setTimeout(() => goToDestination(navigate, job.destination, job.note_id), 600);
          } else if (job.status === "failed") {
            unsubRef.current?.();
            setError(job.error ?? "Processing failed. Please try again.");
          }
        });
      })
      .catch((e: Error) => setError(e.message));

    return () => {
      timers.forEach(clearTimeout);
      unsubRef.current?.();
    };
  }, [url, navigate]);

  let domain = "";
  try {
    domain = new URL(url.startsWith("http") ? url : `https://${url}`).hostname.replace(
      /^www\./,
      "",
    );
  } catch {
    domain = url;
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-ink/40 p-4 backdrop-blur-sm">
      <div className="relative w-full max-w-md rounded-3xl border border-border bg-card p-6 shadow-2xl">
        <button
          type="button"
          onClick={onClose}
          className="absolute right-4 top-4 inline-flex h-8 w-8 items-center justify-center rounded-full text-ink-soft hover:bg-accent hover:text-ink"
          aria-label="Close"
        >
          <X className="h-4 w-4" />
        </button>

        <div className="flex items-center gap-3 rounded-2xl border border-border bg-paper p-3">
          {domain ? (
            <img
              src={`https://www.google.com/s2/favicons?domain=${domain}&sz=64`}
              alt=""
              className="h-8 w-8 rounded-md"
            />
          ) : (
            <div className="flex h-8 w-8 items-center justify-center rounded-md bg-muted">
              <Link2 className="h-4 w-4 text-ink-soft" />
            </div>
          )}
          <div className="min-w-0 flex-1">
            <div className="truncate text-sm font-medium text-ink">{domain || "Source"}</div>
            <div className="truncate text-xs text-ink-soft">{url}</div>
          </div>
        </div>

        {error ? (
          <div className="mt-6 flex items-start gap-3 rounded-2xl bg-destructive/10 p-4 text-sm text-destructive">
            <AlertCircle className="mt-0.5 h-4 w-4 shrink-0" />
            <span>{error}</span>
          </div>
        ) : (
          <div className="mt-6">
            <div className="inline-flex items-center gap-1.5 text-xs uppercase tracking-wider text-ink-soft">
              <Sparkles className={`h-3.5 w-3.5 ${done ? "" : "animate-pulse"}`} />
              {done ? "Done" : "AI at work"}
            </div>

            <ul className="mt-3 space-y-2">
              {stages.map((label, i) => {
                const active = i === stage && !done;
                const complete = i < stage || done;
                return (
                  <li key={i} className="flex items-center gap-3">
                    <span
                      className={`flex h-5 w-5 items-center justify-center rounded-full text-[10px] ${
                        complete
                          ? "bg-ink text-paper"
                          : active
                            ? "bg-summary-soft text-summary"
                            : "bg-muted text-ink-soft"
                      }`}
                    >
                      {complete ? "✓" : i + 1}
                    </span>
                    <span
                      className={`text-sm transition-colors ${
                        complete
                          ? "text-ink-soft line-through"
                          : active
                            ? "text-ink"
                            : "text-ink-soft"
                      }`}
                    >
                      {label}
                    </span>
                  </li>
                );
              })}
            </ul>
            <p className="mt-4 text-xs text-ink-soft">
              Videos can take up to a minute. The note appears in your feed automatically.
            </p>
          </div>
        )}
      </div>
    </div>
  );
}
