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
from models.ask import GroundedAnswer, NoteSelection
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
  "title": "concise, specific note title",
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


ASK_SELECT_SYSTEM = """You select which of a user's saved notes could help answer their question.
You receive a JSON index of notes (id, type, title, summary), the question,
and recent conversation turns.
Return ONLY valid JSON: {"note_ids": ["id", ...]}

Rules:
- Include every note that could plausibly contribute; most relevant first; max 12.
- Use ONLY ids that appear in the index — never invent ids.
- Resolve follow-ups from the conversation ("which of those is cheapest" refers
  to the notes discussed in the previous turns).
- If nothing is relevant, return {"note_ids": []}."""


ASK_ANSWER_SYSTEM = """You are Clipnote's assistant. The user saves links as structured notes; answer
their question using ONLY the saved notes provided.
Return ONLY valid JSON: {"answer_markdown": str, "cited_note_ids": [str]}

Rules:
- Ground every claim in the notes. NEVER FABRICATE: if the notes don't contain
  enough to answer, say so plainly and suggest what they could save — do not
  fill gaps from general knowledge or the wider internet.
- Be direct, conversational, and specific: use the real names, prices, timings,
  and quantities from the notes.
- Mention note titles naturally when recommending or comparing, so the user
  knows where each item came from.
- cited_note_ids: only notes you actually used, most relevant first.
- Markdown subset only: short paragraphs, "- " bullets, numbered lists, **bold**,
  ### headings. No tables, images, links, or HTML.
- Use the conversation history to resolve follow-ups; answer the latest question."""


def _history_lines(history: list[dict]) -> str:
    return "\n".join(f"{t['role']}: {t['text']}" for t in history)


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
                              existing_categories: list[str]) -> str:
        categories_str = ", ".join(existing_categories) if existing_categories else "none yet"
        prompt = (
            f"URL: {url}\n"
            f"Platform: {bundle.metadata.get('platform', 'web')}\n"
            f"Content preview: {bundle.preview[:600]}\n"
            f"User's existing categories: {categories_str}\n"
            "Choose the content_type."
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

    def _build_contents(self, url: str, bundle: ContentBundle, content_type: str) -> list:
        parts: list = []
        if bundle.video_uri:
            # YouTube URLs and gs:// URIs are both passed as FileData — Gemini ingests
            # the video directly (visuals + audio). Never inline bytes. Vertex requires
            # an explicit mimeType even for YouTube URLs (400 without it).
            parts.append(types.Part(file_data=types.FileData(file_uri=bundle.video_uri,
                                                             mime_type="video/mp4")))
        text_prompt = [f"URL: {url}", f"content_type: {content_type}"]
        meta = bundle.metadata
        if meta.get("title"):
            text_prompt.append(f"Source title: {meta['title']}")
        if meta.get("author"):
            text_prompt.append(f"Author/creator: {meta['author']}")
        if bundle.structured:
            text_prompt.append(
                "JSON-LD ground truth from the page (authoritative for exact values):\n"
                + json.dumps(bundle.structured, ensure_ascii=False)[:12000]
            )
        if bundle.text:
            text_prompt.append(f"Content:\n{bundle.text[:28000]}")
        if bundle.video_uri:
            text_prompt.append("Analyze the attached video fully (visuals, on-screen text, and speech).")
        parts.append(types.Part(text="\n\n".join(text_prompt)))
        return [types.Content(role="user", parts=parts)]

    def extract(self, url: str, bundle: ContentBundle, content_type: str) -> NoteExtraction:
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
                    contents=self._build_contents(url, bundle, content_type),
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

    async def extract_async(self, url: str, bundle: ContentBundle, content_type: str) -> NoteExtraction:
        return await asyncio.to_thread(self.extract, url, bundle, content_type)

    # ---------- Ask AI: chat grounded in the user's saved notes ----------

    def _select_notes(self, question: str, history: list[dict], index: list[dict]) -> list[str]:
        prompt_parts = [f"Question: {question}"]
        if history:
            prompt_parts.append("Recent conversation:\n" + _history_lines(history))
        prompt_parts.append("Note index (JSON):\n" + json.dumps(index, ensure_ascii=False))
        for attempt in (1, 2):
            try:
                response = self.client.models.generate_content(
                    model=settings.GEMINI_LITE_MODEL,
                    contents=["\n\n".join(prompt_parts)],
                    config=types.GenerateContentConfig(
                        response_mime_type="application/json",
                        system_instruction=ASK_SELECT_SYSTEM,
                    ),
                )
                record_usage(settings.GEMINI_LITE_MODEL, response)
                return NoteSelection.model_validate_json(_strip_code_fences(response.text)).note_ids
            except Exception as e:
                if attempt == 1:
                    log.warning("select_notes attempt 1 failed, retrying: %s: %s",
                                type(e).__name__, e)
                    time.sleep(2)
        # Selection is best-effort: an empty list degrades to "nothing found",
        # which beats failing the whole ask.
        return []

    async def select_notes(self, question: str, history: list[dict], index: list[dict]) -> list[str]:
        return await asyncio.to_thread(self._select_notes, question, history, index)

    def _answer_from_notes(self, question: str, history: list[dict], notes: list[dict]) -> GroundedAnswer:
        prompt_parts = []
        if history:
            prompt_parts.append("Conversation so far:\n" + _history_lines(history))
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
                        system_instruction=ASK_ANSWER_SYSTEM,
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

    async def answer_from_notes(self, question: str, history: list[dict], notes: list[dict]) -> GroundedAnswer:
        return await asyncio.to_thread(self._answer_from_notes, question, history, notes)

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


gemini_service = GeminiService()
