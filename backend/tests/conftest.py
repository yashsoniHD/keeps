"""Minimal in-memory Firestore double — just the surface the code under test touches."""
import pytest


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

    async def get(self, transaction=None):
        return FakeSnap(self._db.docs.get(self._key), self)

    async def update(self, data):
        self._db.docs[self._key] = {**self._db.docs.get(self._key, {}), **data}
        self._db.updates.append((self._key, dict(data)))

    async def set(self, data, merge=False):
        base = self._db.docs.get(self._key, {}) if merge else {}
        self._db.docs[self._key] = {**base, **data}

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

    def document(self, doc_id):
        return FakeDocRef(self._db, self._name, doc_id)

    def order_by(self, field, direction="ASCENDING"):
        self._order = field
        self._desc = str(direction).upper().endswith("DESCENDING") or direction == "DESCENDING"
        return self

    def limit(self, n):
        self._limit = n
        return self

    async def stream(self):
        items = [(k[1], v) for k, v in self._db.docs.items() if k[0] == self._name]
        if self._order:
            items.sort(key=lambda kv: (kv[1].get(self._order) is None, kv[1].get(self._order)),
                       reverse=self._desc)
        if self._limit is not None:
            items = items[: self._limit]
        for doc_id, data in items:
            yield FakeSnap(data, FakeDocRef(self._db, self._name, doc_id))


class FakeDb:
    def __init__(self):
        self.docs: dict[tuple[str, str], dict] = {}
        self.updates: list[tuple[tuple[str, str], dict]] = []

    def collection(self, name):
        return FakeCollection(self, name)

    def seed(self, collection, doc_id, data):
        self.docs[(collection, doc_id)] = data


@pytest.fixture
def fake_db():
    return FakeDb()
