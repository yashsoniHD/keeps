"""A2 spike: base64 video_url limits, latency, fallback and JSON behaviour on OpenRouter.

Run: cd backend && .venv/bin/python ../phase0/ab/video_spike.py [phase ...]
Phases: encode, sizes, youtube, fallback (default: all). JSON parseability is scored on every call.
Results append to video_spike.jsonl.
Source clip: public-domain "Duck and Cover" (1951, archive.org) -- narrated, so audio vs visual
is checkable: visuals = cartoon turtle "Bert", kids ducking under desks; audio = narrator/jingle.
"""
import base64, json, os, re, subprocess, sys, time
from concurrent.futures import ThreadPoolExecutor
from pathlib import Path

sys.path.insert(0, os.getcwd())
from config import settings  # noqa: E402  (loads backend/.env)
from openai import OpenAI  # noqa: E402

FREE = "nvidia/nemotron-3-nano-omni-30b-a3b-reasoning:free"
PAID = "google/gemini-2.5-flash-lite"
HERE = Path(__file__).parent
WORK = Path(os.environ.get("SPIKE_DIR", "/tmp/video_spike"))
SRC = WORK / "src.mp4"
SRC_URL = "https://archive.org/download/DuckandC1951/DuckandC1951_512kb.mp4"
OUT = HERE / "video_spike.jsonl"
# (label, seconds, video kbps) -> roughly the target size at 360p
SIZES = [("5MB", 60, 600), ("12MB", 150, 600), ("20MB", 250, 600), ("25MB", 310, 600),
         ("33MB", 410, 600), ("45MB", 555, 600), ("60MB", 555, 820)]
YOUTUBE_URL = "https://www.youtube.com/watch?v=jNQXAC9IVRw"  # "Me at the zoo", 19 s

SYSTEM = (
    "You turn a video into a note. Describe what is SEEN and what is HEARD (speech, narration, "
    "music). Reply with ONLY a JSON object, no prose, no code fences: "
    '{"title": str, "summary": str, "key_points": [str], "seen": [str], "heard": [str]}'
)
client = OpenAI(base_url="https://openrouter.ai/api/v1", api_key=settings.OPENROUTER_API_KEY,
                max_retries=0)


def encode():
    WORK.mkdir(parents=True, exist_ok=True)
    if not SRC.exists():
        subprocess.run(["curl", "-sL", "-o", str(SRC), SRC_URL], check=True)
    for label, secs, kbps in SIZES:
        out = WORK / f"clip_{label}.mp4"
        if not out.exists():
            subprocess.run(["ffmpeg", "-y", "-v", "error", "-i", str(SRC), "-t", str(secs),
                            "-vf", "scale=480:360", "-c:v", "libx264", "-b:v", f"{kbps}k",
                            "-maxrate", f"{kbps}k", "-bufsize", f"{2 * kbps}k",
                            "-c:a", "aac", "-b:a", "64k", str(out)], check=True)
        print(label, secs, "s", round(out.stat().st_size / 1e6, 2), "MB")


def parse_json(text):
    if not text:
        return None
    m = re.search(r"\{.*\}", text, re.S)  # tolerate fences / leading prose
    try:
        return json.loads(m.group(0)) if m else None
    except json.JSONDecodeError:
        return None


def call(model, video_url, *, models=None, timeout=280.0, tag=""):
    extra = {"reasoning": {"effort": "low"} if "nemotron" in model else {"enabled": False}}
    if models:
        extra["models"] = models
    rec = {"tag": tag, "model": model, "models": models, "timeout": timeout}
    t = time.monotonic()
    try:
        r = client.chat.completions.create(
            model=model, max_tokens=1500, timeout=timeout, extra_body=extra,
            messages=[{"role": "system", "content": SYSTEM}, {"role": "user", "content": [
                {"type": "video_url", "video_url": {"url": video_url}},
                {"type": "text", "text": "Make the note for this video."}]}])
        rec["latency_s"] = round(time.monotonic() - t, 1)
        text = (r.choices[0].message.content if r.choices else None) or ""
        u = r.usage
        rec.update(status=200, served_by=r.model, provider=(r.model_extra or {}).get("provider"),
                   cost=getattr(u, "cost", None) if u else None,
                   tok_in=u.prompt_tokens if u else None, tok_out=u.completion_tokens if u else None,
                   finish=r.choices[0].finish_reason if r.choices else None,
                   json_ok=parse_json(text) is not None, strict_json=_strict(text), text=text[:4000])
        if not r.choices:
            rec["raw"] = str(r.model_dump())[:600]
    except Exception as e:  # record the failure, keep going
        rec["latency_s"] = round(time.monotonic() - t, 1)
        rec.update(status=getattr(e, "status_code", None), error=f"{type(e).__name__}: {str(e)[:400]}")
    print(json.dumps({k: v for k, v in rec.items() if k != "text"}), flush=True)
    with OUT.open("a") as f:
        f.write(json.dumps(rec) + "\n")
    return rec


def _strict(text):
    try:
        json.loads(text)
        return True
    except Exception:
        return False


def data_url(label):
    b = (WORK / f"clip_{label}.mp4").read_bytes()
    return "data:video/mp4;base64," + base64.b64encode(b).decode()


def sizes():
    for label, *_ in SIZES:
        mb = round((WORK / f"clip_{label}.mp4").stat().st_size / 1e6, 2)
        url = data_url(label)
        body_mb = round(len(url) / 1e6, 1)
        for model in (PAID, FREE):
            call(model, url, tag=f"size {label} file={mb}MB b64={body_mb}MB")


EDGE = [("17MB", 205, 600), ("18.5MB", 224, 600), ("19.5MB", 237, 600)]


def edge():
    """Bracket the free provider's 26,214,400-byte request-body cap (found by sizes())."""
    for label, secs, kbps in EDGE:
        out = WORK / f"clip_{label}.mp4"
        if not out.exists():
            subprocess.run(["ffmpeg", "-y", "-v", "error", "-i", str(SRC), "-t", str(secs),
                            "-vf", "scale=480:360", "-c:v", "libx264", "-b:v", f"{kbps}k",
                            "-maxrate", f"{kbps}k", "-bufsize", f"{2 * kbps}k",
                            "-c:a", "aac", "-b:a", "64k", str(out)], check=True)
        url = data_url(label)
        call(FREE, url, tag=f"edge {label} file={out.stat().st_size} b64={len(url)}")


def youtube():
    for _ in range(2):
        call(PAID, YOUTUBE_URL, tag="youtube direct url")
    call(FREE, YOUTUBE_URL, tag="youtube direct url (free)")


def fallback():
    url = data_url("5MB")
    # a) first model in the chain is invalid/unavailable -> does the paid one serve?
    call(FREE, url, models=["nvidia/does-not-exist:free", PAID], tag="fallback invalid-first")
    # b) free first, paid second, normal request
    call(FREE, url, models=[FREE, PAID], tag="fallback free-first normal")
    # c) burst the free model to provoke 429 and see if requests land on the paid model
    with ThreadPoolExecutor(8) as ex:
        list(ex.map(lambda i: call(FREE, url, models=[FREE, PAID], tag=f"fallback burst {i}"),
                    range(8)))
    # d) client timeout shorter than the free model's latency -> does anything fall back?
    call(FREE, url, models=[FREE, PAID], timeout=10, tag="fallback client-timeout 10s")
    # e) an oversized payload the free model may refuse while the paid one accepts
    call(FREE, data_url("33MB"), models=[FREE, PAID], tag="fallback oversize 33MB")


if __name__ == "__main__":
    phases = sys.argv[1:] or ["encode", "sizes", "youtube", "fallback"]
    for p in phases:
        globals()[p]()
