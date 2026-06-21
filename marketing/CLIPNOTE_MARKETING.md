# Clipnote — Marketing Context & Master Brief

> **Purpose of this file:** a single source of truth that any AI assistant (Claude, Gemini, ChatGPT, etc.)
> can be handed to generate on-brand marketing — posts, threads, scripts, ad copy, landing pages,
> launch assets. Paste the whole file, or the relevant section, into the assistant before asking for output.
>
> **Goal this brief serves:** grow from ~10 users to **1,000 users in 2 weeks** via a coordinated launch
> (Product Hunt + Show HN + Reddit + creator content) plus a built-in viral loop (public notes).
>
> **Author's honest framing:** 1,000 signups in 14 days is a *stretch* goal, not a baseline. It is
> achievable only if at least one discovery channel "hits" (PH top-5 OR HN front page OR a viral Reddit
> post) AND the funnel doesn't leak. See **§14 Targets & math** and **§15 Launch readiness** — read both
> before spending a rupee or an hour. Especially §15: a successful launch with the current cost caps will
> *break the app for new users*. Fix that first.

---

## §0 How an AI assistant should use this file

When asked to produce marketing for Clipnote:
1. **Match the voice** in §4. Never sound like generic SaaS ("Unlock the power of…", "Revolutionize…").
2. **Lead with the pain, then the payoff** (§5). Name the enemy (the bookmark graveyard) before the feature.
3. **Always surface the two differentiators** that competitors lack: *the note is better than the source*
   and *Clip AI lets you ask your saved links anything* (§3).
4. **Shift register per platform** (§10). The HN line and the Instagram line are different sentences.
5. **Never invent metrics, testimonials, press, funding, or user counts.** We have ~10 users. Do not
   fabricate social proof. If social proof is needed, use honest "early / just launched / built solo" framing.
6. **Use the real URL:** https://clipnote.web.app — and the real brand spelling **Clipnote** (one word,
   lowercase "n"). Internal docs say "Clip Note"; the public brand is **Clipnote**.

---

## §1 Product snapshot

**One sentence:** Clipnote turns any link you save — a recipe reel, a product page, a long article, a
YouTube video — into a clean, structured note you'll actually re-read, and lets you *chat across everything
you've saved*.

**The 10-second pitch:** Paste a link. AI rebuilds it as a beautiful structured note (ingredients + steps,
spec table, TL;DR + key points, day-by-day itinerary). Then ask Clip AI things like *"build an itinerary
from everything I saved about Goa"* or *"make a meal plan from my saved recipes."*

| Fact | Value |
|------|-------|
| Live app | https://clipnote.web.app |
| Platforms | Web (PWA — installs like a native app), iOS (Share Sheet via Shortcut), Android (share target) |
| Sign-in | Google, one tap |
| Price | Free today (paid tiers planned — see §15) |
| Input types | Articles, YouTube/video, Instagram reels, TikTok, recipes, products (Amazon etc.), Reddit, Twitter/X, any URL |
| Output | Typed notes: Recipe, Itinerary, Product, Summary, Workout + open-ended AI-invented types, each with a cover image |
| AI layer | **Clip AI** — query-aware chat/RAG across your notes; consolidates many notes into one artifact (itinerary, meal plan + grocery list, comparison table, checklist); can create a new note from a conversation |
| Sharing | Any note → public link (`/p/{id}`) anyone can view and one-tap save |

---

## §2 What Clipnote actually does (feature truth — don't overclaim beyond this)

- **Capture anywhere:** paste in-app, or use the phone Share Sheet from any app (IG, YouTube, browser).
- **AI extraction:** scrapes/reads the source and produces *structured data*, not a clipped copy —
  e.g. a recipe reel becomes an ingredient list + numbered steps + time/servings; an article becomes
  TL;DR + key points + pull quotes; a product page becomes price + spec table + pros/cons.
- **Cover image** auto-pulled (or a clean gradient hero fallback) so the feed looks like a magazine, not a list.
- **Open-ended types:** the AI invents new note categories on the fly (e.g. "workout", "skincare routine"),
  so it isn't limited to a fixed template set.
- **Clip AI (the moat):** ask natural questions over your library. It routes intelligently — temporal
  ("what did I save today"), exhaustive ("all my recipes"), semantic ("that article about sleep"), and can
  **consolidate** multiple notes into a brand-new artifact you save as its own note.
- **Re-read surface:** a real-time feed, search, categories, annotations, shareable public notes.

**Do NOT claim:** offline AI, team collaboration, browser extension (it's a PWA/share-sheet), Android native
app, or any integration not listed above.

---

## §3 The differentiators (the moat — put these in every campaign)

1. **"The note is better than the source."** Most savers (Pocket, Raindrop, browser bookmarks) save *the page*.
   Clipnote saves *the understanding* — restructured, skimmable, re-readable. This is the wedge.
2. **"Ask your links anything." (Clip AI)** No mainstream bookmark/read-later tool lets you chat across your
   saved library and synthesize new artifacts from it. This is the unfair advantage. **Lead demos with it.**
3. **Capture is a reflex.** Share Sheet on iOS/Android + PWA means saving is one tap from any app — no copy-paste,
   no context switch.

---

## §4 Brand & voice

**Personality:** calm, literary, a little nerdy; the opposite of hype-y growth-bro SaaS. Think *"a commonplace
book for the modern web"* — a tool for people who love ideas and hate losing them.

**Voice rules:**
- Plain, confident, specific. Short sentences. Concrete nouns (recipe, reel, itinerary), not abstractions.
- Wit over hype. A dry joke beats an exclamation mark.
- Show, don't adjective. "Paste a messy IG reel, get a clean recipe card" > "powerful AI extraction."
- Lowercase-friendly, em-dashes welcome, no emoji spam (1 purposeful emoji max in social copy; none in HN).

**Words/phrases that are ON-brand:** bookmark graveyard, save the link / keep the knowledge, commonplace book,
notes you'll actually re-read, ask your links, second brain (use sparingly — it's overused), clip it.

**Words to AVOID:** revolutionary, unlock, supercharge, game-changer, seamless, leverage, "in today's
fast-paced world", 🚀 as punctuation, fake urgency.

**Visual identity:** warm paper background (`#faf6ee` light), near-black ink (`#141414`/`#1c1917` dark),
serif display type (Instrument Serif) + clean sans body, sparkle mark. Aesthetic = *editorial / stationery*,
not neon-tech. Keep marketing visuals in this palette.

---

## §5 Positioning & messaging hierarchy

**Category we play in:** read-it-later / bookmarking — but reframed as **"a second brain that reads for you."**

**The enemy:** the bookmark graveyard — hundreds of saved links you never reopen.

### Master one-liner (use as default)
> **Your bookmarks are a graveyard. Clipnote turns every saved link into a note you'll actually re-read — and lets you ask them anything.**

### Tagline options (A/B these)
- Bookmarks go to die. Clips come back to life.
- Save the link. Keep the knowledge.
- Your links, finally worth re-reading.
- A commonplace book for the modern web. *(literary / HN / LinkedIn)*
- Stop hoarding links. Start using them.

### Value-prop ladder (pain → mechanism → payoff)
1. **Pain:** "You save 100 links a month and reopen maybe 3."
2. **Mechanism:** "Clipnote runs each link through AI and rebuilds it as a structured note — recipe cards,
   spec tables, TL;DRs — with a cover image."
3. **Payoff:** "Now your saves are a library you actually use. Ask Clip AI to turn 8 saved Goa links into one
   itinerary, or your saved recipes into a week's meal plan."

### Audience-specific angles
| Audience | Hook |
|----------|------|
| Pocket / read-it-later refugees | "Pocket is gone. Your links don't have to be. Clipnote is where they go next — and it's smarter." |
| Recipe hoarders | "Every recipe you saved from Instagram, finally in one clean, cookable card. Then: 'meal-plan my saved recipes.'" |
| Trip planners | "Saved 12 links about Tokyo? Clip AI turns them into a day-by-day itinerary." |
| Knowledge workers / PKM crowd | "A commonplace book that structures what you read and lets you query it." |
| Online shoppers | "Paste an Amazon link, get a clean spec + pros/cons card. Compare saved products side by side." |

---

## §6 Copy analysis of current live app (findings + rewrites)

**What's shipped now:**
- Title: *"Clipnote: your AI notes from anywhere on the web"*
- Login/meta: *"Reels, videos, products, articles: saved as structured notes you'll actually re-read."*
- OG: *"A commonplace book for the modern web. Paste a link, get a structured note."*
- Public note CTA: *"Save this note to your Clipnote." / "Sign up to save"*
- Paste bar: *"Paste any link: article, reel, recipe, product…"*
- Onboarding: *"Welcome to Clipnote — Three steps to make capture a reflex."*

**Findings:**
1. ✅ **"Notes you'll actually re-read"** is a strong, consistent value prop. Keep it.
2. ✅ **"Commonplace book for the modern web"** is distinctive and ownable. Keep for literary channels.
3. ❌ **Clip AI is absent from all marketing copy.** Biggest miss. The chat/consolidation feature is the moat
   and it's invisible. Add it to the title/OG/landing hero.
4. ❌ **No pain framing.** All feature, no enemy. Cold traffic won't feel why they need it. Add the "bookmark
   graveyard" angle to top-of-funnel surfaces.
5. ⚠️ **Public-note CTA is functional but not persuasive.** "Sign up to save" → make it sell the outcome.
6. ⚠️ **No viral attribution on public notes.** Every shared note should carry a tasteful "Made with Clipnote —
   start your own" so each share is an ad. (Confirm whether this exists; if not, it's the cheapest growth win.)

**Suggested rewrites:**
- **Title tag:** "Clipnote — turn any link into a note you'll re-read, then ask it anything"
- **Meta description:** "Paste a reel, article, recipe, or product. Clipnote rebuilds it as a clean, structured
  note — and Clip AI lets you ask your whole library questions. Free."
- **OG title:** "Clipnote: your links, finally worth re-reading"
- **Public-note sticky CTA:** "Like this note? Clipnote turns *your* links into ones like it. Save this + start free →"
- **Public-note footer (NEW, viral loop):** "✦ Made with Clipnote — paste any link, get a note like this. clipnote.web.app"

---

## §7 ICP, personas & beachhead

**Core ICP:** a chronic link-saver — someone who sends themselves dozens of articles/reels/recipes/products a
month and loses them in tabs, bookmarks, WhatsApp "saved messages," or IG collections.

**Three personas (ranked by launch priority):**
1. **The read-it-later refugee** (highest intent, *actively searching now* post-Pocket shutdown). PKM-curious,
   on Reddit/HN/X. → Lead acquisition channel.
2. **The recipe hoarder** (highest "wow" from the demo; huge, visual, shareable). On Instagram/Facebook/Pinterest.
   → Lead content channel.
3. **The trip planner** (best Clip AI demo). On Reddit travel subs, IG, in WhatsApp groups.

**Beachhead decision:** *acquire* via #1 (refugees, searching), *demo* via #2 and #3 (visual wow). One message
can't serve all three at once — pick per channel using §5's audience table.

---

## §8 Competitive landscape & live wedges

| Competitor | What they do | Where Clipnote wins |
|-----------|--------------|---------------------|
| Pocket (shut down by Mozilla, 2025) | Read-later, save articles | They're gone; Clipnote restructures + adds AI chat |
| Raindrop.io | Beautiful bookmark manager | Saves the page; Clipnote saves the *understanding* + Clip AI |
| Instapaper | Read-later, text-only | No structuring, no AI query, no recipes/products/video |
| MyMind | AI-tagged visual bookmarks | No restructuring into typed notes, no consolidation chat |
| Readwise Reader | Power-reader, highlights | Heavier/paid/power-user; Clipnote is one-tap simple + reframes content |
| Notion / Apple Notes | Manual notes | You do the work; Clipnote does it for you from a raw link |

**Timely wedges to exploit (free demand):**
- **Pocket shutdown** → people are *actively* searching "Pocket alternative / where do my saved links go now."
  Be present in those threads and searches (Reddit, HN, X, Google).
- **AI fatigue with chatbots** → "I don't want another chatbot, I want my own stuff to be useful" — Clip AI is
  grounded in *your* library, not the open web. That's a differentiator worth stating.

---

## §9 Landing page plan

Today the entry point is a bare login screen. For a launch driving cold traffic, you want a **dedicated
landing page** (can live at `/` for logged-out users, or a marketing route) before the Google sign-in wall.
Cold visitors must *see the value* before being asked to authenticate.

**Page structure (top to bottom):**

1. **Hero**
   - Headline: *"Your bookmarks are a graveyard. Clipnote brings them back to life."*
   - Subhead: *"Paste any link — reel, recipe, article, product. Get a clean, structured note you'll actually
     re-read. Then ask Clip AI anything across everything you've saved."*
   - Primary CTA: **"Start free with Google"** · Secondary: "See it in action" (scrolls to demo)
   - Hero visual: a real before→after (messy IG reel → clean recipe card). Static + autoplay muted loop.

2. **The "magic moment" demo strip** (3 GIFs/clips, the core of the page)
   - Reel → recipe card
   - 6 travel links → "build my itinerary" (Clip AI)
   - Amazon link → product spec/pros-cons card

3. **"How it works" — 3 steps:** Paste a link → AI rebuilds it → Re-read & ask anything.

4. **Differentiator block:** "Not another bookmark folder" — 2-up: *Better than the source* / *Ask your links*.

5. **Use-case grid:** Recipes · Articles · Products · Travel · Workouts · Anything (each a tiny example card).

6. **Capture-anywhere block:** "Save from any app — one tap." (Share Sheet + PWA install.)

7. **Social proof / honesty block:** Since pre-traction — use "Built by one person. Just launched on Product
   Hunt." + a few real example public notes (`/p/{id}`) embedded as proof of output quality. **No fake testimonials.**

8. **FAQ:** Is it free? / What links work? / Is my data private? / Is this another chatbot? (no — grounded in
   your notes) / Pocket import? (state honestly).

9. **Final CTA:** repeat hero CTA. Footer with the "commonplace book" line.

**SEO note:** target "Pocket alternative", "AI bookmark manager", "save links as notes", "chat with my
bookmarks". Put these naturally in H2s and meta.

**Implementation:** keep it in the existing palette (paper/ink/serif). It can be a static section rendered for
logged-out users in `frontend/src/routes/index.tsx` or a new `/welcome` route. (Ask me to build it — see end.)

---

## §10 Channel playbooks

> For each channel: who's there, the angle, format, cadence, and a ready-to-adapt example. Tone shifts per §4.

### X / Twitter
- **Angle:** build-in-public + the Pocket wedge + demo clips. Founders, indie hackers, PKM nerds live here.
- **Format:** short demo videos (the 15–50s clips), build-in-public threads, reply-guy in "Pocket alternative"
  and PKM conversations.
- **Cadence:** 1–2 posts/day during launch fortnight; reply to 5–10 relevant convos/day.
- **Launch thread example:**
  > I got tired of saving 100 links a month and reopening none.
  >
  > So I built Clipnote: paste any link — a reel, an article, a recipe — and AI rebuilds it into a clean note
  > you'll actually re-read.
  >
  > Then you can ask your whole library questions. Here's what that looks like 👇 [clip]
  >
  > (then 4–6 tweets, each one feature + one clip, ending with the link + "free, would love your take")

### LinkedIn
- **Angle:** the *story* (why you built it) + the knowledge-worker / "commonplace book" framing. Less meme,
  more reflective. Strong for your warm network.
- **Format:** 1 founder story post (text + 1 demo video), then 2–3 follow-ups across the fortnight.
- **Cadence:** 3–4 posts total. Quality over frequency.
- **Example opener:**
  > I save things constantly — articles, recipes, products I'm researching — and I lose almost all of them.
  > Bookmarks are where links go to die.
  >
  > So over the last few weeks I built Clipnote. You paste a link; it becomes a structured note you'll actually
  > re-read. And you can ask your saved library questions, like "summarize everything I saved this week."
  >
  > It's live and free: clipnote.web.app — I'd love your honest feedback.

### Instagram (Reels-first — highest organic-reach surface)
- **Angle:** satisfying before→after transformations. Recipes are the killer format (huge, visual, shareable).
- **Format:** 9:16 Reels, 7–15s, fast cut. Hook in first 1s ("POV: you saved this recipe reel and never made it").
  Trending audio. On-screen text. CTA in caption + pinned comment.
- **Cadence:** 1 Reel/day ideal; minimum 4–5 across the fortnight. Repurpose the same clips to TikTok + YT Shorts + Reels.
- **Reel concepts:**
  1. "I never cook the recipes I save. So I fixed it." (reel → clean card → cook it)
  2. "Planning a trip from 10 saved links in 5 seconds" (Clip AI itinerary)
  3. "Your saved links vs. your saved links on Clipnote" (split screen: messy tabs → tidy feed)
  4. "Paste an Amazon link, watch what happens" (product card)
- **Caption template:** hook line + 1 line of value + "Free on web, link in bio (clipnote.web.app)" + 3–5 niche
  hashtags (#recipesaver #secondbrain #notionalternative #pocketalternative #productivity).

### TikTok / YouTube Shorts
- **Angle:** same Reels content, native re-uploads (don't post the watermarked version). TikTok rewards the
  "POV / oddly satisfying transformation" format heavily.
- **Cadence:** repost every IG Reel here. Near-zero marginal cost, uncorrelated reach.

### Facebook
- **Angle:** Groups, not the feed. Recipe groups, travel-planning groups, "Notion lovers", student/study groups,
  expat groups (trip planning). Value-first; never drive-by spam.
- **Format:** a helpful post ("I made a free tool that turns saved recipe reels into clean cards — sharing in
  case it helps") + reply to "how do you organize saved recipes" threads.
- **Cadence:** 1 group post/day in a *different* relevant group; always read group rules first.

### Reddit (likely your highest-ROI acquisition channel)
- **Angle:** value-first participation, never spam. Two modes: (a) genuinely answer "Pocket alternative?" /
  "how do you save recipes?" threads; (b) one well-crafted Show-and-tell post per relevant sub.
- **Target subs:** r/PKMS, r/productivity, r/Notion, r/datacurator, r/selfhosted (careful — they prefer FOSS),
  r/pocket, r/Cooking & r/recipes (recipe angle), r/travel & r/solotravel (itinerary angle), r/SideProject,
  r/InternetIsBeautiful, r/webdev (build story).
- **Rules:** read each sub's self-promo policy; comment genuinely for days before posting; disclose you built it;
  respond to every comment.
- **Show-and-tell post example (r/SideProject / r/PKMS):**
  > **I built a tool that turns my saved links into AI-structured notes I can chat with**
  >
  > Long-time link hoarder. Bookmarks, IG saves, 200 tabs — never reopened any of it. So I built Clipnote: you
  > paste a link and it rebuilds it as a clean structured note (recipes → ingredient+step cards, articles →
  > TL;DR + key points, products → spec tables). Then there's a chat layer that works across everything you've
  > saved — "make an itinerary from my saved Tokyo links," etc.
  >
  > It's free, web + phone share sheet. Demo: [clip]. Built solo, would genuinely love feedback on what's missing.

### Product Hunt (the launch centerpiece)
- **When:** mid-launch (e.g. Day 4–6), after warming X/Reddit so you have an audience to mobilize hour 1.
- **Prep checklist:**
  - Tagline (60 chars): *"Turn any link into a note you'll re-read — and ask it anything"*
  - Gallery: 1 hero GIF (reel→card), 3–4 feature shots, 1 Clip AI demo, all in brand palette.
  - First comment (maker's story): why you built it + what's genuinely different (Clip AI) + ask for feedback.
  - Line up 15–30 friends/network to engage (comment, not just upvote — PH weights discussion) **in the first 2–3
    hours** and **throughout the day** (don't bunch upvotes — PH flags that).
  - Offer something for hunters (e.g. "PH folks get [perk]" — only if you have one).
  - Launch 12:01am PT; be present *all day* replying to every comment.
- **Goal:** top 5 of the day → typically a few hundred to ~1–2k visitors.

### Hacker News — Show HN (highest-variance, highest-ceiling)
- **When:** a weekday morning US time (Tue–Thu ~8–10am ET), *separate day* from PH to not split your energy.
- **Title:** `Show HN: Clipnote – paste a link, get an AI-structured note you can chat with`
- **Body:** plain, no marketing voice. What it is, why you built it, the tech honestly (FastAPI/Cloud Run/Gemini/
  Firestore + RAG), what's hard (extraction across messy sources), what you want feedback on. HN rewards candor
  and punishes hype.
- **Rules:** post it yourself, don't ask for upvotes (against HN rules — can get you penalized), reply fast and
  humbly, expect skepticism about AI/cost/privacy and answer it straight.
- **Goal:** front page → 5k–30k visitors. Even a modest showing = a strong batch of high-quality signups.

### Other channels worth a slot
- **WhatsApp (warm, India-strong):** 1:1 personal messages with the 50s video to 20–40 people — *not* a broadcast.
  Highest conversion of any channel for early users; do this Day 1.
- **Pinterest:** pin recipe-card outputs (perfect format) linking to public notes / landing. Slow burn, SEO value.
- **Threads / Bluesky:** repost X content; PKM and indie communities are active.
- **Indie/PKM communities:** Indie Hackers, relevant Discords/Slacks (PKM, Notion, productivity), dev.to build post.
- **Directories:** AlternativeTo (list as a Pocket/Raindrop alternative), BetaList, SaaSHub, There's An AI For That,
  Futurepedia — submit once; ongoing discovery traffic.

---

## §11 Two-week day-by-day plan

> Assumes one person + AI tools. Front-loads asset creation, mid-loads the big launches, back-loads
> amplification + iteration. Adjust PH/HN days to weekdays.

**Pre-flight (Day 0 — do before anything):** read §15 and confirm launch readiness (cost caps, graceful
degradation, landing page, public-note viral footer, analytics events firing). **Do not launch into a broken funnel.**

### Week 1 — build assets, seed warm, test message
- **Day 1:** Lock positioning (§5). Rewrite live copy (§6). Send 20–40 personal WhatsApp/DM notes with the video.
  Submit to AlternativeTo/BetaList/SaaSHub directories.
- **Day 2:** Record the 3 core demo clips (reel→recipe, links→itinerary, Amazon→product). Set up IG/TikTok/YT
  Shorts accounts if not done. Ship the landing page (or at least the hero + demo strip).
- **Day 3:** Post LinkedIn founder story. Post first X build-in-public thread. Start genuine Reddit commenting
  (no promo yet) in 3–4 target subs.
- **Day 4:** First IG Reel + TikTok + YT Short (recipe transformation). First value-first Reddit show-and-tell in
  r/SideProject. Reply to everything.
- **Day 5:** Reel #2 (Clip AI itinerary). X demo clip. Begin PH assets (gallery, tagline, first comment draft).
  Line up PH supporters.

### Week 2 — launch spikes + amplify
- **Day 6 (PH launch day):** Go live 12:01am PT. All-day presence, reply to every comment. Mobilize warm network
  to comment through the day. Cross-post the PH link to X/LinkedIn/relevant communities.
- **Day 7:** Ride PH momentum — recap post on X/LinkedIn ("we launched, here's what happened"). Reel #3.
- **Day 8 (Show HN day — weekday AM ET):** Post Show HN. Be present all day, answer skeptics honestly. Do **not**
  cross-promote it asking for upvotes.
- **Day 9:** Reddit show-and-tell in 2 more subs (recipe sub + travel sub, niche-matched). Reel #4. Facebook group post.
- **Day 10:** Pinterest pins of recipe cards. Threads/Bluesky reposts. Reply-guy day on X in PKM/Pocket threads.
- **Day 11:** Second LinkedIn post (a specific use-case story). Reel #5. Submit to remaining AI directories.
- **Day 12:** Outreach to 3–5 micro-creators/newsletters in cooking/PKM/productivity for a mention or collab.
- **Day 13:** Whatever channel pulled hardest → double down with 2–3 more posts in that format.
- **Day 14:** Retrospective: pull analytics (signups by source, activation rate, where they drop). Decide what to
  keep running past the sprint. Update this file with what worked.

---

## §12 Asset checklist (make once, reuse everywhere)

- [ ] 3 core demo clips (reel→recipe, links→itinerary, Amazon→product), 9:16 + 16:9 versions
- [ ] 5+ short Reels/Shorts (repurpose clips with hooks + captions)
- [ ] Landing page (hero + demo strip + how-it-works + FAQ + CTA)
- [ ] Public-note "Made with Clipnote" viral footer
- [ ] PH gallery (hero GIF + 4 shots), tagline, maker's-first-comment
- [ ] Show HN title + body
- [ ] X launch thread + 5 standalone demo tweets
- [ ] LinkedIn founder story + 2 follow-ups
- [ ] Reddit show-and-tell posts (3 variants, niche-matched)
- [ ] 3–4 example public notes that show output quality (recipe, itinerary, product, article)
- [ ] OG image refresh (so shared links look good)
- [ ] Directory listings copy (AlternativeTo, BetaList, SaaSHub, TAAFT)

---

## §13 AI prompt library (paste these into Claude/Gemini after pasting this file)

> Each prompt assumes the assistant already has this brief in context.

- **Reels:** *"Using the Clipnote brief, write 5 Instagram Reel scripts (hook in first 1s, on-screen text beats,
  caption, hashtags) for the recipe-hoarder persona. Match the voice in §4. No emoji spam."*
- **X thread:** *"Write a 7-tweet build-in-public launch thread for Clipnote leading with the bookmark-graveyard
  pain and the Clip AI differentiator. Each tweet ≤270 chars. End with the link and a humble feedback ask."*
- **LinkedIn:** *"Write a reflective LinkedIn founder-story post (~180 words) about why I built Clipnote, in the
  §4 voice — calm and literary, no hype, no emoji walls."*
- **Reddit:** *"Draft a value-first r/PKMS show-and-tell post for Clipnote that would NOT read as spam: honest,
  built-solo framing, disclose I made it, ask for feedback on what's missing. Match each sub's culture."*
- **Product Hunt:** *"Write a 60-char PH tagline + a maker's first comment (~120 words) for Clipnote that leads
  with the problem and highlights Clip AI as the differentiator."*
- **Show HN:** *"Write a Show HN title and body for Clipnote in plain, candid HN register — what it is, why I built
  it, the stack honestly, what's technically hard, what feedback I want. No marketing adjectives."*
- **Landing copy:** *"Write the hero headline, subhead, and 3 'how it works' steps for the Clipnote landing page
  per §9, in the §4 voice."*
- **Repurpose:** *"Turn this winning [tweet/Reel] into versions for [TikTok / LinkedIn / Pinterest], adjusting
  register per §10."*

**Guardrails to include in every prompt:** "Don't invent users, metrics, testimonials, or press. We just
launched and have a tiny user base — keep social proof honest. Use clipnote.web.app and spell the brand 'Clipnote'."

---

## §14 Targets & honest math

To net **1,000 signups in 14 days**, you need a spike, not a trickle. Rough conversion planning:

| Source | Realistic visitor range | Signup rate | Signups |
|--------|------------------------|-------------|---------|
| Product Hunt (top ~5) | 800–2,000 | 8–15% | 100–300 |
| Show HN (front page) | 5,000–30,000 | 2–5% | 150–1,000+ |
| Reddit (1–2 posts hit) | 1,000–10,000 | 3–8% | 50–600 |
| Instagram/TikTok Reels | highly variable (1 viral clip = 10k–500k views) | 0.2–1% | 50–1,000+ |
| Warm network (WhatsApp/LinkedIn/X) | 200–800 | 15–40% | 60–250 |
| Directories + viral loop (public notes) | long-tail | — | 50–200 |

**Read:** 1,000 is reachable **if one of HN / a viral Reel / a strong Reddit post lands.** Bank on the warm
network + PH + directories for a **floor of ~300–500**; the stretch to 1,000 depends on a high-variance hit.
Don't bet the goal on a single channel — fire all of them, double down on whatever spikes.

**Track from Day 0** (your analytics already emit `note_saved` / `ask_submitted` / `note_viewed`):
- Signups **by source** (use UTM tags on every link — e.g. `?utm_source=producthunt`).
- **Activation rate** = % of signups who save ≥1 note (today this is only 30–40% — see §15; fixing it may
  matter more than any channel).
- **Aha-moment rate** = % who use Clip AI at least once.
- Drop-off step (sign-in → first paste → first note → return D1/D7).

---

## §15 ⚠️ Launch readiness — READ BEFORE DRIVING TRAFFIC

A successful launch with the app *as currently configured* will **hurt you**. Two hard blockers:

1. **Cost caps will throttle real users.** The backend has global daily kill-switches:
   `DAILY_GLOBAL_NOTE_CAP=1000`, `DAILY_GLOBAL_ASK_CAP=300`, `DAILY_GLOBAL_DEEP_CAP=50`, on a one-time
   credit budget of ~₹30k (~$360). If hundreds of new users arrive in a day, the app will hit these caps and
   **new users will get blocked/errored on their very first save** — the worst possible first impression. The
   total budget at full caps lasts only ~3 days. **Before launch you must decide:** raise the budget, gate
   signups (waitlist/invite drip so load is paced), and ensure that hitting a cap shows a *graceful* "we're at
   capacity, you're queued" message — never a broken error. (See `backend/config.py`.)

2. **Activation is leaking (~30–40%).** Driving 1,000 signups into a funnel where 60% never save a note wastes
   the spend. The onboarding requires install + shortcut + first save — that's friction. Consider letting users
   experience value *before* sign-in (the landing demo in §9) and simplifying the first-run path.

**Recommended pre-launch sequence:** (a) ship the landing page + public-note viral footer, (b) make cap-hits
graceful, (c) decide budget/pacing (waitlist drip is the safe move), (d) confirm analytics + UTMs, (e) *then*
open the channels. If forced to choose, **pace the launch** (invite waves) rather than risk a public flameout
on day one.

---

## §16 Brand safety / do-not list

- Don't fabricate users, revenue, testimonials, ratings, press, or funding.
- Don't promise features we don't have (offline AI, team mode, browser extension, Android native app).
- Don't spam — every Reddit/FB/community post must add value and disclose authorship.
- Don't ask for HN upvotes or bunch PH upvotes (both get penalized).
- Don't overclaim privacy — state honestly what we store (Firestore notes, Google auth).
- Keep the voice calm and specific (§4). When in doubt, show the product instead of adjectives.

---

*Last updated: 2026-06-16. Maintainer: update §14 with real conversion data after the sprint, and §6 with the
winning copy variants.*
