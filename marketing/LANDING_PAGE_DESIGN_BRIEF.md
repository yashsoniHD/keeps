# Clipnote Landing Page — Design Brief for Claude

> **How to use this file:** paste the whole thing into Claude (design/artifact mode). It contains the
> exact prompt, final copy, the live design tokens, the visual direction, and a section-by-section spec.
> Attach the icon PNGs listed in §10 as reference. Ask Claude to output a **single self-contained React +
> Tailwind component** (so it ports straight into the existing app) OR a single HTML file if you want a
> standalone preview first. Everything here is final — Claude should *not* invent copy, colors, or layout.

---

## §1 The prompt (paste this as your instruction)

> Build a high-end, production-grade **marketing landing page** for **Clipnote**, a web app that turns any
> saved link into a clean, AI-structured note you'll actually re-read — and lets you chat across your whole
> library. Output **one self-contained React component using Tailwind CSS** (inline the design tokens in §4 as
> CSS variables on a wrapper, use them via `style`/arbitrary values; assume Inter + Instrument Serif are loaded
> via Google Fonts). It must be **responsive** (mobile-first, single column on phones → multi-column on desktop)
> and support **light + dark mode** via a `.dark` class toggling the CSS variables.
>
> Aesthetic: **editorial / "commonplace book" / premium stationery** — warm paper background, near-black ink,
> large Instrument Serif display headings, generous whitespace, soft shadows, subtle depth. Think *Linear's
> restraint × Notion's warmth × mymind's "show the real product" hero*. NOT neon-tech, NOT generic SaaS gradients,
> NO emoji-as-decoration, NO stock illustrations.
>
> Use the **exact copy in §3** (don't rewrite it), the **exact tokens in §4**, the **section layout in §6**, and
> render the **example note cards in §7** as real card components (this is the hero visual — show the product, not
> an abstract graphic). The primary CTA is a **"paste-to-try" bar** (§6 Hero) — wire its button to a placeholder
> `onTry(url)` handler with a comment; I'll connect it to real sign-in later.

---

## §2 Product in one paragraph (context for tone, not for copying verbatim)

Clipnote lets you paste any link — a recipe reel, a product page, a long article, a YouTube video — and AI
rebuilds it into a clean, structured note (ingredient + step cards, spec tables, TL;DRs, day-by-day itineraries),
each with a cover image. Then **Clip AI** lets you ask your whole saved library questions and consolidate many
notes into one ("build an itinerary from my saved Tokyo links", "meal-plan my saved recipes"). It's a web app
(PWA, installs like native; saves from any phone's share sheet), free to start, Google sign-in. The promise:
your saved links stop being a graveyard and become a library you actually use. Voice = calm, literary, specific,
witty — never hype-y. Live at **clipnote.web.app**.

---

## §3 Final copy (use exactly — every section)

**Brand:** Clipnote (one word). Logo mark = a sparkle/Sparkles glyph in a rounded square (ink fill, paper glyph).

### Header
- Wordmark: **Clipnote** (Instrument Serif)
- Nav button (right): **Sign in**

### Hero
- Eyebrow (small, uppercase, tracked): **YOUR LINKS, FINALLY WORTH RE-READING**
- Headline (Instrument Serif, very large): **Your bookmarks are a graveyard.**
  **Clipnote brings them back to life.**
- Subhead: **Paste any link — a reel, an article, a recipe, a product — and AI rebuilds it into a clean,
  structured note you'll actually re-read. Then ask Clip AI anything across everything you've saved.**
- Paste-to-try bar: input placeholder **"Paste any link: article, reel, recipe, product…"** + button **"Try it free"**
- Trust line (small, under the bar): **Free to start · Sign in with Google · No card**

### Section: The bookmark graveyard (problem-agitation — place right after the hero)
- Eyebrow (uppercase, tracked): **THE BOOKMARK GRAVEYARD**
- Heading (Instrument Serif): **You already save everything. You just never go back.**
- Subcopy: **Instagram's "Saved." X "Bookmarks." YouTube "Watch Later." Amazon "Save for later." Every app
  has a place where links go to be forgotten. Clipnote is the one place a save becomes something you'll
  actually use.**
- Platform "save" chips — render each as a small, **muted / desaturated / faded** card (the graveyard look:
  low opacity, gray brand glyph, dusty), showing the brand icon + platform name + that platform's *real*
  save-feature label:
  - Instagram — "Saved"
  - X — "Bookmarks"
  - YouTube — "Watch Later"
  - Amazon — "Save for later"
  - TikTok — "Favorites"
  - Reddit — "Saved"
  - Pinterest — "Pins"  *(optional, if space)*
  - WhatsApp — "Starred"  *(optional, if space)*
- Punchline / transition line: **Save it to Clipnote instead.**

### Section: See it in action
- Section heading: **One paste. A note worth keeping.**
- Subcopy: **Clipnote reads the source and rebuilds it — structured, skimmable, and better than the original.**
- (Visual = the note-card grid from §7 + one expanded recipe card.)

### Section: How it works
- Heading: **From link to library in three steps.**
- Step 1 — **Paste a link** — "From the web or any app's share sheet. Articles, reels, videos, recipes, products — anything with a URL."
- Step 2 — **AI rebuilds it** — "Clipnote extracts the substance and structures it: ingredients and steps, spec tables, key points, itineraries — with a cover image."
- Step 3 — **Re-read & ask anything** — "Your notes become a library. Ask Clip AI to summarize, compare, or consolidate everything you've saved."

### Section: Clip AI (the differentiator)
- Eyebrow: **MEET CLIP AI**
- Heading: **Ask your links anything.**
- Body: **Most bookmark tools just store the page. Clipnote understands it — so you can talk to your whole
  library. Clip AI knows what you saved and turns it into something new.**
- Example prompts (render as chat-style chips/bubbles):
  - "Build a 3-day itinerary from everything I saved about Tokyo."
  - "Make a meal plan from my saved recipes, with a grocery list."
  - "Compare the three laptops I clipped this week."
  - "Summarize everything I saved today."

### Section: Use cases
- Heading: **For everything you save.**
- Tiles (icon + label + one line):
  - **Recipes** — "Messy reels and blog walls become clean, cookable cards."
  - **Articles** — "Long reads become a TL;DR, key points, and the quotes worth keeping."
  - **Products** — "Price, specs, pros and cons — ready to compare."
  - **Travel** — "Scattered links become a day-by-day plan."
  - **Workouts** — "Routines structured into sets, reps, and form notes."
  - **Anything else** — "New to Clipnote? It invents the right format on the fly."

### Section: Capture anywhere
- Heading: **Saving should be a reflex.**
- Body: **Install Clipnote and it joins your phone's share sheet. See something worth keeping? Share → Clipnote.
  One tap, from any app, and it's a note before you've closed the tab.**

### Final CTA
- Heading: **Stop hoarding links. Start using them.**
- Paste-to-try bar (repeat) + button **"Try it free"**
- Footer line (small, italic-serif): **A commonplace book for the modern web.**
- Footer meta: **Clipnote · clipnote.web.app · © 2026**

---

## §4 Design tokens (THE live app values — match exactly)

Define on a wrapper as CSS variables; `.dark` overrides them. oklch values are authoritative (this is what the
app ships); hex are close approximations for tools that don't do oklch.

**Fonts**
- Display / headings: **Instrument Serif** (`letter-spacing: -0.01em`). Google Fonts.
- Body / UI: **Inter** (with `font-feature-settings: "ss01","cv11"`). Google Fonts.

**Radii** (base `--radius: 1rem`/16px): sm 12px · md 14px · lg 16px · xl 20px · 2xl 24px · 3xl 28px.
Cards use 2xl–3xl, the paste bar + buttons are fully rounded (pill).

**Light mode**
| Token | oklch | ~hex | Use |
|------|-------|------|-----|
| paper / background | `oklch(0.98 0.012 80)` | `#FAF6EE` | page background (warm off-white) |
| ink / foreground | `oklch(0.18 0.02 50)` | `#221C17` | primary text |
| ink-soft | `oklch(0.45 0.02 60)` | `#6E665C` | secondary text |
| card | `oklch(1 0 0)` | `#FFFFFF` | card surfaces |
| muted / secondary | `oklch(0.95 0.012 75)` | `#F1ECE3` | subtle fills |
| accent | `oklch(0.93 0.02 70)` | `#EBE3D6` | hover/soft fills |
| border | `oklch(0.9 0.012 75)` | `#E8E2D8` | hairlines |
| primary (button bg) | = ink | `#221C17` | CTA background |
| primary-foreground | = paper | `#FAF6EE` | CTA text |

**Dark mode** (neutral jet — chroma 0)
| Token | oklch | ~hex |
|------|-------|------|
| paper / background | `oklch(0.14 0 0)` | `#141414` |
| ink / foreground | `oklch(0.96 0 0)` | `#F2F2F2` |
| ink-soft | `oklch(0.70 0 0)` | `#A6A6A6` |
| card | `oklch(0.18 0 0)` | `#1F1F1F` |
| muted/secondary | `oklch(0.23 0 0)` | `#2B2B2B` |
| accent | `oklch(0.26 0 0)` | `#333333` |
| border | `oklch(1 0 0 / 10%)` | white @10% |

**Type-accent palette** (each note category has a color; use for card dots/chips/icons). Light base / dark base:
| Category | Light oklch | ~hex | Dark oklch | meaning |
|---|---|---|---|---|
| recipe | `0.62 0.16 38` | `#C25C3E` | `0.72 0.15 38` | terracotta |
| itinerary | `0.55 0.09 155` | `#588C6E` | `0.70 0.11 155` | sage |
| product | `0.48 0.14 265` | `#4F4FB3` | `0.68 0.14 265` | indigo |
| summary | `0.65 0.13 75` | `#BB8A2C` | `0.76 0.13 80` | amber |
| media | `0.52 0.16 330` | `#A53E84` | `0.70 0.16 330` | plum |
| tech | `0.52 0.11 230` | `#3A78A6` | `0.70 0.12 230` | steel blue |
| business | `0.5 0.09 195` | `#297E84` | `0.68 0.10 195` | deep teal |
| health | `0.55 0.15 10` | `#C2495A` | `0.72 0.15 10` | rose |

Each accent has a `-soft` tint (pale fill in light mode; dark low-chroma tint in dark mode) used as chip
backgrounds, e.g. recipe-soft light `oklch(0.94 0.04 40)`, dark `oklch(0.30 0.05 40)`.

**Texture & depth**
- Optional **paper grain** on the background: two faint radial-dot gradients —
  `radial-gradient(oklch(0.5 0.02 60 / 0.04) 1px, transparent 1px)` at `3px 3px` + a second at `7px 7px`.
- Shadows: soft and low — cards lift on hover (`translateY(-2px)` + a soft `shadow-lg`), the paste bar gets
  `shadow-md` on focus-within. Avoid hard/black drop shadows.

---

## §5 Visual direction & references (condensed design study)

Borrow these specific moves:
- **mymind** → hero *is* the product: show real note cards, not an illustration.
- **Linear** → one headline, one CTA, lots of air, restrained palette, subtle gradient/grain depth.
- **Raycast / Arc** → show the app in a soft frame with a big gentle shadow (premium, tactile).
- **Stripe / Vercel** → alternating feature rows (text ↔ visual); CTA repeated at hero, mid, footer.
- **Superhuman** → a single "magic moment": messy link → clean note (this is the See-it-in-action section).
- **Notion** → use-case tiles so visitors self-identify.
- **Readwise / Mintlify** → editorial type scale; it should read like a publication.

Clipnote's unfair advantage is that its real UI is already beautiful and *warm* — most competitors are cold.
Lean into the paper-and-ink editorial identity hard; that's the differentiation.

---

## §6 Section-by-section layout spec

1. **Header** — sticky, transparent→paper on scroll. Left: sparkle mark + "Clipnote". Right: "Sign in" (text
   button). Slim, generous side padding, max-width ~1100–1200px content column centered.
2. **Hero** — centered, tall. Eyebrow → big serif headline (2 lines) → subhead (max ~60ch) → paste-to-try pill
   bar (prominent, the focal point) → trust line. Behind/below: a soft hint of the note grid peeking up, or a
   subtle paper-grain + radial warm glow. Keep it calm; one focal CTA.
2b. **The bookmark graveyard** (immediately after the hero) — eyebrow + serif heading + subcopy, then a
   **convergence visual** that is the whole point: on the **left**, a loose grid of 6–8 platform "save" chips
   rendered **muted, desaturated, low-opacity** (the graveyard — gray brand glyphs, faded, slightly dusty),
   each labeled with the platform + its real save-feature name (Instagram/Saved, X/Bookmarks, YouTube/Watch
   Later, Amazon/Save for later, TikTok/Favorites, Reddit/Saved…). Converging **arrows or a subtle funnel**
   flow rightward into a **single vibrant Clipnote note card** (full color, soft lift, the recipe example from
   §7). The contrast *is* the message: dead saves on the left, a living note on the right. Close with the line
   **"Save it to Clipnote instead."** On mobile, stack vertically: the chips grid on top → a downward arrow →
   the Clipnote card below. (A rendered concept of this section exists — match its spirit, elevated to the full
   brand palette.)
3. **See it in action** — heading + subcopy, then the **note-card grid** (§7) in a soft "device frame" or just
   floating with shadow; on desktop show 3 across, plus **one expanded recipe card** beside/below to reveal depth.
4. **How it works** — 3 columns (stack on mobile), each: a small numbered ink circle, a lucide icon, bold title,
   one line. Connected by a faint line on desktop.
5. **Clip AI** — two-column on desktop: left = eyebrow + heading + body; right = a faux chat panel showing the
   example prompts as user bubbles with one short AI reply rendered as a mini note/itinerary preview. This is the
   "wow"; give it room and a tasteful accent.
6. **Use cases** — heading + a 6-tile grid (2×3 desktop, 1-col mobile). Each tile: type-accent icon in a soft chip,
   label, one line. Use the accent colors from §4 so the grid is colorful but controlled.
7. **Capture anywhere** — two-column: copy + a simple phone/share-sheet illustration or a clean mock of "Share →
   Clipnote". Keep minimal.
8. **Final CTA** — full-width warm band (slightly darker paper or an ink panel in dark mode), big serif heading,
   repeated paste-to-try bar, then the footer.

---

## §7 Example note cards (render these as real components — they're the hero visual)

Each card: white (light) / `#1F1F1F` (dark) surface, `rounded-2xl`, hairline border, soft hover lift. Top: a
type **chip** (soft accent bg + accent text) with a lucide icon + label, and a small date. Then a serif **title**
(2-line clamp), a 2–3 line **summary** in ink-soft, and a footer row with a source favicon + domain. If a cover
image is present, show it as a rounded top thumbnail; otherwise a soft accent gradient placeholder with the type icon.

Use these 6 mock notes (mix of types so the accent system shows):

```json
[
  { "type": "recipe", "icon": "ChefHat", "label": "Recipe", "title": "One-Pan Lemon Garlic Butter Salmon",
    "summary": "A 20-minute weeknight salmon: seared, then finished in a lemon-garlic butter pan sauce. Serves 2.",
    "domain": "instagram.com" },
  { "type": "itinerary", "icon": "MapPin", "label": "Itinerary", "title": "3 Days in Lisbon, Slowly",
    "summary": "Alfama mornings, a Belém afternoon, and where to catch sunset over the Tagus — paced for wandering, not rushing.",
    "domain": "youtube.com" },
  { "type": "product", "icon": "ShoppingBag", "label": "Product", "title": "Sony WH-1000XM5 Headphones",
    "summary": "Class-leading noise cancelling and 30h battery. Pros: comfort, ANC. Cons: don't fold, pricey.",
    "domain": "amazon.com" },
  { "type": "summary", "icon": "FileText", "label": "Summary", "title": "Why We Sleep — The 20-Minute Version",
    "summary": "The case for 8 hours, what happens when you skip them, and the small habits that fix most sleep.",
    "domain": "nytimes.com" },
  { "type": "tech", "icon": "Cpu", "label": "Software", "title": "A Practical Guide to RAG in 2026",
    "summary": "Chunking, hybrid retrieval, and when to skip vectors entirely — distilled into the decisions that matter.",
    "domain": "github.com" },
  { "type": "health", "icon": "Dumbbell", "label": "Workout", "title": "Beginner Full-Body Dumbbell Routine",
    "summary": "Three days a week, six moves, progressive sets and reps — with form cues for each.",
    "domain": "tiktok.com" }
]
```

**Expanded recipe card** (to show structured depth) — render with these fields:
- Title: **One-Pan Lemon Garlic Butter Salmon** · stats row: **Time 20 min · Serves 2 · Easy**
- Ingredients (list): 2 salmon fillets · 3 tbsp butter · 4 cloves garlic, minced · 1 lemon (juice + zest) ·
  Salt & pepper · Fresh parsley
- Method (numbered): 1) Pat salmon dry, season. 2) Sear skin-side down 4 min. 3) Flip, add butter + garlic,
  baste 3 min. 4) Add lemon juice + zest, spoon over. 5) Finish with parsley; serve.

---

## §8 The paste-to-try bar (primary CTA component)

A fully-rounded pill: left a `Link2` lucide icon (ink-soft), a flush text input (placeholder from §3), and a
right ink-filled pill button "**Try it free**" with an `ArrowRight` icon. Border hairline; `focus-within` adds a
soft shadow. On submit, call a placeholder `onTry(url)` (leave a `// TODO: wire to sign-in + ingest` comment).
Appears in the Hero and Final CTA. On mobile it stays comfortably tappable (button min 44px tall; input ≥16px font).

---

## §9 Responsive & a11y
- Mobile-first: single column; hero headline scales down but stays serif; grids collapse to 1 col; CTA full-width.
- Desktop content max-width ~1100–1200px, centered, generous side gutters.
- Honor `prefers-color-scheme` for first paint; support a `.dark` class toggle.
- Real semantic headings (h1 → h2…), sufficient contrast (ink on paper passes AA), focus rings on interactive
  elements (use the `--ring` token), `alt` text on images, respects `prefers-reduced-motion` for any animation.

---

## §10 Assets to attach / reference
From `frontend/public/`:
- `icon-512.png` / `icon-192.png` — the Clipnote app icon (use as the favicon/og reference; the in-page mark can
  be a lucide `Sparkles` in an ink rounded square to stay crisp at any size).
- `apple-touch-icon.png`.
Lucide icons used: `Sparkles, Link2, ArrowRight, ChefHat, MapPin, ShoppingBag, FileText, Cpu, Dumbbell,
Compass, Share` (load from `lucide-react`).
Live meta/OG copy already set for the root URL (see `frontend/index.html`) — the page lives at `/`.

---

## §11 Do NOT
- Don't invent users, counts, testimonials, press, ratings, or funding. We're early — example *outputs* are the
  proof, not fake logos.
- Don't promise features we don't have: no browser extension, no team/collab mode, no Android native app, no
  offline AI. (We have: web PWA, iOS/Android share sheet, Clip AI chat, public shareable notes.)
- Don't drift from the palette into neon gradients, glassmorphism, or generic-SaaS hero blobs.
- Don't rewrite the §3 copy or the §4 tokens.
- Keep emoji out of the UI chrome (a single tasteful sparkle mark is the only "icon as brand" element).

---

*Pair this with `marketing/CLIPNOTE_MARKETING.md` for full brand voice, positioning, and the broader launch plan.
Once Claude returns a design you like, hand it back here and I'll port it into `frontend/src/` and wire the
paste-to-try CTA to real Google sign-in + ingest, then deploy.*
