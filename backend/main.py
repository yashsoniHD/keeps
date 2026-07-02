import logging
import os

from fastapi import FastAPI, Request
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse

from config import settings
from services.logging_setup import setup_logging
from services.rate_limit import RateLimitMiddleware

setup_logging()
log = logging.getLogger("clipnote.app")

os.makedirs(settings.TEMP_DOWNLOAD_DIR, exist_ok=True)

app = FastAPI(title=settings.PROJECT_NAME, version=settings.VERSION)

# Order matters: add the rate limiter BEFORE CORS so CORS stays the outermost middleware and
# wraps the limiter's 429 with CORS headers (otherwise the browser can't read the response).
app.add_middleware(RateLimitMiddleware, limit_per_min=settings.RATE_LIMIT_PER_MIN)

app.add_middleware(
    CORSMiddleware,
    allow_origins=[
        "http://localhost:3000",
        "http://localhost:5173",
        f"https://{settings.GOOGLE_CLOUD_PROJECT}.web.app",
        f"https://{settings.GOOGLE_CLOUD_PROJECT}.firebaseapp.com",
        # Dedicated hosting site (firebase.json "site": "clipnote") — the project-named
        # URLs above stay for the transition.
        "https://clipnote.web.app",
        "https://clipnote.firebaseapp.com",
    ],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)


@app.exception_handler(Exception)
async def unhandled_exception_handler(request: Request, exc: Exception):
    log.error("unhandled exception on %s %s", request.method, request.url.path, exc_info=exc)
    return JSONResponse(status_code=500, content={"detail": str(exc)})


@app.get("/health")
def health():
    return {"status": "healthy", "version": settings.VERSION}


_client_log = logging.getLogger("clipnote.client")


@app.post("/api/client-errors")
async def client_errors(request: Request):
    """Frontend error sink: window.onerror/unhandledrejection report here so browser
    failures show up in Cloud Logging instead of dying in users' consoles.
    Unauthenticated by design (errors often happen before sign-in); body is capped."""
    body = (await request.body())[:2048].decode("utf-8", errors="ignore")
    _client_log.error("client error: %s", body, extra={"source": "frontend"})
    return {"status": "logged"}


from routers.ingest import router as ingest_router      # noqa: E402
from routers.process import router as process_router    # noqa: E402
from routers.notes import router as notes_router        # noqa: E402
from routers.jobs import router as jobs_router          # noqa: E402
from routers.tokens import router as tokens_router      # noqa: E402
from routers.ask import router as ask_router            # noqa: E402
from routers.admin import router as admin_router        # noqa: E402
from routers.search import router as search_router      # noqa: E402
from routers.categories import router as categories_router  # noqa: E402
from routers.conversations import router as conversations_router  # noqa: E402
from routers.watch_items import router as watch_items_router  # noqa: E402
from routers.wish_items import router as wish_items_router    # noqa: E402
from routers.place_items import router as place_items_router  # noqa: E402
from routers.recipe_items import router as recipe_items_router  # noqa: E402
from routers.trip_items import router as trip_items_router      # noqa: E402
from routers.digest import router as digest_router              # noqa: E402
from routers.collections import router as collections_router    # noqa: E402

app.include_router(ingest_router, prefix="/api")
app.include_router(process_router, prefix="/api")
app.include_router(notes_router, prefix="/api")
app.include_router(jobs_router, prefix="/api")
app.include_router(tokens_router, prefix="/api")
app.include_router(ask_router, prefix="/api")
app.include_router(admin_router, prefix="/api")
app.include_router(search_router, prefix="/api")
app.include_router(categories_router, prefix="/api")
app.include_router(conversations_router, prefix="/api")
app.include_router(watch_items_router, prefix="/api")
app.include_router(wish_items_router, prefix="/api")
app.include_router(place_items_router, prefix="/api")
app.include_router(recipe_items_router, prefix="/api")
app.include_router(trip_items_router, prefix="/api")
app.include_router(digest_router, prefix="/api")
app.include_router(collections_router, prefix="/api")
