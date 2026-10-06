"""Compare legacy, evidence+composition, and reviewed notes on supplied source fixtures.

Run from backend: .venv/bin/python -m scripts.eval_notes cases.json --out /tmp/note-eval
This makes paid model calls, never writes Firestore, and never re-extracts existing notes.
"""
import argparse
import csv
import json
import random
import time
from pathlib import Path

from config import settings
from models.note import ContentBundle
from services.gemini import gemini_service, job_deadline
from services.usage_meter import start_metering


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("cases", type=Path)
    parser.add_argument("--out", type=Path, required=True)
    parser.add_argument("--limit", type=int, default=30)
    args = parser.parse_args()
    cases = json.loads(args.cases.read_text())
    if not isinstance(cases, list) or not 1 <= args.limit <= 30:
        parser.error("cases must be an array; limit must be 1–30")
    # Validate the complete selected fixture set before spending on model calls.
    selected = [(case, ContentBundle.model_validate(case["bundle"])) for case in cases[:args.limit]]
    args.out.mkdir(parents=True, exist_ok=False)
    modes = [("legacy", False, False), ("composed", True, False), ("reviewed", True, True)]
    original = settings.NOTE_DOCUMENTS_ENABLED, settings.NOTE_REVIEW_ENABLED
    blind, key, scores = [], [], []
    rng = random.Random(42)
    try:
        for i, (case, bundle) in enumerate(selected):
            order = list(modes)
            rng.shuffle(order)
            for label, (mode, docs, review) in zip("ABC", order):
                settings.NOTE_DOCUMENTS_ENABLED, settings.NOTE_REVIEW_ENABLED = docs, review
                meter = start_metering()
                started = time.monotonic()
                token = job_deadline.set(started + 240)
                result = {"case": case.get("id", str(i + 1)), "variant": label}
                metrics = {**result, "mode": mode}
                try:
                    note = gemini_service.extract(case.get("url", ""), bundle.model_copy(deep=True),
                                                  case.get("content_type"), case.get("note_hint"))
                    metrics["quality"] = note.data.get("_quality")
                    result["note"] = note.model_dump()
                    result["note"]["data"] = {k: v for k, v in note.data.items() if not k.startswith("_")}
                except Exception as exc:
                    result["error"] = type(exc).__name__
                finally:
                    job_deadline.reset(token)
                metrics.update(seconds=round(time.monotonic() - started, 2), calls=meter.calls,
                               cost_usd=meter.cost_usd, models=meter.models)
                blind.append(result)
                key.append(metrics)
                scores.append({"case": result["case"], "variant": label,
                               "accuracy_1_5": "", "coverage_1_5": "", "readability_1_5": "",
                               "usefulness_1_5": "", "need_source_again": "", "notes": ""})
                # Preserve each finished result if a later request is interrupted.
                (args.out / "blind.json").write_text(json.dumps(blind, indent=2, ensure_ascii=False))
                (args.out / "key-and-metrics.json").write_text(json.dumps(key, indent=2))
    finally:
        settings.NOTE_DOCUMENTS_ENABLED, settings.NOTE_REVIEW_ENABLED = original
    if scores:
        with (args.out / "scores.csv").open("w") as f:
            writer = csv.DictWriter(f, fieldnames=list(scores[0]))
            writer.writeheader()
            writer.writerows(scores)
    print(f"Wrote {len(blind)} outputs to {args.out}")


if __name__ == "__main__":
    main()
