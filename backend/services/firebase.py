import asyncio

import firebase_admin
from firebase_admin import auth
from google.cloud.firestore_v1 import AsyncClient, ArrayUnion

from config import settings

_app = None
_db: AsyncClient | None = None


def get_firebase_app():
    global _app
    if _app is None:
        # On Cloud Run / locally with ADC: Application Default Credentials.
        _app = firebase_admin.initialize_app(options={"projectId": settings.GOOGLE_CLOUD_PROJECT})
    return _app


def get_db() -> AsyncClient:
    """Singleton Firestore async client (never create a new client per request)."""
    global _db
    if _db is None:
        get_firebase_app()
        _db = AsyncClient(project=settings.GOOGLE_CLOUD_PROJECT)
    return _db


async def verify_firebase_token(token: str) -> str:
    """Verifies a Firebase ID token and returns the uid. The SDK call is blocking —
    run it off the event loop."""
    get_firebase_app()
    decoded = await asyncio.to_thread(auth.verify_id_token, token)
    return decoded["uid"]


async def get_user_categories(uid: str) -> list[str]:
    """The user's known content_type slugs from users/{uid}.categories —
    one doc read, never a notes-collection scan."""
    snap = await get_db().collection("users").document(uid).get()
    if not snap.exists:
        return []
    return sorted(snap.to_dict().get("categories", []))


async def add_user_category(uid: str, slug: str) -> None:
    """Adds a content_type slug to users/{uid}.categories (idempotent via ArrayUnion)."""
    await get_db().collection("users").document(uid).set(
        {"categories": ArrayUnion([slug])}, merge=True
    )


async def ensure_user_doc(uid: str, *, display_name: str | None = None,
                          email: str | None = None, photo_url: str | None = None) -> None:
    """Creates/refreshes the users/{uid} profile doc (called on first ingest)."""
    doc = {k: v for k, v in {
        "display_name": display_name, "email": email, "photo_url": photo_url,
    }.items() if v is not None}
    if doc:
        await get_db().collection("users").document(uid).set(doc, merge=True)
