import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { ArrowLeft, RefreshCw, Users, FileText, Coins, AlertTriangle } from "lucide-react";
import { useAuth } from "@/contexts/auth-context";
import { adminStats, type AdminStats } from "@/lib/api";
import { AppShell } from "@/components/AppShell";

export const Route = createFileRoute("/admin")({ component: AdminPage });

// Mirror of backend ADMIN_EMAILS — purely to hide the page client-side. The real gate
// is the server (verified Firebase email); this just avoids rendering a doomed fetch.
export const ADMIN_EMAILS = new Set(["yashsoni102@gmail.com"]);

const nf = new Intl.NumberFormat("en-US");
const fmt = (n: number) => nf.format(n);
const usd = (n: number) => `$${n.toFixed(2)}`;
const inr = (n: number) => `₹${nf.format(Math.round(n))}`;

function fmtDate(ms: number | null): string {
  if (!ms) return "—";
  const d = new Date(ms);
  return d.toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" });
}

function AdminPage() {
  const { user, loading } = useAuth();
  const navigate = useNavigate();
  const [stats, setStats] = useState<AdminStats | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [refreshing, setRefreshing] = useState(false);

  const isAdmin = !!user?.email && ADMIN_EMAILS.has(user.email.toLowerCase());

  useEffect(() => {
    if (loading) return;
    if (!user) {
      navigate({ to: "/login" });
      return;
    }
    if (!isAdmin) {
      navigate({ to: "/" });
    }
  }, [user, loading, isAdmin, navigate]);

  const load = () => {
    setRefreshing(true);
    setError(null);
    adminStats()
      .then(setStats)
      .catch((e) => setError(e instanceof Error ? e.message : "Couldn't load stats."))
      .finally(() => setRefreshing(false));
  };

  useEffect(() => {
    if (isAdmin) load();
  }, [isAdmin]);

  if (loading || !user || !isAdmin) return null;

  return (
    <AppShell>
      <div className="mx-auto max-w-5xl px-4 py-8 md:px-6">
        <div className="flex items-center justify-between gap-3">
          <Link
            to="/"
            className="inline-flex items-center gap-1.5 text-sm text-ink-soft transition-colors hover:text-ink"
          >
            <ArrowLeft className="h-4 w-4" />
            Notes
          </Link>
          <button
            type="button"
            onClick={load}
            disabled={refreshing}
            className="inline-flex items-center gap-1.5 rounded-full border border-border bg-card px-3.5 py-1.5 text-xs font-medium text-ink transition-opacity hover:opacity-80 disabled:opacity-50"
          >
            <RefreshCw className={`h-3.5 w-3.5 ${refreshing ? "animate-spin" : ""}`} />
            Refresh
          </button>
        </div>

        <h1 className="mt-4 font-serif text-3xl text-ink">Admin</h1>
        {stats && (
          <p className="mt-1 text-sm text-ink-soft">
            As of {new Date(stats.generated_at).toLocaleString()}
          </p>
        )}

        {error && (
          <div className="mt-6 flex items-center gap-2 rounded-2xl border border-destructive/30 bg-card p-4 text-sm text-destructive">
            <AlertTriangle className="h-4 w-4" />
            {error}
          </div>
        )}

        {!stats && !error && <p className="mt-8 text-sm text-ink-soft">Loading…</p>}

        {stats && (
          <>
            {/* Summary cards */}
            <div className="mt-6 grid grid-cols-2 gap-3 md:grid-cols-4">
              <StatCard
                icon={Users}
                label="Users"
                value={fmt(stats.totals.users)}
                sub={`${fmt(stats.totals.active_7d)} active · 7d`}
              />
              <StatCard
                icon={FileText}
                label="Notes"
                value={fmt(stats.totals.notes)}
                sub={`${fmt(stats.totals.notes_today)} today`}
              />
              <StatCard
                icon={Coins}
                label="Total cost"
                value={inr(stats.totals.cost_inr)}
                sub={usd(stats.totals.cost_usd)}
              />
              <StatCard
                icon={AlertTriangle}
                label="Failed jobs"
                value={fmt(stats.totals.jobs_failed)}
                sub={`of ${fmt(stats.totals.jobs)} jobs`}
              />
            </div>

            <div className="mt-3 grid grid-cols-2 gap-3 md:grid-cols-4">
              <StatCard label="Active · 30d" value={fmt(stats.totals.active_30d)} />
              <StatCard label="Tokens" value={fmt(stats.totals.tokens)} />
              <StatCard label="Asks today" value={fmt(stats.totals.asks_today)} />
              <StatCard
                label="Avg ₹/user"
                value={inr(stats.totals.users ? stats.totals.cost_inr / stats.totals.users : 0)}
              />
            </div>

            {/* Per-user table */}
            <div className="mt-8 overflow-hidden rounded-3xl border border-border bg-card">
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="border-b border-border text-left text-xs uppercase tracking-wider text-ink-soft">
                      <th className="px-4 py-3 font-medium">User</th>
                      <th className="px-4 py-3 text-right font-medium">Notes</th>
                      <th className="px-4 py-3 text-right font-medium">Tokens</th>
                      <th className="px-4 py-3 text-right font-medium">AI calls</th>
                      <th className="px-4 py-3 text-right font-medium">Cost</th>
                      <th className="px-4 py-3 font-medium">Joined</th>
                      <th className="px-4 py-3 text-center font-medium">Active</th>
                    </tr>
                  </thead>
                  <tbody>
                    {stats.users.map((u) => (
                      <tr key={u.uid} className="border-b border-border/60 last:border-0">
                        <td className="px-4 py-3">
                          <div className="font-medium text-ink">{u.display_name || "—"}</div>
                          <div className="text-xs text-ink-soft">{u.email || u.uid}</div>
                        </td>
                        <td className="px-4 py-3 text-right tabular-nums text-ink">
                          {fmt(u.notes)}
                        </td>
                        <td className="px-4 py-3 text-right tabular-nums text-ink-soft">
                          {fmt(u.tokens)}
                          <div className="text-[10px]">
                            {fmt(u.tokens_in)} in · {fmt(u.tokens_out)} out
                          </div>
                        </td>
                        <td className="px-4 py-3 text-right tabular-nums text-ink-soft">
                          {fmt(u.ai_calls)}
                        </td>
                        <td className="px-4 py-3 text-right tabular-nums text-ink">
                          {inr(u.cost_inr)}
                          <div className="text-[10px] text-ink-soft">{usd(u.cost_usd)}</div>
                        </td>
                        <td className="px-4 py-3 text-xs text-ink-soft">{fmtDate(u.created_at)}</td>
                        <td className="px-4 py-3 text-center">
                          {u.active_7d ? (
                            <span
                              className="inline-block h-2 w-2 rounded-full bg-itinerary"
                              title="Active in last 7 days"
                            />
                          ) : u.active_30d ? (
                            <span
                              className="inline-block h-2 w-2 rounded-full bg-ink-soft/40"
                              title="Active in last 30 days"
                            />
                          ) : (
                            <span
                              className="inline-block h-2 w-2 rounded-full bg-border"
                              title="Inactive"
                            />
                          )}
                        </td>
                      </tr>
                    ))}
                    {stats.users.length === 0 && (
                      <tr>
                        <td colSpan={7} className="px-4 py-8 text-center text-ink-soft">
                          No users yet.
                        </td>
                      </tr>
                    )}
                  </tbody>
                </table>
              </div>
            </div>

            <p className="mt-3 text-xs text-ink-soft">{stats.pricing_note}</p>
          </>
        )}
      </div>
    </AppShell>
  );
}

function StatCard({
  icon: Icon,
  label,
  value,
  sub,
}: {
  icon?: typeof Users;
  label: string;
  value: string;
  sub?: string;
}) {
  return (
    <div className="rounded-3xl border border-border bg-card p-4">
      <div className="flex items-center gap-1.5 text-xs uppercase tracking-wider text-ink-soft">
        {Icon && <Icon className="h-3.5 w-3.5" />}
        {label}
      </div>
      <div className="mt-2 font-serif text-2xl text-ink tabular-nums">{value}</div>
      {sub && <div className="mt-0.5 text-xs text-ink-soft">{sub}</div>}
    </div>
  );
}
