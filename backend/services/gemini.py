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
from models.ask import ArtifactNote, AskPlan, GroundedAnswer, SynthAnswer
from models.note import ContentBundle, NoteExtraction
from services.usage_meter import record_usage

log = logging.getLogger("clipnote.gemini")


def normalize_slug(raw: str) -> str:
    """lowercase-kebab-case, trimmed."""
    s = re.sub(r"[^a-z0-9]+", "-", (raw or "").lower()).strip("-")
    return s or "summary"


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
   - "place" — a SINGLE venue worth visiting: a restaurant, cafe, bar, dessert/
     ice-cream shop, bakery, food stall, attraction, viewpoint, or hotel. A reel
     recommending one spot is "place", NOT "itinerary".
   - "book" — a book recommendation/review.
   - "summary" — see rule 4.
3. Single venue vs trip: one restaurant/cafe/shop/attraction = "place"; a route or
   day-by-day plan covering several stops = "itinerary". Never use a vague "travel"
   slug for a single venue — use "place".
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


_SHARED_RULES = """You are a note extraction engine. The user saves links and never wants to
open the source again — your note must be MORE useful than the source.

Output is STRUCTURED JSON ONLY — no HTML, no markdown, no styling. Shape:
{
  "content_type": "<echo the slug you were given — do not change it>",
  "title": "concise, specific note title in SENTENCE CASE (capitalize only the first word and proper nouns/brand names/acronyms, e.g. 'Easy weeknight paneer butter masala', 'A weekend in Lisbon', 'Sony WH-1000XM5 review')",
  "ai_summary": "2 conversational, specific sentences about THIS content (mention actual details)",
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

`data` schema for place (restaurant, cafe, attraction, hotel):
{
  "name": str, "location": "area, city", "category": "e.g. cafe, viewpoint",
  "priceRange"?: str, "rating"?: str, "timings"?: str,
  "facts": [{"label": str, "value": str}],
  "highlights": ["what it's known for; what to order/see", ...],
  "tips"?: ["best time, booking, how to reach", ...]
}""",

    "book": _SHARED_RULES + """

`data` schema for book:
{
  "author": str, "genre"?: str, "pages"?: str, "published"?: str,
  "facts": [{"label": str, "value": str}],
  "premise": "2-3 sentences, no spoilers",
  "keyIdeas"?: ["for non-fiction: the core ideas", ...],
  "whoShouldRead": str
}""",
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
 "artifact": {"title": str, "ai_summary": "1-2 sentence overview",
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
 "ai_summary": "1-2 sentence overview",
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

    async def assign_category(self, url: str, bundle: ContentBundle,
                              existing_categories: list[str],
                              note_hint: str | None = None) -> str:
        categories_str = ", ".join(existing_categories) if existing_categories else "none yet"
        prompt = (
            f"URL: {url}\n"
            f"Platform: {bundle.metadata.get('platform', 'web')}\n"
            f"Content preview: {bundle.preview[:600]}\n"
            f"User's existing categories: {categories_str}\n"
            + (f"User instruction: {note_hint}\n" if note_hint else "")
            + "Choose the content_type."
        )
        response = await asyncio.to_thread(
            self.client.models.generate_content,
            model=settings.GEMINI_LITE_MODEL,
            contents=[prompt],
            # No tight max_output_tokens: Gemini 3.x models think by default and a small
            # cap gets consumed by thoughts, returning text=None (measured at Phase 0).
            config=types.GenerateContentConfig(
                response_mime_type="application/json",
                system_instruction=CATEGORY_SYSTEM,
            ),
        )
        record_usage(settings.GEMINI_LITE_MODEL, response)
        try:
            slug = json.loads(_strip_code_fences(response.text)).get("content_type", "summary")
        except (json.JSONDecodeError, AttributeError):
            slug = "summary"
        return match_existing(slug, existing_categories)

    # ---------- Step 2: type-focused extraction (main model) ----------

    def _build_contents(self, url: str, bundle: ContentBundle, content_type: str,
                        note_hint: str | None = None) -> list:
        parts: list = []
        if bundle.video_uri:
            # YouTube URLs and gs:// URIs are both passed as FileData — Gemini ingests
            # the video directly (visuals + audio). Never inline bytes. Vertex requires
            # an explicit mimeType even for YouTube URLs (400 without it).
            parts.append(types.Part(file_data=types.FileData(file_uri=bundle.video_uri,
                                                             mime_type="video/mp4")))
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
        if note_hint:
            text_prompt.append(f"User instruction for this note: {note_hint}")
        parts.append(types.Part(text="\n\n".join(text_prompt)))
        return [types.Content(role="user", parts=parts)]

    def extract(self, url: str, bundle: ContentBundle, content_type: str,
                note_hint: str | None = None) -> NoteExtraction:
        system = TYPE_PROMPTS.get(content_type, COMPOSER_PROMPT)
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
