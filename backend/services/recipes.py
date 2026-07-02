"""Recipes mini-app: fan recipe notes out into per-recipe recipe_items.

The cooking counterpart of services/wishlist.py — and, like the wishlist, it needs no external API.
A recipe note arrives *already structured* by Gemini: the `recipe` TYPE_PROMPT puts the times,
servings, difficulty, ingredients and steps in the note's `data`, the dish name is the note `title`,
and its photo is the note `cover_image_url`. So fan-out is a pure copy into one trackable doc under
users/{uid}/recipe_items, deduped by the canonical recipe URL across notes (the same recipe saved
twice = one item) and carrying its own user state (`favorite`) which a re-save must never reset.

Unlike the watchlist/wishlist/places, recipes have no status workflow — they're a single cookbook
wall organised by filters + favorites — so the only owner-editable field is `favorite`.

Fan-out is 1:1 — one recipe note → one recipe_item.
"""
import hashlib
import logging
import re
from datetime import datetime, timezone
from urllib.parse import urlsplit, urlunsplit, parse_qsl, urlencode

from google.cloud.firestore_v1 import ArrayUnion

from services import search_index
from services.firebase import get_db

log = logging.getLogger("clipnote.recipes")

# Query params that never identify a recipe — strip them so the same recipe linked with different
# tracking junk dedupes to one item. Anything else (a real ?id=) is kept.
_TRACKING_PARAMS = re.compile(r"^(utm_|ref$|ref_|tag$|fbclid$|gclid$|mc_|_branch|spm$|igsh$)", re.I)


def _slug(s: str) -> str:
    return re.sub(r"[^a-z0-9]+", "-", (s or "").lower()).strip("-") or "untitled"


def _canonical_url(url: str) -> str | None:
    """Normalize a recipe URL for stable dedup: lowercase scheme+host, drop the fragment and any
    tracking-only query params, keep the rest sorted. None if there's nothing url-like."""
    if not url or not isinstance(url, str):
        return None
    try:
        parts = urlsplit(url.strip())
        if not parts.netloc:
            return None
        kept = [(k, v) for k, v in parse_qsl(parts.query, keep_blank_values=False)
                if not _TRACKING_PARAMS.match(k)]
        query = urlencode(sorted(kept))
        path = parts.path.rstrip("/") or "/"
        return urlunsplit((parts.scheme.lower(), parts.netloc.lower(), path, query, ""))
    except Exception:  # noqa: BLE001 — a malformed URL just means "no canonical key".
        return None


def _doc_id(canonical_url: str | None, title: str) -> str:
    """Stable id → natural dedup. Prefer a hash of the canonical recipe URL (the strongest recipe
    identity); fall back to a title slug so URL-less recipes (typed/voice notes) still dedupe."""
    if canonical_url:
        return "r_" + hashlib.sha1(canonical_url.encode("utf-8")).hexdigest()[:16]
    return f"r_{_slug(title)}"


def _seed_user_state(doc: dict, now: datetime) -> None:
    """First time a recipe is seen, seed the owner-editable state — in one place so the
    note-fan-out and any future path stay in sync and never reset existing state. Recipes have no
    status buckets, so the only owner state is `favorite`."""
    doc["favorite"] = False
    doc["created_at"] = now


async def enrich_recipe_item(uid: str, source_id: str, *, title: str,
                             cover_image_url: str | None, source_url: str | None,
                             source_domain: str | None, data: dict | None,
                             ai_summary: str = "") -> str | None:
    """Upsert one recipe_item from a recipe note's already-extracted fields. Best-effort and
    non-fatal: any failure logs and is swallowed so ingest never fails because of the cookbook.
    Returns the produced recipe_item id (for capture-destination routing), or None if skipped.
    `source_id` is the note id when a note exists, else the job id (mini-app captures make no note).

    Skips notes with no ingredients — a cooking-family slug that routed through the composer rather
    than the recipe schema won't carry cookable data, and shouldn't pollute the cookbook."""
    data = data or {}
    ingredients = data.get("ingredients")
    if not ingredients:
        return None  # nothing cookable to track

    title = (title or "").strip() or "Untitled recipe"
    canonical = _canonical_url(source_url)

    try:
        db = get_db()
        now = datetime.now(timezone.utc)
        doc_id = _doc_id(canonical, title)
        ref = (db.collection("users").document(uid)
               .collection("recipe_items").document(doc_id))
        existing = await ref.get()

        # Enrichment fields (always refreshed); never touch the user's `favorite` state here.
        enrichment = {
            "user_id": uid,
            "title": title,
            "cuisine": data.get("cuisine") or None,
            "image_url": cover_image_url,
            "source_url": source_url or None,
            "domain": source_domain or None,
            "total_time": data.get("totalTime") or None,
            "prep_time": data.get("prepTime") or None,
            "cook_time": data.get("cookTime") or None,
            "servings": data.get("servings") or None,
            "difficulty": data.get("difficulty") or None,
            "calories": data.get("calories") or None,
            "ingredients": ingredients,
            "steps": data.get("steps") or [],
            "tips": data.get("tips") or [],
            "source_note_ids": ArrayUnion([source_id]),
            "updated_at": now,
        }
        if not existing.exists:
            _seed_user_state(enrichment, now)
        await ref.set(enrichment, merge=True)
        await search_index.upsert(
            db, user_id=uid, kind="recipe", ref_id=doc_id, title=title,
            summary=ai_summary or (data.get("cuisine") or ""), cover_image_url=cover_image_url,
        )
        return doc_id
    except Exception as e:  # noqa: BLE001 — the cookbook must never sink an ingest.
        log.warning("recipe_item enrichment failed for %r: %s: %s",
                    title, type(e).__name__, e)
        return None


async def backfill_user(uid: str, limit: int = 200) -> dict:
    """Populate recipe_items from a user's EXISTING recipe notes. Like the wishlist backfill, this
    is a pure no-LLM copy: recipes are already structured in each note's stored `data`. Idempotent:
    enrich_recipe_item upserts by canonical URL and never clobbers user state, so re-running is
    safe. Returns a small summary."""
    from services.gemini import is_recipe  # local import avoids a circular import at module load

    db = get_db()
    notes_seen = 0
    recipes_found = 0
    query = db.collection("notes").where("user_id", "==", uid)
    async for snap in query.stream():
        if notes_seen >= limit:
            break
        note = snap.to_dict() or {}
        if not is_recipe(note.get("content_type", "")):
            continue
        data = note.get("data") or {}
        if not data.get("ingredients"):
            continue
        notes_seen += 1
        recipes_found += 1
        await enrich_recipe_item(
            uid, snap.id,
            title=note.get("title", ""),
            cover_image_url=note.get("cover_image_url"),
            source_url=note.get("source_url"),
            source_domain=note.get("source_domain"),
            data=data,
        )
    log.info("recipes backfill for %s: %d recipe notes", uid, recipes_found)
    return {"notes_processed": notes_seen, "recipes_found": recipes_found}
