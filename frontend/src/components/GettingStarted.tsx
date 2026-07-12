import { useEffect, useState } from "react";
import { Link } from "@tanstack/react-router";
import { Check, ChevronRight, Compass, MonitorDown, Share, Smartphone, X } from "lucide-react";
import { listTokens } from "@/lib/api";
import { getInstallPrompt, isIOS, isStandalone } from "@/lib/platform";

// New-user checklist: install → connect the phone → first capture. Steps self-mark
// complete where the browser can tell (standalone mode, token count, note count);
// dismissal is persisted by the parent on users/{uid}.onboarding_done.
export function GettingStarted({
  notesCount,
  onAddLink,
  onTrySample,
  onDismiss,
}: {
  notesCount: number;
  onAddLink: () => void;
  onTrySample?: () => void;
  onDismiss: () => void;
}) {
  const [hasToken, setHasToken] = useState(false);
  const [installed, setInstalled] = useState(isStandalone);

  useEffect(() => {
    listTokens()
      .then((t) => setHasToken(t.length > 0))
      .catch(() => {});
  }, []);

  const ios = isIOS();
  const installPrompt = getInstallPrompt();

  const handleInstall = async () => {
    if (!installPrompt) return;
    await installPrompt.prompt();
    setTimeout(() => setInstalled(isStandalone()), 1500);
  };

  const steps: {
    done: boolean;
    icon: typeof Share;
    title: string;
    detail: React.ReactNode;
    action?: React.ReactNode;
  }[] = [
    {
      // Lead with the aha — activation comes from the first note, not from installing the PWA.
      done: notesCount > 0,
      icon: Compass,
      title: "Save your first link",
      detail: "Paste any URL (recipe, reel, product, article) and watch it become a note.",
      action: (
        <div className="flex shrink-0 items-center gap-2">
          {onTrySample && (
            <button
              type="button"
              onClick={onTrySample}
              className="rounded-full border border-border bg-card px-3.5 py-1.5 text-xs font-medium text-ink"
            >
              Try a sample
            </button>
          )}
          <button
            type="button"
            onClick={onAddLink}
            className="rounded-full bg-ink px-3.5 py-1.5 text-xs font-medium text-paper"
          >
            Add a link
          </button>
        </div>
      ),
    },
    {
      done: installed,
      icon: MonitorDown,
      title: "Install the app",
      detail: ios ? (
        <>
          In Safari: tap <Share className="inline h-3.5 w-3.5" /> <strong>Share</strong> →{" "}
          <strong>Add to Home Screen</strong>.
        </>
      ) : installPrompt ? (
        "One tap, and Clipnote opens like a native app."
      ) : (
        <>
          In your browser menu, choose <strong>Install app</strong> /{" "}
          <strong>Add to Home screen</strong>.
        </>
      ),
      action:
        !ios && installPrompt ? (
          <button
            type="button"
            onClick={handleInstall}
            className="rounded-full bg-ink px-3.5 py-1.5 text-xs font-medium text-paper"
          >
            Install
          </button>
        ) : undefined,
    },
    {
      done: hasToken,
      icon: Smartphone,
      title: "Set up the shortcut",
      detail: ios ? (
        <>
          In <strong>Settings → Capture from your phone</strong>, add the iPhone shortcut, then any
          app's share sheet saves to Clipnote.
        </>
      ) : (
        <>
          On Android the installed app joins the share sheet by itself. On an iPhone, add the
          shortcut from <strong>Settings → Capture from your phone</strong>.
        </>
      ),
      action: (
        <Link
          to="/settings"
          className="inline-flex items-center gap-1 rounded-full border border-border bg-card px-3.5 py-1.5 text-xs font-medium text-ink"
        >
          Set up
          <ChevronRight className="h-3 w-3" />
        </Link>
      ),
    },
  ];

  return (
    <section className="mb-5 rounded-3xl border border-border bg-card p-5">
      <div className="flex items-start justify-between gap-3">
        <div>
          <h2 className="font-serif text-2xl text-ink">Welcome to Clipnote</h2>
          <p className="mt-1 text-sm text-ink-soft">Three steps to make capture a reflex.</p>
        </div>
        <button
          type="button"
          onClick={onDismiss}
          aria-label="Dismiss getting started guide"
          className="shrink-0 rounded-full p-1.5 text-ink-soft transition-colors hover:text-ink"
        >
          <X className="h-4 w-4" />
        </button>
      </div>

      <ol className="mt-4 space-y-3">
        {steps.map((step, i) => (
          <li
            key={i}
            className={`flex items-center gap-3.5 rounded-2xl border border-border/70 p-3.5 ${
              step.done ? "opacity-60" : ""
            }`}
          >
            <span
              className={`flex h-9 w-9 shrink-0 items-center justify-center rounded-full ${
                step.done ? "bg-place-soft text-place-chip" : "bg-muted text-ink-soft"
              }`}
            >
              {step.done ? <Check className="h-4 w-4" /> : <step.icon className="h-4 w-4" />}
            </span>
            <div className="min-w-0 flex-1">
              <div className={`text-sm font-medium text-ink ${step.done ? "line-through" : ""}`}>
                {step.title}
              </div>
              <div className="mt-0.5 text-xs text-ink-soft">{step.detail}</div>
            </div>
            {!step.done && step.action}
          </li>
        ))}
      </ol>
    </section>
  );
}
