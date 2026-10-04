# A2 spike: video calls on OpenRouter (2026-10-04)

Script: `phase0/ab/video_spike.py` (raw rows: `video_spike.jsonl`, 35 calls, total paid spend **$0.103**).
Clip: public-domain *Duck and Cover* (1951, archive.org), re-encoded at 480x360 h264 ~600 kbps + 64 kbps AAC,
trimmed to hit each size. It is narrated, so visual vs audio understanding is checkable.
YouTube and TikTok downloads were blocked from this machine (403 / connect timeout), which is why the clip comes from archive.org.
Request: system prompt asking for strict JSON `{title, summary, key_points, seen, heard}`, `max_tokens=1500`,
Gemini `reasoning.enabled=false`, Nemotron `reasoning.effort=low`, no provider pinning for base64.

## Results: base64 `video_url` data URL

| File | Base64 body | Gemini 2.5 Flash Lite | Nemotron omni :free |
|---|---|---|---|
| 4.9 MB (60 s) | 6.6 MB | 200, **9.9 s**, $0.0022, 17k tok in, JSON ok (fenced) | 200, **60.6 s**, $0, strict JSON |
| 12.3 MB (150 s) | 16.4 MB | 200, **19.9 s**, $0.0055, 43k tok | 200, **72.2 s**, $0, strict JSON |
| 16.7 MB (205 s) | 22.3 MB | not run | 200, **68.0 s**, strict JSON |
| 18.3 MB (224 s) | 24.4 MB | not run | 200, **108.2 s**, strict JSON |
| 19.4 MB (237 s) | 25.88 MB | not run | 200, **157.0 s**, strict JSON (5,047 output tokens despite max_tokens=1500) |
| 20.5 MB (250 s) | 27.3 MB | 200, **28.6 s**, $0.0086, 71k tok | **400** "payload below 26214400 bytes" (13.5 s) |
| 25.4 MB (310 s) | 33.8 MB | 200, **30.7 s**, $0.0107, 88k tok | **400** same |
| 33.6 MB (410 s) | 44.8 MB | 200, **38.9 s**, $0.0139, 116k tok | **400** same |
| 45.3 MB (555 s) | 60.4 MB | 200, **49.2 s**, $0.0187, 157k tok | **400** same |
| 60.3 MB (555 s) | 80.4 MB | 200, **50.6 s**, $0.0189, 157k tok | **400** same |

**Size limits.** OpenRouter itself passed an 80 MB body; Gemini (provider "Google") read every size tried. The Nvidia free
provider rejects any request body over **26,214,400 bytes (25 MiB)**. Base64 adds a third, so the raw video must stay
under about **19.4 MB** for the free model to take it.

**Quality.** Both models really watch *and* listen. Gemini's notes cite narration-only facts (fires, traffic,
"narrated by an off-screen voice"). Nemotron's `heard` array quotes the narrator and the theme song word for word,
and its `seen` gives a scene-by-scene description. Nemotron's notes are more concrete. Gemini's are more summary-like.

**Latency.** Gemini runs 10 s at 5 MB and 50 s at 60 MB, roughly linear in video length. Across 15 calls it ranged
4.6 to 50.6 s. Nemotron took 46 to 72 s for clips up to about 17 MB and climbed to 108 to 157 s near its cap.
Reasoning tokens are not capped by `max_tokens` (we saw 2,010 to 5,047 output tokens).

**JSON.** Nemotron returned strict JSON (no fences) in 10 of 11 served calls. The one failure leaked its reasoning into
`content`, then degenerated into a `<unk><unk>…` loop. Gemini wrapped every reply in ```` ```json ```` fences: 0 of 15
were strict, but 13 of 15 parsed after stripping the fences. The 2 failures hit `finish=length` in a repetition loop
("dam dam dam…") at 1,496 tokens. **Both models can degenerate.** The parser must strip fences, and an unparseable
reply or `finish=length` must count as a failure that triggers retry or fallback.

## YouTube direct URL as `video_url`

| Model | Result |
|---|---|
| Gemini 2.5 Flash Lite (provider Google AI Studio) | 200 twice, **4.7 s / 4.6 s**, $0.0008, correct see+hear note ("Me at the zoo", 19 s) |
| Nemotron :free | HTTP 200 with `choices=None`, `error: {code: 502, "Failed to load video from https://www.youtube.com/...: Could not open video stream"}`, so it **cannot** read YouTube URLs |

## `models: [free, paid]` fallback

| Test | Result |
|---|---|
| Invalid first ID in `models` | **400 "not a valid model ID"**. OpenRouter validates every ID up front and never falls back. |
| Free first, normal | Free served it (60 s). |
| Burst of 8 concurrent free calls | **4 of 8 fell back to Gemini** (16–33 s, paid). 4 served by free (49–69 s). The free provider's error at that load: 502 `ResourceExhausted: Worker local total request limit reached (16/16)`. |
| Oversize 33 MB, chain [free, paid] | **Fell back to Gemini** (36.6 s, $0.014). The 400 payload-too-large from Nvidia does trigger fallback. |
| Client `timeout=10`, chain [free, paid] | Served by Gemini in 15.6 s, because free capacity was exhausted. The client timeout did not fire. |
| Client `timeout=20`, free only | **Completed at 46.2 s.** The SDK timeout did not abort it. |

Findings:
1. Fallback fires on provider 5xx/capacity errors and on a provider 400 (payload too big). It does **not** fire on a
   client-side timeout. OpenRouter cannot know the client gave up, so a slow free call is never handed to the paid model.
2. The openai SDK `timeout` is **not a wall-clock deadline** on OpenRouter. The connection is kept alive, so the read
   timeout keeps resetting. A 20 s timeout let a 46 s call finish. A hard deadline needs `future.result(timeout=…)`
   around the call (then re-issue to the paid model), or streaming with an elapsed-time check.
3. When the free model fails **without** a chain, the reply is HTTP 200 with `choices=None` and an `error` object. The
   SDK does not raise. Today's `_chat` would silently return `""`. Treat `resp.error` / empty `choices` as a failure.

## Recommendations

1. **`VIDEO_MAX_BYTES = 18_000_000`** (raw mp4) **if the free model stays in the chain.** That is 24 MB as base64,
   below Nvidia's 26,214,400-byte cap with room for the prompt and caption. If paid-only, 25 MB (the plan's target) is
   safe: Gemini took 25, 33, 45 and 60 MB without trouble. A mid-size option is to send >18 MB clips straight to Gemini
   (skip the free model) rather than wasting a round trip on the guaranteed 400. Measured, that round trip is 13–29 s
   before fallback.
2. **Per-call timeout: 150 s wall clock** for the free attempt, enforced outside the SDK (thread future). On expiry,
   re-issue once to Gemini with its own **90 s** cap. Gemini's worst measured case was 51 s at 157k tokens. 150 + 90 =
   240 s fits inside `JOB_DEADLINE_S=270` only if acquisition is fast. If acquisition took more than about 30 s, skip
   the free model. Setting `timeout=` on the SDK alone does nothing useful (finding 2).
3. **Free omni model as first choice: viable on quality, not on latency or reliability. Default to Gemini first.**
   Its notes are as good as Gemini's or better, and its strict JSON is reliable (10/11). But it is 5–7x slower (46–72 s
   vs 10–30 s), climbs past 150 s near its size cap, hit shared-capacity errors in half of a burst of 8, and cannot read
   YouTube URLs. Each Gemini video note costs $0.002–0.011 for clips ≤25 MB, so the saving is small next to a doubled
   wait. If the free model stays first anyway, gate it on file ≤18 MB, use the `[free, paid]` chain for 4xx/5xx, and
   add the 150 s wall-clock guard with manual re-issue to Gemini for slow calls.
