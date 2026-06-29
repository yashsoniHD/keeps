"""Shared OIDC verification for internal worker endpoints.

Cloud Tasks and Cloud Scheduler call our private worker endpoints (/api/process*,
/api/digest/run) with an OIDC token signed by the service account. We verify the token's
signature, audience (the worker URL), and SA email — never a shared secret.
"""
from fastapi import HTTPException
from google.auth.transport import requests as google_requests
from google.oauth2 import id_token

from config import settings


def verify_oidc(request) -> None:
    """Raise 403 unless the request carries a valid OIDC token from our service account."""
    auth_header = request.headers.get("authorization", "")
    if not auth_header.startswith("Bearer "):
        raise HTTPException(403, "Forbidden")
    try:
        claims = id_token.verify_oauth2_token(
            auth_header.removeprefix("Bearer "),
            google_requests.Request(),
            audience=settings.CLOUD_TASKS_WORKER_URL,
        )
    except Exception:
        raise HTTPException(403, "Forbidden")
    if claims.get("email") != settings.CLOUD_TASKS_SA_EMAIL or not claims.get("email_verified"):
        raise HTTPException(403, "Forbidden")
