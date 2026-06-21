import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import {
  ArrowLeft,
  RefreshCw,
  Users,
  FileText,
  Coins,
  AlertTriangle,
  Image,
  TrendingUp,
  MessageSquare,
} from "lucide-react";
import { useAuth } from "@/contexts/auth-context";
import { adminStats, type AdminStats, type DailyTrend } from "@/lib/api";
import { AppShell } from "@/components/AppShell";

export const Route = createFileRoute("/admin")({ component: AdminPage });

export const ADMIN_EMAILS = new Set(["yashsoni102@gmail.com"]);

const nf = new Intl.NumberFormat("en-US");
const fmt = (n: number) => nf.format(n);
const usd = (n: number) => `$${n.toFixed(2)}`;
const inr = (n: number) => `₹${nf.format(Math.round(n))}`;
const usdSmall = (n: number) =>
  n < 0.01 ? `$${n.toFixed(4)}` : `$${n.toFixed(3)}`;

function fmtDate(ms: number | null): string {
  if (!ms) return "—";
  return new Date(ms).toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
  });
}

function fmtDay(yyyymmdd: string): string {
  const y = yyyymmdd.slice(0, 4);
  const m = yyyymmdd.slice(4, 6);
  const d = yyyymmdd.slice(6, 8);
  return new Date(`${y}-${m}-${d}`).toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
  });
}

// ─── Mini bar chart (pure SVG, no dependencies) ─────────────────────────────

function MiniBarChart({
  values,
  colorClass = "fill-ink/30",
  accentClass = "fill-ink",
}: {
  values: number[];
  colorClass?: string;
  accentClass?: string;
}) {
  const max = Math.max(...values, 1);
  const n = values.length;
  const barW = 100 / n;
  const gap = 0.6;
  return (
    <svg
      viewBox="0 0 100 28"
      preserveAspectRatio="none"
      className="h-7 w-full"
      aria-hidden
    >
      {values.map((v, i) => {
        const h = Math.max((v / max) * 26, v > 0 ? 1.5 : 0);
        const isToday = i === n - 1;
        return (
          <rect
            key={i}
            x={i * barW + gap}
            y={28 - h}
            width={barW - gap * 2}
            height={h}
            rx={1.5}
            className={isToday ? accentClass : colorClass}
          />
        );
      })}
    </svg>
  );
}

// ─── Trend card: metric + sparkbar + date range ──────────────────────────────

function TrendCard({
  label,
  trend,
  getValue,
  formatTotal,
  colorClass,
  accentClass,
  icon: Icon,
}: {
  label: string;
  trend: DailyTrend[];
  getValue: (d: DailyTrend) => number;
  formatTotal: (total: number) => string;
  colorClass?: string;
  accentClass?: string;
  icon?: typeof TrendingUp;
}) {
  const values = trend.map(getValue);
  const total = values.reduce((s, v) => s + v, 0);
  const todayVal = values[values.length - 1] ?? 0;
  const peak = Math.max(...values);
  return (
    <div className="rounded-3xl border border-border bg-card p-4">
      <div className="flex items-center justify-between gap-2">
        <div className="flex items-center gap-1.5 text-xs uppercase tracking-wider text-ink-soft">
          {Icon && <Icon className="h-3.5 w-3.5" />}
          {label}
        </div>
        <span className="text-xs text-ink-soft">30d</span>
      </div>
      <div className="mt-2 flex items-end justify-between gap-2">
        <div>
          <div className="font-serif text-2xl tabular-nums text-ink">
            {formatTotal(total)}
          </div>
          <div className="mt-0.5 text-xs text-ink-soft">
            {formatTotal(todayVal)} today · peak {formatTotal(peak)}
          </div>
        </div>
      </div>
      <div className="mt-3">
        <MiniBarChart
          values={values}
          colorClass={colorClass}
          accentClass={accentClass}
        />
        <div className="mt-1 flex justify-between text-[10px] text-ink-soft/60">
          <span>{trend.length ? fmtDay(trend[0].date) : ""}</span>
          <span>today</span>
        </div>
      </div>
    </div>
  );
}

// ─── Stat card ───────────────────────────────────────────────────────────────

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
      <div className="mt-2 font-serif text-2xl tabular-nums text-ink">{value}</div>
      {sub && <div className="mt-0.5 text-xs text-ink-soft">{sub}</div>}
    </div>
  );
}

// ─── Page ────────────────────────────────────────────────────────────────────

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
    if (!isAdmin) navigate({ to: "/" });
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

  const t = stats?.totals;

  return (
    <AppShell>
      <div className="mx-auto max-w-5xl px-4 py-8 md:px-6">
        {/* Header */}
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

        <h1 className="mt-4 font-serif text-3xl text-ink">Observability</h1>
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

        {stats && t && (
          <>
            {/* ── Key metrics ── */}
            <div className="mt-6 grid grid-cols-2 gap-3 md:grid-cols-4">
              <StatCard
                icon={Users}
                label="Users"
                value={fmt(t.users)}
                sub={`${fmt(t.active_7d)} active · 7d`}
              />
              <StatCard
                icon={FileText}
                label="Notes"
                value={fmt(t.notes)}
                sub={`${fmt(t.notes_today)} today`}
              />
              <StatCard
                icon={Coins}
                label="Total cost"
                value={inr(t.cost_inr)}
                sub={usd(t.cost_usd)}
              />
              <StatCard
                icon={AlertTriangle}
                label="Failed jobs"
                value={fmt(t.jobs_failed)}
                sub={`of ${fmt(t.jobs)} jobs`}
              />
            </div>

            <div className="mt-3 grid grid-cols-2 gap-3 md:grid-cols-4">
              <StatCard label="Active · 30d" value={fmt(t.active_30d)} />
              <StatCard
                icon={Coins}
                label="Cost / note"
                value={usdSmall(t.cost_per_note_usd)}
                sub={`₹${(t.cost_per_note_usd * 84).toFixed(2)} / note`}
              />
              <StatCard
                icon={MessageSquare}
                label="Asks today"
                value={fmt(t.asks_today)}
              />
              <StatCard
                icon={Image}
                label="AI covers"
                value={fmt(t.images)}
                sub={`${fmt(t.images_today)} today`}
              />
            </div>

            {/* ── Growth & retention (the fundraising numbers) ── */}
            <h2 className="mt-8 text-xs font-medium uppercase tracking-wider text-ink-soft">
              Growth & retention
            </h2>
            <div className="mt-3 grid grid-cols-2 gap-3 md:grid-cols-4">
              <StatCard
                icon={TrendingUp}
                label="Activation"
                value={`${Math.round(t.activation_rate * 100)}%`}
                sub={`${fmt(t.activated)} of ${fmt(t.users)} saved a note`}
              />
              <StatCard
                icon={Users}
                label="Retained · 7d"
                value={`${Math.round(t.retained_7d * 100)}%`}
                sub="of users >7d old, active in last 7d"
              />
              <StatCard
                icon={Users}
                label="New users"
                value={fmt(t.new_users_7d)}
                sub={`${fmt(t.new_users_30d)} in 30d`}
              />
              <StatCard
                icon={Coins}
                label="Cost / active user"
                value={usdSmall(t.cost_per_active_user_usd)}
                sub="30-day active"
              />
            </div>

            {stats.signups_by_source && Object.keys(stats.signups_by_source).length > 0 && (
              <div className="mt-3 rounded-2xl border border-border bg-card p-4">
                <p className="text-xs font-medium uppercase tracking-wider text-ink-soft">
                  Signups by source
                </p>
                <div className="mt-3 flex flex-wrap gap-2">
                  {Object.entries(stats.signups_by_source)
                    .sort((a, b) => b[1] - a[1])
                    .map(([src, n]) => (
                      <span
                        key={src}
                        className="inline-flex items-center gap-1.5 rounded-full border border-border bg-paper px-3 py-1 text-sm text-ink"
                      >
                        <span className="text-ink-soft">{src}</span>
                        <span className="font-medium">{fmt(n)}</span>
                      </span>
                    ))}
                </div>
              </div>
            )}

            {/* ── 30-day trend charts ── */}
            {stats.daily_trend.length > 0 && (
              <div className="mt-6 grid grid-cols-1 gap-3 md:grid-cols-2">
                <TrendCard
                  icon={FileText}
                  label="Notes saved"
                  trend={stats.daily_trend}
                  getValue={(d) => d.notes}
                  formatTotal={(v) => fmt(v)}
                  colorClass="fill-ink/20"
                  accentClass="fill-ink/70"
                />
                <TrendCard
                  icon={MessageSquare}
                  label="Clip AI asks"
                  trend={stats.daily_trend}
                  getValue={(d) => d.asks}
                  formatTotal={(v) => fmt(v)}
                  colorClass="fill-itinerary/30"
                  accentClass="fill-itinerary"
                />
                <TrendCard
                  icon={Coins}
                  label="Daily spend"
                  trend={stats.daily_trend}
                  getValue={(d) => d.cost_usd}
                  formatTotal={(v) => (v < 0.01 ? `$${v.toFixed(4)}` : `$${v.toFixed(3)}`)}
                  colorClass="fill-product/30"
                  accentClass="fill-product"
                />
                <TrendCard
                  icon={TrendingUp}
                  label="Notes + asks"
                  trend={stats.daily_trend}
                  getValue={(d) => d.notes + d.asks}
                  formatTotal={(v) => fmt(v)}
                  colorClass="fill-recipe/30"
                  accentClass="fill-recipe"
                />
              </div>
            )}

            {/* ── Per-user table ── */}
            <div className="mt-8 overflow-hidden rounded-3xl border border-border bg-card">
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="border-b border-border text-left text-xs uppercase tracking-wider text-ink-soft">
                      <th className="px-4 py-3 font-medium">User</th>
                      <th className="px-4 py-3 text-right font-medium">Notes</th>
                      <th className="px-4 py-3 text-right font-medium">Tokens</th>
                      <th className="px-4 py-3 text-right font-medium">AI covers</th>
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
                          {fmt(u.images)}
                        </td>
                        <td className="px-4 py-3 text-right tabular-nums text-ink-soft">
                          {fmt(u.ai_calls)}
                        </td>
                        <td className="px-4 py-3 text-right tabular-nums text-ink">
                          {inr(u.cost_inr)}
                          <div className="text-[10px] text-ink-soft">{usd(u.cost_usd)}</div>
                        </td>
                        <td className="px-4 py-3 text-xs text-ink-soft">
                          {fmtDate(u.created_at)}
                        </td>
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
                        <td colSpan={8} className="px-4 py-8 text-center text-ink-soft">
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
