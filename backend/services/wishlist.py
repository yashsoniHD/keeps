"""Wishlist mini-app: fan product notes out into per-product wish_items.

The shopping counterpart of services/watchlist.py. Where the watchlist matches extracted titles
against TMDB, a product note arrives *already enriched* by Gemini — price / specs / pros / cons
live in the note's `data`, the product's name is the note `title`, and its image is the note
`cover_image_url`. So fan-out needs no external API: it copies those fields into one trackable
doc under users/{uid}/wish_items, deduped by the canonical buy URL across notes (the same product
saved twice = one item) and carrying its own user state (wish_status / target_price / purchased_at)
which a re-save must never reset.

Phase A is 1:1 — one product note → one wish_item. (Multi-product roundups capture only the note's
primary product until a `data.products[]` extraction path lands.)
"""
import hashlib
import logging
import re
from datetime import datetime, timezone
from urllib.parse import urlsplit, urlunsplit, parse_qsl, urlencode

from google.cloud.firestore_v1 import ArrayUnion

from services import search_index
from services.firebase import get_db

log = logging.getLogger("clipnote.wishlist")

# Query params that never identify a product — strip them so the same product linked with
# different tracking junk dedupes to one item. Anything else (e.g. a real ?pid=) is kept.
_TRACKING_PARAMS = re.compile(r"^(utm_|ref$|ref_|tag$|fbclid$|gclid$|mc_|_branch|spm$|igsh$)", re.I)

# A leading currency token + the first number in a price string ("₹2,499", "Rs. 1,200", "$19.99").
_PRICE_RE = re.compile(
    r"(₹|\$|€|£|¥|Rs\.?|INR|USD|EUR|GBP|AED|CAD|AUD)?\s*([0-9][0-9,]*(?:\.[0-9]+)?)",
    re.I,
)


def _slug(s: str) -> str:
    return re.sub(r"[^a-z0-9]+", "-", (s or "").lower()).strip("-") or "untitled"


def _canonical_url(url: str) -> str | None:
    """Normalize a buy URL for stable dedup: lowercase scheme+host, drop the fragment and any
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


def _doc_id(canonical_buy_url: str | None, brand: str | None, title: str) -> str:
    """Stable id → natural dedup. Prefer a hash of the canonical buy URL (the strongest product
    identity); fall back to a brand+title slug so URL-less products still dedupe."""
    if canonical_buy_url:
        return "p_" + hashlib.sha1(canonical_buy_url.encode("utf-8")).hexdigest()[:16]
    return f"p_{_slug((brand or '') + '-' + title)}"


def _parse_price(raw) -> tuple[float | None, str | None]:
    """Best-effort split of a price string into a numeric amount (for sorting / drop-detection)
    and a currency token (for display). Returns (None, None) when nothing parses."""
    if not isinstance(raw, str):
        return None, None
    m = _PRICE_RE.search(raw)
    if not m:
        return None, None
    currency = (m.group(1) or "").strip() or None
    try:
        amount = float(m.group(2).replace(",", ""))
    except (ValueError, AttributeError):
        amount = None
    return amount, currency


def _coerce_rating(raw) -> float | None:
    """The product's own review rating (0–5), display-only. Distinct from any future user rating."""
    try:
        r = float(raw)
    except (TypeError, ValueError):
        return None
    return round(r, 1) if 0 <= r <= 5 else None


def _seed_user_state(doc: dict, now: datetime, status: str = "saved") -> None:
    """First time a product is seen, seed the owner-editable state — in one place so the
    note-fan-out and any future manual-add path stay in sync and never reset existing state.

    Note-captured products land in the `saved` inbox; the user promotes the ones they actually
    intend to buy to `to_buy`, then marks `purchased`. `price_when_added` anchors price-drop
    detection (Phase B) to what the price was when the user first saved it."""
    doc["wish_status"] = status
    doc["target_price"] = None
    doc["purchased_at"] = None
    doc["price_when_added"] = doc.get("price_amount")
    doc["favorite"] = False
    doc["created_at"] = now


async def enrich_wish_item(uid: str, source_id: str, *, title: str,
                           cover_image_url: str | None, source_domain: str | None,
                           data: dict | None, ai_summary: str = "") -> str | None:
    """Upsert one wish_item from a product note's already-extracted fields. Best-effort and
    non-fatal: any failure logs and is swallowed so ingest never fails because of the wishlist.
    Returns the produced wish_item id (for capture-destination routing), or None if skipped.
    `source_id` is the note id when a note exists, else the job id (mini-app captures make no note).

    Skips notes with nothing buyable (no buy URL and no price) — a shopping-family slug that
    routed through the composer rather than the product schema won't carry product fields, and
    shouldn't pollute the wishlist."""
    data = data or {}
    buy_url = data.get("buyUrl") or None
    price_raw = data.get("price")
    if not buy_url and not price_raw:
        return None  # nothing buyable to track

    title = (title or "").strip() or "Untitled product"
    canonical = _canonical_url(buy_url)
    amount, currency = _parse_price(price_raw)

    try:
        db = get_db()
        now = datetime.now(timezone.utc)
        doc_id = _doc_id(canonical, data.get("brand"), title)
        ref = (db.collection("users").document(uid)
               .collection("wish_items").document(doc_id))
        existing = await ref.get()

        # Enrichment fields (always refreshed); never touch the user's wish state here.
        enrichment = {
            "user_id": uid,
            "title": title,
            "brand": data.get("brand") or None,
            "image_url": cover_image_url,
            "buy_url": buy_url,
            "domain": source_domain or None,
            "price_raw": price_raw if isinstance(price_raw, str) else None,
            "price_amount": amount,
            "currency": currency,
            "rating": _coerce_rating(data.get("rating")),
            "specs": data.get("specs") or [],
            "pros": data.get("pros") or [],
            "cons": data.get("cons") or [],
            "verdict": data.get("verdict") or None,
            "source_note_ids": ArrayUnion([source_id]),
            "updated_at": now,
        }
        if not existing.exists:
            _seed_user_state(enrichment, now)
        await ref.set(enrichment, merge=True)
        await search_index.upsert(
            db, user_id=uid, kind="wish", ref_id=doc_id, title=title,
            summary=ai_summary or data.get("verdict") or "", cover_image_url=cover_image_url,
        )
        return doc_id
    except Exception as e:  # noqa: BLE001 — the wishlist must never sink an ingest.
        log.warning("wish_item enrichment failed for %r: %s: %s",
                    title, type(e).__name__, e)
        return None


async def backfill_user(uid: str, limit: int = 200) -> dict:
    """Populate wish_items from a user's EXISTING product notes. Unlike the watchlist backfill
    (which re-extracts titles from prose via Gemini), products are already structured in each
    note's stored `data`, so this is a pure no-LLM copy. Idempotent: enrich_wish_item upserts by
    canonical URL and never clobbers user state, so re-running is safe. Returns a small summary."""
    from services.gemini import is_shopping  # local import avoids a circular import at module load

    db = get_db()
    notes_seen = 0
    products_found = 0
    query = db.collection("notes").where("user_id", "==", uid)
    async for snap in query.stream():
        if notes_seen >= limit:
            break
        note = snap.to_dict() or {}
        if not is_shopping(note.get("content_type", "")):
            continue
        data = note.get("data") or {}
        if not (data.get("buyUrl") or data.get("price")):
            continue
        notes_seen += 1
        products_found += 1
        await enrich_wish_item(
            uid, snap.id,
            title=note.get("title", ""),
            cover_image_url=note.get("cover_image_url"),
            source_domain=note.get("source_domain"),
            data=data,
        )
    log.info("wishlist backfill for %s: %d product notes", uid, products_found)
    return {"notes_processed": notes_seen, "products_found": products_found}
