import os
import traceback

from fastapi import FastAPI, Request
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse

from config import settings

os.makedirs(settings.TEMP_DOWNLOAD_DIR, exist_ok=True)

app = FastAPI(title=settings.PROJECT_NAME, version=settings.VERSION)

app.add_middleware(
    CORSMiddleware,
    allow_origins=[
        "http://localhost:3000",
        "http://localhost:5173",
        f"https://{settings.GOOGLE_CLOUD_PROJECT}.web.app",
        f"https://{settings.GOOGLE_CLOUD_PROJECT}.firebaseapp.com",
    ],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)


@app.exception_handler(Exception)
async def unhandled_exception_handler(request: Request, exc: Exception):
    print(traceback.format_exc())
    return JSONResponse(status_code=500, content={"detail": str(exc)})


@app.get("/health")
def health():
    return {"status": "healthy", "version": settings.VERSION}


from routers.ingest import router as ingest_router      # noqa: E402
from routers.process import router as process_router    # noqa: E402
from routers.notes import router as notes_router        # noqa: E402
from routers.jobs import router as jobs_router          # noqa: E402

app.include_router(ingest_router, prefix="/api")
app.include_router(process_router, prefix="/api")
app.include_router(notes_router, prefix="/api")
app.include_router(jobs_router, prefix="/api")
