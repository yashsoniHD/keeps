"""One-off: unify fragmented movie/place slugs onto the canonical templates.

The notes-first collapse left film notes scattered across open slugs
(`entertainment-recommendations`, `movie`, `entertainment`) and venue notes across
(`place`, `dessert`, `restaurant`, `idli-dosa`, …). This normalizes them so a single feed
chip shows all movies and one shows all places:

  data.titles[] of objects  → content_type = template = "entertainment"
  data.venues[]             → content_type = template = "place"

`data` is never touched — only content_type/template. Setting `template="place"` also repairs
notes that rendered as GenericNote (resolveTemplate returns note.template BEFORE it checks
data.venues, so a stray template slug hid the Places UI).

Also patches each note's search_index entry content_type and rebuilds users/{uid}.categories
from the resulting distinct content_types (drops now-empty slugs). Idempotent.

Usage (from backend/, ADC pointing at the project):
    python -m scripts.normalize_note_types --dry-run
    python -m scripts.normalize_note_types
    python -m scripts.normalize_note_types --uid <uid>
"""
import argparse
import asyncio
import logging
from datetime import datetime, timezone

from services import search_index
from services.firebase import get_db

logging.basicConfig(level=logging.INFO)
log = logging.getLogger("clipnote.normalize_note_types")

SEARCH_COLLECTION = "search_index"


def _target_type(data: dict) -> str | None:
    """The canonical content_type for a note, by its data shape — mirrors the frontend
    resolveTemplate rules for entertainment (titles[] first) and place (venues[])."""
    if not isinstance(data, dict):
        return None
    titles = data.get("titles")
    if isinstance(titles, list) and titles and isinstance(titles[0], dict):
        return "entertainment"
    if isinstance(data.get("venues"), list):
        return "place"
    return None


async def _normalize_user(db, uid: str, dry_run: bool) -> dict:
    changed = 0
    seen_types: set[str] = set()
    async for snap in db.collection("notes").where("user_id", "==", uid).stream():
        d = snap.to_dict() or {}
        target = _target_type(d.get("data") or {})
        ct = d.get("content_type")
        if target and (ct != target or d.get("template") != target):
            log.info("%s %s: (%r/%r) -> %r", "would set" if dry_run else "set",
                     snap.id[:8], ct, d.get("template"), target)
            if not dry_run:
                await snap.reference.update({
                    "content_type": target,
                    "template": target,
                    "updated_at": datetime.now(timezone.utc),
                })
                # keep the search index in sync (leave embedding/other fields alone)
                sref = db.collection(SEARCH_COLLECTION).document(f"note-{snap.id}")
                if (await sref.get()).exists:
                    await sref.update({"content_type": target})
            changed += 1
            seen_types.add(target)
        else:
            seen_types.add(target or ct)

    seen_types.discard(None)
    seen_types.discard("")
    categories = sorted(seen_types)
    log.info("user %s: %d note(s) %s; categories -> %s", uid, changed,
             "would change" if dry_run else "changed", categories)
    if not dry_run:
        await db.collection("users").document(uid).set({"categories": categories}, merge=True)
    return {"changed": changed}


async def run(dry_run: bool, only_uid: str | None) -> None:
    db = get_db()
    if only_uid:
        uids = [only_uid]
    else:
        uids = [u.id async for u in db.collection("users").stream()]
    total = 0
    for uid in uids:
        total += (await _normalize_user(db, uid, dry_run))["changed"]
    log.info("done: %d note(s) %s across %d user(s)%s", total,
             "would change" if dry_run else "changed", len(uids),
             " (dry-run)" if dry_run else "")


if __name__ == "__main__":
    parser = argparse.ArgumentParser()
    parser.add_argument("--dry-run", action="store_true", help="log actions without writing")
    parser.add_argument("--uid", help="normalize a single user")
    args = parser.parse_args()
    asyncio.run(run(args.dry_run, args.uid))
