import pytest

import routers.search as search_mod
from services.source_alias import canonical_source, source_matches


@pytest.mark.parametrize(
    "domain,keyword,expected",
    [
        ("pin.it", "pinterest", True),          # short link — the reported bug
        ("in.pinterest.com", "pinterest", True),
        ("youtu.be", "youtube", True),
        ("x.com", "twitter", True),
        ("amzn.in", "amazon", True),
        ("instagram.com", "pinterest", False),  # different brand must not match
        ("", "pinterest", False),
        ("pin.it", "", False),                  # empty keyword never matches
    ],
)
def test_source_matches(domain, keyword, expected):
    assert source_matches(domain, keyword) is expected


def test_canonical_source_registrable_fallback():
    assert canonical_source("open.substack.com") == "substack"
    assert canonical_source("somerandomblog.dev") == "somerandomblog"


class _FakeDoc:
    def __init__(self, d):
        self.id = d["id"]
        self._d = d

    def to_dict(self):
        return self._d


def _fake_db(docs):
    class FakeStream:
        def __aiter__(self):
            async def gen():
                for d in docs:
                    yield _FakeDoc(d)
            return gen()

    class FakeQuery:
        def where(self, *a, **k):
            return self

        def order_by(self, *a, **k):
            return self

        def limit(self, *a, **k):
            return self

        def stream(self):
            return FakeStream()

    class FakeDB:
        def collection(self, *a, **k):
            return FakeQuery()

    return FakeDB()


@pytest.mark.asyncio
async def test_search_notes_by_source_matches_short_link():
    db = _fake_db([
        {"id": "pin1", "source_domain": "pin.it", "title": "Mango sago", "content_type": "recipe"},
        {"id": "ig1", "source_domain": "instagram.com", "title": "Reel", "content_type": "summary"},
    ])
    source_hits, _ = await search_mod._keyword_hits(db, "u", "pinterest", match_source=True)
    assert [h["id"] for h in source_hits] == ["pin1"]
