import json

from google.cloud import tasks_v2

from config import settings


def enqueue_process_job(job_id: str, path: str = "/api/process") -> None:
    """Enqueues a Cloud Task that calls a worker endpoint for this job.

    The worker reads everything it needs off the job doc, so the payload stays minimal. The
    request carries an OIDC token signed as the service account; the worker verifies signature,
    audience, and SA email — no shared secret. `path` selects the worker: the default URL→note
    pipeline (`/api/process`) or the deep agent task worker (`/api/process-agent`).
    """
    client = tasks_v2.CloudTasksClient()
    parent = client.queue_path(
        settings.GOOGLE_CLOUD_PROJECT,
        settings.CLOUD_TASKS_LOCATION,
        settings.CLOUD_TASKS_QUEUE,
    )
    task = {
        "http_request": {
            "http_method": tasks_v2.HttpMethod.POST,
            "url": f"{settings.CLOUD_TASKS_WORKER_URL}{path}/{job_id}",
            "headers": {"Content-Type": "application/json"},
            "body": json.dumps({"job_id": job_id}).encode(),
            "oidc_token": {
                "service_account_email": settings.CLOUD_TASKS_SA_EMAIL,
                "audience": settings.CLOUD_TASKS_WORKER_URL,
            },
        }
    }
    client.create_task(parent=parent, task=task)
