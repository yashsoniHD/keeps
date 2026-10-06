"""Note extraction pipeline (OpenRouter model chains).

Classify: rules first (shop domains, JSON-LD @type, video sources), then one CLASSIFY_MODELS
call against the user's existing categories only when rules don't decide.

Extract: source evidence, flexible document composition and bounded review by default.
NOTE_DOCUMENTS_ENABLED=false restores legacy type-focused prompts. Known types get a TYPE_PROMPT carrying only that type's schema;
unknown/invented slugs get the composer prompt (facts/sections/steps/table/checklist/quotes).
Video (reels, YouTube fallback files) goes to VIDEO_MODELS as a base64 `video_url` part; a
YouTube URL gets ONE YOUTUBE_MODELS attempt, else `VideoUnreadable`.

Every call passes a model chain via OpenRouter's `models` fallback (free first, paid floor).
Free endpoints may lack JSON mode, so JSON is enforced by prompt and repaired by a tolerant
parser plus one "fix this JSON" nudge that re-sends only the bad output, never the payload.

Module/class names keep "gemini" for import stability.
"""
import asyncio
import base64
import contextvars
import json
import logging
import re
import time
from concurrent.futures import ThreadPoolExecutor
from concurrent.futures import TimeoutError as FutureTimeout
from urllib.parse import urlparse

import httpx
from openai import APITimeoutError, OpenAI
from pydantic import ValidationError

from config import settings
from models.note import ContentBundle, NoteExtraction
from services.usage_meter import record_usage

log = logging.getLogger("keeps.gemini")


class ProviderError(ValueError):
    """OpenRouter answered 200 but with `error` set or no `choices` (every provider failed).
    A ValueError so callers treat it like any other empty reply."""


class VideoUnreadable(Exception):
    """The video model could not produce a note from this video (or YouTube URL). The caller
    falls back (YouTube scraper / caption-only note); the message carries the cause."""


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


# Place family — routes slugs like "restaurants"/"cafes" to the `place` venues[] schema.
# Whole hyphen-token match (with plural folding) so "bar" doesn't hit "barbell-workout".
_PLACES_KEYWORDS = (
    "place", "restaurant", "cafe", "bar", "dining", "eatery", "bakery", "dessert",
    "brewery", "pub", "venue", "attraction", "viewpoint", "hotel", "stay", "things-to-do",
)


def _is_places(content_type: str) -> bool:
    slug = normalize_slug(content_type)
    tokens = set(slug.split("-"))
    for kw in _PLACES_KEYWORDS:
        if "-" in kw:
            if kw in slug:
                return True
        elif kw in tokens or any(t.rstrip("s") == kw for t in tokens):
            return True
    return False


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
   - "resources" — a roundup of things to check out: videos, tools, repos, apps, courses,
     plugins, newsletters ("3 videos you must watch", "11 new Claude plugins", "this free
     GitHub tool"). Software/free tools are "resources", NOT "product".
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


_SHARED_RULES = """You are a note extraction engine. The user saves links and never wants to
open the source again — your note must be MORE useful than the source.

Output is STRUCTURED JSON ONLY — no HTML, no markdown, no styling. Shape:
{
  "content_type": "<echo the slug you were given — do not change it>",
  "title": "SHORT title, 2-6 words, max ~40 characters, SENTENCE CASE (capitalize only the first word and proper nouns/brand names/acronyms), a label not a sentence, e.g. 'Paneer butter masala', '3 days in Meghalaya', 'Sony WH-1000XM5 review', 'Themed restaurants in Bengaluru'",
  "ai_summary": "ONE concise, specific sentence (~15-25 words) capturing the single most useful takeaway from THIS content (mention an actual detail)",
  "data": { ...per the schema below... }
}

Extraction rules:
- Extract CONCRETE values: real quantities, timings, prices, set/rep counts, place names.
- If the content shows something visually but never says it aloud, extract what is SHOWN.
- Strip sponsorships, intros, filler and calls-to-action. NEVER output "comment X",
  "link in bio", "check the pinned comment", "follow for more", "DM me" or similar in ANY
  field — they are not action items.
- Fill every schema field the source supports. If the source does not support a field,
  OMIT it — never write placeholder text ("Unspecified", "not mentioned", "implies ...",
  "possibly ...") and never write null.
- Each field must add something the others don't. Do not restate the title, ai_summary or
  another field in different words.
- Do not transcribe. Never copy the speech sentence by sentence; distil it.
- Spell proper nouns (people, places, venues, products) as they are correctly known; if
  on-screen text shows a name, prefer its spelling over what you heard.
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
  "destination": str, "duration"?: "e.g. 5 days — only if the source states a length", "budget"?: "with currency",
  "bestSeason"?: str,
  "days": [{"day": 1, "title": "e.g. Old Town & Food Walk",
            "stops": [{"time"?: "09:00", "place": str, "note": "why go / what to do / cost"}]}],
  "tips"?: ["transport, booking, local etiquette", ...]
}
Only use multiple days when the source gives a day-by-day plan. Otherwise put every stop in
ONE entry ({"day": 1, "title": "Stops", ...}) in the source's order and omit "duration".""",

    "product": _SHARED_RULES + """

`data` schema for product:
{
  "price": "with currency symbol", "brand": str, "rating"?: "0-5 float",
  "buyUrl": "the product page URL",
  "specs": [{"label": str, "value": str}],   // the specs that actually matter for a buying decision
  "pros": [str], "cons"?: [str],             // from reviews/description; honest, specific; omit cons if the source gives none
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
  "tldr": "2-3 sentences stating the actual argument/conclusion, not a teaser ('covers topics like...' is a failure)",
  "keyPoints": ["3-6 items, each a complete, specific claim NOT already in the tldr", ...],
  "quotes"?: [{"text": str, "timestamp"?: str}],   // AT MOST 2, only genuinely memorable lines; omit for videos under 3 minutes
  "actionItems"?: ["concrete things the content tells the viewer to do in their own life/work", ...]
}""",

    "place": _SHARED_RULES + """

This is a place recommendation — a single venue OR a list (a "5 cafes to try" reel, a thread, a
best-of article). Extract EVERY distinct venue mentioned as its own entry so each becomes a
trackable place to try. NEVER merge two different venues into one entry, and NEVER invent a venue
that is not named in the source.

COUNT CHECK: if the source announces a count ("10 must-visit restaurants", "5 rooftop bars"),
`venues` MUST contain exactly that many entries — recount before you answer. The ONLY exception:
if the source actually names fewer venues than it announces, output only the named ones — NEVER
invent a venue to reach the announced count. Output venues in the source's own order;
array position IS the ranking (there is no separate rank field).

`data` schema for place (restaurant, cafe, bar, attraction, hotel):
{
  "facts"?: [{"label": str, "value": str}],   // 2-4 at-a-glance facts ABOUT THE LIST itself
                                              // (e.g. "City":"Lisbon", "Count":"10 cafes"), optional
  "venues": [{
    "name": "the venue's name exactly as stated",
    "location"?: "the real area/neighbourhood and/or city, ONLY if given. A theme label like 'Mini Dubai' is NOT a location — put it in `why`",
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
COMPLETENESS (fabrication-safe): every venue MUST carry at least one of `why` or `highlights`,
drawn from the source, and `why`/`highlights` must not just repeat the list's theme. If the source only names the venue with no detail, set `why` from the
list's own framing (e.g. "One of the 10 best brunch spots in Bandra") — NEVER invent dishes,
prices, ratings, or any attribute the source did not state.
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

    "resources": _SHARED_RULES + """

This is a roundup of things to check out (videos, tools, repos, apps, courses, plugins) — or a
single one. Extract EVERY distinct item named as its own entry; NEVER invent an item.

`data` schema for resources:
{
  "items": [{
    "name": "the item's name/title exactly as stated",
    "kind": "video | tool | repo | app | course | plugin | article | book | other",
    "creator"?: "person/company behind it, if stated",
    "what": "one line: what it is / what you get from it, specific",
    "url"?: "ONLY a URL shown/stated for THIS item — never guess one, never reuse one item's URL for another",
    "cost"?: "e.g. Free, $20/mo — only if stated"
  }],
  "context"?: "one line on why these were recommended, if it adds something"
}
The note's own `title`/`ai_summary` should describe the roundup as a whole.""",

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


def _strip_code_fences(text: str) -> str:
    t = text.strip()
    if t.startswith("```"):
        t = re.sub(r"^```[a-z]*\n?", "", t)
        t = re.sub(r"\n?```$", "", t)
    return t


# JSON-object mode on some providers (DeepSeek) requires the word "json" in the prompt, and
# several system prompts (COMPOSER_PROMPT, CATEGORY_CAP_RULE, …) don't contain it.
JSON_SUFFIX = "\nRespond with a single JSON object."

OPENROUTER_BASE_URL = "https://openrouter.ai/api/v1"


def _youtube_uri(bundle: ContentBundle) -> str | None:
    """The bundle's video URI when it is a YouTube URL (the only video a model reads directly).
    A legacy gs:// video_uri is treated as absent → the note is extracted from text."""
    uri = bundle.video_uri or ""
    host = (urlparse(uri).hostname or "").lower()
    if host == "youtu.be" or host == "youtube.com" or host.endswith(".youtube.com"):
        return uri
    return None


# Absolute time.monotonic() deadline of the current request (set by process_job); extract()
# falls back to it when no explicit `deadline` is passed. None = unbounded.
job_deadline: contextvars.ContextVar[float | None] = contextvars.ContextVar(
    "job_deadline", default=None)



# ---------- Rules-first classification ----------

_SHOP_HOSTS = ("amazon.", "amzn.", "flipkart.com", "myntra.com", "ajio.com", "nykaa.com",
               "meesho.com", "ebay.", "etsy.com", "bestbuy.com", "walmart.com")
_VIDEO_HOSTS = ("youtube.com", "youtu.be", "tiktok.com", "fb.watch")


def _host(url: str) -> str:
    host = (urlparse(url or "").hostname or "").lower()
    return host[4:] if host.startswith("www.") else host


def is_video_source(url: str, bundle: ContentBundle) -> bool:
    """YouTube / reels / TikTok: the video model reads the video itself and picks the type."""
    host, path = _host(url), urlparse(url or "").path.lower()
    return (bundle.strategy.startswith(("reel_", "youtube"))
            or any(host == h or host.endswith("." + h) for h in _VIDEO_HOSTS)
            or (("instagram.com" in host or "facebook.com" in host)
                and any(seg in path for seg in ("/reel/", "/reels/", "/tv/", "/videos/"))))


def _jsonld_types(node, depth: int = 0) -> set[str]:
    """Every schema.org @type in a JSON-LD blob (top level, @graph, and lists)."""
    if depth > 3:
        return set()
    if isinstance(node, list):
        return set().union(*(_jsonld_types(n, depth + 1) for n in node)) if node else set()
    if not isinstance(node, dict):
        return set()
    t = node.get("@type")
    found = {x.lower() for x in (t if isinstance(t, list) else [t]) if isinstance(x, str)}
    return found | _jsonld_types(node.get("@graph"), depth + 1)


def rule_category(url: str, bundle: ContentBundle) -> str | None:
    """Deterministic content_type from domain / page type, or None when rules don't decide.
    ponytail: a short domain list + two JSON-LD types; extend the tuples as misses show up."""
    types = _jsonld_types(bundle.structured)
    if "recipe" in types:
        return "recipe"
    host = _host(url)
    if "product" in types or any(h in host for h in _SHOP_HOSTS):
        return "product"
    return None


# ---------- Tolerant JSON ----------

_THINK_RE = re.compile(r"<think>.*?</think>", re.S)

JSON_NUDGE = ("\n\nYour previous reply (the user message) was not valid JSON for this shape. "
              "Return the SAME content as ONE valid JSON object — no prose, no code fences.")


def parse_json(text: str):
    """Model reply → JSON. Strips <think> blocks and ``` fences, then falls back to the span
    from the first '{' to the last '}'. Raises ValueError (JSONDecodeError) when unparseable."""
    t = _strip_code_fences(_THINK_RE.sub("", text or ""))
    try:
        return json.loads(t)
    except json.JSONDecodeError:
        i, j = t.find("{"), t.rfind("}")
        if i < 0 or j <= i:
            raise
        return json.loads(t[i:j + 1])


def _note_from(obj) -> NoteExtraction:
    if not isinstance(obj, dict):
        raise ValueError("reply is not a JSON object")
    return NoteExtraction.model_validate(obj)


# ---------- Any-type prompt (the video model picks content_type itself) ----------

_CATEGORY_RULES = CATEGORY_SYSTEM.split("Rules, in priority order:\n", 1)[1]
ANY_TYPE_PROMPT = (
    _SHARED_RULES.replace('"<echo the slug you were given — do not change it>"',
                          '"<the most specific slug — see Choosing content_type>"')
    + "\n\nChoosing content_type (lowercase-kebab-case):\n" + _CATEGORY_RULES
    + "\n\nKnown types — when content_type is one of these, `data` MUST follow its schema:\n"
    + "\n".join(f"\n=== {k} ==={p[len(_SHARED_RULES):]}" for k, p in TYPE_PROMPTS.items())
    + "\n\n=== any other content_type ===" + COMPOSER_PROMPT[len(_SHARED_RULES):]
)

VIDEO_INSTRUCTIONS = (
    "Watch the attached video end to end. Describe what is SEEN (on-screen text, captions "
    "burned into the frame, demonstrations, products, dishes, places, quantities) AND what is "
    "HEARD (speech, narration, voice-over). The caption and top comments are extra context "
    "from the post; the video itself is the primary source. Extract all relevant information.")


THIN_RULE = (
    "THIN SOURCE: only the post's caption is available — the video itself could not be read. "
    "Fill ONLY the fields the caption text explicitly supports and leave every other field "
    "out: no estimated times, quantities, prices, tips, song or title names, or steps that "
    "the caption does not state. Keep the post's own shape: a list of places stays a list of "
    "venues — NEVER turn it into a day-by-day itinerary. A short, sparse note is correct here.")


def _system_for(content_type: str | None) -> str:
    """Exact known type → its schema; entertainment/place family → that schema; None → the
    any-type prompt (model picks); anything else → the open composer."""
    if not content_type:
        return ANY_TYPE_PROMPT
    if content_type in TYPE_PROMPTS:
        return TYPE_PROMPTS[content_type]
    if is_entertainment(content_type):
        return TYPE_PROMPTS["entertainment"]
    if _is_places(content_type):
        return TYPE_PROMPTS["place"]
    return COMPOSER_PROMPT


def _call_timeout(cap: float, deadline: float | None = None) -> float:
    """min(cap, remaining job budget), floored at 15 s."""
    if deadline is None:
        deadline = job_deadline.get()
    if deadline is None:
        return cap
    return min(cap, max(15.0, deadline - time.monotonic()))


# Video calls leave this much budget for the caption/text fallback + a JSON nudge, and are
# skipped outright (VideoUnreadable) when less than VIDEO_MIN_BUDGET_S remains.
VIDEO_RESERVE_S = 60
VIDEO_MIN_BUDGET_S = 75


def _video_timeout(deadline: float | None = None) -> float:
    """min(VIDEO_CALL_TIMEOUT_S, remaining - VIDEO_RESERVE_S); raises VideoUnreadable when the
    remaining job budget is under VIDEO_MIN_BUDGET_S."""
    if deadline is None:
        deadline = job_deadline.get()
    if deadline is None:
        return float(settings.VIDEO_CALL_TIMEOUT_S)
    remaining = deadline - time.monotonic()
    if remaining < VIDEO_MIN_BUDGET_S:
        raise VideoUnreadable(f"only {remaining:.0f}s of job budget left; skipping video call")
    return min(float(settings.VIDEO_CALL_TIMEOUT_S), remaining - VIDEO_RESERVE_S)


def _categories_line(content_type: str | None, categories: list[str] | None) -> str | None:
    """When the model picks the type, it must see the user's categories to reuse them."""
    if content_type:
        return None
    return f"User's existing categories: {', '.join(categories or []) or 'none yet'}"


def _system_with_cap(content_type: str | None, categories: list[str] | None) -> str:
    system = _system_for(content_type)
    if not content_type and len(categories or []) >= settings.MAX_USER_CATEGORIES:
        system += CATEGORY_CAP_RULE
    return system


# OpenRouter streams keep-alive whitespace ahead of non-streaming replies, so httpx's per-read
# timeout may never fire: every call runs here and is abandoned at a wall-clock deadline.
# ponytail: an abandoned call keeps its worker until the server finishes or the socket drops;
# 16 workers is ample at current volume — switch to an async client + cancellation if not.
_TIMEOUT_REQUEST = httpx.Request("POST", OPENROUTER_BASE_URL + "/chat/completions")
_POOL = ThreadPoolExecutor(max_workers=16, thread_name_prefix="openrouter")

# max_tokens caps per call type.
MAX_TOKENS_CLASSIFY = 600
MAX_TOKENS_NOTE = 8000
MAX_TOKENS_GROUNDED = 1500


class GeminiService:
    def __init__(self):
        key = settings.OPENROUTER_API_KEY or "unset"  # SDK refuses an empty key at import time
        # SDK retries off: OpenRouter's `models` chain + process_job's retry are the retry layers.
        self.client = OpenAI(base_url=OPENROUTER_BASE_URL, api_key=key, max_retries=0, timeout=120)

    def _chat(self, models: list[str], system: str, text: str, **kw) -> tuple[str, str]:
        """`_chat_full` without the finish_reason → (reply text or "", model that answered)."""
        text_out, used, _ = self._chat_full(models, system, text, **kw)
        return text_out, used

    def _chat_full(self, models: list[str], system: str, text: str, *, json: bool = True,
                   temperature: float | None = None, images=(), video_url: str | None = None,
                   pin_google: bool = False, web: bool = False, timeout: float | None = None,
                   max_tokens: int = MAX_TOKENS_NOTE,
                   reserve: float = 15) -> tuple[str, str, str | None]:
        """One chat completion over a model chain → (reply text or "", model, finish_reason).

        models    → models[0] as `model`, the whole chain as `models` (OpenRouter falls back on
                    429/5xx/downtime). A client timeout, or a 200 carrying `error` / no
                    `choices` (OpenRouter's provider-error shape; the SDK doesn't raise), retries
                    once on models[1:] when at least `reserve` + 15 s of job budget remain, else
                    raises.
        json      → JSON_SUFFIX + `response_format` (a soft preference — never removes a model
                    without JSON mode from the chain; callers parse with `parse_json`)
        images    → bundle.image_parts dicts ({mime_type, data: bytes}) as data URLs
        video_url → a YouTube URL or a base64 `data:video/...` URL
        pin_google→ Google AI Studio only (the provider that fetches YouTube URLs)
        web       → OpenRouter web-search plugin
        timeout   → wall-clock seconds (default 120)
        No `reasoning` param: no chain contains a reasoning-first model any more.
        """
        if video_url or images:
            content: str | list = [{"type": "video_url", "video_url": {"url": video_url}}] if video_url else []
            content.append({"type": "text", "text": text})
            for img in images:
                b64 = base64.b64encode(img["data"]).decode()
                content.append({"type": "image_url", "image_url": {
                    "url": f"data:{img.get('mime_type', 'image/jpeg')};base64,{b64}"}})
        else:
            content = text
        extra: dict = {}
        if len(models) > 1:
            extra["models"] = list(models)
        if pin_google:
            extra["provider"] = {"order": ["google-ai-studio"], "allow_fallbacks": False}
        if web:
            extra["plugins"] = [{"id": "web", "max_results": 3}]
        kwargs: dict = {
            "model": models[0],
            "messages": ([{"role": "system", "content": system + (JSON_SUFFIX if json else "")}]
                         if system or json else []) + [{"role": "user", "content": content}],
            "max_tokens": max_tokens,
            "extra_body": extra,
        }
        if json:
            kwargs["response_format"] = {"type": "json_object"}
        if temperature is not None:
            kwargs["temperature"] = temperature
        wall = timeout if timeout is not None else 120.0
        kwargs["timeout"] = wall  # httpx connect/read limits; _POOL enforces the wall clock
        fut = _POOL.submit(self.client.chat.completions.create, **kwargs)
        try:
            resp = fut.result(timeout=wall)
            err = getattr(resp, "error", None)
            failure: Exception | None = (
                ProviderError(f"empty reply from {models[0]}: {err or 'no choices'}")
                if err or not getattr(resp, "choices", None) else None)
        except (APITimeoutError, FutureTimeout):
            fut.cancel()  # drops a call still queued behind abandoned ones; no-op once running
            failure = APITimeoutError(request=_TIMEOUT_REQUEST)
        if failure is not None:
            # OpenRouter's own fallback can't fire on a client abort, and an error-shaped 200
            # means it already gave up — walk the rest of the chain here.
            dl = job_deadline.get()
            remaining = None if dl is None else dl - time.monotonic()
            if len(models) < 2 or (remaining is not None and remaining < reserve + 15):
                raise failure
            retry_timeout = wall if remaining is None else min(wall, remaining - reserve)
            log.warning("model %s failed (%s); retrying on %s", models[0], failure, models[1:])
            return self._chat_full(models[1:], system, text, json=json, temperature=temperature,
                                   images=images, video_url=video_url, pin_google=pin_google,
                                   web=web, timeout=retry_timeout, max_tokens=max_tokens,
                                   reserve=reserve)
        used = getattr(resp, "model", None)
        if not isinstance(used, str) or not used:
            used = models[0]
        record_usage(used, resp)
        choice = resp.choices[0]
        return (choice.message.content or ""), used, getattr(choice, "finish_reason", None)

    def _note_json(self, models: list[str], system: str, prompt: str,
                   **kw) -> tuple[NoteExtraction, str]:
        """_chat + tolerant parse; on bad JSON, ONE nudge on TEXT_MODELS that re-sends only the
        bad reply (never the payload). An empty reply raises — nothing to repair."""
        text, used, finish = self._chat_full(models, system, prompt, **kw)
        try:
            return _note_from(parse_json(text)), used
        except (ValueError, ValidationError) as e:
            if not _THINK_RE.sub("", text).strip():  # nothing (or only reasoning) to repair
                raise ValueError(f"empty reply from {used}") from e
            if finish == "length":  # truncated (often a looping word): not repairable
                raise ValueError(f"reply from {used} hit max_tokens") from e
            log.warning("bad JSON from %s (%s: %s); nudging", used, type(e).__name__, e)
        fixed, _ = self._chat(settings.TEXT_MODELS, system + JSON_NUDGE, text[:30000],
                              temperature=0, timeout=_call_timeout(60),
                              max_tokens=MAX_TOKENS_NOTE)
        return _note_from(parse_json(fixed)), used

    def _extract_note(self, models, system, prompt, *, deadline=None, **kw):
        if not settings.NOTE_DOCUMENTS_ENABLED:
            return self._note_json(models, system, prompt, temperature=0.2, **kw)
        from services.note_document import generate_document
        rules = "\nChoosing category (does not determine layout):\n" + _CATEGORY_RULES
        if CATEGORY_CAP_RULE in system:
            rules += CATEGORY_CAP_RULE
        # Also bound transport-level model fallbacks, including callers without a worker.
        deadlines = [d for d in (deadline, job_deadline.get(), time.monotonic() + 240) if d is not None]
        end = min(deadlines)
        token = job_deadline.set(end)
        try:
            return generate_document(self._chat_full, parse_json, models, prompt, rules,
                                     deadline=end, **kw)
        finally:
            job_deadline.reset(token)

    # ---------- Step 1: categorization ----------

    async def classify(self, url: str, bundle: ContentBundle,
                       existing_categories: list[str],
                       note_hint: str | None = None) -> str | None:
        """Resolve a note's content_type. Returns None for video sources (no user hint): the
        video model picks the type itself (`extract_from_video(type_hint=None)` /
        `extract(content_type=None)`). Otherwise rules first (shop domains, JSON-LD @type),
        then one CLASSIFY_MODELS call; the slug is matched against the user's categories."""
        slug: str | None = None
        if not note_hint:
            if is_video_source(url, bundle):
                return None
            slug = rule_category(url, bundle)
        at_cap = len(existing_categories) >= settings.MAX_USER_CATEGORIES
        if slug is None:
            categories_str = ", ".join(existing_categories) if existing_categories else "none yet"
            prompt = (
                f"URL: {url}\n"
                f"Platform: {bundle.metadata.get('platform', 'web')}\n"
                f"Content preview: {bundle.preview[:600]}\n"
                f"User's existing categories: {categories_str}\n"
                + (f"User instruction: {note_hint}\n" if note_hint else "")
                + "Choose the content_type."
            )
            system = CATEGORY_SYSTEM + (CATEGORY_CAP_RULE if at_cap else "")
            try:
                text, _ = await asyncio.to_thread(
                    self._chat, settings.CLASSIFY_MODELS, system, prompt,
                    max_tokens=MAX_TOKENS_CLASSIFY, timeout=_call_timeout(45))
                slug = parse_json(text).get("content_type") or "summary"
            except (ValueError, AttributeError):
                slug = "summary"
        resolved = match_existing(slug, existing_categories)
        # Enforce the taxonomy cap in code (the prompt rule is best-effort): at/over the cap a
        # net-new slug is snapped onto the closest existing category, never appended.
        if at_cap and resolved not in existing_categories:
            resolved = closest_existing(resolved, existing_categories)
        return resolved

    # ---------- Step 2: type-focused extraction ----------

    def _build_prompt(self, url: str, bundle: ContentBundle, content_type: str | None,
                      note_hint: str | None = None, video_url: str | None = None,
                      images: bool = False, categories: list[str] | None = None) -> str:
        """The extraction user prompt. The video (YouTube URL) and carousel images are attached
        by `_chat`; `video_url`/`images` only say whether to tell the model about them."""
        text_prompt = [f"URL: {url}", f"content_type: {content_type or '(choose it)'}"]
        if line := _categories_line(content_type, categories):
            text_prompt.append(line)
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
        if video_url:
            text_prompt.append(
                "Analyze the attached video fully (visuals, on-screen text, and speech). "
                + ("Also use the video description above — it may contain buy links, "
                   "key specs, or details not mentioned in the video itself. "
                   if meta.get("description") else "")
                + "Extract all relevant information."
            )
        if images and bundle.image_parts:
            n = len(bundle.image_parts)
            text_prompt.append(
                f"{n} images from the post are attached, in order — read the text and visuals "
                "in EVERY slide of the carousel and synthesize them together; do not stop at "
                "the first slide." if n > 1
                else "An image from the post is attached — read its text and visuals."
            )
        if bundle.metadata.get("thin") or bundle.strategy.endswith("_thin"):
            text_prompt.append(THIN_RULE)
        if note_hint:
            text_prompt.append(f"User instruction for this note: {note_hint}")
        return "\n\n".join(text_prompt)

    def extract(self, url: str, bundle: ContentBundle, content_type: str | None,
                note_hint: str | None = None, deadline: float | None = None,
                categories: list[str] | None = None) -> NoteExtraction:
        """One extraction call. Routing: YouTube URL → YOUTUBE_MODELS (Google AI Studio pinned,
        ONE attempt; any failure raises VideoUnreadable); carousel images → IMAGE_MODELS; else
        TEXT_MODELS. content_type None → the model picks it (normalized slug). The model that
        answered is written to bundle.metadata["model"]. Transient failures propagate to
        process_job's retry; bad JSON gets one nudge. `categories` = the user's existing
        categories, shown to the model when it picks the type (content_type None)."""
        system = _system_with_cap(content_type, categories)
        yt = _youtube_uri(bundle)
        prompt = self._build_prompt(url, bundle, content_type, note_hint, video_url=yt,
                                    images=bool(bundle.image_parts) and not yt,
                                    categories=categories)
        if yt:
            yt_timeout = _video_timeout(deadline)  # raises VideoUnreadable when out of budget
            try:
                parsed, used = self._extract_note(settings.YOUTUBE_MODELS, system, prompt,
                                               deadline=deadline, video_url=yt, pin_google=True,
                                               timeout=yt_timeout, reserve=VIDEO_RESERVE_S)
            except Exception as e:
                raise VideoUnreadable(f"{type(e).__name__}: {e}") from e
        elif bundle.image_parts:
            parsed, used = self._extract_note(settings.IMAGE_MODELS, system, prompt,
                                           deadline=deadline, images=bundle.image_parts,
                                           timeout=_call_timeout(120, deadline))
        else:
            parsed, used = self._extract_note(settings.TEXT_MODELS, system, prompt,
                                           deadline=deadline, timeout=_call_timeout(120, deadline))
        parsed.content_type = content_type or normalize_slug(parsed.content_type)
        bundle.metadata["model"] = used
        return parsed

    async def extract_async(self, url: str, bundle: ContentBundle, content_type: str | None,
                            note_hint: str | None = None,
                            deadline: float | None = None,
                            categories: list[str] | None = None) -> NoteExtraction:
        return await asyncio.to_thread(self.extract, url, bundle, content_type, note_hint,
                                       deadline, categories)

    def _extract_from_video(self, video_bytes: bytes, mime: str, caption: str,
                            comments: list[str], type_hint: str | None,
                            categories: list[str] | None = None) -> NoteExtraction:
        if not video_bytes:
            raise VideoUnreadable("empty video")
        if len(video_bytes) > settings.VIDEO_MAX_BYTES:
            raise VideoUnreadable(f"video {len(video_bytes)} B > VIDEO_MAX_BYTES")
        parts = [f"content_type: {type_hint or '(choose it)'}"]
        if line := _categories_line(type_hint, categories):
            parts.append(line)
        if caption:
            parts.append(f"Post caption:\n{caption[:4000]}")
        top = [c.strip() for c in comments or [] if c and c.strip()][:20]
        if top:
            parts.append("Top comments:\n" + "\n".join(f"- {c[:300]}" for c in top))
        parts.append(VIDEO_INSTRUCTIONS)
        timeout = _video_timeout()  # raises VideoUnreadable when out of budget
        data_url = f"data:{mime or 'video/mp4'};base64,{base64.b64encode(video_bytes).decode()}"
        try:
            parsed, used = self._extract_note(
                settings.VIDEO_MODELS, _system_with_cap(type_hint, categories),
                "\n\n".join(parts), video_url=data_url,
                timeout=timeout, reserve=VIDEO_RESERVE_S)
        except Exception as e:
            raise VideoUnreadable(f"{type(e).__name__}: {e}") from e
        parsed.content_type = type_hint or normalize_slug(parsed.content_type)
        return parsed

    async def extract_from_video(self, video_bytes: bytes, mime: str, caption: str,
                                 comments: list[str], type_hint: str | None,
                                 categories: list[str] | None = None) -> NoteExtraction:
        """Reel / downloaded-video file → note, from picture + sound (VIDEO_MODELS chain, base64
        `video_url` part, VIDEO_CALL_TIMEOUT_S per call). type_hint None → the model picks the
        content_type, seeing `categories` (the user's existing ones) to reuse. Timeout is
        min(VIDEO_CALL_TIMEOUT_S, remaining budget - 60 s); under 75 s left, no call is made.
        Any failure (budget, size cap, API error/timeout, unrepairable JSON) raises
        VideoUnreadable. The model that answered is on the request meter (`last_model`)."""
        return await asyncio.to_thread(self._extract_from_video, video_bytes, mime, caption,
                                       comments, type_hint, categories)

    # ---------- Search-grounded page lookup (for bot-blocked pages) ----------

    def _search_grounded_page(self, url: str, hint: str = "") -> str | None:
        """Recover page facts via web search (OpenRouter web plugin) when the page itself is
        unreachable from datacenter IPs (Amazon blocks direct fetch and Jina — but its
        listings are fully indexed by search engines).
        Returns grounded prose for the normal extraction pipeline, or None."""
        prompt = (
            f"Search the web to find this exact page: {url}\n"
            + (f"Known hint about it: {hint}\n" if hint else "")
            + "Report ONLY facts you find about this exact page/product/item: full title, "
            "brand/author, current price, rating and review count, key features or specs, "
            "and a short factual description. Do not include facts about similar items. "
            "If you cannot find this exact page, reply with just: NOT_FOUND"
        )
        try:
            text, _ = self._chat(settings.TEXT_MODELS, "", prompt, json=False, temperature=0.1,
                                 web=True, max_tokens=MAX_TOKENS_GROUNDED,
                                 timeout=_call_timeout(60))
        except Exception as e:
            log.warning("search-grounded lookup failed: %s", e, extra={"url": url})
            return None
        text = _THINK_RE.sub("", text).strip()
        if not text or "NOT_FOUND" in text[:300]:
            return None
        return text

    async def search_grounded_page(self, url: str, hint: str = "") -> str | None:
        return await asyncio.to_thread(self._search_grounded_page, url, hint)


gemini_service = GeminiService()
