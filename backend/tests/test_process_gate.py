"""Completeness gate + escalation + private_or_blocked failure path in the worker."""
import routers.process as process
from models.note import ContentBundle, NoteExtraction


class DummyRequest:
    headers = {}


def _ex(ct, data, summary="S"):
    return NoteExtraction(content_type=ct, title="T", ai_summary=summary, data=data)


# ---- _is_complete (pure) ----

def test_recipe_complete_needs_ingredients_quantities_and_steps():
    good = {"ingredients": [{"items": ["2 cups flour", "1 tsp salt", "3 eggs"]}],
            "steps": ["mix", "bake"]}
    assert process._is_complete(_ex("recipe", good), "recipe")
    assert not process._is_complete(_ex("recipe", {**good, "steps": ["mix"]}), "recipe")
    assert not process._is_complete(
        _ex("recipe", {"ingredients": [{"items": ["flour", "salt"]}], "steps": ["a", "b"]}), "recipe")
    # quantity-less ingredient lists are incomplete even when long enough
    assert not process._is_complete(
        _ex("recipe", {"ingredients": [{"items": ["flour", "salt", "eggs", "milk"]}],
                       "steps": ["a", "b"]}), "recipe")


def test_place_and_itinerary_need_a_named_stop():
    assert process._is_complete(_ex("place", {"venues": [{"name": "Cafe X"}]}), "place")
    assert not process._is_complete(_ex("place", {"venues": []}), "place")
    assert process._is_complete(
        _ex("itinerary", {"days": [{"stops": [{"place": "Eiffel"}]}]}), "itinerary")
    assert not process._is_complete(_ex("itinerary", {"days": [{"stops": []}]}), "itinerary")


def test_other_types_need_a_summary():
    assert process._is_complete(_ex("summary", {"tldr": "x"}), "summary")
    assert not process._is_complete(_ex("summary", {"tldr": "x"}, summary="  "), "summary")


# ---- escalation loop ----

def _reel(tier="caption"):
    return ContentBundle(kind="text", text="c", strategy="reel_caption",
                         metadata={"tier": tier})


async def test_incomplete_recipe_escalates_to_transcript_then_frames(monkeypatch):
    extracts, tiers = [], []

    async def extract(url, bundle, ct, hint=None):
        extracts.append(bundle.strategy)
        return _ex("recipe", {"ingredients": [], "steps": []})

    async def escalate(url, bundle):
        nxt = {"reel_caption": "reel_transcript", "reel_transcript": "reel_frames"}[bundle.strategy]
        tiers.append(nxt)
        return bundle.model_copy(update={"strategy": nxt,
                                         "metadata": {"tier": nxt.removeprefix("reel_")}})

    monkeypatch.setattr(process.gemini_service, "extract_async", extract)
    monkeypatch.setattr(process.sources, "escalate", escalate)
    ex, bundle = await process._extract_with_escalation(
        "u", _reel(), "recipe", None, process.time.monotonic())
    assert extracts == ["reel_caption", "reel_transcript", "reel_frames"]
    assert bundle.strategy == "reel_frames"        # renamed to the tier that produced the note
    assert ex.title == "T"                          # a failed gate never rejects the note


async def test_escalation_stops_when_complete_and_max_two(monkeypatch):
    calls = {"esc": 0}

    async def extract(url, bundle, ct, hint=None):
        return _ex("recipe", {"ingredients": [], "steps": []})

    async def escalate(url, bundle):
        calls["esc"] += 1
        return bundle.model_copy(update={"metadata": {"tier": "caption"}})  # never advances

    monkeypatch.setattr(process.gemini_service, "extract_async", extract)
    monkeypatch.setattr(process.sources, "escalate", escalate)
    await process._extract_with_escalation("u", _reel(), "recipe", None, process.time.monotonic())
    assert calls["esc"] == process.MAX_ESCALATIONS == 2


async def test_non_reel_never_escalates(monkeypatch):
    async def extract(url, bundle, ct, hint=None):
        return _ex("recipe", {})

    async def escalate(url, bundle):
        raise AssertionError("only reel_* strategies escalate")

    monkeypatch.setattr(process.gemini_service, "extract_async", extract)
    monkeypatch.setattr(process.sources, "escalate", escalate)
    b = ContentBundle(kind="text", text="x", strategy="web_scrape")
    await process._extract_with_escalation("u", b, "recipe", None, process.time.monotonic())


async def test_failed_reextract_keeps_best_partial(monkeypatch):
    n = {"i": 0}
    first = _ex("recipe", {"ingredients": [], "steps": []}, summary="partial")

    async def extract(url, bundle, ct, hint=None):
        n["i"] += 1
        if n["i"] == 1:
            return first
        raise RuntimeError("model down")

    async def escalate(url, bundle):
        return bundle.model_copy(update={"strategy": "reel_transcript"})

    monkeypatch.setattr(process.gemini_service, "extract_async", extract)
    monkeypatch.setattr(process.sources, "escalate", escalate)
    ex, _ = await process._extract_with_escalation(
        "u", _reel(), "recipe", None, process.time.monotonic())
    assert ex is first


# ---- full worker ----

def _wire(monkeypatch, fake_db, acquire, *, cleaned=None):
    monkeypatch.setattr(process, "_verify_oidc", lambda request: None)
    monkeypatch.setattr(process, "get_db", lambda: fake_db)

    async def _noop(*a, **k):
        return None

    async def cats(uid):
        return []

    async def classify(url, bundle, existing, hint=None):
        return "recipe"

    async def extract(url, bundle, ct, hint=None):
        return _ex(ct, {"ingredients": [{"items": ["1 cup a", "2 tbsp b", "3 c"]}],
                        "steps": ["x", "y"], "pad": "z" * 50})

    for name in ("add_user_category", "add_user_source", "touch_user_activity",
                 "_note_embedding", "fan_out_note"):
        monkeypatch.setattr(process, name, _noop)
    monkeypatch.setattr(process, "get_user_categories", cats)
    monkeypatch.setattr(process, "get_user_collections", cats)

    async def enrich(uid, ct, d, cover):
        return d, None

    monkeypatch.setattr(process, "enrich_note_data", enrich)
    monkeypatch.setattr(process.gemini_service, "classify", classify)
    monkeypatch.setattr(process.gemini_service, "extract_async", extract)
    monkeypatch.setattr(process.sources, "acquire", acquire)
    if cleaned is not None:
        monkeypatch.setattr(process.sources, "cleanup", lambda b: cleaned.append(b))


async def _blocked(url):
    return ContentBundle(kind="metadata_only", strategy="private_or_blocked",
                         metadata={"platform": "instagram"})


async def test_private_or_blocked_fails_job_and_writes_no_note(fake_db, monkeypatch):
    cleaned = []
    _wire(monkeypatch, fake_db, _blocked, cleaned=cleaned)
    fake_db.seed("jobs", "j", {"status": "pending", "user_id": "u", "input_type": "url",
                               "url": "https://www.instagram.com/reel/A/"})
    res = await process.process_job("j", DummyRequest())
    assert res["status"] == "failed"
    job = fake_db.docs[("jobs", "j")]
    assert job["status"] == "failed" and job["error"] == "private_or_blocked"
    assert not [k for k in fake_db.docs if k[0] == "notes"]
    assert cleaned                                    # temp dir cleanup always runs


async def test_private_or_blocked_reextract_does_not_clobber_note(fake_db, monkeypatch):
    _wire(monkeypatch, fake_db, _blocked)
    fake_db.seed("notes", "n1", {"user_id": "u", "title": "Keep me"})
    fake_db.seed("jobs", "j", {"status": "pending", "user_id": "u", "input_type": "url",
                               "url": "https://www.instagram.com/reel/A/",
                               "target_note_id": "n1"})
    res = await process.process_job("j", DummyRequest())
    assert res["status"] == "failed"
    assert fake_db.docs[("notes", "n1")]["title"] == "Keep me"
    assert fake_db.docs[("jobs", "j")]["error"] == "private_or_blocked"


async def test_thin_reel_escalates_before_classify_and_uses_canonical_source(fake_db, monkeypatch):
    order = []

    async def acquire(url):
        return ContentBundle(kind="text", text="hi", strategy="reel_caption",
                             metadata={"tier": "caption", "canonical_url":
                                       "https://www.instagram.com/reel/REAL/"})

    async def escalate(url, bundle):
        order.append("escalate")
        return bundle.model_copy(update={"text": "x" * 300, "strategy": "reel_transcript"})

    async def classify(url, bundle, existing, hint=None):
        order.append(("classify", bundle.strategy))
        return "recipe"

    _wire(monkeypatch, fake_db, acquire)
    monkeypatch.setattr(process.sources, "escalate", escalate)
    monkeypatch.setattr(process.gemini_service, "classify", classify)
    fake_db.seed("jobs", "j", {"status": "pending", "user_id": "u", "input_type": "url",
                               "url": "https://www.instagram.com/share/reel/ABC"})
    res = await process.process_job("j", DummyRequest())
    assert order == ["escalate", ("classify", "reel_transcript")]
    note = fake_db.docs[("notes", res["note_id"])]
    assert note["acquisition"] == "reel_transcript"
    assert note["source_url"] == "https://www.instagram.com/reel/REAL/"


async def _textless(url):
    return ContentBundle(kind="text", text=None, strategy="reel_caption",
                         metadata={"tier": "caption", "via": "ytdlp"})


async def test_thin_reel_escalate_none_fails_private_or_blocked(fake_db, monkeypatch):
    async def escalate(url, bundle):
        return None

    async def classify(*a, **k):
        raise AssertionError("must not classify a thin bundle")

    _wire(monkeypatch, fake_db, _textless)
    monkeypatch.setattr(process.sources, "escalate", escalate)
    monkeypatch.setattr(process.gemini_service, "classify", classify)
    fake_db.seed("jobs", "j", {"status": "pending", "user_id": "u", "input_type": "url",
                               "url": "https://www.instagram.com/reel/A/"})
    res = await process.process_job("j", DummyRequest())
    assert res["status"] == "failed"
    assert fake_db.docs[("jobs", "j")]["error"] == "private_or_blocked"
    assert not [k for k in fake_db.docs if k[0] == "notes"]


async def test_textless_reel_escalate_success_makes_note_via_escalated_tier(fake_db, monkeypatch):
    async def escalate(url, bundle):
        return bundle.model_copy(update={"text": "x" * 300, "strategy": "reel_transcript"})

    _wire(monkeypatch, fake_db, _textless)
    monkeypatch.setattr(process.sources, "escalate", escalate)
    fake_db.seed("jobs", "j", {"status": "pending", "user_id": "u", "input_type": "url",
                               "url": "https://www.instagram.com/reel/A/"})
    res = await process.process_job("j", DummyRequest())
    assert fake_db.docs[("notes", res["note_id"])]["acquisition"] == "reel_transcript"


async def test_short_real_caption_escalate_none_still_extracts(fake_db, monkeypatch):
    async def acquire(url):
        return ContentBundle(kind="text", text="easy pasta, 2 cups flour", strategy="reel_caption",
                             metadata={"tier": "caption", "via": "ytdlp"})

    async def escalate(url, bundle):
        return None

    _wire(monkeypatch, fake_db, acquire)
    monkeypatch.setattr(process.sources, "escalate", escalate)
    fake_db.seed("jobs", "j", {"status": "pending", "user_id": "u", "input_type": "url",
                               "url": "https://www.instagram.com/reel/A/"})
    res = await process.process_job("j", DummyRequest())
    assert fake_db.docs[("notes", res["note_id"])]["acquisition"] == "reel_caption"
