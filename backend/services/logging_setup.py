"""Structured JSON logging for Cloud Run.

Cloud Run's log agent parses one-JSON-object-per-line stdout: `severity` and
`message` map onto Cloud Logging fields automatically, and everything else
becomes queryable jsonPayload fields — so alerts can filter on e.g.
jsonPayload.job_id or severity>=ERROR without regex-scraping text logs.

Usage:
    log = logging.getLogger("clipnote.sources")
    log.warning("strategy failed", extra={"url": url, "strategy": name})
"""
import json
import logging
import sys

# Context keys we promote from `extra={...}` into the JSON payload.
_EXTRA_FIELDS = ("job_id", "user_id", "url", "strategy", "source", "status_code")


class _JsonFormatter(logging.Formatter):
    def format(self, record: logging.LogRecord) -> str:
        entry = {
            "severity": record.levelname,
            "message": record.getMessage(),
            "logger": record.name,
        }
        for key in _EXTRA_FIELDS:
            value = getattr(record, key, None)
            if value is not None:
                entry[key] = value
        if record.exc_info:
            entry["exception"] = self.formatException(record.exc_info)
        return json.dumps(entry, ensure_ascii=False, default=str)


def setup_logging() -> None:
    handler = logging.StreamHandler(sys.stdout)
    handler.setFormatter(_JsonFormatter())
    root = logging.getLogger()
    root.handlers[:] = [handler]
    root.setLevel(logging.INFO)
    # uvicorn's access/error loggers keep their own handlers otherwise.
    for name in ("uvicorn", "uvicorn.access", "uvicorn.error"):
        logging.getLogger(name).handlers[:] = []
        logging.getLogger(name).propagate = True
