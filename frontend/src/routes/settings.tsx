import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { useCallback, useEffect, useState } from "react";
import {
  ArrowLeft,
  LogOut,
  Trash2,
  Smartphone,
  Copy,
  Check,
  X,
  Download,
  BarChart3,
} from "lucide-react";
import { useAuth } from "@/contexts/auth-context";
import { ADMIN_EMAILS } from "@/routes/admin";
import {
  deleteAllNotes,
  createToken,
  listTokens,
  revokeToken,
  type ShortcutToken,
} from "@/lib/api";
import { AppShell } from "@/components/AppShell";
import { isStandalone } from "@/lib/platform";

export const Route = createFileRoute("/settings")({ component: Settings });

// Published from frontend/public/clipnote.shortcut (import into Shortcuts on the Mac →
// Share → "Copy iCloud Link"). iOS only allows true one-tap installs from
// icloud.com/shortcuts links — the shortcuts:// URL scheme rejects self-hosted files
// ("invalid URL"), and file downloads need manual taps through Safari's download list.
// The published copy carries the "Paste your Clipnote token" import question (verified
// via the icloud.com/shortcuts/api/records/<id> payload) — no token is baked in.
// Re-publishing creates a NEW link; update this constant whenever the shortcut changes.
const SHORTCUT_ICLOUD_LINK = "https://www.icloud.com/shortcuts/a3ff9cb521f54dfcb8d82a5773050848";

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
          {!!user.email && ADMIN_EMAILS.has(user.email.toLowerCase()) && (
            <Link
              to="/admin"
              className="mt-4 flex items-center gap-2 text-sm text-ink hover:text-ink-soft"
            >
              <BarChart3 className="h-4 w-4" />
              Admin dashboard
            </Link>
          )}
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

  // Tap 1: create the token and auto-copy it. The shortcut link is then a real anchor
  // ("Add the Shortcut") — JS-triggered window.open after an await is outside the user
  // gesture and iOS blocks it, so opening Shortcuts gets its own explicit tap instead.
  // Safari clipboard gotcha: writeText after an await is equally outside the gesture —
  // but ClipboardItem accepts a *promise* for its payload, letting the write start
  // synchronously inside the gesture while the token is still being minted.
  const handleAdd = async () => {
    setCreating(true);
    setError(null);
    setCopied(false);
    const tokenPromise = createToken("iPhone").then(({ token }) => token);
    tokenPromise.then(() => refresh()).catch(() => {});

    let clipboardOk = false;
    try {
      if (typeof ClipboardItem !== "undefined" && navigator.clipboard?.write) {
        await navigator.clipboard.write([
          new ClipboardItem({
            "text/plain": tokenPromise.then((t) => new Blob([t], { type: "text/plain" })),
          }),
        ]);
        clipboardOk = true;
      }
    } catch {
      /* clipboard refused — the visible token + Copy button below is the fallback */
    }

    try {
      const token = await tokenPromise;
      setNewToken(token); // stays on screen as the fallback if the paste was missed
      if (!clipboardOk) {
        try {
          await navigator.clipboard.writeText(token);
          clipboardOk = true;
        } catch {
          /* same fallback */
        }
      }
      setCopied(clipboardOk);
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
          <strong className="text-ink">Android / desktop:</strong> install Clipnote from the browser
          menu ("Add to Home screen") — it then appears in your share sheet.
        </p>
        <p>
          <strong className="text-ink">iPhone:</strong> one tap sets up a Shortcut so any app's
          share sheet can save straight to Clipnote.
        </p>
      </div>

      {!newToken && (
        <button
          type="button"
          onClick={handleAdd}
          disabled={creating}
          className="mt-4 rounded-full bg-ink px-5 py-2.5 text-sm font-medium text-paper transition-opacity hover:opacity-90 disabled:opacity-50"
        >
          {creating ? "Setting up…" : "Add iPhone shortcut"}
        </button>
      )}

      {newToken && (
        <div className="mt-4 rounded-2xl border border-border bg-paper p-4">
          {SHORTCUT_ICLOUD_LINK ? (
            <>
              <a
                href={SHORTCUT_ICLOUD_LINK}
                target="_blank"
                rel="noreferrer"
                className="inline-flex w-full items-center justify-center gap-2 rounded-full bg-ink px-5 py-3 text-sm font-medium text-paper transition-opacity hover:opacity-90"
              >
                <Download className="h-4 w-4" />
                Add the Shortcut
              </a>
              <ol className="mt-4 list-decimal space-y-1.5 pl-5 text-sm text-ink-soft">
                <li>
                  Tap <strong className="text-ink">Add the Shortcut</strong> — the Shortcuts app
                  opens.
                </li>
                <li>
                  Tap <strong className="text-ink">Add Shortcut</strong>, then{" "}
                  <strong className="text-ink">paste when asked</strong> — your token is already
                  copied.
                </li>
                <li>
                  Done. In any app: <strong className="text-ink">Share</strong> →{" "}
                  <strong className="text-ink">Save to Clipnote</strong>.
                </li>
              </ol>
            </>
          ) : (
            <>
              <a
                href="/clipnote.shortcut"
                className="inline-flex w-full items-center justify-center gap-2 rounded-full bg-ink px-5 py-3 text-sm font-medium text-paper transition-opacity hover:opacity-90"
              >
                <Download className="h-4 w-4" />
                Download the Shortcut
              </a>
              <ol className="mt-4 list-decimal space-y-1.5 pl-5 text-sm text-ink-soft">
                <li>
                  Tap <strong className="text-ink">Download the Shortcut</strong> in Safari on your
                  iPhone.
                </li>
                <li>
                  Tap the <strong className="text-ink">downloads (↓) icon</strong> in Safari's
                  address bar, then tap{" "}
                  <strong className="text-ink">Save to Clipnote.shortcut</strong> — the Shortcuts
                  app opens.
                </li>
                <li>
                  Tap <strong className="text-ink">Add Shortcut</strong>, then paste your token when
                  asked <em>"Paste your Clipnote token"</em>.
                </li>
                <li>
                  Done. In any app: <strong className="text-ink">Share</strong> →{" "}
                  <strong className="text-ink">Save to Clipnote</strong>.
                </li>
              </ol>
              {isStandalone() && (
                <p className="mt-3 text-xs text-ink-soft">
                  You're in the installed app, where iPhone can't show downloads — open{" "}
                  <strong className="text-ink">{window.location.host}/settings</strong> in Safari
                  for this step.
                </p>
              )}
            </>
          )}

          <div className="mt-4 border-t border-border pt-3">
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
                {copied ? (
                  <Check className="h-4 w-4 text-itinerary" />
                ) : (
                  <Copy className="h-4 w-4" />
                )}
              </button>
            </div>
            <p className="mt-2 text-xs text-ink-soft">
              {copied
                ? "Copied to your clipboard ✓ — just paste when the Shortcut asks."
                : "Tap copy, then paste when the Shortcut asks."}
            </p>
          </div>

          <button
            type="button"
            onClick={() => setNewToken(null)}
            className="mt-4 text-sm text-ink-soft underline hover:text-ink"
          >
            Done — hide token
          </button>
        </div>
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
