"""Minimal in-memory Firestore double — just the surface the code under test touches."""
import pytest


class FakeSnap:
    def __init__(self, data, ref):
        self._data = data
        self.reference = ref

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


class FakeCollection:
    def __init__(self, db, name):
        self._db = db
        self._name = name

    def document(self, doc_id):
        return FakeDocRef(self._db, self._name, doc_id)


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
