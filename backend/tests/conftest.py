"""Minimal in-memory Firestore double — just the surface the code under test touches."""
import pytest

try:
    from google.cloud.firestore_v1.transforms import Increment as _Increment
except Exception:  # pragma: no cover — firestore absent in a minimal env
    _Increment = None


def _resolve_transforms(base: dict, data: dict) -> dict:
    """Apply Firestore field transforms (Increment) against the current doc so tests read
    plain numbers, matching what the real server materializes."""
    out = dict(data)
    if _Increment is not None:
        for k, v in data.items():
            if isinstance(v, _Increment):
                out[k] = (base.get(k) or 0) + v.value
    return out


class FakeSnap:
    def __init__(self, data, ref):
        self._data = data
        self.reference = ref
        self.id = ref._key[1] if ref is not None else None

    @property
    def exists(self) -> bool:
        return self._data is not None

    def to_dict(self):
        return dict(self._data) if self._data is not None else None


class FakeDocRef:
    def __init__(self, db, collection, doc_id):
        self._db = db
        self._key = (collection, doc_id)

    @property
    def path(self) -> str:
        return f"{self._key[0]}/{self._key[1]}"

    async def get(self, transaction=None):
        return FakeSnap(self._db.docs.get(self._key), self)

    async def update(self, data):
        base = self._db.docs.get(self._key, {})
        data = _resolve_transforms(base, data)
        self._db.docs[self._key] = {**base, **data}
        self._db.updates.append((self._key, dict(data)))

    async def set(self, data, merge=False):
        base = self._db.docs.get(self._key, {}) if merge else {}
        self._db.docs[self._key] = {**base, **_resolve_transforms(base, data)}

    async def delete(self):
        self._db.docs.pop(self._key, None)

    def collection(self, name):
        # Subcollection — namespaced by the parent doc so keys don't collide.
        return FakeCollection(self._db, f"{self._key[0]}/{self._key[1]}/{name}")


class FakeCollection:
    def __init__(self, db, name):
        self._db = db
        self._name = name
        self._order = None
        self._desc = False
        self._limit = None
        self._require_embedding = False
        self._filters: list[tuple[str, str, object]] = []

    def document(self, doc_id):
        return FakeDocRef(self._db, self._name, doc_id)

    def where(self, field, op, value):
        # Only "==" is needed by the code under test (e.g. notes by user_id/content_type).
        self._filters.append((field, op, value))
        return self

    def select(self, _fields):
        return self  # projection is irrelevant to the in-memory store

    def count(self):
        return FakeAggregation(self)

    def order_by(self, field, direction="ASCENDING"):
        self._order = field
        self._desc = str(direction).upper().endswith("DESCENDING") or direction == "DESCENDING"
        return self

    def limit(self, n):
        self._limit = n
        return self

    def find_nearest(self, vector_field=None, query_vector=None,
                     distance_measure=None, limit=None, **kwargs):
        # Vector search double: ignore the vector (no real ANN), just return matching docs that
        # HAVE the embedding field, honouring the existing where-filters and the limit. Enough to
        # exercise the shortlist/candidate-pool wiring; ranking is out of scope for these tests.
        self._require_embedding = True
        if limit is not None:
            self._limit = limit
        return self

    async def stream(self):
        items = [
            (k[1], v) for k, v in self._db.docs.items()
            if k[0] == self._name and all(v.get(f) == val for f, op, val in self._filters)
            and (not self._require_embedding or v.get("embedding") is not None)
        ]
        if self._order:
            items.sort(key=lambda kv: (kv[1].get(self._order) is None, kv[1].get(self._order)),
                       reverse=self._desc)
        if self._limit is not None:
            items = items[: self._limit]
        for doc_id, data in items:
            yield FakeSnap(data, FakeDocRef(self._db, self._name, doc_id))


class _FakeAggResult:
    def __init__(self, value):
        self.value = value


class FakeAggregation:
    """Mirrors collection.where(...).count().get() → agg[0][0].value."""
    def __init__(self, coll):
        self._coll = coll

    async def get(self):
        n = sum(
            1 for k, v in self._coll._db.docs.items()
            if k[0] == self._coll._name
            and all(v.get(f) == val for f, op, val in self._coll._filters)
        )
        return [[_FakeAggResult(n)]]


class FakeCollectionGroup:
    """Minimal collection-group query: streams every doc whose collection path's leaf equals the
    group name (top-level or nested under users/{uid}/…). Enough for the migration scripts."""

    def __init__(self, db, name):
        self._db = db
        self._name = name

    async def stream(self):
        for (coll, doc_id), data in list(self._db.docs.items()):
            leaf = coll.rsplit("/", 1)[-1]
            if leaf == self._name:
                yield FakeSnap(data, FakeDocRef(self._db, coll, doc_id))


class FakeTransaction:
    """Pairs with the autouse identity stub on fs.async_transactional: reads go through
    ref.get(transaction=tx) as usual; writes apply immediately (no commit phase)."""

    def __init__(self, db):
        self._db = db

    def set(self, ref, data, merge=False):
        base = self._db.docs.get(ref._key, {}) if merge else {}
        self._db.docs[ref._key] = {**base, **_resolve_transforms(base, data)}

    def update(self, ref, data):
        base = self._db.docs.get(ref._key, {})
        self._db.docs[ref._key] = {**base, **_resolve_transforms(base, data)}


class FakeDb:
    def __init__(self):
        self.docs: dict[tuple[str, str], dict] = {}
        self.updates: list[tuple[tuple[str, str], dict]] = []

    def collection(self, name):
        return FakeCollection(self, name)

    def transaction(self):
        return FakeTransaction(self)

    def collection_group(self, name):
        # Matches every subcollection whose leaf name is `name` (keys like
        # "users/{uid}/watch_items") as well as a top-level collection of that name.
        return FakeCollectionGroup(self, name)

    def seed(self, collection, doc_id, data):
        self.docs[(collection, doc_id)] = data


@pytest.fixture
def fake_db():
    return FakeDb()


@pytest.fixture(autouse=True)
def _stub_transactional(monkeypatch):
    """Run @fs.async_transactional bodies directly against FakeTransaction — the real
    decorator needs a live Firestore transaction (begin/commit/rollback RPCs)."""
    try:
        monkeypatch.setattr("google.cloud.firestore.async_transactional", lambda f: f)
    except Exception:  # pragma: no cover — firestore absent in a minimal env
        pass


@pytest.fixture(autouse=True)
def _stub_embeddings(monkeypatch):
    """No test should make a real Vertex embedding call. search_index (wired into every ingest /
    note write) embeds via the shared singleton, so stub it globally with a deterministic vector.
    Tests that assert on embedding wiring stub their own router-local `_note_embedding` on top."""
    async def fake_embed(text, *a, **k):
        return [0.0] * 8
    try:
        from services.embeddings import embedding_service
        monkeypatch.setattr(embedding_service, "embed_document", fake_embed)
        monkeypatch.setattr(embedding_service, "embed_query", fake_embed)
    except Exception:  # pragma: no cover — embeddings deps absent in a minimal env
        pass
