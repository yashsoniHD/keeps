/**
 * Clipnote Landing Page
 * ----------------------
 * Single self-contained React + Tailwind component. Drops directly into the
 * existing app — uses the design tokens already declared in frontend/src/styles.css
 * (paper, ink, ink-soft, recipe/itinerary/product/summary/tech/health + their
 * `-soft` variants). Inter + Instrument Serif are loaded via @fontsource.
 *
 * Usage:
 *   1. Save as `frontend/src/routes/landing.tsx` (or import anywhere).
 *   2. Mount it on a route, e.g. add to routeTree.gen.ts.
 *   3. The "Try it free" button calls `onTry(url)` — currently a placeholder.
 *      Wire it to real Google sign-in + POST /api/ingest.
 *
 * Aesthetic: editorial / commonplace book / warm paper.
 * See marketing/LANDING_PAGE_DESIGN_BRIEF.md for the full spec.
 */

import { useEffect, useState } from "react";
import {
  ArrowRight,
  ChefHat,
  Compass,
  Cpu,
  Dumbbell,
  FileText,
  Link2,
  MapPin,
  Share,
  ShoppingBag,
  Sparkles,
} from "lucide-react";

// ---------- Design tokens (re-exposed as TS constants for inline styles) ----
// Mirror of the CSS custom properties declared in frontend/src/styles.css so
// we can use them in `style={{ ... }}` (Tailwind arbitrary values also work,
// but having JS constants makes the accent palette easy to map over).

const ACCENTS = {
  recipe: "var(--recipe)",
  itinerary: "var(--itinerary)",
  product: "var(--product)",
  summary: "var(--summary)",
  media: "var(--media)",
  tech: "var(--tech)",
  business: "var(--business)",
  health: "var(--health)",
} as const;

const ACCENT_SOFT = {
  recipe: "var(--recipe-soft)",
  itinerary: "var(--itinerary-soft)",
  product: "var(--product-soft)",
  summary: "var(--summary-soft)",
  media: "var(--media-soft)",
  tech: "var(--tech-soft)",
  business: "var(--business-soft)",
  health: "var(--health-soft)",
} as const;

// ---------- Data ------------------------------------------------------------

type NoteType = keyof typeof ACCENTS;

const SAMPLE_NOTES: {
  type: NoteType;
  icon: keyof typeof ICONS;
  label: string;
  title: string;
  summary: string;
  domain: string;
}[] = [
  {
    type: "recipe",
    icon: "ChefHat",
    label: "Recipe",
    title: "One-Pan Lemon Garlic Butter Salmon",
    summary:
      "A 20-minute weeknight salmon: seared, then finished in a lemon-garlic butter pan sauce. Serves 2.",
    domain: "instagram.com",
  },
  {
    type: "itinerary",
    icon: "MapPin",
    label: "Itinerary",
    title: "3 Days in Lisbon, Slowly",
    summary:
      "Alfama mornings, a Belém afternoon, and where to catch sunset over the Tagus — paced for wandering, not rushing.",
    domain: "youtube.com",
  },
  {
    type: "product",
    icon: "ShoppingBag",
    label: "Product",
    title: "Sony WH-1000XM5 Headphones",
    summary:
      "Class-leading noise cancelling and 30h battery. Pros: comfort, ANC. Cons: don't fold, pricey.",
    domain: "amazon.com",
  },
  {
    type: "summary",
    icon: "FileText",
    label: "Summary",
    title: "Why We Sleep — The 20-Minute Version",
    summary:
      "The case for 8 hours, what happens when you skip them, and the small habits that fix most sleep.",
    domain: "nytimes.com",
  },
  {
    type: "tech",
    icon: "Cpu",
    label: "Software",
    title: "A Practical Guide to RAG in 2026",
    summary:
      "Chunking, hybrid retrieval, and when to skip vectors entirely — distilled into the decisions that matter.",
    domain: "github.com",
  },
  {
    type: "health",
    icon: "Dumbbell",
    label: "Workout",
    title: "Beginner Full-Body Dumbbell Routine",
    summary:
      "Three days a week, six moves, progressive sets and reps — with form cues for each.",
    domain: "tiktok.com",
  },
];

const GRAVEYARD = [
  { name: "Instagram", label: "Saved" },
  { name: "X", label: "Bookmarks" },
  { name: "YouTube", label: "Watch Later" },
  { name: "Amazon", label: "Save for later" },
  { name: "TikTok", label: "Favorites" },
  { name: "Reddit", label: "Saved" },
  { name: "Pinterest", label: "Pins" },
  { name: "WhatsApp", label: "Starred" },
];

const USE_CASES: {
  type: NoteType;
  icon: keyof typeof ICONS;
  label: string;
  copy: string;
}[] = [
  {
    type: "recipe",
    icon: "ChefHat",
    label: "Recipes",
    copy: "Messy reels and blog walls become clean, cookable cards.",
  },
  {
    type: "summary",
    icon: "FileText",
    label: "Articles",
    copy: "Long reads become a TL;DR, key points, and the quotes worth keeping.",
  },
  {
    type: "product",
    icon: "ShoppingBag",
    label: "Products",
    copy: "Price, specs, pros and cons — ready to compare.",
  },
  {
    type: "itinerary",
    icon: "MapPin",
    label: "Travel",
    copy: "Scattered links become a day-by-day plan.",
  },
  {
    type: "health",
    icon: "Dumbbell",
    label: "Workouts",
    copy: "Routines structured into sets, reps, and form notes.",
  },
  {
    type: "tech",
    icon: "Sparkles",
    label: "Anything else",
    copy: "New to Clipnote? It invents the right format on the fly.",
  },
];

const CLIP_AI_PROMPTS = [
  "Build a 3-day itinerary from everything I saved about Tokyo.",
  "Make a meal plan from my saved recipes, with a grocery list.",
  "Compare the three laptops I clipped this week.",
  "Summarize everything I saved today.",
];

// ---------- Icon registry --------------------------------------------------

const ICONS = {
  Sparkles,
  Link2,
  ArrowRight,
  ChefHat,
  MapPin,
  ShoppingBag,
  FileText,
  Cpu,
  Dumbbell,
  Compass,
  Share,
} as const;

type IconName = keyof typeof ICONS;

function Icon({
  name,
  className,
  style,
}: {
  name: IconName;
  className?: string;
  style?: React.CSSProperties;
}) {
  const Cmp = ICONS[name];
  return <Cmp className={className} style={style} strokeWidth={1.6} />;
}

// ---------- Reusable: Paste-to-try bar -------------------------------------

function PasteBar({
  onTry,
  size = "md",
}: {
  onTry: (url: string) => void;
  size?: "md" | "lg";
}) {
  const [value, setValue] = useState("");
  const isLg = size === "lg";

  return (
    <form
      onSubmit={(e) => {
        e.preventDefault();
        if (value.trim()) onTry(value.trim());
      }}
      className={[
        "group flex w-full items-center gap-2 rounded-full border border-border bg-card",
        "shadow-sm transition-shadow focus-within:shadow-md",
        isLg ? "p-2 pl-5" : "p-1.5 pl-4",
      ].join(" ")}
    >
      <Link2
        className="shrink-0 text-ink-soft"
        size={isLg ? 20 : 18}
        strokeWidth={1.8}
        aria-hidden
      />
      <input
        type="url"
        inputMode="url"
        autoComplete="off"
        spellCheck={false}
        placeholder="Paste any link: article, reel, recipe, product…"
        value={value}
        onChange={(e) => setValue(e.target.value)}
        className={[
          "min-w-0 flex-1 bg-transparent text-ink placeholder:text-ink-soft/70",
          "outline-none focus:outline-none focus-visible:outline-none",
          isLg ? "h-12 text-base" : "h-10 text-[15px]",
        ].join(" ")}
        aria-label="Paste a link to try Clipnote"
      />
      <button
        type="submit"
        className={[
          "inline-flex shrink-0 items-center justify-center gap-1.5 rounded-full bg-primary text-primary-foreground",
          "transition-all hover:opacity-90 active:scale-[0.98]",
          "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background",
          isLg ? "h-12 px-6 text-sm" : "h-10 px-5 text-sm",
        ].join(" ")}
      >
        Try it free
        <ArrowRight size={isLg ? 18 : 16} strokeWidth={2} />
      </button>
    </form>
  );
}

// ---------- Reusable: Note card --------------------------------------------

function NoteCard({
  note,
  expanded = false,
}: {
  note: (typeof SAMPLE_NOTES)[number];
  expanded?: boolean;
}) {
  if (expanded) {
    return <ExpandedRecipeCard />;
  }
  return (
    <article
      className={[
        "group relative flex h-full flex-col overflow-hidden rounded-2xl border border-border bg-card",
        "transition-all duration-300 ease-out hover:-translate-y-0.5 hover:shadow-[0_18px_40px_-20px_oklch(0.18_0.02_50/0.25)]",
      ].join(" ")}
    >
      {/* cover gradient (placeholder; real product would have og:image) */}
      <div
        aria-hidden
        className="relative aspect-[16/10] w-full overflow-hidden"
        style={{
          background: `linear-gradient(135deg, ${accentVar(
            note.type,
            "soft",
          )} 0%, ${softToDeep(note.type)} 100%)`,
        }}
      >
        <div className="absolute inset-0 flex items-center justify-center opacity-60 mix-blend-multiply transition-transform duration-500 group-hover:scale-105">
          <Icon
            name={note.icon}
            className="h-12 w-12"
            style={{ color: ACCENTS[note.type] }}
          />
        </div>
        <div
          className="absolute left-3 top-3 inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-[11px] font-medium tracking-wide"
          style={{
            backgroundColor: ACCENT_SOFT[note.type],
            color: ACCENTS[note.type],
          }}
        >
          <Icon name={note.icon} className="h-3 w-3" />
          {note.label}
        </div>
      </div>

      <div className="flex flex-1 flex-col gap-2 p-5">
        <h3 className="font-serif text-[19px] leading-snug tracking-tight text-ink line-clamp-2">
          {note.title}
        </h3>
        <p className="text-[13.5px] leading-relaxed text-ink-soft line-clamp-3">
          {note.summary}
        </p>
        <div className="mt-auto flex items-center gap-1.5 pt-2 text-[12px] text-ink-soft/80">
          <FaviconMark domain={note.domain} />
          <span>{note.domain}</span>
        </div>
      </div>
    </article>
  );
}

// The single "expanded" card showing real structure — recipe with ingredients
// and method. This is the proof-of-magic section.
function ExpandedRecipeCard() {
  const stats = ["Time 20 min", "Serves 2", "Easy"];
  const ingredients = [
    "2 salmon fillets",
    "3 tbsp butter",
    "4 cloves garlic, minced",
    "1 lemon (juice + zest)",
    "Salt & pepper",
    "Fresh parsley",
  ];
  const steps = [
    "Pat salmon dry, season.",
    "Sear skin-side down 4 min.",
    "Flip, add butter + garlic, baste 3 min.",
    "Add lemon juice + zest, spoon over.",
    "Finish with parsley; serve.",
  ];

  return (
    <article className="relative flex h-full flex-col overflow-hidden rounded-2xl border border-border bg-card shadow-[0_18px_40px_-20px_oklch(0.18_0.02_50/0.25)]">
      {/* cover */}
      <div
        aria-hidden
        className="relative aspect-[16/9] w-full"
        style={{
          background:
            "linear-gradient(135deg, var(--recipe-soft) 0%, oklch(0.78 0.10 38) 100%)",
        }}
      >
        <div className="absolute inset-0 flex items-center justify-center opacity-60 mix-blend-multiply">
          <ChefHat
            className="h-16 w-16"
            style={{ color: ACCENTS.recipe }}
            strokeWidth={1.4}
          />
        </div>
        <div
          className="absolute left-4 top-4 inline-flex items-center gap-1.5 rounded-full px-3 py-1 text-[11px] font-medium tracking-wide"
          style={{
            backgroundColor: ACCENT_SOFT.recipe,
            color: ACCENTS.recipe,
          }}
        >
          <ChefHat className="h-3 w-3" />
          Recipe
        </div>
      </div>

      <div className="flex flex-1 flex-col gap-5 p-6">
        <div>
          <h3 className="font-serif text-[22px] leading-tight tracking-tight text-ink">
            One-Pan Lemon Garlic Butter Salmon
          </h3>
          <div className="mt-3 flex flex-wrap gap-x-4 gap-y-1 text-[12.5px] text-ink-soft">
            {stats.map((s, i) => (
              <span key={s} className="inline-flex items-center">
                {i > 0 && <span className="mr-4 h-1 w-1 rounded-full bg-border" />}
                {s}
              </span>
            ))}
          </div>
        </div>

        <div>
          <p className="mb-2 text-[11px] font-medium uppercase tracking-[0.14em] text-ink-soft">
            Ingredients
          </p>
          <ul className="space-y-1.5 text-[14px] text-ink">
            {ingredients.map((it) => (
              <li key={it} className="flex items-start gap-2.5">
                <span
                  className="mt-1.5 h-1.5 w-1.5 shrink-0 rounded-full"
                  style={{ backgroundColor: ACCENTS.recipe }}
                />
                {it}
              </li>
            ))}
          </ul>
        </div>

        <div>
          <p className="mb-2 text-[11px] font-medium uppercase tracking-[0.14em] text-ink-soft">
            Method
          </p>
          <ol className="space-y-2 text-[14px] text-ink">
            {steps.map((step, i) => (
              <li key={step} className="flex items-start gap-3">
                <span
                  className="mt-0.5 inline-flex h-5 w-5 shrink-0 items-center justify-center rounded-full text-[11px] font-medium"
                  style={{
                    backgroundColor: ACCENT_SOFT.recipe,
                    color: ACCENTS.recipe,
                  }}
                >
                  {i + 1}
                </span>
                {step}
              </li>
            ))}
          </ol>
        </div>
      </div>
    </article>
  );
}

// ---------- Helpers --------------------------------------------------------

function accentVar(type: NoteType, variant: "fg" | "soft" = "fg") {
  return variant === "soft" ? ACCENT_SOFT[type] : ACCENTS[type];
}

function softToDeep(type: NoteType): string {
  // Map each accent to a slightly deeper companion for the gradient.
  const map: Record<NoteType, string> = {
    recipe: "oklch(0.88 0.06 40)",
    itinerary: "oklch(0.86 0.04 155)",
    product: "oklch(0.84 0.06 265)",
    summary: "oklch(0.88 0.07 80)",
    media: "oklch(0.86 0.06 330)",
    tech: "oklch(0.85 0.05 230)",
    business: "oklch(0.84 0.04 195)",
    health: "oklch(0.88 0.06 10)",
  };
  return map[type];
}

function FaviconMark({ domain }: { domain: string }) {
  const initial = domain.charAt(0).toUpperCase();
  return (
    <span
      aria-hidden
      className="inline-flex h-4 w-4 items-center justify-center rounded-sm bg-muted text-[9px] font-semibold text-ink-soft"
    >
      {initial}
    </span>
  );
}

// ---------- The page -------------------------------------------------------

export default function ClipnoteLanding({
  onTry = (url) => {
    // Fallback (component used standalone): log the pasted URL. The app route
    // (frontend/src/routes/landing.tsx) supplies a real handler that stashes the
    // URL and routes to sign-in.
    // eslint-disable-next-line no-console
    console.log("Try:", url);
  },
  onSignIn,
}: {
  onTry?: (url: string) => void;
  onSignIn?: () => void;
}) {
  // Slight header elevation when scrolled — keeps it transparent on first paint.
  const [scrolled, setScrolled] = useState(false);
  useEffect(() => {
    const onScroll = () => setScrolled(window.scrollY > 12);
    onScroll();
    window.addEventListener("scroll", onScroll, { passive: true });
    return () => window.removeEventListener("scroll", onScroll);
  }, []);

  return (
    <div className="relative min-h-screen overflow-x-hidden bg-background font-sans text-foreground antialiased">
      {/* Paper-grain texture (subtle, layered radial dots) */}
      <div
        aria-hidden
        className="pointer-events-none fixed inset-0 z-0 opacity-[0.55]"
        style={{
          backgroundImage: [
            "radial-gradient(oklch(0.5 0.02 60 / 0.05) 1px, transparent 1px)",
            "radial-gradient(oklch(0.5 0.02 60 / 0.04) 1px, transparent 1px)",
          ].join(", "),
          backgroundSize: "3px 3px, 7px 7px",
          backgroundPosition: "0 0, 1px 1px",
        }}
      />
      {/* Warm radial glow behind hero */}
      <div
        aria-hidden
        className="pointer-events-none absolute left-1/2 top-[-10%] z-0 h-[60vh] w-[120vw] -translate-x-1/2"
        style={{
          background:
            "radial-gradient(60% 60% at 50% 30%, oklch(0.95 0.04 75 / 0.6) 0%, transparent 70%)",
        }}
      />

      <div className="relative z-10">
        {/* HEADER ------------------------------------------------------ */}
        <header
          className={[
            "sticky top-0 z-50 transition-all duration-300",
            scrolled
              ? "border-b border-border/70 bg-background/80 backdrop-blur-md"
              : "bg-transparent",
          ].join(" ")}
        >
          <div className="mx-auto flex h-16 max-w-[1180px] items-center justify-between px-6">
            <a
              href="#top"
              className="group inline-flex items-center gap-2.5"
              aria-label="Clipnote — home"
            >
              <span className="inline-flex h-7 w-7 items-center justify-center rounded-lg bg-ink text-paper transition-transform group-hover:rotate-[8deg]">
                <Sparkles size={15} strokeWidth={2} />
              </span>
              <span className="font-serif text-[22px] tracking-tight text-ink">
                Clipnote
              </span>
            </a>

            <button
              type="button"
              onClick={() => {
                if (onSignIn) onSignIn();
                else
                  document
                    .getElementById("try")
                    ?.scrollIntoView({ behavior: "smooth" });
              }}
              className={[
                "inline-flex items-center gap-1.5 rounded-full px-3.5 py-2 text-[13.5px] font-medium",
                "text-ink transition-colors hover:bg-muted",
                "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
              ].join(" ")}
            >
              Sign in
            </button>
          </div>
        </header>

        {/* HERO -------------------------------------------------------- */}
        <section id="top" className="relative px-6 pb-16 pt-10 sm:pt-16 lg:pt-20">
          <div className="mx-auto max-w-[820px] text-center">
            <p className="mb-6 text-[11px] font-semibold uppercase tracking-[0.22em] text-ink-soft">
              Your links, finally worth re-reading
            </p>

            <h1 className="font-serif text-[clamp(2.5rem,6vw,4.75rem)] font-normal leading-[1.02] tracking-[-0.015em] text-ink">
              Your bookmarks are a graveyard.
              <br />
              <span className="italic text-ink/95">
                Clipnote brings them back to life.
              </span>
            </h1>

            <p className="mx-auto mt-7 max-w-[58ch] text-[17px] leading-[1.55] text-ink-soft">
              Paste any link — a reel, an article, a recipe, a product — and
              AI rebuilds it into a clean, structured note you'll actually
              re-read. Then ask Clip AI anything across everything you've saved.
            </p>

            <div id="try" className="mx-auto mt-10 max-w-[620px]">
              <PasteBar onTry={onTry} size="lg" />
              <p className="mt-3 text-[12.5px] text-ink-soft/85">
                Free to start · Sign in with Google · No card
              </p>
            </div>
          </div>
        </section>

        {/* BOOKMARK GRAVEYARD ----------------------------------------- */}
        <section className="relative px-6 py-20 sm:py-28">
          <div className="mx-auto max-w-[1180px]">
            <div className="mx-auto max-w-[680px] text-center">
              <p className="text-[11px] font-semibold uppercase tracking-[0.22em] text-ink-soft">
                The bookmark graveyard
              </p>
              <h2 className="mt-4 font-serif text-[clamp(1.875rem,3.5vw,2.75rem)] leading-[1.1] tracking-[-0.01em] text-ink">
                You already save everything.
                <br />
                You just never go back.
              </h2>
              <p className="mx-auto mt-5 max-w-[55ch] text-[15.5px] leading-relaxed text-ink-soft">
                Instagram's "Saved." X "Bookmarks." YouTube "Watch Later."
                Amazon "Save for later." Every app has a place where links go
                to be forgotten. Clipnote is the one place a save becomes
                something you'll actually use.
              </p>
            </div>

            {/* Convergence: faded platforms → arrow → single vibrant card */}
            <div className="relative mt-14 grid grid-cols-1 items-center gap-10 lg:grid-cols-[1fr_auto_1fr] lg:gap-8">
              {/* Faded graveyard chips */}
              <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4">
                {GRAVEYARD.map((g) => (
                  <div
                    key={g.name}
                    className="group flex items-center gap-2.5 rounded-xl border border-border/70 bg-muted/40 px-3 py-2.5 opacity-60 grayscale transition-all duration-300 hover:opacity-80 hover:grayscale-[0.7]"
                  >
                    <span className="inline-flex h-7 w-7 items-center justify-center rounded-md bg-muted text-[11px] font-semibold uppercase text-ink-soft">
                      {g.name.charAt(0)}
                    </span>
                    <div className="min-w-0 leading-tight">
                      <div className="truncate text-[12px] font-medium text-ink-soft">
                        {g.name}
                      </div>
                      <div className="truncate text-[10.5px] text-ink-soft/70">
                        {g.label}
                      </div>
                    </div>
                  </div>
                ))}
              </div>

              {/* Arrow / funnel */}
              <div
                aria-hidden
                className="hidden lg:flex lg:flex-col lg:items-center"
              >
                <svg
                  width="120"
                  height="40"
                  viewBox="0 0 120 40"
                  fill="none"
                  className="text-ink-soft/40"
                >
                  <path
                    d="M2 20 H110 M96 12 L110 20 L96 28"
                    stroke="currentColor"
                    strokeWidth="1.5"
                    strokeLinecap="round"
                    strokeLinejoin="round"
                  />
                </svg>
              </div>

              {/* Living note card (vibrant) */}
              <div className="mx-auto w-full max-w-[360px] lg:mx-0">
                <NoteCard note={SAMPLE_NOTES[0]} />
              </div>
            </div>

            {/* Mobile-only downward arrow */}
            <div
              aria-hidden
              className="mt-10 flex justify-center text-ink-soft/40 lg:hidden"
            >
              <svg
                width="32"
                height="40"
                viewBox="0 0 32 40"
                fill="none"
                className="rotate-90"
              >
                <path
                  d="M2 20 H30 M16 4 L30 20 L16 36"
                  stroke="currentColor"
                  strokeWidth="1.5"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                />
              </svg>
            </div>

            <p className="mt-12 text-center font-serif text-[22px] italic tracking-tight text-ink">
              Save it to Clipnote instead.
            </p>
          </div>
        </section>

        {/* SEE IT IN ACTION ------------------------------------------- */}
        <section className="relative px-6 py-20 sm:py-28">
          <div className="mx-auto max-w-[1180px]">
            <div className="mx-auto max-w-[680px] text-center">
              <h2 className="font-serif text-[clamp(1.875rem,3.5vw,2.75rem)] leading-[1.1] tracking-[-0.01em] text-ink">
                One paste. A note worth keeping.
              </h2>
              <p className="mx-auto mt-5 max-w-[55ch] text-[15.5px] leading-relaxed text-ink-soft">
                Clipnote reads the source and rebuilds it — structured,
                skimmable, and better than the original.
              </p>
            </div>

            {/* 3x2 grid (or 2x3), with one expanded card spanning two */}
            <div className="mt-14 grid grid-cols-1 gap-5 sm:grid-cols-2 lg:grid-cols-3">
              {SAMPLE_NOTES.slice(0, 2).map((n) => (
                <NoteCard key={n.title} note={n} />
              ))}
              {/* expanded recipe card */}
              <div className="sm:col-span-2 lg:col-span-2 lg:row-span-2">
                <ExpandedRecipeCard />
              </div>
              {SAMPLE_NOTES.slice(2).map((n) => (
                <NoteCard key={n.title} note={n} />
              ))}
            </div>
          </div>
        </section>

        {/* HOW IT WORKS ----------------------------------------------- */}
        <section className="relative px-6 py-20 sm:py-28">
          <div className="mx-auto max-w-[1080px]">
            <div className="mx-auto max-w-[680px] text-center">
              <h2 className="font-serif text-[clamp(1.875rem,3.5vw,2.75rem)] leading-[1.1] tracking-[-0.01em] text-ink">
                From link to library in three steps.
              </h2>
            </div>

            <div className="relative mt-16 grid grid-cols-1 gap-10 md:grid-cols-3 md:gap-6">
              {/* connector line (desktop only) */}
              <div
                aria-hidden
                className="absolute left-[14%] right-[14%] top-6 hidden h-px bg-gradient-to-r from-transparent via-border to-transparent md:block"
              />

              {[
                {
                  n: 1,
                  icon: "Link2" as IconName,
                  title: "Paste a link",
                  body:
                    "From the web or any app's share sheet. Articles, reels, videos, recipes, products — anything with a URL.",
                },
                {
                  n: 2,
                  icon: "Sparkles" as IconName,
                  title: "AI rebuilds it",
                  body:
                    "Clipnote extracts the substance and structures it: ingredients and steps, spec tables, key points, itineraries — with a cover image.",
                },
                {
                  n: 3,
                  icon: "Compass" as IconName,
                  title: "Re-read & ask anything",
                  body:
                    "Your notes become a library. Ask Clip AI to summarize, compare, or consolidate everything you've saved.",
                },
              ].map((s) => (
                <div key={s.n} className="relative text-center md:px-4">
                  <div className="relative mx-auto inline-flex">
                    <span className="inline-flex h-12 w-12 items-center justify-center rounded-full bg-ink font-serif text-base text-paper">
                      {s.n}
                    </span>
                  </div>
                  <div className="mt-5 inline-flex h-10 w-10 items-center justify-center rounded-xl bg-muted text-ink">
                    <Icon name={s.icon} className="h-5 w-5" />
                  </div>
                  <h3 className="mt-4 font-serif text-[22px] tracking-tight text-ink">
                    {s.title}
                  </h3>
                  <p className="mx-auto mt-2 max-w-[34ch] text-[14.5px] leading-relaxed text-ink-soft">
                    {s.body}
                  </p>
                </div>
              ))}
            </div>
          </div>
        </section>

        {/* CLIP AI ----------------------------------------------------- */}
        <section className="relative px-6 py-20 sm:py-28">
          <div className="mx-auto max-w-[1180px]">
            <div className="grid grid-cols-1 items-center gap-12 lg:grid-cols-[1fr_1.05fr] lg:gap-16">
              <div>
                <p className="text-[11px] font-semibold uppercase tracking-[0.22em] text-ink-soft">
                  Meet Clip AI
                </p>
                <h2 className="mt-4 font-serif text-[clamp(1.875rem,3.5vw,2.75rem)] leading-[1.05] tracking-[-0.01em] text-ink">
                  Ask your links anything.
                </h2>
                <p className="mt-5 max-w-[52ch] text-[16px] leading-relaxed text-ink-soft">
                  Most bookmark tools just store the page. Clipnote understands
                  it — so you can talk to your whole library. Clip AI knows what
                  you saved and turns it into something new.
                </p>
              </div>

              {/* Faux chat */}
              <div className="relative">
                <div
                  aria-hidden
                  className="absolute -inset-4 -z-10 rounded-3xl bg-gradient-to-br from-muted/60 to-transparent blur-2xl"
                />
                <div className="overflow-hidden rounded-2xl border border-border bg-card shadow-[0_30px_60px_-30px_oklch(0.18_0.02_50/0.25)]">
                  <div className="flex items-center gap-2 border-b border-border/60 px-5 py-3.5">
                    <span className="inline-flex h-6 w-6 items-center justify-center rounded-md bg-ink text-paper">
                      <Sparkles size={12} strokeWidth={2} />
                    </span>
                    <span className="text-[12px] font-medium text-ink">
                      Clip AI
                    </span>
                    <span className="ml-auto text-[11px] text-ink-soft">
                      3-day itinerary · Tokyo
                    </span>
                  </div>

                  <div className="space-y-4 p-5">
                    {/* User bubble 1 */}
                    <div className="flex justify-end">
                      <div className="max-w-[85%] rounded-2xl rounded-br-md bg-muted px-4 py-2.5 text-[14px] leading-relaxed text-ink">
                        Build a 3-day itinerary from everything I saved about
                        Tokyo.
                      </div>
                    </div>

                    {/* AI reply */}
                    <div className="flex justify-start">
                      <div className="max-w-[92%] rounded-2xl rounded-bl-md border border-border/60 bg-background px-4 py-3 text-[14px] leading-relaxed text-ink">
                        <p className="mb-3">
                          Based on <strong>12 of your saved notes</strong>,
                          here's a calm three-day plan:
                        </p>
                        <div className="space-y-2 text-[13px]">
                          <div className="flex gap-2">
                            <span
                              className="mt-0.5 inline-flex h-5 w-5 shrink-0 items-center justify-center rounded-full text-[10px] font-medium"
                              style={{
                                backgroundColor: ACCENT_SOFT.itinerary,
                                color: ACCENTS.itinerary,
                              }}
                            >
                              1
                            </span>
                            <span>
                              <strong>Asakusa & Senso-ji</strong> — early, before
                              the tour buses. Note from your saved reel:
                              "Yanaka at sunrise beats Shibuya at midnight."
                            </span>
                          </div>
                          <div className="flex gap-2">
                            <span
                              className="mt-0.5 inline-flex h-5 w-5 shrink-0 items-center justify-center rounded-full text-[10px] font-medium"
                              style={{
                                backgroundColor: ACCENT_SOFT.itinerary,
                                color: ACCENTS.itinerary,
                              }}
                            >
                              2
                            </span>
                            <span>
                              <strong>Tsukiji breakfast loop</strong> — three
                              stops from your saved list, paced for a slow
                              morning.
                            </span>
                          </div>
                          <div className="flex gap-2">
                            <span
                              className="mt-0.5 inline-flex h-5 w-5 shrink-0 items-center justify-center rounded-full text-[10px] font-medium"
                              style={{
                                backgroundColor: ACCENT_SOFT.itinerary,
                                color: ACCENTS.itinerary,
                              }}
                            >
                              3
                            </span>
                            <span>
                              <strong>teamLab evenings</strong> — book ahead;
                              you saved two blog posts with tips on the
                              less-crowded hours.
                            </span>
                          </div>
                        </div>

                        <button
                          type="button"
                          className="mt-4 inline-flex items-center gap-1.5 rounded-full border border-border bg-background px-3 py-1.5 text-[12px] font-medium text-ink transition-colors hover:bg-muted"
                        >
                          Save as note
                          <ArrowRight size={12} strokeWidth={2} />
                        </button>
                      </div>
                    </div>

                    {/* Other prompt chips */}
                    <div className="flex flex-wrap gap-2 pt-2">
                      {CLIP_AI_PROMPTS.slice(1).map((p) => (
                        <span
                          key={p}
                          className="rounded-full border border-border/60 bg-background px-3 py-1.5 text-[12px] text-ink-soft"
                        >
                          {p}
                        </span>
                      ))}
                    </div>
                  </div>
                </div>
              </div>
            </div>
          </div>
        </section>

        {/* USE CASES --------------------------------------------------- */}
        <section className="relative px-6 py-20 sm:py-28">
          <div className="mx-auto max-w-[1180px]">
            <div className="mx-auto max-w-[680px] text-center">
              <h2 className="font-serif text-[clamp(1.875rem,3.5vw,2.75rem)] leading-[1.1] tracking-[-0.01em] text-ink">
                For everything you save.
              </h2>
            </div>

            <div className="mt-14 grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
              {USE_CASES.map((u) => (
                <article
                  key={u.label}
                  className={[
                    "group relative overflow-hidden rounded-2xl border border-border bg-card p-6",
                    "transition-all duration-300 hover:-translate-y-0.5 hover:shadow-[0_18px_40px_-20px_oklch(0.18_0.02_50/0.25)]",
                  ].join(" ")}
                >
                  <div
                    className="inline-flex h-11 w-11 items-center justify-center rounded-xl"
                    style={{
                      backgroundColor: ACCENT_SOFT[u.type],
                      color: ACCENTS[u.type],
                    }}
                  >
                    <Icon name={u.icon} className="h-5 w-5" />
                  </div>
                  <h3 className="mt-4 font-serif text-[20px] tracking-tight text-ink">
                    {u.label}
                  </h3>
                  <p className="mt-1.5 text-[14px] leading-relaxed text-ink-soft">
                    {u.copy}
                  </p>
                </article>
              ))}
            </div>
          </div>
        </section>

        {/* CAPTURE ANYWHERE ------------------------------------------- */}
        <section className="relative px-6 py-20 sm:py-28">
          <div className="mx-auto max-w-[1080px]">
            <div className="grid grid-cols-1 items-center gap-12 lg:grid-cols-[1fr_1fr]">
              <div>
                <h2 className="font-serif text-[clamp(1.875rem,3.5vw,2.75rem)] leading-[1.1] tracking-[-0.01em] text-ink">
                  Saving should be a reflex.
                </h2>
                <p className="mt-5 max-w-[52ch] text-[16px] leading-relaxed text-ink-soft">
                  Install Clipnote and it joins your phone's share sheet. See
                  something worth keeping? Share → Clipnote. One tap, from any
                  app, and it's a note before you've closed the tab.
                </p>
                <ul className="mt-6 space-y-3 text-[14.5px] text-ink">
                  {[
                    "PWA — installs like native, no app store.",
                    "iOS & Android share sheet, wired in one tap.",
                    "Background sync: paste on desktop, finish on phone.",
                  ].map((l) => (
                    <li key={l} className="flex items-start gap-3">
                      <span className="mt-1.5 h-1.5 w-1.5 shrink-0 rounded-full bg-ink" />
                      {l}
                    </li>
                  ))}
                </ul>
              </div>

              {/* Phone + share-sheet mock */}
              <div className="mx-auto w-full max-w-[360px]">
                <div className="relative rounded-[36px] border border-border bg-card p-3 shadow-[0_40px_80px_-30px_oklch(0.18_0.02_50/0.3)]">
                  <div className="rounded-[28px] bg-muted/40 p-5">
                    <p className="mb-3 text-[11px] font-medium uppercase tracking-[0.14em] text-ink-soft">
                      From any app
                    </p>
                    <div className="rounded-xl bg-background p-4">
                      <div className="flex items-center gap-2">
                        <div className="h-8 w-8 rounded-full bg-ink" />
                        <div className="flex-1">
                          <div className="h-2 w-3/4 rounded-full bg-muted" />
                          <div className="mt-1.5 h-2 w-1/2 rounded-full bg-muted" />
                        </div>
                      </div>
                      <p className="mt-3 text-[13px] leading-snug text-ink">
                        The 20-Minute Salmon You're Going To Make Forever
                      </p>
                    </div>

                    {/* share sheet */}
                    <div className="mt-5">
                      <div className="mb-2 flex items-center gap-2 px-1">
                        <span className="h-1.5 w-1.5 rounded-full bg-ink-soft/40" />
                        <span className="text-[10.5px] font-medium uppercase tracking-wider text-ink-soft">
                          Share
                        </span>
                      </div>
                      <div className="grid grid-cols-4 gap-2">
                        {[
                          "Messages",
                          "Mail",
                          "Twitter",
                          "Notes",
                        ].map((s) => (
                          <div
                            key={s}
                            className="flex flex-col items-center gap-1.5 rounded-xl bg-background p-2 opacity-50"
                          >
                            <div className="h-9 w-9 rounded-lg bg-muted" />
                            <span className="text-[10px] text-ink-soft">
                              {s}
                            </span>
                          </div>
                        ))}
                        {/* Clipnote — highlighted */}
                        <div className="relative flex flex-col items-center gap-1.5 rounded-xl bg-background p-2 ring-2 ring-ink">
                          <div className="absolute -top-1.5 right-1.5 inline-flex h-4 w-4 items-center justify-center rounded-full bg-ink text-paper">
                            <Sparkles size={9} strokeWidth={2.5} />
                          </div>
                          <div className="inline-flex h-9 w-9 items-center justify-center rounded-lg bg-ink">
                            <Sparkles
                              size={16}
                              className="text-paper"
                              strokeWidth={1.8}
                            />
                          </div>
                          <span className="text-[10px] font-medium text-ink">
                            Clipnote
                          </span>
                        </div>
                      </div>
                    </div>
                  </div>
                </div>
                <p className="mt-4 text-center text-[12px] text-ink-soft/80">
                  <Share size={11} className="mr-1 inline" strokeWidth={2} />
                  Share → Clipnote
                </p>
              </div>
            </div>
          </div>
        </section>

        {/* FINAL CTA --------------------------------------------------- */}
        <section className="relative px-6 py-24 sm:py-32">
          <div className="mx-auto max-w-[1100px]">
            <div className="relative overflow-hidden rounded-3xl border border-border bg-card px-6 py-16 text-center shadow-[0_40px_80px_-40px_oklch(0.18_0.02_50/0.25)] sm:px-12">
              {/* faint warm wash */}
              <div
                aria-hidden
                className="absolute inset-0 -z-10 opacity-80"
                style={{
                  background:
                    "radial-gradient(80% 60% at 50% 0%, oklch(0.95 0.04 75 / 0.7) 0%, transparent 70%)",
                }}
              />

              <h2 className="font-serif text-[clamp(2rem,4vw,3.25rem)] leading-[1.05] tracking-[-0.01em] text-ink">
                Stop hoarding links.
                <br />
                <span className="italic">Start using them.</span>
              </h2>

              <div className="mx-auto mt-10 max-w-[620px]">
                <PasteBar onTry={onTry} size="lg" />
              </div>

              <p className="mt-10 font-serif text-[15px] italic text-ink-soft">
                A commonplace book for the modern web.
              </p>
            </div>
          </div>
        </section>

        {/* FOOTER ----------------------------------------------------- */}
        <footer className="px-6 pb-10 pt-4">
          <div className="mx-auto flex max-w-[1180px] flex-col items-center gap-3 border-t border-border/70 pt-8 text-center sm:flex-row sm:justify-between sm:text-left">
            <div className="inline-flex items-center gap-2.5">
              <span className="inline-flex h-6 w-6 items-center justify-center rounded-md bg-ink text-paper">
                <Sparkles size={13} strokeWidth={2} />
              </span>
              <span className="font-serif text-[18px] tracking-tight text-ink">
                Clipnote
              </span>
            </div>
            <p className="text-[12px] text-ink-soft/85">
              Clipnote · clipnote.web.app · © 2026
            </p>
          </div>
        </footer>
      </div>
    </div>
  );
}
