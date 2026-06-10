import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { useCallback, useEffect, useState } from "react";
import { ArrowLeft, LogOut, Trash2, Smartphone, Copy, Check, X } from "lucide-react";
import { useAuth } from "@/contexts/auth-context";
import {
  deleteAllNotes,
  createToken,
  listTokens,
  revokeToken,
  API_BASE,
  type ShortcutToken,
} from "@/lib/api";
import { AppShell } from "@/components/AppShell";

export const Route = createFileRoute("/settings")({ component: Settings });

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
    listTokens().then(setTokens).catch(() => {});
  }, []);
  useEffect(refresh, [refresh]);

  const handleCreate = async () => {
    setCreating(true);
    setError(null);
    try {
      const { token } = await createToken("iPhone");
      setNewToken(token);
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
          <strong className="text-ink">iPhone:</strong> create a token below, then build a
          one-time Shortcut that shares links straight to Clipnote.
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
          <ol className="mt-4 list-decimal space-y-1.5 pl-5 text-sm text-ink-soft">
            <li>Open the <strong className="text-ink">Shortcuts</strong> app → + → name it "Save to Clipnote".</li>
            <li>Tap the ⓘ info panel → enable <strong className="text-ink">Show in Share Sheet</strong>.</li>
            <li>Add action <strong className="text-ink">"Get URLs from Input"</strong> (input: Shortcut Input).</li>
            <li>
              Add action <strong className="text-ink">"Get Contents of URL"</strong>:
              <ul className="mt-1 list-disc space-y-1 pl-4">
                <li>URL: <code className="rounded bg-muted px-1 text-xs">{API_BASE}/api/ingest</code></li>
                <li>Method: POST · Headers: <code className="rounded bg-muted px-1 text-xs">Authorization: Bearer &lt;your token&gt;</code></li>
                <li>Request body (JSON): <code className="rounded bg-muted px-1 text-xs">url</code> = URLs from step 3, <code className="rounded bg-muted px-1 text-xs">source</code> = shortcut</li>
              </ul>
            </li>
            <li>Add action <strong className="text-ink">"Show Notification"</strong> ("Saved to Clipnote ✓").</li>
          </ol>
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
