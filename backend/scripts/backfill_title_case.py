"""One-off backfill: convert existing note titles to sentence case.

New notes get sentence-case titles from the extraction prompt (gemini.py), but notes
saved before that change keep their old title-case strings. This re-cases the existing
corpus to match: first word + proper nouns/brands/acronyms capitalized, everything else
lowercased — WITHOUT changing wording.

Re-casing is done by the lite model rather than a heuristic, because only a model reliably
knows which words are proper nouns ("Lisbon", "iPhone", "Sony WH-1000XM5") and must stay
capitalized. Titles are batched per call to keep cost and latency low. Idempotent: a title
already in sentence case comes back unchanged and is skipped.

Usage (from backend/, with ADC pointing at the project):
    python -m scripts.backfill_title_case --dry-run
    python -m scripts.backfill_title_case --limit 20 --dry-run
    python -m scripts.backfill_title_case
"""
import argparse
import asyncio
import json
import logging

from google import genai
from google.genai import types

from config import settings
from services.firebase import get_db
from services.gemini import _strip_code_fences

logging.basicConfig(level=logging.INFO)
log = logging.getLogger("clipnote.backfill")

BATCH = 40

SYSTEM = (
    "You convert note titles to sentence case. Capitalize ONLY the first word and genuine "
    "proper nouns: people, places, brands, product/model names, and acronyms (iPhone, Lisbon, "
    "Sony WH-1000XM5, NASA). Lowercase every other word. Do NOT reword, translate, add, remove, "
    "or re-punctuate — change letter case only. Return a JSON array of strings, the re-cased "
    "titles in the SAME ORDER and SAME COUNT as the input array, nothing else."
)


def recase_batch(client: genai.Client, titles: list[str]) -> list[str] | None:
    prompt = "Re-case these titles to sentence case:\n" + json.dumps(titles, ensure_ascii=False)
    resp = client.models.generate_content(
        model=settings.GEMINI_LITE_MODEL,
        contents=[prompt],
        config=types.GenerateContentConfig(
            response_mime_type="application/json",
            system_instruction=SYSTEM,
        ),
    )
    try:
        out = json.loads(_strip_code_fences(resp.text))
    except (json.JSONDecodeError, AttributeError, TypeError):
        log.warning("batch parse failed; skipping %d titles", len(titles))
        return None
    if not isinstance(out, list) or len(out) != len(titles):
        log.warning("batch length mismatch (got %s, want %d); skipping",
                    len(out) if isinstance(out, list) else type(out).__name__, len(titles))
        return None
    return [str(t) for t in out]


async def run(dry_run: bool, limit: int | None) -> None:
    db = get_db()
    client = genai.Client(
        vertexai=True,
        project=settings.GOOGLE_CLOUD_PROJECT,
        location=settings.GEMINI_LOCATION,
    )

    items: list[tuple[str, str]] = []  # (doc_id, title)
    async for doc in db.collection("notes").stream():
        title = (doc.to_dict() or {}).get("title")
        if isinstance(title, str) and title.strip():
            items.append((doc.id, title))
        if limit and len(items) >= limit:
            break

    log.info("scanned %d notes with titles", len(items))
    changed = 0

    for i in range(0, len(items), BATCH):
        chunk = items[i:i + BATCH]
        recased = await asyncio.to_thread(recase_batch, client, [t for _, t in chunk])
        if recased is None:
            continue
        for (doc_id, old), new in zip(chunk, recased):
            new = new.strip()
            if not new or new == old:
                continue
            changed += 1
            if dry_run:
                log.info("would update %s\n  - %s\n  + %s", doc_id, old, new)
                continue
            await db.collection("notes").document(doc_id).update({"title": new})
            log.info("updated %s: %s -> %s", doc_id, old, new)

    log.info("done: scanned=%d changed=%d%s",
             len(items), changed, " (dry-run)" if dry_run else "")


if __name__ == "__main__":
    parser = argparse.ArgumentParser()
    parser.add_argument("--dry-run", action="store_true", help="show changes without writing")
    parser.add_argument("--limit", type=int, default=None, help="only process the first N notes")
    args = parser.parse_args()
    asyncio.run(run(args.dry_run, args.limit))
