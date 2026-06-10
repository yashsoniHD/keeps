import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { LogOut, Trash2 } from "lucide-react";
import { useAuth } from "@/contexts/auth-context";
import { deleteAllNotes } from "@/lib/api";
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
