import { Fragment, useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { Link, useCanGoBack, useRouter } from "@tanstack/react-router";
import { X, ArrowRight, RotateCw, CalendarClock } from "lucide-react";
import type { MyDigestResponse, NoteRef, PersonalDigestStats } from "@/lib/types";
import { noteAccent, noteIcon, noteLabel, paletteAccent, type NoteAccent } from "@/lib/note-meta";
import { FOCUS_RING } from "@/lib/ui";
import { PillLink } from "@/components/shared/PillButton";

// "2026-07-08" → "8 Jul". Parsed as local parts (not `new Date(iso)`) so the day never drifts
// across a timezone boundary.
function fmtDay(iso: string): string {
  const [y, m, d] = iso.split("-").map(Number);
  if (!y || !m || !d) return "";
  return new Date(y, m - 1, d).toLocaleDateString("en-IN", { day: "numeric", month: "short" });
}

// Reveal classes for a slide's content, staggered per child. Only fires when the slide is active
// (keyed remount in SlideShell replays it on each entry); inactive slides render statically so
// they still read correctly while peeking during a swipe. fill-mode-both holds the from-state
// through the delay so a delayed child doesn't flash at its final position first.
const DELAYS = ["", "delay-100", "delay-200", "delay-300", "delay-500"];
function reveal(active: boolean, i: number): string {
  if (!active) return "";
  return `animate-in fade-in slide-in-from-bottom-4 duration-700 fill-mode-both motion-reduce:animate-none ${
    DELAYS[Math.min(i, DELAYS.length - 1)]
  }`;
}

// A small-caps kicker used at the top of most slides.
function Kicker({ children, active, i = 0 }: { children: ReactNode; active: boolean; i?: number }) {
  return (
    <p
      className={`text-[11px] font-semibold uppercase tracking-[0.18em] opacity-70 ${reveal(active, i)}`}
    >
      {children}
    </p>
  );
}

// The self-colored slide surface: a solid accent fill with its WCAG-safe `on` text. Padding
// clears the top progress/close overlay and both safe areas; content is vertically centered and
// scrolls if a section runs long. Keyed on `active` so the reveal animation replays on entry.
function SlideShell({
  accent,
  active,
  children,
}: {
  accent: NoteAccent;
  active: boolean;
  children: ReactNode;
}) {
  return (
    <section
      className={`relative flex h-full w-full shrink-0 snap-center flex-col overflow-hidden ${accent.dot} ${accent.on}`}
    >
      {/* `my-auto` on the inner wrapper (not justify-center on the scroller) so short content
          centers but a long narrative scrolls with its top still reachable. */}
      <div
        key={active ? "on" : "off"}
        className="flex min-h-0 flex-1 flex-col overflow-y-auto px-7 pt-[calc(env(safe-area-inset-top)+4.5rem)] pb-[calc(env(safe-area-inset-bottom)+2.5rem)] [scrollbar-width:none] [&::-webkit-scrollbar]:hidden"
      >
        <div className="my-auto flex flex-col gap-5">{children}</div>
      </div>
    </section>
  );
}

// ─── Slides ────────────────────────────────────────────────────────────────

function HeroSlide({
  accent,
  active,
  stats,
}: {
  accent: NoteAccent;
  active: boolean;
  stats: PersonalDigestStats;
}) {
  return (
    <SlideShell accent={accent} active={active}>
      <Kicker active={active}>{stats.fallback ? "Your latest saves" : "Your week"}</Kicker>
      <div className={reveal(active, 1)}>
        <p className="font-serif text-4xl leading-tight">You saved</p>
        <p className="font-serif text-[7rem] leading-none tabular-nums">{stats.total}</p>
        <p className="font-serif text-4xl leading-tight">
          {stats.fallback ? "of your latest saves" : "things this week"}
        </p>
      </div>
      {stats.window_start && stats.window_end && !stats.fallback && (
        <p className={`text-sm opacity-70 ${reveal(active, 2)}`}>
          {fmtDay(stats.window_start)} to {fmtDay(stats.window_end)}
        </p>
      )}
    </SlideShell>
  );
}

function CategoriesSlide({
  accent,
  active,
  categories,
}: {
  accent: NoteAccent;
  active: boolean;
  categories: PersonalDigestStats["categories"];
}) {
  const top = categories.slice(0, 5);
  const [first, ...rest] = top;
  const FirstIcon = noteIcon(first.slug);
  return (
    <SlideShell accent={accent} active={active}>
      <Kicker active={active}>What you saved</Kicker>
      {/* #1 gets the callout treatment: big serif label + count. */}
      <div className={`flex items-center gap-3 ${reveal(active, 1)}`}>
        <span className="flex h-12 w-12 shrink-0 items-center justify-center rounded-2xl bg-black/10">
          <FirstIcon className="h-6 w-6" aria-hidden="true" />
        </span>
        <div className="min-w-0">
          <p className="truncate font-serif text-3xl leading-tight">{noteLabel(first.slug)}</p>
          <p className="text-sm opacity-70">
            {first.count} {first.count === 1 ? "note" : "notes"} · your top pick
          </p>
        </div>
      </div>
      {rest.length > 0 && (
        <ul className={`flex flex-col gap-2.5 ${reveal(active, 2)}`}>
          {rest.map((c) => {
            const Icon = noteIcon(c.slug);
            return (
              <li
                key={c.slug}
                className="flex items-center gap-3 rounded-2xl bg-black/10 px-3.5 py-2.5"
              >
                <Icon className="h-4 w-4 shrink-0 opacity-80" aria-hidden="true" />
                <span className="min-w-0 flex-1 truncate text-sm font-medium">
                  {noteLabel(c.slug)}
                </span>
                <span className="shrink-0 text-sm tabular-nums opacity-70">{c.count}</span>
              </li>
            );
          })}
        </ul>
      )}
    </SlideShell>
  );
}

function SourcesSlide({
  accent,
  active,
  stats,
}: {
  accent: NoteAccent;
  active: boolean;
  stats: PersonalDigestStats;
}) {
  const domains = stats.top_domains.slice(0, 4);
  return (
    <SlideShell accent={accent} active={active}>
      <Kicker active={active}>Where it came from</Kicker>
      {domains.length > 0 && (
        <ul className={`flex flex-col gap-2.5 ${reveal(active, 1)}`}>
          {domains.map((d) => (
            <li
              key={d.domain}
              className="flex items-center gap-3 rounded-2xl bg-black/10 px-3.5 py-2.5"
            >
              <img
                src={`https://www.google.com/s2/favicons?domain=${d.domain}&sz=32`}
                onError={(e) => {
                  e.currentTarget.style.visibility = "hidden";
                }}
                alt=""
                className="h-4 w-4 shrink-0 rounded-sm"
              />
              <span className="min-w-0 flex-1 truncate text-sm font-medium">{d.domain}</span>
              <span className="shrink-0 text-sm tabular-nums opacity-70">{d.count}</span>
            </li>
          ))}
        </ul>
      )}
      <div className={`flex gap-3 ${reveal(active, 2)}`}>
        {stats.busiest_day && (
          <div className="flex-1 rounded-2xl bg-black/10 px-4 py-3">
            <p className="font-serif text-3xl leading-none tabular-nums">
              {stats.busiest_day.count}
            </p>
            <p className="mt-1 text-xs opacity-70">saves on {stats.busiest_day.label}</p>
          </div>
        )}
        <div className="flex-1 rounded-2xl bg-black/10 px-4 py-3">
          <p className="font-serif text-3xl leading-none tabular-nums">{stats.active_days}</p>
          <p className="mt-1 text-xs opacity-70">
            active {stats.active_days === 1 ? "day" : "days"}
          </p>
        </div>
      </div>
    </SlideShell>
  );
}

function IntroSlide({
  accent,
  active,
  intro,
  facts,
}: {
  accent: NoteAccent;
  active: boolean;
  intro: string;
  facts: { label: string; value: string }[];
}) {
  const shown = facts.slice(0, 2);
  return (
    <SlideShell accent={accent} active={active}>
      <p className={`font-serif text-3xl leading-snug md:text-4xl ${reveal(active, 0)}`}>{intro}</p>
      {shown.length > 0 && (
        <dl className={`flex flex-wrap gap-x-8 gap-y-3 ${reveal(active, 1)}`}>
          {shown.map((f, i) => (
            <div key={i} className="flex flex-col gap-0.5">
              <dt className="text-[11px] uppercase tracking-wider opacity-70">{f.label}</dt>
              <dd className="text-lg font-medium">{f.value}</dd>
            </div>
          ))}
        </dl>
      )}
    </SlideShell>
  );
}

function SectionSlide({
  accent,
  active,
  heading,
  body,
  items,
}: {
  accent: NoteAccent;
  active: boolean;
  heading: string;
  body?: string;
  items: { title: string; summary: string; note_id: string }[];
}) {
  const paragraphs = (body ?? "")
    .split(/\n\s*\n/)
    .map((p) => p.trim())
    .filter(Boolean);
  const rows = items.slice(0, 3);
  return (
    <SlideShell accent={accent} active={active}>
      <Kicker active={active}>{heading}</Kicker>
      {paragraphs.length > 0 && (
        <div className={`flex flex-col gap-3 ${reveal(active, 1)}`}>
          {paragraphs.map((p, i) => (
            <p
              key={i}
              className={`leading-relaxed ${i === 0 ? "text-lg font-medium" : "text-base"}`}
            >
              {p}
            </p>
          ))}
        </div>
      )}
      {rows.length > 0 && (
        <ul className={`flex flex-col gap-2 ${reveal(active, 2)}`}>
          {/* Several items can cite the same note (item-level extraction), so the key needs
              the index too. */}
          {rows.map((it, i) => (
            <li key={`${it.note_id}-${i}`}>
              <Link
                to="/notes/$noteId"
                params={{ noteId: it.note_id }}
                className={`group flex items-center gap-3 rounded-2xl bg-black/10 px-3.5 py-2.5 transition-colors hover:bg-black/20 ${FOCUS_RING}`}
              >
                <span className="min-w-0 flex-1 truncate text-sm">
                  <span className="font-medium">{it.title}</span>
                  {it.summary && <span className="opacity-70"> · {it.summary}</span>}
                </span>
                <ArrowRight className="h-4 w-4 shrink-0 opacity-60" aria-hidden="true" />
              </Link>
            </li>
          ))}
        </ul>
      )}
    </SlideShell>
  );
}

// Rendered in place of the narrative slides when the story couldn't be written and there was no
// cache to fall back on (digest === null && stale). Graceful, never a dead end.
function NoStorySlide({ accent, active }: { accent: NoteAccent; active: boolean }) {
  return (
    <SlideShell accent={accent} active={active}>
      <CalendarClock className={`h-10 w-10 ${reveal(active, 0)}`} aria-hidden="true" />
      <p className={`font-serif text-3xl leading-snug ${reveal(active, 1)}`}>
        We couldn't write your story today
      </p>
      <p className={`text-base opacity-80 ${reveal(active, 2)}`}>
        The numbers are all here. Check back later and we'll have the words too.
      </p>
    </SlideShell>
  );
}

function FinaleSlide({
  accent,
  active,
  fallback,
  noteRefs,
  onRegenerate,
  regenerating,
}: {
  accent: NoteAccent;
  active: boolean;
  fallback: boolean;
  noteRefs: NoteRef[];
  onRegenerate: () => void;
  regenerating: boolean;
}) {
  const chips = noteRefs.slice(0, 8);
  return (
    <SlideShell accent={accent} active={active}>
      <p className={`font-serif text-4xl leading-tight ${reveal(active, 0)}`}>
        {fallback ? "That was your recap" : "That was your week"}
      </p>
      {chips.length > 0 && (
        <div className={`flex flex-wrap gap-2 ${reveal(active, 1)}`}>
          {chips.map((n) => {
            const title = n.title.length > 26 ? `${n.title.slice(0, 26).trimEnd()}…` : n.title;
            return (
              <Link
                key={n.id}
                to="/notes/$noteId"
                params={{ noteId: n.id }}
                className={`inline-flex max-w-full items-center gap-1.5 rounded-full bg-black/10 px-3 py-1.5 text-xs transition-colors hover:bg-black/20 ${FOCUS_RING}`}
              >
                {n.source_domain && (
                  <img
                    src={`https://www.google.com/s2/favicons?domain=${n.source_domain}&sz=32`}
                    onError={(e) => {
                      e.currentTarget.style.visibility = "hidden";
                    }}
                    alt=""
                    className="h-3 w-3 shrink-0 rounded-sm"
                  />
                )}
                <span className="min-w-0 truncate">{title}</span>
              </Link>
            );
          })}
        </div>
      )}
      <div className={`flex flex-col items-start gap-3 ${reveal(active, 2)}`}>
        <PillLink to="/" variant="secondary">
          Back to your notes
        </PillLink>
        <button
          type="button"
          onClick={onRegenerate}
          disabled={regenerating}
          className={`inline-flex items-center gap-1.5 text-sm underline underline-offset-4 opacity-70 transition-opacity hover:opacity-100 disabled:opacity-50 ${FOCUS_RING}`}
        >
          <RotateCw
            className={`h-3.5 w-3.5 ${regenerating ? "animate-spin motion-reduce:animate-none" : ""}`}
            aria-hidden="true"
          />
          {regenerating ? "Regenerating…" : "Regenerate"}
        </button>
      </div>
    </SlideShell>
  );
}

// ─── Shell ───────────────────────────────────────────────────────────────

type SlideDef = { accent: NoteAccent; render: (active: boolean) => ReactNode };

export function WrappedStories({
  data,
  onRegenerate,
  regenerating,
}: {
  data: MyDigestResponse;
  onRegenerate: () => void;
  regenerating: boolean;
}) {
  const router = useRouter();
  const canGoBack = useCanGoBack();
  const scrollerRef = useRef<HTMLDivElement>(null);
  const [active, setActive] = useState(0);

  const close = useCallback(() => {
    if (canGoBack) router.history.back();
    else router.navigate({ to: "/settings" });
  }, [canGoBack, router]);

  const slides = useMemo<SlideDef[]>(() => {
    const { stats, digest, note_refs, stale } = data;
    const out: SlideDef[] = [];
    // A running counter feeds paletteAccent so consecutive slides land on different palettes;
    // category-driven slides override with their own accent instead.
    let a = 4; // start on plum for a bold opener
    const next = () => paletteAccent(a++);

    if (stats) {
      const heroAcc = next();
      out.push({
        accent: heroAcc,
        render: (act) => <HeroSlide accent={heroAcc} active={act} stats={stats} />,
      });
      if (stats.categories.length > 0) {
        const acc = noteAccent(stats.categories[0].slug);
        out.push({
          accent: acc,
          render: (act) => (
            <CategoriesSlide accent={acc} active={act} categories={stats.categories} />
          ),
        });
      }
      if (stats.top_domains.length > 0 || stats.busiest_day || stats.active_days > 0) {
        const acc = next();
        out.push({
          accent: acc,
          render: (act) => <SourcesSlide accent={acc} active={act} stats={stats} />,
        });
      }
    }

    if (digest) {
      const introAcc = next();
      out.push({
        accent: introAcc,
        render: (act) => (
          <IntroSlide accent={introAcc} active={act} intro={digest.intro} facts={digest.facts} />
        ),
      });
      for (const sec of digest.sections.slice(0, 4)) {
        const acc = next();
        out.push({
          accent: acc,
          render: (act) => (
            <SectionSlide
              accent={acc}
              active={act}
              heading={sec.heading}
              body={sec.body}
              items={sec.items ?? []}
            />
          ),
        });
      }
    } else if (stale && stats) {
      // Stats built but the narrative failed with no cache — say so gracefully.
      const acc = next();
      out.push({ accent: acc, render: (act) => <NoStorySlide accent={acc} active={act} /> });
    }

    const finAcc = next();
    out.push({
      accent: finAcc,
      render: (act) => (
        <FinaleSlide
          accent={finAcc}
          active={act}
          fallback={stats?.fallback ?? false}
          noteRefs={note_refs}
          onRegenerate={onRegenerate}
          regenerating={regenerating}
        />
      ),
    });
    return out;
  }, [data, regenerating, onRegenerate]);

  const count = slides.length;
  const activeAccent = slides[Math.min(active, count - 1)]?.accent ?? paletteAccent(0);

  const goTo = useCallback(
    (i: number) => {
      const el = scrollerRef.current;
      if (!el) return;
      const clamped = Math.max(0, Math.min(count - 1, i));
      el.scrollTo({ left: clamped * el.clientWidth, behavior: "smooth" });
    },
    [count],
  );

  const onScroll = () => {
    const el = scrollerRef.current;
    if (!el || el.clientWidth === 0) return;
    setActive(Math.round(el.scrollLeft / el.clientWidth));
  };

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "ArrowLeft") goTo(active - 1);
      else if (e.key === "ArrowRight") goTo(active + 1);
      else if (e.key === "Escape") close();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [active, goTo, close]);

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-ink/40 backdrop-blur-sm md:p-4">
      <div className="relative flex h-full w-full flex-col overflow-hidden bg-background md:h-auto md:aspect-[9/16] md:max-h-[85vh] md:w-full md:max-w-md md:rounded-3xl md:shadow-2xl">
        {/* Story-style tap navigation lives on the scroller itself (left third back, rest
            forward) instead of overlay buttons: the reveal animation's transform creates a
            stacking context per slide, so no z-index could reliably keep links above an
            overlay — and an overlay would also swallow the vertical scroll of long slides.
            Clicks on real links/buttons inside a slide are left alone. */}
        <div
          ref={scrollerRef}
          onScroll={onScroll}
          onClick={(e) => {
            if ((e.target as HTMLElement).closest("a,button")) return;
            const el = scrollerRef.current;
            if (!el) return;
            const { left, width } = el.getBoundingClientRect();
            goTo(e.clientX - left < width * 0.3 ? active - 1 : active + 1);
          }}
          className="flex h-full snap-x snap-mandatory overflow-x-auto overscroll-x-contain [scrollbar-width:none] [&::-webkit-scrollbar]:hidden"
        >
          {slides.map((s, i) => (
            <Fragment key={i}>{s.render(i === active)}</Fragment>
          ))}
        </div>

        {/* Progress + close, tinted to the active slide's `on` colour so both read on any
            accent. pointer-events-none except the close button, so taps pass to the zones. */}
        <div
          className={`pointer-events-none absolute inset-x-0 top-0 z-30 flex flex-col gap-2 px-3 pt-[calc(env(safe-area-inset-top)+0.75rem)] ${activeAccent.on}`}
        >
          <div className="flex gap-1">
            {slides.map((_, i) => (
              <span
                key={i}
                className={`h-1 flex-1 rounded-full bg-current transition-opacity ${
                  i <= active ? "opacity-90" : "opacity-30"
                }`}
              />
            ))}
          </div>
          <div className="flex items-center justify-between">
            {/* A cached narrative that no longer matches the current note set still renders;
                the pill is the only hint it was written earlier. */}
            {data.stale && data.digest?.generated_at ? (
              <span className="rounded-full bg-black/10 px-2.5 py-1 text-[11px] font-medium">
                From {fmtDay(data.digest.generated_at.slice(0, 10))}
              </span>
            ) : (
              <span />
            )}
            <button
              type="button"
              onClick={close}
              aria-label="Close"
              className={`pointer-events-auto inline-flex h-9 w-9 items-center justify-center rounded-full bg-black/10 text-current transition-colors hover:bg-black/20 ${FOCUS_RING}`}
            >
              <X className="h-4 w-4" />
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
