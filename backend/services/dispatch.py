"""Self-dispatch to the worker route (replaces Cloud Tasks).

POSTs this deployment's own /api/process/{job_id} with the worker secret. The worker only
answers when the job is done, so a read timeout means "accepted and mid-run" — we stop
waiting after ~1.5 s. Runs in the caller's thread so the request finishes before the
caller's own response does (hence ~1.5 s added ingest latency). Retries and lost-job
recovery live in process.py (in-process retry, sweep route), not here.
"""
import httpx

from config import settings


def enqueue_process_job(job_id: str, path: str = "/api/process") -> None:
    """Kick the worker for `job_id`. `path` selects the pipeline: the default URL→note
    worker (`/api/process`) or the deep agent worker (`/api/process-agent`).

    A connect failure or 401/403 raises (bad URL/secret should fail loudly at the caller);
    409 means another delivery already claimed the job, which is fine."""
    url = f"{settings.WORKER_URL}{path}/{job_id}"
    try:
        r = httpx.post(url, headers={"X-Worker-Secret": settings.WORKER_SECRET},
                       timeout=httpx.Timeout(10, read=1.5))
    except httpx.ReadTimeout:
        return  # worker accepted and is mid-run; it only answers when done
    if r.status_code >= 400 and r.status_code != 409:
        raise RuntimeError(f"worker dispatch failed: HTTP {r.status_code}")
