"""Two-step, per-user-aware, anti-generic Gemini pipeline.

Step 1 (lite model): categorize against the user's existing categories — prefer the most
specific applicable type; `summary` only for genuinely prose content; `general` banned.

Step 2 (main model): type-focused extraction. Known types get a focused TYPE_PROMPT carrying
only that type's schema with field-level guidance. Unknown/invented slugs get the composer
prompt: rich building blocks (facts/sections/steps/table/checklist/quotes) that GenericNote
renders with template-grade styling — never a wall of bullets.

Note on structured output: `data` is intentionally open-shaped (AI-invented types), and
Vertex controlled generation rejects object schemas without fixed properties — so we use
JSON mode (response_mime_type) and validate with Pydantic afterwards instead of response_schema.
"""
import asyncio
import json
import logging
import re
import time

from google import genai
from google.genai import types

from config import settings
from models.ask import ArtifactNote, AskPlan, CollectionDigest, GroundedAnswer, SynthAnswer
from models.note import ContentBundle, NoteExtraction
from services.usage_meter import record_usage

log = logging.getLogger("clipnote.gemini")


def normalize_slug(raw: str) -> str:
    """lowercase-kebab-case, trimmed."""
    s = re.sub(r"[^a-z0-9]+", "-", (raw or "").lower()).strip("-")
    return s or "summary"


# The entertainment content family. Entertainment slugs are AI-invented and open
# (`entertainment-recommendations`, `movie`, `film`, `tv`, …), so the family is defined by a
# keyword matcher rather than a fixed enum. Used to (a) route extraction through the
# `entertainment` schema and (b) gate TMDB enrichment in the worker. Keep this list in sync
# with the frontend family matcher.
ENTERTAINMENT_KEYWORDS = (
    "movie", "film", "tv", "show", "series", "anime", "cinema",
    "entertainment", "sitcom", "netflix", "documentary", "watchlist",
)


def is_entertainment(content_type: str) -> bool:
    """True when a content_type slug belongs to the movies/shows family."""
    slug = normalize_slug(content_type)
    return any(kw in slug for kw in ENTERTAINMENT_KEYWORDS)


# The shopping content family — the counterpart of ENTERTAINMENT_KEYWORDS.
# Product slugs are AI-invented and open (`product`, `gadget`, `gift-guide`, `buying-guide`, …),
# so the family is a keyword matcher. Used only to GATE price-parse enrichment in the worker; it
# does NOT reroute extraction (a roundup keeps its rich note rendering), and the fan-out itself
# guards on a usable price/buy URL, so a composer note that merely matches a keyword is skipped.
# Keep this list in sync with the frontend family matcher.
SHOPPING_KEYWORDS = (
    "product", "shopping", "gadget", "deal", "wishlist", "gift", "buying",
)


def is_shopping(content_type: str) -> bool:
    """True when a content_type slug belongs to the products/shopping family."""
    slug = normalize_slug(content_type)
    return any(kw in slug for kw in SHOPPING_KEYWORDS)


# The places content family — the dining/going-out counterpart of the other families.
# Place slugs are AI-invented and open (`place`, `restaurant`, `cafe`, `food-spots`, …), so the
# family is a keyword matcher. Used to (a) route extraction through the `place` venues[] schema and
# (b) gate Google-Places enrichment in the worker. Keep this list in sync with the frontend family
# matcher.
PLACES_KEYWORDS = (
    "place", "restaurant", "cafe", "bar", "dining", "eatery", "bakery", "dessert",
    "brewery", "pub", "venue", "attraction", "viewpoint", "hotel", "stay", "things-to-do",
)


def is_places(content_type: str) -> bool:
    """True when a content_type slug belongs to the places/dining family. Matches on whole
    hyphen-tokens (with simple plural folding) rather than raw substrings, so short keywords like
    'bar'/'pub' don't false-match 'barbell-workout' or 'public-speaking'."""
    slug = normalize_slug(content_type)
    tokens = set(slug.split("-"))
    for kw in PLACES_KEYWORDS:
        if "-" in kw:
            if kw in slug:  # multi-word keyword, e.g. "things-to-do"
                return True
        elif kw in tokens or (kw + "s") in tokens or any(t.rstrip("s") == kw for t in tokens):
            return True
    return False


# The recipe content family — the cooking counterpart of the other families. The
# `recipe` TYPE_PROMPT already produces structured ingredients/steps, so (like the wishlist) this
# only GATES enrichment in the worker; it does not reroute extraction. The fan-out itself guards
# on a usable `data.ingredients`, so a slug that merely matches a keyword without cookable data is
# skipped. "food"/"dessert" are deliberately excluded — they overlap with the Places family. Keep
# this list in sync with the frontend family matcher.
RECIPE_KEYWORDS = ("recipe", "cooking", "baking", "bake", "dish", "meal-prep")


def is_recipe(content_type: str) -> bool:
    """True when a content_type slug belongs to the cooking/recipe family."""
    slug = normalize_slug(content_type)
    return any(kw in slug for kw in RECIPE_KEYWORDS)


# The itinerary content family — the travel counterpart of the other families. The classifier
# deliberately separates `itinerary` (a day-by-day trip plan) from `place` (venues), and
# the `itinerary` TYPE_PROMPT already produces structured days[].stops[], so (like the recipes/
# wishlist) this only GATES stop-geocoding in the worker; it does not reroute extraction. Enrichment
# itself guards on a usable `data.days`, so a vague travel slug without a day plan is skipped. Keep
# this list in sync with the frontend family matcher.
ITINERARY_KEYWORDS = ("itinerary", "trip", "travel", "tour", "road-trip", "vacation", "getaway")


def is_itinerary(content_type: str) -> bool:
    """True when a content_type slug belongs to the travel/itinerary family."""
    slug = normalize_slug(content_type)
    return any(kw in slug for kw in ITINERARY_KEYWORDS)


def match_existing(slug: str, existing: list[str]) -> str:
    """Collapse to an existing category if it's effectively the same (case/space/plural)."""
    norm = normalize_slug(slug)
    by_norm = {normalize_slug(c): c for c in existing}
    if norm in by_norm:
        return by_norm[norm]
    for cand in (norm.rstrip("s"), norm + "s"):
        if cand in by_norm:
            return by_norm[cand]
    return norm


def closest_existing(slug: str, existing: list[str]) -> str:
    """Map a net-new slug onto the most similar EXISTING category — the code-side enforcement
    of the category cap (config.MAX_USER_CATEGORIES). When the taxonomy is full the classifier
    is told to reuse a slug, but if the model still returns something new we snap it here rather
    than append a duplicate. Cheap heuristic: the existing category sharing the most whole
    hyphen-tokens (with singular/plural folding) wins. If nothing overlaps, fall back to a
    generic bucket already in the taxonomy, else the first existing slug. `existing` must be
    non-empty (the cap only bites once the user has categories)."""
    def _fold(tokens: set[str]) -> set[str]:
        return {t.rstrip("s") for t in tokens if t}

    want = _fold(set(normalize_slug(slug).split("-")))
    best: str | None = None
    best_score = 0
    for cand in existing:
        score = len(want & _fold(set(normalize_slug(cand).split("-"))))
        if score > best_score:
            best_score, best = score, cand
    if best is not None:
        return best
    by_norm = {normalize_slug(c): c for c in existing}
    for generic in ("summary", "bookmark", "note"):
        if generic in by_norm:
            return by_norm[generic]
    return existing[0]


CATEGORY_SYSTEM = """You assign a content category to saved content.
Return ONLY valid JSON: {"content_type": "slug"} — lowercase-kebab-case.

Rules, in priority order:
1. REUSE the user's existing categories. If one of the user's existing categories
   semantically fits the content, you MUST return that exact slug — do not invent a
   near-synonym. (If the user has "restaurants", a cafe/ice-cream/breakfast spot is
   "restaurants", NOT "place"/"cafe"/"food". If they have "travel", a trip plan is
   "travel", not "itinerary".)
2. When no existing category fits, pick the MOST SPECIFIC type that fits what the
   content IS USED FOR, not its medium. Prefer these known types when one applies:
   - "recipe" — a dish to cook (a cooking video/post).
   - "workout" — a gym/exercise routine.
   - "product" — a product page or product review.
   - "itinerary" — a MULTI-stop or multi-day trip plan across a destination.
   - "place" — venues worth visiting: restaurants, cafes, bars, dessert/ice-cream
     shops, bakeries, food stalls, attractions, viewpoints, or hotels. ONE spot OR a
     roundup of several spots ("5 best cafes in Bandra") are both "place" — the schema
     lists each venue. A reel recommending spots is "place", NOT "itinerary".
   - "book" — a book recommendation/review.
   - "summary" — see rule 4.
3. Places vs trip: one venue OR a list of independent venues = "place"; only a route or
   day-by-day plan that sequences several stops into a journey = "itinerary". Never use a
   vague "travel" slug for venues — use "place".
4. "summary" is ONLY for genuinely prose content with no actionable structure:
   essays, news articles, opinion pieces, talks. NEVER use "summary" for anything
   with steps, items, specs, exercises, or places.
5. NEVER return "general", "misc", "other", or "video" — invent a specific new slug instead
   (e.g. "books", "home-decor", "career").
6. Slugs are SHORT: one word, two only when needed ("home-decor", not
   "home-decor-ideas"). Never append filler like -recommendations, -guide, -ideas,
   -advice, -list, -tips.
7. Discussion threads, Q&A, comment collections, and anecdote threads are NOT plans.
   A forum thread about workouts is "fitness-discussion", not "workout". Only classify as
   recipe/workout/itinerary when the source actually CONTAINS that artifact."""


# Appended to CATEGORY_SYSTEM only when the user's taxonomy is already at the cap
# (config.MAX_USER_CATEGORIES). It overrides rule 2's "invent a new slug" licence: a full
# taxonomy must NOT grow, so the model is required to reuse the best-fitting existing slug.
# Code-side enforcement (closest_existing) is the backstop if the model ignores this.
CATEGORY_CAP_RULE = """

IMPORTANT: the user's category list is FULL. You MUST return one of their existing
categories exactly as written — do NOT invent a new slug, even if none is a perfect fit.
Pick the closest existing category."""


COLLECTION_QUERY_SYSTEM = """You expand a user's collection name into a semantic search query.
The user named a folder for their saved notes; write 2-3 sentences describing what content
belongs in it — topics, typical note subjects, related terms and synonyms. Be concrete and
broad within the theme. Return ONLY the description text, no preamble, no quotes.
Example: "AI" → Artificial intelligence and machine learning: AI tools and products, LLMs and
chatbots like ChatGPT, ML research papers and tutorials, prompt engineering, AI news."""


TITLES_FROM_NOTE_SYSTEM = """You extract the movie and TV show titles named in a saved note.
Return ONLY valid JSON:
{"titles":[{"title":str,"year"?:str,"mediaType":"movie|tv|unknown","why"?:"one short line"}]}

Rules:
- List EVERY distinct film/series named. A roundup ("5 sci-fi films") yields one entry per title.
- A note about a single work yields one entry — use the work's real name, NOT the note's headline.
- NEVER invent a title that isn't in the note. If none are identifiable, return {"titles":[]}.
- `year` only if stated; `mediaType` is your best guess (tv = series/show/anime/miniseries)."""


VENUES_FROM_NOTE_SYSTEM = """You extract the places/venues named in a saved note.
Return ONLY valid JSON:
{"venues":[{"name":str,"location"?:str,"city"?:str,"category"?:str,"why"?:"one short line"}]}

Rules:
- List EVERY distinct venue named (a roundup "5 cafes" yields one entry per venue).
- A note about a single venue yields one entry — use the venue's real name, NOT the note's headline.
- NEVER invent a venue that isn't in the note. If none are identifiable, return {"venues":[]}.
- `location`/`city`/`category` only if stated or clearly implied."""


DAYS_FROM_NOTE_SYSTEM = """You turn a saved travel note into a structured day-by-day itinerary.
Return ONLY valid JSON:
{"destination"?:str,"duration"?:str,"budget"?:str,"bestSeason"?:str,
 "days":[{"day":1,"title"?:str,"stops":[{"time"?:str,"place":str,"note"?:str}]}],
 "tips"?:[str]}

Rules:
- ONLY produce days if the note describes an actual multi-stop or day-by-day trip/route across a
  destination. If it is a single spot, a venue roundup ("best cafes in X"), or generic travel tips
  with no sequence of stops, return {"days":[]} — it is NOT a trip.
- Build days/stops ONLY from places and details actually named in the note. NEVER invent stops,
  times, or places. If the note isn't already day-structured but IS a real trip, organize its named
  stops into sensible days yourself.
- `place` is required on every stop; `time`/`note` only when stated or clearly implied.
- This is a faithful re-structuring of the note, not new travel advice."""


SUMMARIZE_BACKFILL_SYSTEM = """You write ai_summary for a note that already has a title and
structured data — you are NOT re-reading the source, only restating what's already extracted.
Return ONLY the summary text: ONE concise, specific sentence (~15-25 words) capturing the single
most useful takeaway (mention an actual detail from the data — a dish, destination, title, spec).
Never restate the content_type generically, never mention "items", "collection", or how many
things were saved. No markdown, no quotes, no preamble."""


_SHARED_RULES = """You are a note extraction engine. The user saves links and never wants to
open the source again — your note must be MORE useful than the source.

Output is STRUCTURED JSON ONLY — no HTML, no markdown, no styling. Shape:
{
  "content_type": "<echo the slug you were given — do not change it>",
  "title": "concise, specific note title in SENTENCE CASE (capitalize only the first word and proper nouns/brand names/acronyms, e.g. 'Easy weeknight paneer butter masala', 'A weekend in Lisbon', 'Sony WH-1000XM5 review')",
  "ai_summary": "ONE concise, specific sentence (~15-25 words) capturing the single most useful takeaway from THIS content (mention an actual detail)",
  "cover_image_prompt": "a vivid visual scene for a cover image",
  "data": { ...per the schema below... }
}

Extraction rules:
- Extract CONCRETE values: real quantities, timings, prices, set/rep counts, place names.
- If the content shows something visually but never says it aloud, extract what is SHOWN.
- Strip sponsorships, intros, calls-to-action, filler.
- Never leave a schema field empty if the information exists anywhere in the source.
- NEVER FABRICATE. If the source does not state a value, omit the field — do not estimate,
  average, or invent plausible-sounding numbers/items to fill the schema. A sparse but
  truthful note beats a complete-looking invented one.
- If JSON-LD ground truth is provided, treat it as authoritative for exact values."""


TYPE_PROMPTS: dict[str, str] = {
    "recipe": _SHARED_RULES + """

`data` schema for recipe:
{
  "totalTime": "e.g. 35 min", "prepTime"?: str, "cookTime"?: str,
  "servings": "e.g. 4", "difficulty": "Easy|Medium|Hard",
  "cuisine"?: str, "calories"?: str,
  "ingredients": [{"group"?: "e.g. For the sauce", "items": ["250 g paneer, cubed", ...]}],
  "steps": ["one clear instruction per step, with times/temps where given", ...],
  "tips"?: ["chef tips, substitutions, storage", ...]
}
Every ingredient must carry its quantity. Group ingredients when the source does.""",

    "itinerary": _SHARED_RULES + """

`data` schema for itinerary:
{
  "destination": str, "duration": "e.g. 5 days", "budget"?: "with currency",
  "bestSeason"?: str,
  "days": [{"day": 1, "title": "e.g. Old Town & Food Walk",
            "stops": [{"time"?: "09:00", "place": str, "note": "why go / what to do / cost"}]}],
  "tips"?: ["transport, booking, local etiquette", ...]
}
If the source is not day-structured, organize the places into sensible days yourself.""",

    "product": _SHARED_RULES + """

`data` schema for product:
{
  "price": "with currency symbol", "brand": str, "rating"?: "0-5 float",
  "buyUrl": "the product page URL",
  "specs": [{"label": str, "value": str}],   // the specs that actually matter for a buying decision
  "pros": [str], "cons": [str],              // from reviews/description; honest, specific
  "verdict"?: "1 sentence: who should buy this"
}
Pros/cons must be specific ("battery lasts 2 days") not generic ("good quality").""",

    "workout": _SHARED_RULES + """

`data` schema for workout:
{
  "goal": "e.g. hypertrophy, fat loss, mobility", "level": "Beginner|Intermediate|Advanced",
  "duration": "per session, e.g. 45 min", "frequency"?: "e.g. 3x/week",
  "equipment": ["dumbbells", "none", ...],
  "structure"?: [{"block": "e.g. Warm-up", "items": ["jumping jacks 60s", ...]}],
  "exercises": [{"name": str, "sets"?: "3", "reps"?: "8-12", "duration"?: "45s",
                 "rest"?: "60s", "formCues"?: "the key technique point shown/said"}],
  "tips"?: ["progression, common mistakes", ...]
}
Watch the demonstration: capture sets/reps/tempo even if only shown on screen text.""",

    "summary": _SHARED_RULES + """

`data` schema for summary (prose content only — articles, essays, talks):
{
  "medium": "article|video|podcast", "readTime"?: str, "videoLength"?: str,
  "tldr": "3-4 sentences capturing the actual argument, not a teaser",
  "keyPoints": ["each a complete, specific claim from the content", ...],
  "quotes"?: [{"text": str, "timestamp"?: str}],
  "actionItems"?: ["if the content implies things to do", ...]
}""",

    "place": _SHARED_RULES + """

This is a place recommendation — a single venue OR a list (a "5 cafes to try" reel, a thread, a
best-of article). Extract EVERY distinct venue mentioned as its own entry so each becomes a
trackable place to try. NEVER merge two different venues into one entry, and NEVER invent a venue
that is not named in the source.

`data` schema for place (restaurant, cafe, bar, attraction, hotel):
{
  "venues": [{
    "name": "the venue's name exactly as stated",
    "location": "area, city (whatever is given)",
    "city"?: "just the city, if identifiable — used to group places",
    "category": "e.g. cafe, fine-dining, rooftop bar, viewpoint, hotel",
    "cuisine"?: "for restaurants/cafes, e.g. 'South Indian', 'Italian'",
    "priceForTwo"?: "approx cost for two, with currency, if stated",
    "mustTry"?: ["specific signature dishes/drinks to order", ...],
    "goodFor"?: ["e.g. 'date night', 'groups', 'work', 'solo', 'family'"],
    "bestTime"?: "best time to go, if mentioned",
    "reservationNeeded"?: true,
    "highlights": ["what it's known for; the experience; what to order/see", ...],
    "tips"?: ["booking, how to reach, what to avoid", ...],
    "why"?: "one short line on why it's recommended, from the source",
    "website"?: "the venue's own site, ONLY if the source gives it",
    "instagram"?: "the venue's instagram handle/URL, ONLY if the source gives it",
    "bookingUrl"?: "a direct reservation/booking link, ONLY if the source gives it",
    "phone"?: "phone number, ONLY if stated"
  }],
  "listTheme"?: "the theme if it's a themed roundup, e.g. 'best brunch in Bandra'"
}
A single-venue post yields a one-element `venues` array; a listicle yields one entry per venue.
The note's own `title`/`ai_summary` should describe the reel/list as a whole.""",

    "book": _SHARED_RULES + """

`data` schema for book:
{
  "author": str, "genre"?: str, "pages"?: str, "published"?: str,
  "facts": [{"label": str, "value": str}],
  "premise": "2-3 sentences, no spoilers",
  "keyIdeas"?: ["for non-fiction: the core ideas", ...],
  "whoShouldRead": str
}""",

    "entertainment": _SHARED_RULES + """

This is a movie/show recommendation — a single title OR a list (a "5 films to watch" reel,
a thread, a best-of article). Extract EVERY distinct work mentioned as its own entry so each
renders as its own card on the note. NEVER merge two different works into one entry, and NEVER
invent a title that is not named in the source.

`data` schema for entertainment:
{
  "titles": [{
    "title": "the work's name exactly as stated",
    "year"?: "release year if shown or said, e.g. '2014'",
    "mediaType": "movie | tv | unknown",   // tv = series/show/anime; unknown if unclear
    "creator"?: "director or showrunner, only if mentioned",
    "why"?: "one short line on why it's recommended, from the source"
  }],
  "listTheme"?: "the theme of the list if it's a themed roundup, e.g. 'feel-good sci-fi'"
}
A single-title post yields a one-element `titles` array; a listicle yields one entry per work.
The note's own `title`/`ai_summary` should describe the reel/list as a whole.""",
}


COMPOSER_PROMPT = _SHARED_RULES + """

This content_type has no fixed schema. COMPOSE the most useful `data` for it from these
building blocks — pick whichever genuinely fit; use several:

  "facts":     [{"label": str, "value": str}]                  // key/value stat grid — lead with this when there are numbers/attributes
  "sections":  [{"heading": str, "items": [str]}]              // headed lists of substantive items
  "steps":     [str]                                           // ONLY for genuinely ordered procedures
  "table":     {"columns": [str], "rows": [[str]]}             // comparisons, schedules, option matrices
  "checklist": [str]                                           // things to acquire/do/pack
  "quotes":    [{"text": str, "attribution"?: str}]

Design rule: structure mirrors the content. A comparison becomes a table; a plan becomes
steps or day sections; a list of recommendations becomes sections with one heading per theme.
Do NOT flatten everything into one bullet list — that is a failure."""


ASK_PLAN_SYSTEM = """You plan how to answer a message in Clipnote, an app where the user saves
links as structured notes. You receive: the user's message, recent conversation, today's local
date, and a JSON index of candidate notes (id, type, title, summary, saved date).

Return ONLY valid JSON:
{"intent":"answer|aggregate|create|save_link","scope":"notes|general","topic":str|null,
 "period":"today|yesterday|this_week|last_week|this_month|recent"|null,
 "content_types":[slug,...],"source":str|null,"exhaustive":bool,
 "output":"prose|itinerary|meal_plan|comparison|checklist","note_ids":[id,...],
 "save_url":str|null,"save_hint":str|null}

How to fill it:
- scope: "notes" only if the message is about the user's saved notes/content. Use "general"
  for small talk OR any general-knowledge question you could answer on your own that does not
  reference their saved content (then note_ids = []). Judge follow-ups from the conversation —
  "and who directed it?" after a movie note is "notes"; "what's the capital of France",
  "explain X", "write me a poem" are "general". When unsure between the two, prefer "general"
  unless the message clearly points at their saved content.
- intent: "answer" normally; "aggregate" for counting / how-many / breakdown questions;
  "create" ONLY if the user asks to make/save a NEW note;
  "save_link" when the message contains a URL (http:// or https://) the user wants to clip/save.
  Examples of save_link: "save this https://…", "clip this for me: https://…", a bare URL with
  or without commentary like "save as a workout note: https://…". NOT save_link: asking a
  question about an already-saved note that happens to include a URL in context.
- save_url: when intent is save_link, extract the full URL (must start with http:// or https://).
  Otherwise null.
- save_hint: when intent is save_link, any instructions the user gave beyond the URL itself
  (e.g. "focus on the ingredients", "save as a workout note", "note the price"). Otherwise null.
- period: set when the message is time-scoped ("today", "yesterday", "this week",
  "lately"/"recently" = recent). Resolve relative to today's date given. Otherwise null.
- content_types: the note types the message targets — reuse the exact slugs that appear in the
  index when they fit (e.g. "recipe", "place"). Empty if it spans everything or is unclear.
- source: set when the user references WHERE a note came from — a website or app — e.g. "my
  Pinterest notes", "the recipe I saved from Instagram", "that NYT article". Use a short
  lowercase keyword (pinterest, instagram, youtube, nytimes, amazon). Otherwise null.
- exhaustive: true when the user wants ALL of something ("all my recipes", "consolidate my trip
  notes", "compare every laptop", "everything I saved from Pinterest"). For period, source, or
  exhaustive requests, leave note_ids EMPTY — retrieval fetches the full filtered set itself.
- output: "prose" by default. Use itinerary/meal_plan/comparison/checklist only when the user
  explicitly wants that artifact built.
- note_ids: for an ordinary topic question (no period, not exhaustive), pick the relevant ids
  from the index, most relevant first, max 12. Use ONLY ids present in the index — never invent.

If nothing in the index is relevant but the message is clearly about their notes, return
scope="notes" with note_ids=[]."""


ASK_ANSWER_NOTES_SYSTEM = """You are Clipnote's assistant. The user saves links as structured notes;
answer their question using ONLY the saved notes provided.
Return ONLY valid JSON: {"answer_markdown": str, "cited_note_ids": [str]}

Rules:
- Ground every claim in the notes. NEVER FABRICATE: if the notes don't contain enough to
  answer, say so plainly and suggest what they could save — do not fill gaps from general
  knowledge or the wider internet.
- Be direct, conversational, and specific: use the real names, prices, timings, and
  quantities from the notes.
- Mention note titles naturally when recommending or comparing, so the user knows where
  each item came from.
- cited_note_ids: only notes you actually used, most relevant first.
- Markdown subset: short paragraphs, "- " bullets, numbered lists, **bold**, ### headings,
  and a simple markdown table ONLY when comparing items. No images, links, or HTML.
- Use the conversation history to resolve follow-ups; answer the latest question."""


ASK_CHAT_SYSTEM = """You are Clipnote's friendly assistant. The user's message is general
conversation or a general-knowledge question — NOT about their saved notes.
Return ONLY valid JSON: {"answer_markdown": str, "cited_note_ids": []}

Rules:
- Answer naturally, helpfully, and concisely from your own knowledge.
- Do NOT mention the user's notes, searching them, or that none were found — just answer.
- cited_note_ids is ALWAYS an empty list.
- Markdown subset only: short paragraphs, "- " bullets, **bold**. No tables, images, links, or HTML.
- Use the conversation history to resolve follow-ups."""


ASK_SYNTH_SYSTEM = """You are Clipnote's assistant. The user wants you to CONSOLIDATE several of
their saved notes into ONE structured artifact. Build it using ONLY the provided notes.

Return ONLY valid JSON:
{"answer_markdown": "one short lead-in sentence introducing the artifact",
 "artifact": {"title": str, "ai_summary": "one concise sentence overview",
              "content_type": "<short slug for the artifact>",
              "data": { ...blocks below... }},
 "cited_note_ids": [ids of notes you used]}

artifact.data is built from these blocks — use whichever fit:
  "facts":     [{"label": str, "value": str}]
  "sections":  [{"heading": str, "items": [str]}]
  "steps":     [str]
  "table":     {"columns": [str], "rows": [[str]]}
  "checklist": [str]

Shape it to the requested OUTPUT kind:
  - itinerary  → one section per day (heading "Day 1 — ...", items = stops with time/place/why);
                 add a checklist of bookings/things to carry if useful. content_type "itinerary".
  - meal_plan  → one section per day listing meals, plus a "Grocery list" checklist that
                 DEDUPES ingredients across the recipes. content_type "meal-plan".
  - comparison → a table (one row per item; columns = the attributes compared) and a short
                 verdict section. content_type "comparison".
  - checklist  → a single checklist (optionally grouped into sections). content_type "checklist".

Rules:
- content_type: if one of the user's existing categories (listed in the request) fits the
  artifact, REUSE it verbatim instead of inventing a near-duplicate; otherwise use the slug
  suggested above for the OUTPUT kind.
- NEVER FABRICATE: use only details present in the notes; omit anything missing. A sparse but
  truthful artifact beats an invented complete-looking one.
- Be specific: real names, times, prices, quantities from the notes.
- cited_note_ids: every note that contributed."""


ASK_CREATE_SYSTEM = """You are Clipnote's assistant. The user wants you to CREATE a new note from
this conversation and your own knowledge. Author a genuinely useful, well-structured note.

Return ONLY valid JSON:
{"title": "concise note title in sentence case",
 "ai_summary": "one concise sentence overview",
 "content_type": "<short category slug>",
 "data": { ...blocks below... }}

data is built from these blocks — use whichever fit (structure mirrors the content; never dump
one flat bullet list):
  "facts":     [{"label": str, "value": str}]
  "sections":  [{"heading": str, "items": [str]}]
  "steps":     [str]
  "table":     {"columns": [str], "rows": [[str]]}
  "checklist": [str]

Rules:
- Use the conversation to understand exactly what to capture, then fill in helpful, accurate
  detail from your own knowledge. Be concrete, specific, and skimmable.
- content_type: a short slug describing the note. If one of the user's existing categories
  (listed in the request) fits, REUSE it verbatim — do not invent a near-duplicate (e.g. don't
  emit "travel-tips" when "travel" already exists). Only coin a new slug when none fits. Never
  "general", "misc", or "other"."""


DIGEST_SYSTEM = """You are Clipnote's assistant. Build a DIGEST for one of the user's smart
collections: a piece of writing that TEACHES what's actually in its saved notes, the way a
well-read colleague would brief you on a folder of links they'd actually read — not an index,
not a list of links, not the notes' own titles and summaries restated.

Each note's `data` field (marked CONTENT below) holds the real substance — named tools,
techniques, steps, places, prompts, numbers — and that is what you are reading and reporting on.
The note's title/summary (marked metadata below) exist only to identify which note is which; they
are NEVER something you may copy into your output. If your section body could have been written
from the title and summary alone, without opening `data`, you have failed at this task.

INTERNAL STEP (do this before writing anything): scan every note's CONTENT and build a mental
list of every specific named thing across ALL of them — every tool, skill, technique, step,
prompt, place, or number. Notice which ones repeat or relate across different notes. Only then
group them into sections and write each section's body from that list.

Return ONLY valid JSON:
{"intro": "1-2 sentences characterizing what this collection has become",
 "facts": [{"label": str, "value": str}],
 "sections": [{"heading": str,
               "body": "1-3 short paragraphs of prose, \\n\\n between paragraphs",
               "items": [{"title": str, "summary": str, "note_id": str}],
               "source_note_ids": [str]}]}

WORKED EXAMPLE — given two notes: one titled "The top 3 most GOATED skills for Claude" whose
CONTENT lists three Claude Code skills (a discovery tool, a persistent-memory tool, a security
scanner, each with what it does), and another titled "How to de-slop every AI output forever"
whose CONTENT describes a custom skill that runs sub-agents to audit and rewrite AI-generated
text — a GOOD section looks like this (note the body names the actual tools and draws the
connection between notes; it does not mention either note's title):

{"heading": "Claude Code skills worth installing",
 "body": "Three skills close the gaps vibe coders hit most often. Find Skills automatically
   discovers and installs whichever skill fits a given prompt, so you stop hunting through skill
   directories by hand. Claude-mem gives Claude persistent memory across sessions by compressing
   project context, past decisions, and preferences, so you're not re-explaining the codebase
   every time you open a new chat. VibeSec-Skill acts as an AI penetration tester, scanning
   generated code for hardcoded API keys and weak admin passwords before it ships.\\n\\nA fourth
   pattern shows up in a separate note: a skill built specifically to de-slop AI writing, using
   specialized sub-agents to audit and rewrite output rather than a single pass. Paired with the
   three skills above, the shape of a solid Claude Code setup becomes discovery, memory, security,
   and output quality, each handled by a dedicated skill instead of one prompt trying to do
   everything.",
 "items": [
   {"title": "Find Skills", "summary": "Auto-discovers and installs the right skill for a prompt", "note_id": "<id of that note>"},
   {"title": "Claude-mem", "summary": "Persistent memory across sessions via context compression", "note_id": "<id of that note>"},
   {"title": "VibeSec-Skill", "summary": "AI penetration tester for hardcoded secrets and weak auth", "note_id": "<id of that note>"}
 ],
 "source_note_ids": ["<id of first note>", "<id of second note>"]}

A BAD section (do NOT do this — this is v2's failure mode, restating the note instead of reading it):
{"heading": "AI Tools", "body": "", "items": [
   {"title": "The top 3 most GOATED skills for Claude", "summary": "Enhance Claude Code with Find Skills, Claude-mem for persistent memory, and VibeSec-Skill for security scanning.", "note_id": "..."}
 ]}
(That entry just copied the note's title into "title" and its summary into "summary" — it never
opened CONTENT. Every entry above is a REAL example.)

Rules:
- `body` is mandatory and is the primary output — write it first, for every section, even ones
  with items. It must read as synthesis: name the specific things, explain what each does or
  means, and connect them across notes when more than one note contributes ("this pairs with...",
  "the same pattern shows up in...", "unlike the note above,..."). 1-3 short paragraphs, plain
  text, "\\n\\n" between paragraphs, no headings or bullets inside it.
- `items` is OPTIONAL and reserved for genuinely atomic listables worth their own row (a specific
  tool, site, or place someone would want to click through to) — many good sections have body
  prose and an empty items list, because not everything worth explaining is a discrete link-out.
  Never pad items with vague or duplicate entries just to have some; an empty list is correct
  when nothing in the section is atomic enough to deserve one.
  - An item's title must NEVER restate or rephrase the source note's title (see the BAD example).
    Name the actual thing: "Claude-mem: persistent memory across sessions", never "The top 3 most
    GOATED skills for Claude".
  - Merge duplicates across notes into ONE item, citing whichever note covers it in most detail.
  - Every item MUST carry the exact note_id it came from, chosen ONLY from the NOTE ids given
    below. Never invent an id, never cite one not in the notes provided.
- `source_note_ids`: every note id (from the ones provided) that the section's body actually
  draws on, so the section itself can deep-link and cite even when it has no items.
- Group into 3-6 sections that are specific and content-derived, never generic buckets like
  "Articles" or "Notes" — name each section for what's actually in it (e.g. "AI coding tools",
  "Memory & context systems", "Prompting techniques"). Order sections by usefulness, most
  useful/most populated first.
- facts: 2-4 genuinely informative at-a-glance stats (e.g. "Tools catalogued: 14", "Newest
  save: <title>"). Any number in a fact (a count of tools, notes, items, etc) MUST be one you can
  literally verify by counting things you actually named in this response or notes actually
  provided — never estimate or guess a total. When you're not sure a stat is exactly right, drop
  it; omit any fact that would be filler; return an empty list when nothing meaningful applies.
- No em-dashes anywhere in intro, facts, body, or item summaries.
- NEVER FABRICATE: ground every claim, item, and fact in the CONTENT provided; omit anything you
  can't ground rather than inventing it."""


PERSONAL_DIGEST_SYSTEM = """You are Clipnote's assistant. Write a personal WEEK IN REVIEW for one
user, addressed directly to them ("you saved", "you were into", "you kept coming back to"): a warm,
brief piece of writing that reflects back what they actually saved and read, the way a friend who'd
skimmed their whole week of links would tell them what they'd been on about, not an index and not a
list of the notes' own titles and summaries restated.

Each note's `data` field (marked CONTENT below) holds the real substance (named tools, techniques,
steps, places, prompts, numbers) and that is what you are reading and reporting on. The note's
title/summary (marked metadata below) exist only to identify which note is which; they are NEVER
something you may copy into your output. If a section body could have been written from the titles
and summaries alone, without opening `data`, you have failed at this task.

INTERNAL STEP (do this before writing anything): scan every note's CONTENT and build a mental list
of every specific named thing across ALL of them (every tool, skill, technique, step, prompt,
place, or number). Notice which ones repeat or relate across different notes. Only then group them
into themes and write each theme's body from that list.

Return ONLY valid JSON:
{"intro": "1-2 sentences characterizing the themes of the user's week",
 "facts": [{"label": str, "value": str}],
 "sections": [{"heading": str,
               "body": "1-3 short paragraphs of prose, \\n\\n between paragraphs",
               "items": [{"title": str, "summary": str, "note_id": str}],
               "source_note_ids": [str]}]}

Rules:
- intro: 1-2 sentences, second person, characterizing what the week was about ("This week you went
  deep on agent tooling and squeezed in two recipes."). Name the actual themes, not "you saved
  several notes".
- Group into 2-4 theme sections that are specific and content-derived, never generic buckets like
  "Articles" or "Notes"; name each for what's actually in it (e.g. "AI coding tools", "Weeknight
  dinners"). Order sections by how much of the week they represent, biggest first.
- `body` is mandatory and is the primary output; write it first, for every section. It must read as
  synthesis in second person: name the specific things, explain what each does or means, and connect
  them across notes when more than one contributes ("this pairs with...", "the same idea shows up
  in..."). 1-3 short paragraphs, plain text, "\\n\\n" between paragraphs, no headings or bullets
  inside it.
- `items` is OPTIONAL and reserved for genuinely atomic listables worth their own row (a specific
  tool, site, or place worth clicking through to); many good sections have body-only prose and an
  empty items list. Never pad items with vague or duplicate entries.
  - An item's title must NEVER restate or rephrase the source note's title. Name the actual thing.
  - Merge duplicates across notes into ONE item, citing whichever note covers it in most detail.
  - Every item MUST carry the exact note_id it came from, chosen ONLY from the NOTE ids given
    below. Never invent an id, never cite one not in the notes provided.
- `source_note_ids`: every note id (from the ones provided) the section's body actually draws on, so
  the section can deep-link and cite even when it has no items.
- facts: 0-2 QUALITATIVE at-a-glance highlights only (e.g. "Deepest read: <what it was about>",
  "Kept coming back to: <theme>"). NEVER emit numeric counts of any kind: no "5 notes", no "3
  recipes", no totals or tallies. Python computes all the counting stats separately; a numeric fact
  here is always wrong. Omit any fact that would be filler; return an empty list when nothing
  qualitative stands out.
- No em-dashes anywhere in intro, facts, body, or item summaries.
- NEVER FABRICATE: ground every claim, item, and fact in the CONTENT provided; omit anything you
  can't ground rather than inventing it."""


def _history_lines(history: list[dict]) -> str:
    return "\n".join(f"{t['role']}: {t['text']}" for t in history)


def _focal_hint(title: str) -> str:
    """Steer the answer toward the note the user is currently viewing (Ask opened from a
    note's page) — primary subject, but not a hard filter ("this note first, then all")."""
    return (
        f'CONTEXT: The user is currently viewing the note titled "{title}". Treat it as the '
        "primary subject and prioritize it in your answer, unless the question is clearly "
        "about other notes."
    )


def _strip_code_fences(text: str) -> str:
    t = text.strip()
    if t.startswith("```"):
        t = re.sub(r"^```[a-z]*\n?", "", t)
        t = re.sub(r"\n?```$", "", t)
    return t


class GeminiService:
    def __init__(self):
        self.client = genai.Client(
            vertexai=True,
            project=settings.GOOGLE_CLOUD_PROJECT,
            location=settings.GEMINI_LOCATION,
        )

    # ---------- Step 1: categorization (lite model, ~50 output tokens) ----------

    async def classify(self, url: str, bundle: ContentBundle,
                       existing_categories: list[str],
                       note_hint: str | None = None) -> str:
        """One lite call that assigns a note's content_type against the user's existing
        categories. Returns the resolved slug.

        Collection membership is NO LONGER decided here — a classifier call used to also
        file the note into at most one user-created bucket, but that's now resolved by
        embedding similarity at ingest (services.collections.match_collections_by_embedding,
        called from routers/process.py after the note embedding is computed), which lets a
        note belong to more than one collection instead of the old at-most-one assignment.
        Dropping collection routing from this prompt also shaves its output tokens."""
        categories_str = ", ".join(existing_categories) if existing_categories else "none yet"
        prompt = (
            f"URL: {url}\n"
            f"Platform: {bundle.metadata.get('platform', 'web')}\n"
            f"Content preview: {bundle.preview[:600]}\n"
            f"User's existing categories: {categories_str}\n"
        )
        prompt += (
            (f"User instruction: {note_hint}\n" if note_hint else "")
            + "Choose the content_type."
        )
        at_cap = len(existing_categories) >= settings.MAX_USER_CATEGORIES
        system = CATEGORY_SYSTEM + (CATEGORY_CAP_RULE if at_cap else "")
        # An uploaded image/PDF often has no useful preview text — classify from the file
        # itself (the lite model is multimodal). Video is left out: it's the expensive path
        # and its title/description text is enough for categorization.
        if bundle.media_uri or bundle.image_parts:
            cat_parts: list = []
            if bundle.media_uri:
                cat_parts.append(types.Part(file_data=types.FileData(
                    file_uri=bundle.media_uri,
                    mime_type=bundle.media_mime or "application/octet-stream")))
            for img in bundle.image_parts:
                cat_parts.append(types.Part.from_bytes(
                    data=img["data"], mime_type=img.get("mime_type", "image/jpeg")))
            cat_parts.append(types.Part(text=prompt))
            contents = [types.Content(role="user", parts=cat_parts)]
        else:
            contents = [prompt]
        response = await asyncio.to_thread(
            self.client.models.generate_content,
            model=settings.GEMINI_LITE_MODEL,
            contents=contents,
            # No tight max_output_tokens: Gemini 3.x models think by default and a small
            # cap gets consumed by thoughts, returning text=None (measured at Phase 0).
            config=types.GenerateContentConfig(
                response_mime_type="application/json",
                system_instruction=system,
            ),
        )
        record_usage(settings.GEMINI_LITE_MODEL, response)
        try:
            parsed = json.loads(_strip_code_fences(response.text))
            slug = parsed.get("content_type", "summary")
        except (json.JSONDecodeError, AttributeError):
            slug = "summary"
        resolved = match_existing(slug, existing_categories)
        # Enforce the taxonomy cap in code (the prompt rule is best-effort): at/over the cap a
        # net-new slug is snapped onto the closest existing category, never appended.
        if at_cap and resolved not in existing_categories:
            resolved = closest_existing(resolved, existing_categories)
        return resolved

    async def assign_category(self, url: str, bundle: ContentBundle,
                              existing_categories: list[str],
                              note_hint: str | None = None) -> str:
        """Back-compat alias — identical to classify now that collection routing has moved
        to embedding match at ingest (kept so any external caller of the old name still works)."""
        return await self.classify(url, bundle, existing_categories, note_hint=note_hint)

    # ---------- Backfill: pull titles out of an already-saved note ----------

    async def extract_titles_from_note(self, title: str, ai_summary: str,
                                       data: dict | None) -> list[dict]:
        """For the Watchlist backfill: extract the movie/show titles from a note that was
        already saved (so its `data` predates the entertainment schema and has no titles[]).
        Works off the STORED text only — no re-scraping. Lite model, JSON mode."""
        blob = (
            f"Note title: {title}\n"
            f"Summary: {ai_summary}\n"
            f"Stored data: {json.dumps(data or {}, ensure_ascii=False)[:6000]}"
        )
        try:
            response = await asyncio.to_thread(
                self.client.models.generate_content,
                model=settings.GEMINI_LITE_MODEL,
                contents=[blob],
                config=types.GenerateContentConfig(
                    response_mime_type="application/json",
                    system_instruction=TITLES_FROM_NOTE_SYSTEM,
                ),
            )
            record_usage(settings.GEMINI_LITE_MODEL, response)
            out = json.loads(_strip_code_fences(response.text))
            titles = out.get("titles", []) if isinstance(out, dict) else []
            return [t for t in titles if isinstance(t, dict) and t.get("title")]
        except Exception as e:  # noqa: BLE001 — backfill is best-effort per note.
            log.warning("title backfill extract failed: %s: %s", type(e).__name__, e)
            return []

    async def expand_collection_query(self, name: str, description: str = "") -> str:
        """Expand a thin collection name/description into a descriptive semantic query for the
        backfill embedding. A two-letter name like "AI" embeds almost nothing — the expansion is
        the difference between sweeping in matching notes and silently matching zero. Lite model,
        plain text; returns "" on any failure (caller falls back to the raw text)."""
        prompt = f"Collection name: {name}"
        if description and description.strip().lower() != name.strip().lower():
            prompt += f"\nUser's description: {description}"
        try:
            response = await asyncio.to_thread(
                self.client.models.generate_content,
                model=settings.GEMINI_LITE_MODEL,
                contents=[prompt],
                config=types.GenerateContentConfig(
                    system_instruction=COLLECTION_QUERY_SYSTEM,
                ),
            )
            record_usage(settings.GEMINI_LITE_MODEL, response)
            return (response.text or "").strip()
        except Exception as e:  # noqa: BLE001 — expansion is best-effort.
            log.warning("collection query expansion failed: %s: %s", type(e).__name__, e)
            return ""

    async def extract_venues_from_note(self, title: str, ai_summary: str,
                                       data: dict | None) -> list[dict]:
        """For the Places backfill: extract the venue names from a note that was already saved
        (so its `data` predates the venues[] schema). Works off the STORED text only — no
        re-scraping. Lite model, JSON mode."""
        blob = (
            f"Note title: {title}\n"
            f"Summary: {ai_summary}\n"
            f"Stored data: {json.dumps(data or {}, ensure_ascii=False)[:6000]}"
        )
        try:
            response = await asyncio.to_thread(
                self.client.models.generate_content,
                model=settings.GEMINI_LITE_MODEL,
                contents=[blob],
                config=types.GenerateContentConfig(
                    response_mime_type="application/json",
                    system_instruction=VENUES_FROM_NOTE_SYSTEM,
                ),
            )
            record_usage(settings.GEMINI_LITE_MODEL, response)
            out = json.loads(_strip_code_fences(response.text))
            venues = out.get("venues", []) if isinstance(out, dict) else []
            return [v for v in venues if isinstance(v, dict) and v.get("name")]
        except Exception as e:  # noqa: BLE001 — backfill is best-effort per note.
            log.warning("venue backfill extract failed: %s: %s", type(e).__name__, e)
            return []

    async def extract_days_from_note(self, title: str, ai_summary: str,
                                     data: dict | None) -> dict:
        """For the Trips backfill: derive a day-by-day itinerary from a travel note saved before the
        Trips app existed (so its `data` went through the generic composer, not the itinerary
        schema, and carries no days[]). Works off the STORED text only — no re-scraping. Returns the
        itinerary `data` shape (destination/duration/.../days[]/tips); {"days":[]} when the note
        isn't actually a trip. Lite model, JSON mode."""
        blob = (
            f"Note title: {title}\n"
            f"Summary: {ai_summary}\n"
            f"Stored data: {json.dumps(data or {}, ensure_ascii=False)[:6000]}"
        )
        try:
            response = await asyncio.to_thread(
                self.client.models.generate_content,
                model=settings.GEMINI_LITE_MODEL,
                contents=[blob],
                config=types.GenerateContentConfig(
                    response_mime_type="application/json",
                    system_instruction=DAYS_FROM_NOTE_SYSTEM,
                ),
            )
            record_usage(settings.GEMINI_LITE_MODEL, response)
            out = json.loads(_strip_code_fences(response.text))
            if not isinstance(out, dict):
                return {"days": []}
            days = out.get("days")
            out["days"] = [d for d in days if isinstance(d, dict) and d.get("stops")] if isinstance(days, list) else []
            return out
        except Exception as e:  # noqa: BLE001 — backfill is best-effort per note.
            log.warning("days backfill extract failed: %s: %s", type(e).__name__, e)
            return {"days": []}

    async def summarize_for_backfill(self, title: str, content_type: str,
                                     data: dict | None) -> str:
        """For scripts/backfill_summaries.py: regenerate `ai_summary` for a note stuck with a
        migration-artifact summary ('Added 37 items to your Places collection.', left behind by
        migrate_items_to_notes.py). Works off the STORED title/data only — no re-scrape. Lite
        model, plain text. Returns "" on any failure (caller treats that as a skip)."""
        blob = (
            f"Title: {title}\n"
            f"content_type: {content_type}\n"
            f"Stored data: {json.dumps(data or {}, ensure_ascii=False)[:6000]}"
        )
        try:
            response = await asyncio.to_thread(
                self.client.models.generate_content,
                model=settings.GEMINI_LITE_MODEL,
                contents=[blob],
                config=types.GenerateContentConfig(
                    system_instruction=SUMMARIZE_BACKFILL_SYSTEM,
                ),
            )
            record_usage(settings.GEMINI_LITE_MODEL, response)
            return _strip_code_fences((response.text or "").strip())
        except Exception as e:  # noqa: BLE001 — backfill is best-effort per note.
            log.warning("summary backfill failed for %r: %s: %s", title, type(e).__name__, e)
            return ""

    # ---------- Step 2: type-focused extraction (main model) ----------

    def _build_contents(self, url: str, bundle: ContentBundle, content_type: str,
                        note_hint: str | None = None) -> list:
        parts: list = []
        if bundle.video_uri:
            # YouTube URLs and gs:// URIs are both passed as FileData — Gemini ingests
            # the video directly (visuals + audio). Never inline bytes. Vertex requires
            # an explicit mimeType even for YouTube URLs (400 without it).
            parts.append(types.Part(file_data=types.FileData(file_uri=bundle.video_uri,
                                                             mime_type=bundle.media_mime or "video/mp4")))
        if bundle.media_uri:
            # A user-saved image / PDF (and later audio), read straight from gs:// — same
            # FileData mechanism as video. Vertex requires the explicit mimeType.
            parts.append(types.Part(file_data=types.FileData(
                file_uri=bundle.media_uri, mime_type=bundle.media_mime or "application/octet-stream")))
        # Inline image bytes (e.g. every slide of an Instagram carousel) so the model reads
        # the actual post imagery, not just the caption. Small per-image, well under the
        # ~20 MB inline ceiling at this slide count.
        for img in bundle.image_parts:
            parts.append(types.Part.from_bytes(data=img["data"],
                                               mime_type=img.get("mime_type", "image/jpeg")))
        text_prompt = [f"URL: {url}", f"content_type: {content_type}"]
        meta = bundle.metadata
        if meta.get("title"):
            text_prompt.append(f"Source title: {meta['title']}")
        if meta.get("author"):
            text_prompt.append(f"Author/creator: {meta['author']}")
        if meta.get("description"):
            text_prompt.append(f"Video description (may contain links and key details):\n{meta['description']}")
        if bundle.structured:
            text_prompt.append(
                "JSON-LD ground truth from the page (authoritative for exact values):\n"
                + json.dumps(bundle.structured, ensure_ascii=False)[:12000]
            )
        if bundle.text:
            text_prompt.append(f"Content:\n{bundle.text[:28000]}")
        if bundle.video_uri:
            text_prompt.append(
                "Analyze the attached video fully (visuals, on-screen text, and speech). "
                + ("Also use the video description above — it may contain buy links, "
                   "key specs, or details not mentioned in the video itself. "
                   if meta.get("description") else "")
                + "Extract all relevant information."
            )
        if bundle.image_parts:
            n = len(bundle.image_parts)
            text_prompt.append(
                f"{n} images from the post are attached, in order — read the text and visuals "
                "in EVERY slide of the carousel and synthesize them together; do not stop at "
                "the first slide." if n > 1
                else "An image from the post is attached — read its text and visuals."
            )
        if bundle.media_uri:
            mime = bundle.media_mime or ""
            text_prompt.append(
                "A PDF document is attached — read all of its text and any figures/tables, "
                "and extract the structured information." if mime == "application/pdf"
                else "An audio recording is attached — transcribe it and extract the key content."
                if mime.startswith("audio/")
                else "An image the user saved is attached — read all of its text and visuals "
                "(it may be a screenshot of a recipe, product, post, or note) and extract "
                "the structured information."
            )
        if note_hint:
            text_prompt.append(f"User instruction for this note: {note_hint}")
        parts.append(types.Part(text="\n\n".join(text_prompt)))
        return [types.Content(role="user", parts=parts)]

    def extract(self, url: str, bundle: ContentBundle, content_type: str,
                note_hint: str | None = None) -> NoteExtraction:
        # Exact known type → its schema; else a family slug → that family's schema
        # (entertainment titles / place venues); else the open composer.
        if content_type in TYPE_PROMPTS:
            system = TYPE_PROMPTS[content_type]
        elif is_entertainment(content_type):
            system = TYPE_PROMPTS["entertainment"]
        elif is_places(content_type):
            system = TYPE_PROMPTS["place"]
        else:
            system = COMPOSER_PROMPT
        config = types.GenerateContentConfig(
            response_mime_type="application/json",
            system_instruction=system,
            temperature=0.2,
        )
        if bundle.video_uri:
            # Low media resolution: ~4x fewer video tokens; plenty for note extraction.
            try:
                config.media_resolution = types.MediaResolution.MEDIA_RESOLUTION_LOW
            except AttributeError:
                pass  # older SDK without media_resolution — default is fine
        # One retry: the global endpoint throws transient 5xx, and a flaky generation can
        # return unparseable JSON — both deserve a second attempt before failing the job.
        last_exc: Exception | None = None
        for attempt in (1, 2):
            try:
                response = self.client.models.generate_content(
                    model=settings.GEMINI_MODEL,
                    contents=self._build_contents(url, bundle, content_type, note_hint),
                    config=config,
                )
                record_usage(settings.GEMINI_MODEL, response)
                parsed = NoteExtraction.model_validate_json(_strip_code_fences(response.text))
                parsed.content_type = content_type  # enforce Step 1's decision
                return parsed
            except Exception as e:
                last_exc = e
                if attempt == 1:
                    log.warning("extract attempt 1 failed, retrying: %s: %s",
                                type(e).__name__, e, extra={"url": url})
                    time.sleep(2)
        raise last_exc

    async def extract_async(self, url: str, bundle: ContentBundle, content_type: str,
                            note_hint: str | None = None) -> NoteExtraction:
        return await asyncio.to_thread(self.extract, url, bundle, content_type, note_hint)

    # ---------- Ask AI: chat grounded in the user's saved notes ----------

    def _plan_ask(self, question: str, history: list[dict], today: str,
                  index: list[dict]) -> AskPlan:
        prompt_parts = [f"Today: {today}", f"Message: {question}"]
        if history:
            prompt_parts.append("Recent conversation:\n" + _history_lines(history))
        prompt_parts.append("Candidate note index (JSON):\n" + json.dumps(index, ensure_ascii=False))
        for attempt in (1, 2):
            try:
                response = self.client.models.generate_content(
                    model=settings.GEMINI_LITE_MODEL,
                    contents=["\n\n".join(prompt_parts)],
                    config=types.GenerateContentConfig(
                        response_mime_type="application/json",
                        system_instruction=ASK_PLAN_SYSTEM,
                        thinking_config=types.ThinkingConfig(thinking_budget=0),
                    ),
                )
                record_usage(settings.GEMINI_LITE_MODEL, response)
                return AskPlan.model_validate_json(_strip_code_fences(response.text))
            except Exception as e:
                if attempt == 1:
                    log.warning("plan_ask attempt 1 failed, retrying: %s: %s",
                                type(e).__name__, e)
                    time.sleep(2)
        # Planning is best-effort: default to a note-scoped answer with no picks, which
        # degrades to "nothing found" rather than failing the whole ask.
        return AskPlan(scope="notes")

    async def plan_ask(self, question: str, history: list[dict], today: str,
                       index: list[dict]) -> AskPlan:
        return await asyncio.to_thread(self._plan_ask, question, history, today, index)

    def _answer_chat(self, question: str, history: list[dict]) -> GroundedAnswer:
        prompt_parts = []
        if history:
            prompt_parts.append("Conversation so far:\n" + _history_lines(history))
        prompt_parts.append(f"Message: {question}")
        last_exc: Exception | None = None
        for attempt in (1, 2):
            try:
                response = self.client.models.generate_content(
                    model=settings.GEMINI_MODEL,
                    contents=["\n\n".join(prompt_parts)],
                    config=types.GenerateContentConfig(
                        response_mime_type="application/json",
                        system_instruction=ASK_CHAT_SYSTEM,
                        temperature=0.4,
                    ),
                )
                record_usage(settings.GEMINI_MODEL, response)
                answer = GroundedAnswer.model_validate_json(_strip_code_fences(response.text))
                answer.cited_note_ids = []  # chat mode never cites notes
                return answer
            except Exception as e:
                last_exc = e
                if attempt == 1:
                    log.warning("answer_chat attempt 1 failed, retrying: %s: %s",
                                type(e).__name__, e)
                    time.sleep(2)
        raise last_exc

    async def answer_chat(self, question: str, history: list[dict]) -> GroundedAnswer:
        return await asyncio.to_thread(self._answer_chat, question, history)

    def _answer_from_notes(self, question: str, history: list[dict], notes: list[dict],
                           focal_title: str | None = None) -> GroundedAnswer:
        prompt_parts = []
        if history:
            prompt_parts.append("Conversation so far:\n" + _history_lines(history))
        if focal_title:
            prompt_parts.append(_focal_hint(focal_title))
        for n in notes:
            prompt_parts.append(
                f"NOTE id={n.get('id')} | {n.get('content_type', '')} | {n.get('title', '')}"
                f" | {n.get('source_domain', '')}\n"
                f"summary: {n.get('ai_summary', '')}\n"
                f"data: {json.dumps(n.get('data', {}), ensure_ascii=False, default=str)[:6000]}"
            )
        prompt_parts.append(f"Question: {question}")
        last_exc: Exception | None = None
        for attempt in (1, 2):
            try:
                response = self.client.models.generate_content(
                    model=settings.GEMINI_MODEL,
                    contents=["\n\n".join(prompt_parts)],
                    config=types.GenerateContentConfig(
                        response_mime_type="application/json",
                        system_instruction=ASK_ANSWER_NOTES_SYSTEM,
                        temperature=0.3,
                    ),
                )
                record_usage(settings.GEMINI_MODEL, response)
                return GroundedAnswer.model_validate_json(_strip_code_fences(response.text))
            except Exception as e:
                last_exc = e
                if attempt == 1:
                    log.warning("answer_from_notes attempt 1 failed, retrying: %s: %s",
                                type(e).__name__, e)
                    time.sleep(2)
        raise last_exc

    async def answer_from_notes(self, question: str, history: list[dict], notes: list[dict],
                                focal_title: str | None = None) -> GroundedAnswer:
        return await asyncio.to_thread(self._answer_from_notes, question, history, notes,
                                       focal_title)

    def _synthesize(self, question: str, history: list[dict], notes: list[dict],
                    output: str, focal_title: str | None = None,
                    existing_categories: list[str] | None = None) -> SynthAnswer:
        existing_categories = existing_categories or []
        prompt_parts = [f"OUTPUT kind requested: {output}"]
        cats = ", ".join(existing_categories) if existing_categories else "none yet"
        prompt_parts.append(f"User's existing categories: {cats}")
        if history:
            prompt_parts.append("Conversation so far:\n" + _history_lines(history))
        if focal_title:
            prompt_parts.append(_focal_hint(focal_title))
        for n in notes:
            prompt_parts.append(
                f"NOTE id={n.get('id')} | {n.get('content_type', '')} | {n.get('title', '')}"
                f" | {n.get('source_domain', '')}\n"
                f"summary: {n.get('ai_summary', '')}\n"
                f"data: {json.dumps(n.get('data', {}), ensure_ascii=False, default=str)[:6000]}"
            )
        prompt_parts.append(f"Request: {question}")
        last_exc: Exception | None = None
        for attempt in (1, 2):
            try:
                response = self.client.models.generate_content(
                    model=settings.GEMINI_MODEL,
                    contents=["\n\n".join(prompt_parts)],
                    config=types.GenerateContentConfig(
                        response_mime_type="application/json",
                        system_instruction=ASK_SYNTH_SYSTEM,
                        temperature=0.3,
                    ),
                )
                record_usage(settings.GEMINI_MODEL, response)
                synth = SynthAnswer.model_validate_json(_strip_code_fences(response.text))
                # Final safety net: collapse case/space/plural variants to an existing category.
                synth.artifact.content_type = match_existing(
                    synth.artifact.content_type, existing_categories
                )
                return synth
            except Exception as e:
                last_exc = e
                if attempt == 1:
                    log.warning("synthesize attempt 1 failed, retrying: %s: %s",
                                type(e).__name__, e)
                    time.sleep(2)
        raise last_exc

    async def synthesize(self, question: str, history: list[dict], notes: list[dict],
                         output: str, focal_title: str | None = None,
                         existing_categories: list[str] | None = None) -> SynthAnswer:
        return await asyncio.to_thread(self._synthesize, question, history, notes, output,
                                       focal_title, existing_categories)

    # ---------- Composed digests (smart collections + personal week-in-review) ----------

    def _run_digest(self, header_lines: list[str], notes: list[dict],
                    system: str) -> CollectionDigest | None:
        """Shared core behind both digest builders: serialize the fed notes (CONTENT-first, with
        the per-note data excerpt), call Gemini once (retry once) under `system`, parse into a
        CollectionDigest, drop entries citing ids outside the fed set, and drop sections left with
        neither body nor items.

        Best-effort end to end: a failure anywhere in here — including note serialization while
        assembling the prompt, not just the model call — resolves to `return None` so the caller
        can keep serving the last cached digest (marked stale) instead of a 500.
        """
        try:
            prompt_parts = list(header_lines)
            for n in notes:
                # CONTENT (data) comes FIRST and is what the model must read; title/summary are
                # pushed below and labeled as metadata only, so the model can't take the lazy
                # path of paraphrasing them instead of opening data (that was v2's failure mode —
                # the prompt banned title-restatement but data was still an afterthought after
                # title/summary in the note's own serialization).
                data_excerpt = json.dumps(
                    n.get("data", {}), ensure_ascii=False, default=str,
                )[:settings.DIGEST_NOTE_DATA_EXCERPT_CHARS]
                prompt_parts.append(
                    f"NOTE id={n.get('id')}\n"
                    f"CONTENT (read this): {data_excerpt}\n"
                    f"metadata (identification only, never copy into output): "
                    f"type={n.get('content_type', '')} | title={n.get('title', '')} | "
                    f"source={n.get('source_domain', '')} | summary={n.get('ai_summary', '')}"
                )
            last_exc: Exception | None = None
            for attempt in (1, 2):
                try:
                    response = self.client.models.generate_content(
                        model=settings.GEMINI_MODEL,
                        contents=["\n\n".join(prompt_parts)],
                        config=types.GenerateContentConfig(
                            response_mime_type="application/json",
                            system_instruction=system,
                            temperature=0.5,
                        ),
                    )
                    record_usage(settings.GEMINI_MODEL, response)
                    digest = CollectionDigest.model_validate_json(_strip_code_fences(response.text))
                    # Drop any entry the model cited that isn't actually one of the fed notes (a
                    # hallucinated/foreign id must never deep-link into someone else's note), then
                    # drop any section left with nothing at all — but a section can be body-only
                    # (no items), so only drop sections with neither.
                    valid_ids = {n.get("id") for n in notes}
                    for section in digest.sections:
                        section.items = [it for it in section.items if it.note_id in valid_ids]
                    digest.sections = [
                        s for s in digest.sections if s.items or s.body.strip()
                    ]
                    return digest
                except Exception as e:
                    last_exc = e
                    if attempt == 1:
                        log.warning("build_digest attempt 1 failed, retrying: %s: %s",
                                    type(e).__name__, e)
                        time.sleep(2)
            log.error("build_digest failed after retry: %s: %s",
                      type(last_exc).__name__, last_exc)
            return None
        except Exception as e:
            log.error("build_digest failed: %s: %s", type(e).__name__, e)
            return None

    def _build_digest(self, name: str, description: str,
                      notes: list[dict]) -> CollectionDigest | None:
        header_lines = [f"Collection name: {name}"]
        if description:
            header_lines.append(f"Collection description: {description}")
        return self._run_digest(header_lines, notes, DIGEST_SYSTEM)

    async def build_digest(self, name: str, description: str,
                           notes: list[dict]) -> CollectionDigest | None:
        return await asyncio.to_thread(self._build_digest, name, description, notes)

    def _build_personal_digest(self, display_name: str, window_label: str,
                               notes: list[dict]) -> CollectionDigest | None:
        header_lines = [
            f"User: {display_name or 'there'}",
            f"Window: {window_label}",
        ]
        return self._run_digest(header_lines, notes, PERSONAL_DIGEST_SYSTEM)

    async def build_personal_digest(self, display_name: str, window_label: str,
                                    notes: list[dict]) -> CollectionDigest | None:
        return await asyncio.to_thread(
            self._build_personal_digest, display_name, window_label, notes)

    def _create_note(self, question: str, history: list[dict],
                     existing_categories: list[str]) -> ArtifactNote:
        prompt_parts = []
        if history:
            prompt_parts.append("Conversation:\n" + _history_lines(history))
        cats = ", ".join(existing_categories) if existing_categories else "none yet"
        prompt_parts.append(f"User's existing categories: {cats}")
        prompt_parts.append(f"Create-note request: {question}")
        last_exc: Exception | None = None
        for attempt in (1, 2):
            try:
                response = self.client.models.generate_content(
                    model=settings.GEMINI_MODEL,
                    contents=["\n\n".join(prompt_parts)],
                    config=types.GenerateContentConfig(
                        response_mime_type="application/json",
                        system_instruction=ASK_CREATE_SYSTEM,
                        temperature=0.4,
                    ),
                )
                record_usage(settings.GEMINI_MODEL, response)
                artifact = ArtifactNote.model_validate_json(_strip_code_fences(response.text))
                artifact.origin = "created"
                # Final safety net: collapse case/space/plural variants to an existing category.
                artifact.content_type = match_existing(artifact.content_type, existing_categories)
                return artifact
            except Exception as e:
                last_exc = e
                if attempt == 1:
                    log.warning("create_note attempt 1 failed, retrying: %s: %s",
                                type(e).__name__, e)
                    time.sleep(2)
        raise last_exc

    async def create_note(self, question: str, history: list[dict],
                          existing_categories: list[str] | None = None) -> ArtifactNote:
        return await asyncio.to_thread(self._create_note, question, history,
                                       existing_categories or [])

    # ---------- Search-grounded page lookup (for bot-blocked pages) ----------

    def _search_grounded_page(self, url: str, hint: str = "") -> str | None:
        """Recover page facts via Google Search grounding when the page itself is
        unreachable from datacenter IPs (Amazon blocks direct fetch, Jina, and even
        Gemini's url_context — but its listings are fully indexed by Google Search).
        Returns grounded prose for the normal extraction pipeline, or None."""
        prompt = (
            f"Use Google Search to find this exact page: {url}\n"
            + (f"Known hint about it: {hint}\n" if hint else "")
            + "Report ONLY facts you find about this exact page/product/item: full title, "
            "brand/author, current price, rating and review count, key features or specs, "
            "and a short factual description. Do not include facts about similar items. "
            "If you cannot find this exact page, reply with just: NOT_FOUND"
        )
        for attempt in (1, 2):  # transient 5xx happen on the global endpoint
            try:
                resp = self.client.models.generate_content(
                    model=settings.GEMINI_MODEL,
                    contents=prompt,
                    config=types.GenerateContentConfig(
                        tools=[types.Tool(google_search=types.GoogleSearch())],
                        temperature=0.1,
                    ),
                )
                record_usage(settings.GEMINI_MODEL, resp)
                text = (resp.text or "").strip()
                if not text or "NOT_FOUND" in text[:300]:
                    return None
                return text
            except Exception as e:
                if attempt == 2:
                    log.warning("search-grounded lookup failed: %s", e, extra={"url": url})
        return None

    async def search_grounded_page(self, url: str, hint: str = "") -> str | None:
        return await asyncio.to_thread(self._search_grounded_page, url, hint)

    # ---------- General web research (Ask AI agent: research_web tool) ----------

    def _web_research(self, query: str) -> str | None:
        """General-purpose web research via Google Search grounding — current/external facts
        the user's notes don't contain (prices, hours, recent papers, live FX). Distinct from
        `_search_grounded_page`, which hunts for ONE known URL. Returns concise sourced prose."""
        if not query.strip():
            return None
        prompt = (
            "Use Google Search to answer this research request with CURRENT, factual information. "
            "Be concise and specific: report concrete facts (names, numbers, prices, dates, "
            "sources) — not filler. If you can't find reliable information, say so plainly.\n\n"
            f"Request: {query}"
        )
        for attempt in (1, 2):  # transient 5xx happen on the global endpoint
            try:
                resp = self.client.models.generate_content(
                    model=settings.GEMINI_MODEL,
                    contents=prompt,
                    config=types.GenerateContentConfig(
                        tools=[types.Tool(google_search=types.GoogleSearch())],
                        temperature=0.2,
                    ),
                )
                record_usage(settings.GEMINI_MODEL, resp)
                return (resp.text or "").strip() or None
            except Exception as e:
                if attempt == 2:
                    log.warning("web research failed: %s: %s", e, extra={"query": query[:120]})
        return None

    async def web_research(self, query: str) -> str | None:
        return await asyncio.to_thread(self._web_research, query)


gemini_service = GeminiService()
