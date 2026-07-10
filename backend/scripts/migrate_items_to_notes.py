"""One-off migration: fold every mini-app item back into a note (notes-first collapse).

The mini-apps are being removed; enrichment now lives on the note itself (services/enrich.py).
Existing captures live ONLY as item docs under users/{uid}/{watch,wish,recipe,place,trip}_items —
this script makes each of them a note again, with the enrichment (posters, providers, Places
fields, geocoded stops, parsed price) folded into `note.data` where the note templates render it.

Per item group (see _FAMILIES):
  1. Items whose `source_note_ids` point at a LIVE note (backfilled from a pre-app note) are
     MERGED onto that note — enrichment lands in its `data`, a coverless note adopts the item's
     image, `favorite` carries over. No duplicate note is created; no embed call is spent.
  2. Orphan items (item-only captures) become new notes. Watch/place items that share one
     canonical source URL (a "5 films" reel fanned into 5 items) regroup into ONE note whose
     `data.titles[]`/`data.venues[]` carries every entry — matching what a fresh capture of that
     URL now produces. `favorite` survives (note.is_favorite); status buckets/ratings are
     deliberately dropped (the intended simplification).

Idempotent: created note ids are uuid5 of (uid, family, group key), so a re-run converges on the
same docs and skips ones that already exist. Item docs are NEVER deleted here — verify the
migrated notes first, then remove the subcollections separately (PITR is the backstop).

Embeds are paced (~15/min, see embed-quota memory) and only spent on NEW notes; merges reuse the
note's stored embedding.

Usage (from backend/, with ADC pointing at the project):
    python -m scripts.migrate_items_to_notes --dry-run
    python -m scripts.migrate_items_to_notes
    python -m scripts.migrate_items_to_notes --heal-refs   # also remap composed notes'
                                                           # prefixed item ids → new note ids
"""
import argparse
import asyncio
import logging
import re
import uuid
from datetime import datetime, timezone
from urllib.parse import parse_qsl, urlencode, urlsplit, urlunsplit

from google.cloud.firestore_v1.vector import Vector

from services import search_index
from services.embeddings import embedding_service
from services.firebase import add_user_category, firestore_safe, get_db

logging.basicConfig(level=logging.INFO)
log = logging.getLogger("clipnote.migrate_items_to_notes")

EMBED_DELAY_S = 4.0  # ~15 embeds/min — text-embedding QPM quota is tiny

_TRACKING_PARAMS = re.compile(r"^(utm_|ref$|ref_|tag$|fbclid$|gclid$|mc_|_branch|spm$|igsh$)", re.I)


def _canonical_url(url) -> str | None:
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
    except Exception:  # noqa: BLE001
        return None


def _clean(d: dict) -> dict:
    """Drop None/empty values so migrated `data` reads like a fresh extraction."""
    return {k: v for k, v in d.items() if v is not None and v != [] and v != ""}


def _norm_title(s) -> str:
    return re.sub(r"[^a-z0-9]+", " ", str(s or "").lower()).strip()


# ---- per-family reshapers: item doc -> the note template's data shape ----------------------

def _watch_entry(item: dict) -> dict:
    return _clean({
        "title": item.get("title"),
        "year": item.get("year"),
        "mediaType": item.get("media_type"),
        "why": item.get("why"),
        "tmdb_id": item.get("tmdb_id"),
        "poster_url": item.get("poster_url"),
        "backdrop_url": item.get("backdrop_url"),
        "overview": item.get("overview"),
        "genres": item.get("genres"),
        "providers": item.get("providers"),
        "providers_region": item.get("providers_region"),
    })


def _venue_entry(item: dict) -> dict:
    return _clean({
        "name": item.get("name"),
        "location": item.get("location"),
        "city": item.get("city"),
        "category": item.get("category"),
        "cuisine": item.get("cuisine"),
        "priceForTwo": item.get("price_for_two"),
        "mustTry": item.get("must_try"),
        "goodFor": item.get("good_for"),
        "bestTime": item.get("best_time"),
        "highlights": item.get("highlights"),
        "tips": item.get("tips"),
        "why": item.get("why"),
        "place_id": item.get("place_id"),
        "formatted_address": item.get("formatted_address"),
        "lat": item.get("lat"),
        "lng": item.get("lng"),
        "rating": item.get("rating"),
        "user_rating_count": item.get("user_rating_count"),
        "price_level": item.get("price_level"),
        "opening_hours": item.get("opening_hours"),
        "website": item.get("website"),
        "phone": item.get("phone"),
        "google_maps_url": item.get("google_maps_url"),
        "reservable": item.get("reservable"),
        "photo_url": item.get("photo_url"),
        "action_links": item.get("action_links"),
    })


def _product_data(item: dict) -> dict:
    return _clean({
        "price": item.get("price_raw"),
        "price_amount": item.get("price_amount"),
        "currency": item.get("currency"),
        "brand": item.get("brand"),
        "rating": item.get("rating"),
        "buyUrl": item.get("buy_url"),
        "specs": item.get("specs"),
        "pros": item.get("pros"),
        "cons": item.get("cons"),
        "verdict": item.get("verdict"),
    })


def _recipe_data(item: dict) -> dict:
    return _clean({
        "cuisine": item.get("cuisine"),
        "totalTime": item.get("total_time"),
        "prepTime": item.get("prep_time"),
        "cookTime": item.get("cook_time"),
        "servings": item.get("servings"),
        "difficulty": item.get("difficulty"),
        "calories": item.get("calories"),
        "ingredients": item.get("ingredients"),
        "steps": item.get("steps"),
        "tips": item.get("tips"),
    })


def _trip_data(item: dict) -> dict:
    return _clean({
        "destination": item.get("destination"),
        "duration": item.get("duration"),
        "budget": item.get("budget"),
        "bestSeason": item.get("best_season"),
        "days": item.get("days"),
        "tips": item.get("tips"),
    })


# family: (subcollection, content_type/template, cover field, multi-entry data key or None)
_FAMILIES = {
    "watch": ("watch_items", "entertainment", "poster_url", "titles"),
    "place": ("place_items", "place", "photo_url", "venues"),
    "wish": ("wish_items", "product", "image_url", None),
    "recipe": ("recipe_items", "recipe", "image_url", None),
    "trip": ("trip_items", "itinerary", "image_url", None),
}

_ENTRY_BUILDERS = {"watch": _watch_entry, "place": _venue_entry}
_DATA_BUILDERS = {"wish": _product_data, "recipe": _recipe_data, "trip": _trip_data}


def _note_id(uid: str, family: str, group_key: str) -> str:
    return str(uuid.uuid5(uuid.NAMESPACE_URL, f"clipnote:migrated:{uid}:{family}:{group_key}"))


def _group_title(family: str, items: list[dict], domain: str | None) -> str:
    if len(items) == 1:
        return (items[0].get("title") or items[0].get("name") or "Saved item").strip()
    noun = "movies & shows" if family == "watch" else "places"
    src = f" from {domain}" if domain else ""
    return f"{len(items)} {noun}{src}"


def _group_summary(family: str, items: list[dict]) -> str:
    if family == "watch":
        first = items[0]
        if len(items) == 1:
            return (first.get("overview") or first.get("why") or "")[:300]
        names = ", ".join(str(i.get("title") or "") for i in items[:5]).strip(", ")
        return f"Saved watchlist: {names}" + ("…" if len(items) > 5 else "")
    if family == "place":
        first = items[0]
        if len(items) == 1:
            return (first.get("why") or first.get("category") or "")[:300]
        names = ", ".join(str(i.get("name") or "") for i in items[:5]).strip(", ")
        return f"Saved places: {names}" + ("…" if len(items) > 5 else "")
    it = items[0]
    return (it.get("verdict") or it.get("why") or it.get("destination")
            or it.get("cuisine") or "")[:300]


async def _live_note(db, uid: str, source_note_ids: list) -> tuple[str, dict] | None:
    """The first source note that still exists and belongs to this user, if any."""
    for nid in source_note_ids or []:
        if not isinstance(nid, str) or any(nid.startswith(p + "-") for p in _FAMILIES):
            continue  # prefixed grounding id, not a note id
        snap = await db.collection("notes").document(nid).get()
        d = snap.to_dict() if snap.exists else None
        if d and d.get("user_id") == uid:
            return nid, d
    return None


def _merge_entries(existing: list, entries: list[dict], name_key: str) -> list:
    """Merge enrichment entries into a note's titles[]/venues[] by normalized name:
    matching entries gain the looked-up fields; unmatched ones are appended."""
    out = [dict(e) if isinstance(e, dict) else e for e in (existing or [])]
    by_name = {_norm_title(e.get(name_key)): i for i, e in enumerate(out)
               if isinstance(e, dict) and e.get(name_key)}
    for entry in entries:
        key = _norm_title(entry.get(name_key))
        if key and key in by_name:
            merged = {**out[by_name[key]], **entry}
            out[by_name[key]] = merged
        else:
            out.append(entry)
    return out


async def _merge_onto_note(db, family: str, note_id: str, note: dict,
                           items: list[dict], dry_run: bool) -> None:
    data = dict(note.get("data") or {})
    if family == "watch":
        data["titles"] = _merge_entries(data.get("titles"), [_watch_entry(i) for i in items],
                                        "title")
    elif family == "place":
        data["venues"] = _merge_entries(data.get("venues"), [_venue_entry(i) for i in items],
                                        "name")
    elif family == "trip":
        trip = _trip_data(items[0])
        if trip.get("days"):
            data["days"] = trip["days"]  # item days carry the geocoded lat/lng
        for k, v in trip.items():
            data.setdefault(k, v)
    elif family == "wish":
        for k, v in _product_data(items[0]).items():
            data.setdefault(k, v)
    # recipe: the note already carries the full recipe — nothing to merge into data.

    cover_field = _FAMILIES[family][2]
    cover = note.get("cover_image_url") or next(
        (i.get(cover_field) for i in items if i.get(cover_field)), None)
    favorite = bool(note.get("is_favorite")) or any(i.get("favorite") for i in items)

    if dry_run:
        log.info("would merge %d %s item(s) onto note %s (%s)",
                 len(items), family, note_id, note.get("title"))
        return
    patch = {"data": firestore_safe(data), "cover_image_url": cover,
             "updated_at": datetime.now(timezone.utc)}
    if favorite:
        patch["is_favorite"] = True
    await db.collection("notes").document(note_id).set(patch, merge=True)
    merged = {**note, **patch}
    await search_index.upsert_for_note(db, note_id, merged, note.get("embedding"))


async def _create_note(db, uid: str, family: str, group_key: str, items: list[dict],
                       dry_run: bool, id_map: dict[str, str]) -> bool:
    """Create one note from an item group. Returns True when an embed call was spent."""
    subcol, content_type, cover_field, multi_key = _FAMILIES[family]
    note_id = _note_id(uid, family, group_key)
    for it in items:
        id_map[f"{family}-{it['_id']}"] = note_id

    ref = db.collection("notes").document(note_id)
    if (await ref.get()).exists:
        log.info("note %s already exists for %s/%s — skipping", note_id, family, group_key)
        return False

    if multi_key:
        data: dict = {multi_key: [_ENTRY_BUILDERS[family](i) for i in items]}
    else:
        data = _DATA_BUILDERS[family](items[0])

    source_url = next((i.get("source_url") or i.get("buy_url") for i in items
                       if i.get("source_url") or i.get("buy_url")), "") or ""
    domain = next((i.get("source_domain") or i.get("domain") for i in items
                   if i.get("source_domain") or i.get("domain")), "") or ""
    if not domain and source_url:
        try:
            domain = (urlsplit(source_url).hostname or "").replace("www.", "")
        except ValueError:
            domain = ""
    title = _group_title(family, items, domain or None)
    ai_summary = _group_summary(family, items)
    cover = next((i.get(cover_field) for i in items if i.get(cover_field)), None)
    created = min((i.get("created_at") for i in items if i.get("created_at")),
                  default=datetime.now(timezone.utc))
    favorite = any(i.get("favorite") for i in items)

    if dry_run:
        log.info("would create %s note %r (%d item[s], key=%s)", family, title, len(items),
                 group_key)
        return False

    embedding = None
    text = "\n".join(p for p in (title, ai_summary) if p).strip()
    if text:
        try:
            vec = await embedding_service.embed_document(text)
            embedding = Vector(vec) if vec else None
        except Exception as e:  # noqa: BLE001 — a backfill re-embed can fill it in later.
            log.warning("embed failed for %r: %s: %s", title, type(e).__name__, e)

    note_doc = {
        "user_id": uid,
        "content_type": content_type,
        "template": content_type,
        "title": title,
        "ai_summary": ai_summary,
        "source_url": source_url,
        "source_domain": domain,
        "source": "web",
        "cover_image_url": cover,
        "collection_id": None,
        "data": firestore_safe(data),
        "acquisition": "migrated_item",
        "is_favorite": favorite,
        "created_at": created,
        "updated_at": datetime.now(timezone.utc),
    }
    if embedding is not None:
        note_doc["embedding"] = embedding
    await ref.set(note_doc)
    await search_index.upsert_for_note(db, note_id, note_doc, embedding)
    await add_user_category(uid, content_type)
    log.info("created %s note %s %r (%d item[s])", family, note_id, title, len(items))
    return embedding is not None


async def _migrate_family(db, uid: str, family: str, dry_run: bool,
                          id_map: dict[str, str]) -> dict:
    subcol = _FAMILIES[family][0]
    items: list[dict] = []
    async for doc in (db.collection("users").document(uid).collection(subcol).stream()):
        items.append({"_id": doc.id, **(doc.to_dict() or {})})
    if not items:
        return {"items": 0, "merged": 0, "created": 0}

    # 1. Split into "merge onto a live note" vs "create a note".
    merges: dict[str, tuple[dict, list[dict]]] = {}
    orphans: list[dict] = []
    for it in items:
        live = await _live_note(db, uid, it.get("source_note_ids"))
        if live:
            nid, note = live
            merges.setdefault(nid, (note, []))[1].append(it)
        else:
            orphans.append(it)

    for nid, (note, group) in merges.items():
        await _merge_onto_note(db, family, nid, note, group, dry_run)

    # 2. Group orphans: by canonical source URL when there is one (a fanned-out listicle
    #    regroups into one multi-entry note), else one note per item.
    groups: dict[str, list[dict]] = {}
    for it in orphans:
        key = _canonical_url(it.get("source_url") or it.get("buy_url")) or f"item:{it['_id']}"
        groups.setdefault(key, []).append(it)

    created = 0
    for key, group in groups.items():
        spent_embed = await _create_note(db, uid, family, key, group, dry_run, id_map)
        created += 1
        if spent_embed:
            await asyncio.sleep(EMBED_DELAY_S)

    return {"items": len(items), "merged": len(merges), "created": created}


async def _heal_refs(db, uid: str, id_map: dict[str, str], dry_run: bool) -> int:
    """Rewrite prefixed item ids ('watch-m_123') in composed notes' source_note_ids to the
    migrated note ids, so 'From your notes' links keep resolving."""
    healed = 0
    query = db.collection("notes").where("user_id", "==", uid).where("source", "==", "ai")
    async for doc in query.stream():
        refs = (doc.to_dict() or {}).get("source_note_ids") or []
        new_refs = list(dict.fromkeys(id_map.get(r, r) for r in refs))
        if new_refs != refs:
            healed += 1
            if not dry_run:
                await doc.reference.update({"source_note_ids": new_refs})
    return healed


async def run(dry_run: bool, heal: bool, only_uid: str | None) -> None:
    db = get_db()
    uids: list[str] = []
    if only_uid:
        uids = [only_uid]
    else:
        async for u in db.collection("users").stream():
            uids.append(u.id)

    for uid in uids:
        id_map: dict[str, str] = {}
        totals = {"items": 0, "merged": 0, "created": 0}
        for family in _FAMILIES:
            stats = await _migrate_family(db, uid, family, dry_run, id_map)
            for k in totals:
                totals[k] += stats[k]
        healed = await _heal_refs(db, uid, id_map, dry_run) if heal else 0
        if totals["items"]:
            log.info("user %s: items=%d merged-onto-notes=%d notes-created=%d healed=%d%s",
                     uid, totals["items"], totals["merged"], totals["created"], healed,
                     " (dry-run)" if dry_run else "")


if __name__ == "__main__":
    parser = argparse.ArgumentParser()
    parser.add_argument("--dry-run", action="store_true", help="log actions without writing")
    parser.add_argument("--heal-refs", action="store_true",
                        help="remap composed notes' prefixed item ids to migrated note ids")
    parser.add_argument("--uid", help="migrate a single user")
    args = parser.parse_args()
    asyncio.run(run(args.dry_run, args.heal_refs, args.uid))
