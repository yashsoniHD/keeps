import { useEffect, useState } from "react";
import { Link } from "@tanstack/react-router";
import { useAuth } from "@/contexts/auth-context";
import { listTokensCached } from "@/lib/api";
import { getInstallPrompt, isIOS, isStandalone } from "@/lib/platform";
import { Icon, IconButton } from "./ui";

// New-user checklist: save a link -> install -> connect the phone. Steps self-mark complete where
// the browser can tell (note count, standalone mode, token count). Dismissal is persisted by the
// parent (users/{uid}.onboarding_done + a localStorage mirror).
export function Guide({
  notesCount,
  onAddLink,
  onTrySample,
  onDismiss,
}: {
  notesCount: number;
  onAddLink: () => void;
  onTrySample: () => void;
  onDismiss: () => void;
}) {
  const { user } = useAuth();
  const [hasToken, setHasToken] = useState(false);
  const [installed, setInstalled] = useState(isStandalone);
  useEffect(() => {
    if (!user) return;
    listTokensCached(user.uid)
      .then((t) => setHasToken(t.length > 0))
      .catch(() => {});
  }, [user]);

  const ios = isIOS();
  const installPrompt = getInstallPrompt();
  const install = async () => {
    if (!installPrompt) return;
    await installPrompt.prompt();
    setTimeout(() => setInstalled(isStandalone()), 1500);
  };

  const steps = [
    {
      done: notesCount > 0,
      title: "Save your first link",
      detail: "Paste any URL (recipe, reel, product, article) and watch it become a note.",
      action: (
        <>
          <button type="button" className="secondary" onClick={onTrySample}>
            Try a sample
          </button>
          <button type="button" className="primary" onClick={onAddLink}>
            Add a link
          </button>
        </>
      ),
    },
    {
      done: installed,
      title: "Install the app",
      detail: ios
        ? "In Safari, tap Share, then Add to Home Screen."
        : installPrompt
          ? "One tap, and Keeps opens like a native app."
          : "In your browser menu, choose Install app or Add to Home screen.",
      action:
        !ios && installPrompt ? (
          <button type="button" className="primary" onClick={install}>
            Install
          </button>
        ) : null,
    },
    {
      done: hasToken,
      title: "Set up the shortcut",
      detail: ios
        ? "In Settings, add the iPhone shortcut, then any app's share sheet saves here."
        : "On Android the installed app joins the share sheet by itself. On an iPhone, add the shortcut in Settings.",
      action: (
        <Link to="/settings" className="secondary">
          Set up
        </Link>
      ),
    },
  ];

  return (
    <section className="guide-card" aria-label="Getting started">
      <div className="guide-head">
        <div>
          <h2>Welcome to Keeps</h2>
          <p>Three steps to make saving a reflex.</p>
        </div>
        <IconButton icon="X" label="Dismiss getting started guide" onClick={onDismiss} />
      </div>
      <ol>
        {steps.map((s) => (
          <li key={s.title} className={s.done ? "done" : ""}>
            <span className="guide-mark">{s.done ? <Icon name="Check" size={16} /> : null}</span>
            <div className="guide-copy">
              <strong>{s.title}</strong>
              <span>{s.detail}</span>
            </div>
            {!s.done && s.action && <div className="guide-actions">{s.action}</div>}
          </li>
        ))}
      </ol>
    </section>
  );
}
