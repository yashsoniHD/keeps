import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { useCallback, useEffect, useState } from "react";
import {
  ArrowLeft,
  LogOut,
  Smartphone,
  Copy,
  Check,
  Download,
  BarChart3,
  Share2,
  Moon,
  Sun,
  LayoutGrid,
  Rows3,
  Settings as SettingsIcon,
} from "lucide-react";
import { useAuth } from "@/contexts/auth-context";
import { useLayout } from "@/lib/layout";
import { checkAdminAccess } from "@/routes/admin";
import { createToken, listTokens, revokeToken, type ShortcutToken } from "@/lib/api";
import { AppShell } from "@/components/AppShell";
import { CategoriesSection } from "@/components/CategoriesSection";
import { Switch } from "@/components/ui/switch";
import { useTheme } from "@/lib/theme";
import { getInstallPrompt, isAndroid, isIOS, isStandalone } from "@/lib/platform";

export const Route = createFileRoute("/settings")({ component: Settings });

// Published from frontend/public/clipnote.shortcut (import into Shortcuts on the Mac →
// Share → "Copy iCloud Link"). iOS only allows true one-tap installs from
// icloud.com/shortcuts links — the shortcuts:// URL scheme rejects self-hosted files
// ("invalid URL"), and file downloads need manual taps through Safari's download list.
// The published copy carries the "Paste your Clipnote token" import question (verified
// via the icloud.com/shortcuts/api/records/<id> payload) — no token is baked in.
// Re-publishing creates a NEW link; update this constant whenever the shortcut changes.
const SHORTCUT_ICLOUD_LINK = "https://www.icloud.com/shortcuts/d3ba89f721d54d1ba2e89185f6472eae";

// Where the app lives — shared via the "Share the app" button below.
const APP_URL = "https://clipnote.web.app";
const APP_SHARE_TEXT =
  "Clipnote: save any link as a beautifully structured note you'll actually re-read.";

function Settings() {
  const { user, loading, signOut } = useAuth();
  const navigate = useNavigate();
  const [signOutConfirm, setSignOutConfirm] = useState(false);
  const [shareCopied, setShareCopied] = useState(false);
  const [isAdmin, setIsAdmin] = useState(false);

  useEffect(() => {
    if (!loading && !user) navigate({ to: "/login" });
  }, [user, loading, navigate]);

  // Only the server knows who's an admin (ADMIN_EMAILS is a Cloud Run env var, never
  // shipped to the client). Probe once per session — the shared cache means this is a
  // no-op network-wise if /admin already ran it, and vice versa.
  useEffect(() => {
    if (!user) return;
    let cancelled = false;
    checkAdminAccess()
      .then(() => {
        if (!cancelled) setIsAdmin(true);
      })
      .catch(() => {
        if (!cancelled) setIsAdmin(false);
      });
    return () => {
      cancelled = true;
    };
  }, [user]);

  const handleSignOut = async () => {
    await signOut();
    navigate({ to: "/login" });
  };

  const handleShareApp = async () => {
    const shareData = { title: "Clipnote", text: APP_SHARE_TEXT, url: APP_URL };
    if (navigator.share && navigator.canShare?.(shareData)) {
      try {
        await navigator.share(shareData);
      } catch {
        // User dismissed the share sheet — not an error.
      }
      return;
    }
    try {
      await navigator.clipboard.writeText(`${APP_SHARE_TEXT}\n\n${APP_URL}`);
      setShareCopied(true);
      setTimeout(() => setShareCopied(false), 2000);
    } catch {
      // Clipboard blocked (insecure context, denied permission) — nothing to do.
    }
  };

  // Auth still resolving — show a spinner instead of a blank flash.
  if (loading || !user) {
    return (
      <div className="flex min-h-screen items-center justify-center">
        <SettingsIcon className="h-6 w-6 animate-pulse text-ink-soft" />
      </div>
    );
  }

  return (
    <AppShell>
      <div className="mx-auto max-w-2xl px-4 py-8 md:px-6">
        <Link
          to="/"
          className="mb-4 inline-flex items-center gap-1.5 text-sm text-ink-soft transition-colors hover:text-ink"
        >
          <ArrowLeft className="h-4 w-4" />
          Home
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

        {/* Preferences first (appearance + view), then organisation, then device setup. */}
        <AppearanceSection />

        <CategoriesSection />

        <ConnectPhone />

        <section className="mt-4 rounded-3xl border border-border bg-card p-6">
          <h2 className="text-xs uppercase tracking-wider text-ink-soft">Account</h2>
          <button
            onClick={handleShareApp}
            className="mt-4 flex items-center gap-2 text-sm text-ink hover:text-ink-soft"
          >
            {shareCopied ? <Check className="h-4 w-4" /> : <Share2 className="h-4 w-4" />}
            {shareCopied ? "Link copied!" : "Share the app"}
          </button>
          {isAdmin && (
            <Link
              to="/admin"
              className="mt-4 flex items-center gap-2 text-sm text-ink hover:text-ink-soft"
            >
              <BarChart3 className="h-4 w-4" />
              Admin dashboard
            </Link>
          )}
          <button
            onClick={() => setSignOutConfirm(true)}
            className="mt-4 flex items-center gap-2 text-sm text-ink hover:text-ink-soft"
          >
            <LogOut className="h-4 w-4" />
            Sign out
          </button>
        </section>
      </div>

      {signOutConfirm && (
        <div className="fixed inset-0 z-50 flex items-end justify-center bg-ink/40 p-0 backdrop-blur-sm md:items-center md:p-4">
          <div className="w-full max-w-sm rounded-t-3xl border border-border bg-card p-5 shadow-2xl md:rounded-3xl">
            <div className="mx-auto mb-3 h-1 w-10 rounded-full bg-border md:hidden" />
            <h2 className="font-serif text-2xl text-ink">Sign out?</h2>
            <p className="mt-1 text-sm text-ink-soft">
              You'll need to sign in again with Google to get back to your notes.
            </p>
            <div className="mt-4 flex gap-2">
              <button
                type="button"
                onClick={() => setSignOutConfirm(false)}
                className="flex-1 rounded-full border border-border bg-card px-4 py-3 text-sm font-medium text-ink"
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={handleSignOut}
                className="flex-1 rounded-full bg-ink px-4 py-3 text-sm font-medium text-paper"
              >
                Sign out
              </button>
            </div>
          </div>
        </div>
      )}
    </AppShell>
  );
}

function AppearanceSection() {
  const { resolved, setTheme } = useTheme();
  const isDark = resolved === "dark";
  const [layout, setLayout] = useLayout();

  return (
    <section className="mt-4 rounded-3xl border border-border bg-card p-6">
      <h2 className="inline-flex items-center gap-2 text-xs uppercase tracking-wider text-ink-soft">
        {isDark ? <Moon className="h-3.5 w-3.5" /> : <Sun className="h-3.5 w-3.5" />}
        Appearance
      </h2>
      <label className="mt-4 flex cursor-pointer items-center justify-between gap-3">
        <span>
          <span className="block text-sm font-medium text-ink">Dark mode</span>
          <span className="block text-xs text-ink-soft">Switch between light and dark themes.</span>
        </span>
        <Switch
          checked={isDark}
          onCheckedChange={(c) => setTheme(c ? "dark" : "light")}
          aria-label="Toggle dark mode"
        />
      </label>

      <div className="mt-6 flex items-center justify-between gap-3 border-t border-border pt-5">
        <span>
          <span className="block text-sm font-medium text-ink">Feed view</span>
          <span className="block text-xs text-ink-soft">How notes are laid out in your feed.</span>
        </span>
        {/* Segmented control: cards vs a condensed list. Persisted via the shared layout hook. */}
        <div className="inline-flex shrink-0 rounded-full border border-border bg-background p-0.5">
          {(
            [
              { value: "standard", label: "Cards", icon: LayoutGrid },
              { value: "condensed", label: "Compact", icon: Rows3 },
            ] as const
          ).map((opt) => {
            const active = layout === opt.value;
            return (
              <button
                key={opt.value}
                type="button"
                onClick={() => setLayout(opt.value)}
                aria-pressed={active}
                className={`inline-flex items-center gap-1.5 rounded-full px-3 py-1.5 text-sm font-medium transition-colors ${
                  active ? "bg-ink text-paper" : "text-ink-soft hover:text-ink"
                }`}
              >
                <opt.icon className="h-3.5 w-3.5" />
                {opt.label}
              </button>
            );
          })}
        </div>
      </div>
    </section>
  );
}

function ConnectPhone() {
  const [tokens, setTokens] = useState<ShortcutToken[]>([]);
  const [newToken, setNewToken] = useState<string | null>(null);
  const [creating, setCreating] = useState(false);
  const [copied, setCopied] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Surface only the instructions that match the device. Desktop (neither) sees both,
  // since we can't tell which phone they'll set up — and may be installing on desktop too.
  const ios = isIOS();
  const android = isAndroid();
  const showIOS = ios || (!ios && !android);
  const showAndroid = android || (!ios && !android);

  const installPrompt = getInstallPrompt();
  const handleInstall = async () => {
    if (!installPrompt) return;
    await installPrompt.prompt();
  };

  const refresh = useCallback(() => {
    listTokens()
      .then(setTokens)
      .catch(() => setError("Couldn't load your connected devices. Refresh to retry."));
  }, []);
  useEffect(refresh, [refresh]);

  // A failed revoke must not become an unhandled rejection (it ships to the client-error
  // sink and trips the backend ERROR alert). Surface it, then refresh — a 404 usually means
  // the list was stale, so refetching self-heals the row away.
  const handleRevoke = useCallback(
    (id: string) => {
      setError(null);
      revokeToken(id)
        .then(refresh)
        .catch(() => {
          setError("Couldn't revoke that device. Refresh and try again.");
          refresh();
        });
    },
    [refresh],
  );

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

      <div className="mt-4 divide-y divide-border">
        {showAndroid && (
          <div className="flex items-center justify-between gap-3 py-3 first:pt-0">
            <div>
              <div className="text-sm font-medium text-ink">Android</div>
              <div className="text-xs text-ink-soft">Appears in your share sheet after install.</div>
            </div>
            {installPrompt && (
              <button
                type="button"
                onClick={handleInstall}
                className="inline-flex shrink-0 items-center gap-1.5 rounded-full bg-ink px-4 py-2 text-sm font-medium text-paper transition-opacity hover:opacity-90"
              >
                <Download className="h-3.5 w-3.5" />
                Install
              </button>
            )}
          </div>
        )}
        {showIOS && !newToken && (
          <div className="flex items-center justify-between gap-3 py-3 first:pt-0">
            <div>
              <div className="text-sm font-medium text-ink">iPhone</div>
              <div className="text-xs text-ink-soft">One-tap Shortcut for any app's share sheet.</div>
            </div>
            <button
              type="button"
              onClick={handleAdd}
              disabled={creating}
              className="inline-flex shrink-0 items-center gap-1.5 rounded-full bg-ink px-4 py-2 text-sm font-medium text-paper transition-opacity hover:opacity-90 disabled:opacity-50"
            >
              {creating ? "Setting up…" : "Add shortcut"}
            </button>
          </div>
        )}
      </div>

      {showIOS && newToken && (
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
                  Tap <strong className="text-ink">Add the Shortcut</strong> to open the Shortcuts
                  app.
                </li>
                <li>
                  Tap <strong className="text-ink">Add Shortcut</strong>, then{" "}
                  <strong className="text-ink">paste when asked</strong>. Your token is already
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
                  <strong className="text-ink">Save to Clipnote.shortcut</strong> to open the
                  Shortcuts app.
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
                  You're in the installed app, where iPhone can't show downloads. Open{" "}
                  <strong className="text-ink">{window.location.host}/settings</strong> in Safari
                  for this step.
                </p>
              )}
            </>
          )}

          <div className="mt-4 border-t border-border pt-3">
            <div className="text-xs uppercase tracking-wider text-ink-soft">
              Your token, shown only once
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
                {copied ? <Check className="h-4 w-4 text-place" /> : <Copy className="h-4 w-4" />}
              </button>
            </div>
            <p className="mt-2 text-xs text-ink-soft">
              {copied
                ? "Copied to your clipboard ✓. Just paste it when the Shortcut asks."
                : "Tap copy, then paste it when the Shortcut asks."}
            </p>
          </div>

          <button
            type="button"
            onClick={() => setNewToken(null)}
            className="mt-4 text-sm text-ink-soft underline hover:text-ink"
          >
            Hide token
          </button>
        </div>
      )}
      {error && <p className="mt-3 text-sm text-destructive">{error}</p>}

      {tokens.length > 0 && (
        <div className="mt-5 border-t border-border pt-4">
          <div className="text-xs uppercase tracking-wider text-ink-soft">Connected devices</div>
          <ul className="mt-1 divide-y divide-border">
            {tokens.map((t) => (
              <li key={t.id} className="flex items-center justify-between gap-3 py-2.5">
                <div>
                  <div className="text-sm text-ink">{t.label}</div>
                  <div className="text-xs text-ink-soft">
                    {t.last_used_at ? "Used recently" : "Never used"}
                  </div>
                </div>
                <button
                  type="button"
                  onClick={() => handleRevoke(t.id)}
                  className="shrink-0 text-xs text-ink-soft transition-colors hover:text-destructive"
                >
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
