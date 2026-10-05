import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useCallback, useEffect, useState } from "react";
import { useAuth } from "@/contexts/auth-context";
import { createToken, listTokensCached, revokeToken, type ShortcutToken } from "@/lib/api";
import { useTheme, type Theme } from "@/lib/theme";
import { getInstallPrompt, isAndroid, isIOS, isStandalone } from "@/lib/platform";
import { Icon, Logo, Sheet } from "@/keeps/ui";
import Onboarding from "@/keeps/Onboarding";

export const Route = createFileRoute("/settings")({ component: Settings });

// Publish keeps.shortcut to iCloud (Shortcuts app → Share → Copy iCloud Link) and paste the link
// here to restore the one-tap install. iOS only allows true one-tap installs from
// icloud.com/shortcuts links — the shortcuts:// URL scheme rejects self-hosted files
// ("invalid URL"), and file downloads need manual taps through Safari's download list.
// While empty, the UI falls back to the self-hosted signed /keeps.shortcut download
// (built by infra/build_shortcut.py). It carries the "Paste your Keeps token" import
// question — no token is baked in. Re-publishing creates a NEW link; update this
// constant whenever the shortcut changes.
// Old link (published "Save to Keeps" shortcut): https://www.icloud.com/shortcuts/d3ba89f721d54d1ba2e89185f6472eae
const SHORTCUT_ICLOUD_LINK = "";

// Where the app lives — shared via the "Share the app" button below.
const APP_URL = "https://clipnote.web.app";
const APP_SHARE_TEXT =
  "Keeps: save any link as a beautifully structured note you'll actually re-read.";

const THEMES: { value: Theme; label: string }[] = [
  { value: "light", label: "Light" },
  { value: "dark", label: "Dark" },
  { value: "system", label: "System" },
];

function Settings() {
  const { user, loading, signOut } = useAuth();
  const navigate = useNavigate();
  const { theme, setTheme } = useTheme();
  const [signOutConfirm, setSignOutConfirm] = useState(false);
  const [shareCopied, setShareCopied] = useState(false);
  const [guide, setGuide] = useState(false);

  useEffect(() => {
    if (!loading && !user) navigate({ to: "/login" });
  }, [user, loading, navigate]);

  const handleSignOut = async () => {
    await signOut();
    navigate({ to: "/login" });
  };

  const handleShareApp = async () => {
    const shareData = { title: "Keeps", text: APP_SHARE_TEXT, url: APP_URL };
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

  // Auth still resolving — show a mark instead of a blank flash.
  if (loading || !user) {
    return (
      <main className="center-screen">
        <Logo />
      </main>
    );
  }

  return (
    <div className="app-shell">
      <main id="main-content" className="main" tabIndex={-1}>
        <header className="page-header">
          <div>
            <button type="button" className="text-button" onClick={() => navigate({ to: "/" })}>
              <Icon name="ChevronLeft" size={16} /> Library
            </button>
            <h1>Settings</h1>
          </div>
        </header>

        <div className="settings-content">
          <section aria-labelledby="profile-heading">
            <h2 id="profile-heading">Profile</h2>
            <div className="settings-profile">
              {user.photoURL && <img src={user.photoURL} alt="" referrerPolicy="no-referrer" />}
              <div>
                <div className="settings-name">{user.displayName}</div>
                <small>{user.email}</small>
              </div>
            </div>
          </section>

          <section aria-labelledby="appearance-heading">
            <h2 id="appearance-heading">Appearance</h2>
            <div className="segmented" role="group" aria-label="Appearance">
              {THEMES.map((t) => (
                <button
                  key={t.value}
                  type="button"
                  aria-pressed={theme === t.value}
                  className={theme === t.value ? "selected" : ""}
                  onClick={() => setTheme(t.value)}
                >
                  {t.label}
                </button>
              ))}
            </div>
          </section>

          <ConnectPhone />

          <button type="button" className="setting-row full-button" onClick={() => setGuide(true)}>
            <span className="row">
              <Icon name="HelpCircle" size={20} />
              Saving guide
            </span>
            <Icon name="ChevronRight" size={18} />
          </button>
          <button type="button" className="setting-row full-button" onClick={handleShareApp}>
            <span className="row">
              <Icon name={shareCopied ? "Check" : "Share2"} size={20} />
              {shareCopied ? "Link copied!" : "Share the app"}
            </span>
          </button>
          <button
            type="button"
            className="setting-row full-button danger"
            onClick={() => setSignOutConfirm(true)}
          >
            Sign out
          </button>
        </div>
      </main>

      {guide && <Onboarding onDone={() => setGuide(false)} />}

      {signOutConfirm && (
        <Sheet title="Sign out?" onClose={() => setSignOutConfirm(false)}>
          <p className="settings-note">
            You'll need to sign in again with Google to get back to your notes.
          </p>
          <div className="settings-actions">
            <button
              type="button"
              className="secondary"
              data-initial-focus
              onClick={() => setSignOutConfirm(false)}
            >
              Cancel
            </button>
            <button type="button" className="primary" onClick={handleSignOut}>
              Sign out
            </button>
          </div>
        </Sheet>
      )}
    </div>
  );
}

function ConnectPhone() {
  const { user } = useAuth();
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

  // Cached read (dedupes with GettingStarted's identical fetch). create/revoke invalidate the
  // "tokens:" cache key, so calling refresh() after a mutation refetches fresh, not stale.
  const refresh = useCallback(() => {
    if (!user) return;
    listTokensCached(user.uid)
      .then(setTokens)
      .catch(() => setError("Couldn't load your connected devices. Refresh to retry."));
  }, [user]);
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
    <section aria-labelledby="phone-heading">
      <h2 id="phone-heading">Capture from your phone</h2>

      {showAndroid && (
        <div className="setting-row">
          <span>
            Android
            <small>Appears in your share sheet after install.</small>
          </span>
          {installPrompt && (
            <button type="button" className="primary small" onClick={handleInstall}>
              <Icon name="Plus" size={16} />
              Install
            </button>
          )}
        </div>
      )}
      {showIOS && !newToken && (
        <div className="setting-row">
          <span>
            iPhone
            <small>One-tap Shortcut for any app's share sheet.</small>
          </span>
          <button type="button" className="primary small" onClick={handleAdd} disabled={creating}>
            {creating ? "Setting up…" : "Add shortcut"}
          </button>
        </div>
      )}

      {showIOS && newToken && (
        <div className="settings-card">
          {SHORTCUT_ICLOUD_LINK ? (
            <>
              <a
                href={SHORTCUT_ICLOUD_LINK}
                target="_blank"
                rel="noreferrer"
                className="primary wide"
              >
                Add the Shortcut
              </a>
              <ol>
                <li>
                  Tap <strong>Add the Shortcut</strong> to open the Shortcuts app.
                </li>
                <li>
                  Tap <strong>Add Shortcut</strong>, then <strong>paste when asked</strong>. Your
                  token is already copied.
                </li>
                <li>
                  Done. In any app: <strong>Share</strong> → <strong>Save to Keeps</strong>.
                </li>
              </ol>
            </>
          ) : (
            <>
              <a href="/keeps.shortcut" className="primary wide">
                Download the Shortcut
              </a>
              <ol>
                <li>
                  Tap <strong>Download the Shortcut</strong> in Safari on your iPhone.
                </li>
                <li>
                  Tap the <strong>downloads (↓) icon</strong> in Safari's address bar, then tap{" "}
                  <strong>Save to Keeps.shortcut</strong> to open the Shortcuts app.
                </li>
                <li>
                  Tap <strong>Add Shortcut</strong>, then paste your token when asked{" "}
                  <em>"Paste your Keeps token"</em>.
                </li>
                <li>
                  Done. In any app: <strong>Share</strong> → <strong>Save to Keeps</strong>.
                </li>
              </ol>
              {isStandalone() && (
                <p>
                  You're in the installed app, where iPhone can't show downloads. Open{" "}
                  <strong>{window.location.host}/settings</strong> in Safari for this step.
                </p>
              )}
            </>
          )}

          <div className="settings-token">
            <small>Your token, shown only once</small>
            <div className="row">
              <code>{newToken}</code>
              <button
                type="button"
                className="icon-button"
                onClick={handleCopy}
                aria-label="Copy token"
              >
                <Icon name={copied ? "Check" : "Copy"} />
              </button>
            </div>
            <p>
              {copied
                ? "Copied to your clipboard. Just paste it when the Shortcut asks."
                : "Tap copy, then paste it when the Shortcut asks."}
            </p>
          </div>

          <button type="button" className="text-button" onClick={() => setNewToken(null)}>
            Hide token
          </button>
        </div>
      )}
      {error && <p className="error-text">{error}</p>}

      {tokens.length > 0 && (
        <>
          <h3 className="settings-subhead">Connected devices</h3>
          {tokens.map((t) => (
            <div key={t.id} className="setting-row">
              <span>
                {t.label}
                <small>{t.last_used_at ? "Used recently" : "Never used"}</small>
              </span>
              <button
                type="button"
                className="secondary small"
                aria-label={`Revoke ${t.label}`}
                onClick={() => handleRevoke(t.id)}
              >
                Revoke
              </button>
            </div>
          ))}
        </>
      )}
    </section>
  );
}
