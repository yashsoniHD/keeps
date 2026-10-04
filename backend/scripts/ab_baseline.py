"""One-off READ-ONLY: sample diverse links from completed jobs + dump surviving notes.

Run: cd backend && .venv/bin/python -m scripts.ab_baseline
Writes ../phase0/ab/{links.txt,baseline.json}. Never writes to Firestore.
"""
import asyncio, collections, json, random
from pathlib import Path
from urllib.parse import urlparse

from services.firebase import get_db

OUT = Path(__file__).resolve().parents[2] / "phase0" / "ab"
# (host suffix, quota)
QUOTAS = [("instagram.com", 12), ("youtube", 5), ("x.com", 2), ("amzn.in", 2),
          ("share.google", 1), ("linkedin.com", 1), ("bbcgoodfood.com", 1),
          ("nykaaman.com", 1), ("github.com", 1), ("pin.it", 1)]


def host(u):
    return urlparse(u).netloc.lower().removeprefix("www.")


def kind(u):  # for diversity within a domain
    p = urlparse(u).path
    if "instagram" in u:
        return "post" if p.startswith(("/p/", "/tv/")) else "reel"
    if "youtu.be" in u:
        return "youtu.be"
    return "shorts" if "/shorts/" in p else "watch" if "youtube" in u else "other"


def jsonable(d):
    return {k: v for k, v in d.items() if k != "embedding"}


async def main():
    db = get_db()  # read-only usage below
    notes = [{"note_id": d.id, **jsonable(d.to_dict())} async for d in db.collection("notes").stream()]
    jobs = [{"job_id": d.id, **d.to_dict()} async for d in db.collection("jobs").stream()]
    jobs = [j for j in jobs if j.get("status") == "completed" and str(j.get("url") or "").startswith("http")]
    by_url = collections.defaultdict(list)
    for j in jobs:
        by_url[j["url"]].append(j)

    rnd = random.Random(7)
    picked = [n["source_url"] for n in notes if n.get("source_url")]  # true old-vs-new pairs first
    for suffix, quota in QUOTAS:
        pool = [u for u in by_url if suffix in host(u) and u not in picked]
        rnd.shuffle(pool)
        have = sum(suffix in host(u) for u in picked)
        groups = collections.defaultdict(list)
        for u in pool:
            groups[kind(u)].append(u)
        while have < quota and any(groups.values()):  # round-robin across kinds
            for g in sorted(groups, key=lambda k: k != "post"):
                if groups[g] and have < quota:
                    picked.append(groups[g].pop()); have += 1

    OUT.mkdir(parents=True, exist_ok=True)
    (OUT / "links.txt").write_text("\n".join(picked) + "\n")
    rows = [{"source_url": u, "source_domain": host(u), "kind": kind(u), "jobs": by_url.get(u, [])} for u in picked]
    (OUT / "baseline.json").write_text(json.dumps({"surviving_notes": notes, "links": rows}, indent=2, default=str))
    print(len(picked), "links")
    print(collections.Counter((host(u), kind(u)) for u in picked).most_common())


asyncio.run(main())
