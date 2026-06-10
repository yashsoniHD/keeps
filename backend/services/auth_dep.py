from fastapi import Header, HTTPException

from services.firebase import verify_firebase_token


async def require_user(authorization: str | None = Header(default=None)) -> str:
    """FastAPI dependency: returns the authenticated uid or raises 401."""
    if not authorization or not authorization.startswith("Bearer "):
        raise HTTPException(401, "Authentication required")
    try:
        return await verify_firebase_token(authorization.removeprefix("Bearer "))
    except Exception:
        raise HTTPException(401, "Invalid token")
