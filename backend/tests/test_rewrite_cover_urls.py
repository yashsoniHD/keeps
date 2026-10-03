import pytest

from scripts import rewrite_cover_urls as mod

GCS = "https://storage.googleapis.com/covers/a.jpg"


@pytest.fixture
def env(fake_db, monkeypatch):
    monkeypatch.setattr(mod, "get_db", lambda: fake_db)
    monkeypatch.setattr(mod, "_DELAY", 0)
    fake_db.seed("notes", "n1", {"cover_image_url": GCS, "source_url": "https://ok.example/a"})
    fake_db.seed("notes", "n2", {"cover_image_url": GCS, "source_url": "https://bad.example/b"})
    fake_db.seed("notes", "n3", {"cover_image_url": "https://cdn.example/c.jpg", "source_url": "https://x.example"})
    fake_db.seed("search_index", "note-n1", {"cover_image_url": GCS})

    async def fake_og(url):
        return "https://img.example/og.jpg" if "ok." in url else None
    monkeypatch.setattr(mod, "_og_image", fake_og)
    return fake_db


async def test_apply(env):
    stats = await mod.run(True, None, 0)
    assert stats == {"rewritten": 1, "nulled": 1, "skipped": 1}
    assert env.docs[("notes", "n1")]["cover_image_url"] == "https://img.example/og.jpg"
    assert env.docs[("search_index", "note-n1")]["cover_image_url"] == "https://img.example/og.jpg"
    assert env.docs[("notes", "n2")]["cover_image_url"] is None
    assert env.docs[("notes", "n3")]["cover_image_url"] == "https://cdn.example/c.jpg"
    assert ("search_index", "note-n2") not in env.docs


async def test_dry_run_writes_nothing(env):
    stats = await mod.run(False, None, 0)
    assert stats["rewritten"] == 1 and stats["nulled"] == 1
    assert env.updates == []
    assert env.docs[("notes", "n1")]["cover_image_url"] == GCS


async def test_og_image_parses_and_fails(monkeypatch):
    class R:
        text = '<meta name="twitter:image" content="https://i.example/t.jpg">'
        def raise_for_status(self): pass
    class C:
        async def __aenter__(self): return self
        async def __aexit__(self, *a): pass
        async def get(self, url, headers=None): return R()
    monkeypatch.setattr(mod, "guarded_async_client", lambda **k: C())
    assert await mod._og_image("https://p.example") == "https://i.example/t.jpg"
    monkeypatch.setattr(mod, "guarded_async_client", lambda **k: (_ for _ in ()).throw(RuntimeError("x")))
    assert await mod._og_image("https://p.example") is None
