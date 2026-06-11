import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { useCallback, useEffect, useState } from "react";
import { ArrowLeft, LogOut, Trash2, Smartphone, Copy, Check, X, Download } from "lucide-react";
import { useAuth } from "@/contexts/auth-context";
import {
  deleteAllNotes,
  createToken,
  listTokens,
  revokeToken,
  type ShortcutToken,
} from "@/lib/api";
import { AppShell } from "@/components/AppShell";

export const Route = createFileRoute("/settings")({ component: Settings });

// One-time setup: import frontend/public/clipnote.shortcut into the Shortcuts app (Mac),
// Share → "Copy iCloud Link", paste it here. iOS only allows true one-tap installs from
// icloud.com/shortcuts links — the shortcuts:// URL scheme rejects self-hosted files
// ("invalid URL"), and file downloads need manual taps through Safari's download list.
const SHORTCUT_ICLOUD_LINK = "";

// Installed-PWA context has no Safari download UI; we steer users to Safari for the file.
const isStandalone = () =>
  window.matchMedia("(display-mode: standalone)").matches ||
  ("standalone" in navigator && (navigator as { standalone?: boolean }).standalone === true);

function Settings() {
  const { user, loading, signOut } = useAuth();
  const navigate = useNavigate();
  const [clearConfirm, setClearConfirm] = useState(false);
  const [clearing, setClearing] = useState(false);
  const [clearError, setClearError] = useState<string | null>(null);

  useEffect(() => {
    if (!loading && !user) navigate({ to: "/login" });
  }, [user, loading, navigate]);

  const handleSignOut = async () => {
    await signOut();
    navigate({ to: "/login" });
  };

  const handleClearNotes = async () => {
    if (!clearConfirm) {
      setClearConfirm(true);
      return;
    }
    setClearing(true);
    setClearError(null);
    try {
      await deleteAllNotes();
      navigate({ to: "/" });
    } catch (e) {
      setClearError(e instanceof Error ? e.message : "Couldn't clear notes.");
    } finally {
      setClearing(false);
      setClearConfirm(false);
    }
  };

  if (loading || !user) return null;

  return (
    <AppShell>
      <div className="mx-auto max-w-2xl px-4 py-8 md:px-6">
        <Link
          to="/"
          className="mb-4 inline-flex items-center gap-1.5 text-sm text-ink-soft transition-colors hover:text-ink"
        >
          <ArrowLeft className="h-4 w-4" />
          Notes
        </Link>
        <h1 className="font-serif text-3xl text-ink">Settings</h1>

        <section className="mt-8 rounded-3xl border border-border bg-card p-6">
          <h2 className="text-xs uppercase tracking-wider text-ink-soft">Profile</h2>
          <div className="mt-4 flex items-center gap-4">
            {user.photoURL && (
              <img
                src={user.photoURL}
                alt=""
                className="h-14 w-14 rounded-full"
                referrerPolicy="no-referrer"
              />
            )}
            <div>
              <div className="font-medium text-ink">{user.displayName}</div>
              <div className="text-sm text-ink-soft">{user.email}</div>
            </div>
          </div>
        </section>

        <ConnectPhone />

        <section className="mt-4 rounded-3xl border border-border bg-card p-6">
          <h2 className="text-xs uppercase tracking-wider text-ink-soft">Account</h2>
          <button
            onClick={handleSignOut}
            className="mt-4 flex items-center gap-2 text-sm text-ink hover:text-ink-soft"
          >
            <LogOut className="h-4 w-4" />
            Sign out
          </button>
        </section>

        <section className="mt-4 rounded-3xl border border-destructive/30 bg-card p-6">
          <h2 className="text-xs uppercase tracking-wider text-destructive">Danger zone</h2>
          <p className="mt-2 text-sm text-ink-soft">
            This permanently deletes all your notes. Cannot be undone.
          </p>
          <button
            onClick={handleClearNotes}
            disabled={clearing}
            className={`mt-4 flex items-center gap-2 rounded-full px-5 py-2.5 text-sm font-medium transition-colors ${
              clearConfirm
                ? "bg-destructive text-white"
                : "border border-destructive/30 text-destructive hover:bg-destructive/10"
            }`}
          >
            <Trash2 className="h-4 w-4" />
            {clearing ? "Clearing…" : clearConfirm ? "Tap again to confirm" : "Clear all notes"}
          </button>
          {clearError && <p className="mt-3 text-sm text-destructive">{clearError}</p>}
        </section>
      </div>
    </AppShell>
  );
}

function ConnectPhone() {
  const [tokens, setTokens] = useState<ShortcutToken[]>([]);
  const [newToken, setNewToken] = useState<string | null>(null);
  const [creating, setCreating] = useState(false);
  const [copied, setCopied] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const refresh = useCallback(() => {
    listTokens()
      .then(setTokens)
      .catch(() => setError("Couldn't load your connected devices. Refresh to retry."));
  }, []);
  useEffect(refresh, [refresh]);

  const handleCreate = async () => {
    setCreating(true);
    setError(null);
    try {
      const { token } = await createToken("iPhone");
      setNewToken(token);
      // Copy immediately so it's ready to paste into the Shortcut's install prompt.
      try {
        await navigator.clipboard.writeText(token);
        setCopied(true);
        setTimeout(() => setCopied(false), 2000);
      } catch {
        /* clipboard may be blocked until a user gesture — the Copy button is the fallback */
      }
      refresh();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Couldn't create token.");
    } finally {
      setCreating(false);
    }
  };

  const handleCopy = async () => {
    if (!newToken) return;
    await navigator.clipboard.writeText(newToken);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  return (
    <section className="mt-4 rounded-3xl border border-border bg-card p-6">
      <h2 className="inline-flex items-center gap-2 text-xs uppercase tracking-wider text-ink-soft">
        <Smartphone className="h-3.5 w-3.5" />
        Capture from your phone
      </h2>

      <div className="mt-4 space-y-2 text-sm text-ink-soft">
        <p>
          <strong className="text-ink">Android / desktop:</strong> install Clipnote from the
          browser menu ("Add to Home screen") — it then appears in your share sheet.
        </p>
        <p>
          <strong className="text-ink">iPhone:</strong> create a token, download the ready-made
          Shortcut, and paste the token once when prompted. Links then share straight to Clipnote
          from any app.
        </p>
      </div>

      {newToken ? (
        <div className="mt-4 rounded-2xl border border-border bg-paper p-4">
          <div className="text-xs uppercase tracking-wider text-ink-soft">
            Your token — shown only once
          </div>
          <div className="mt-2 flex items-center gap-2">
            <code className="min-w-0 flex-1 truncate rounded-lg bg-muted px-3 py-2 text-xs text-ink">
              {newToken}
            </code>
            <button
              type="button"
              onClick={handleCopy}
              className="inline-flex h-9 w-9 shrink-0 items-center justify-center rounded-full border border-border text-ink-soft hover:text-ink"
              aria-label="Copy token"
            >
              {copied ? <Check className="h-4 w-4 text-itinerary" /> : <Copy className="h-4 w-4" />}
            </button>
          </div>
          <p className="mt-2 text-xs text-ink-soft">
            {copied ? "Copied to your clipboard ✓ — keep it handy for step 2." : "Tap copy, then keep it handy for step 2."}
          </p>

          <a
            href={SHORTCUT_ICLOUD_LINK || "/clipnote.shortcut"}
            className="mt-4 inline-flex w-full items-center justify-center gap-2 rounded-full bg-ink px-5 py-3 text-sm font-medium text-paper transition-opacity hover:opacity-90"
          >
            <Download className="h-4 w-4" />
            {SHORTCUT_ICLOUD_LINK ? "Add the Shortcut" : "Download the Shortcut"}
          </a>

          {SHORTCUT_ICLOUD_LINK ? (
            <ol className="mt-4 list-decimal space-y-1.5 pl-5 text-sm text-ink-soft">
              <li>Tap <strong className="text-ink">Add the Shortcut</strong> — it opens the Shortcuts app.</li>
              <li>Tap <strong className="text-ink">Add Shortcut</strong>, then paste your token when asked <em>"Paste your Clipnote token"</em>.</li>
              <li>
                Done. In any app: <strong className="text-ink">Share</strong> →{" "}
                <strong className="text-ink">Save to Clipnote</strong>.
              </li>
            </ol>
          ) : (
            <ol className="mt-4 list-decimal space-y-1.5 pl-5 text-sm text-ink-soft">
              <li>Tap <strong className="text-ink">Download the Shortcut</strong> in Safari on your iPhone.</li>
              <li>Tap the <strong className="text-ink">downloads (↓) icon</strong> in Safari's address bar, then tap <strong className="text-ink">Save to Clipnote.shortcut</strong> — the Shortcuts app opens.</li>
              <li>Tap <strong className="text-ink">Add Shortcut</strong>, then paste your token when asked <em>"Paste your Clipnote token"</em>.</li>
              <li>
                Done. In any app: <strong className="text-ink">Share</strong> →{" "}
                <strong className="text-ink">Save to Clipnote</strong>.
              </li>
            </ol>
          )}
          {isStandalone() && !SHORTCUT_ICLOUD_LINK && (
            <p className="mt-3 text-xs text-ink-soft">
              You're in the installed app, where iPhone can't show downloads — open{" "}
              <strong className="text-ink">{window.location.host}/settings</strong> in Safari for
              this step.
            </p>
          )}
          <button
            type="button"
            onClick={() => setNewToken(null)}
            className="mt-4 text-sm text-ink-soft underline hover:text-ink"
          >
            Done — hide token
          </button>
        </div>
      ) : (
        <button
          type="button"
          onClick={handleCreate}
          disabled={creating}
          className="mt-4 rounded-full bg-ink px-5 py-2.5 text-sm font-medium text-paper transition-opacity hover:opacity-90 disabled:opacity-50"
        >
          {creating ? "Creating…" : "Create iPhone token"}
        </button>
      )}
      {error && <p className="mt-3 text-sm text-destructive">{error}</p>}

      {tokens.length > 0 && (
        <div className="mt-5 border-t border-border pt-4">
          <div className="text-xs uppercase tracking-wider text-ink-soft">Connected devices</div>
          <ul className="mt-2 divide-y divide-border">
            {tokens.map((t) => (
              <li key={t.id} className="flex items-center justify-between gap-3 py-2.5">
                <div>
                  <div className="text-sm font-medium text-ink">{t.label}</div>
                  <div className="text-xs text-ink-soft">
                    {t.last_used_at ? "Used recently" : "Never used"}
                  </div>
                </div>
                <button
                  type="button"
                  onClick={() => revokeToken(t.id).then(refresh)}
                  className="inline-flex items-center gap-1 rounded-full border border-border px-3 py-1 text-xs text-ink-soft transition-colors hover:border-destructive/40 hover:text-destructive"
                >
                  <X className="h-3 w-3" />
                  Revoke
                </button>
              </li>
            ))}
          </ul>
        </div>
      )}
    </section>
  );
}
