import hashlib
import json
import logging

from google.api_core.exceptions import AlreadyExists
from google.cloud import tasks_v2

from config import settings

log = logging.getLogger(__name__)


def enqueue_process_job(job_id: str, path: str = "/api/process") -> None:
    """Enqueues a Cloud Task that calls a worker endpoint for this job.

    The worker reads everything it needs off the job doc, so the payload stays minimal. The
    request carries an OIDC token signed as the service account; the worker verifies signature,
    audience, and SA email — no shared secret. `path` selects the worker: the default URL→note
    pipeline (`/api/process`) or the deep agent task worker (`/api/process-agent`).

    Task name is derived from job_id so Cloud Tasks deduplicates retries within its 1-hour
    window — AlreadyExists means the task is already queued, which is fine.
    """
    client = tasks_v2.CloudTasksClient()
    parent = client.queue_path(
        settings.GOOGLE_CLOUD_PROJECT,
        settings.CLOUD_TASKS_LOCATION,
        settings.CLOUD_TASKS_QUEUE,
    )
    # Deterministic task name based on job_id prevents duplicate enqueues from retry storms.
    # Cloud Tasks enforces uniqueness for ~1 hour after creation.
    dedup_key = hashlib.sha256(job_id.encode()).hexdigest()[:32]
    task = {
        "name": f"{parent}/tasks/{dedup_key}",
        "http_request": {
            "http_method": tasks_v2.HttpMethod.POST,
            "url": f"{settings.CLOUD_TASKS_WORKER_URL}{path}/{job_id}",
            "headers": {"Content-Type": "application/json"},
            "body": json.dumps({"job_id": job_id}).encode(),
            "oidc_token": {
                "service_account_email": settings.CLOUD_TASKS_SA_EMAIL,
                "audience": settings.CLOUD_TASKS_WORKER_URL,
            },
        },
    }
    try:
        client.create_task(parent=parent, task=task)
    except AlreadyExists:
        log.info("enqueue_process_job: task already exists for job %s (dedup hit)", job_id)
