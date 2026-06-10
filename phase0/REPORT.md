# Phase 0 Validation Report

Run date: 2026-06-10 · Models: `gemini-3.5-flash` (extraction, global endpoint) + `gemini-3.1-flash-lite` (categorization)

URLs run: 20 · OK: 20 · Failed: 0 · Generic verdicts: 0

Categories that emerged (in order): `recipe`, `workout`, `educational-tutorial`, `product`, `itinerary`, `fitness-discussion`

| # | URL | Strategy | Category | Verdict | Time | Status |
|---|---|---|---|---|---|---|
| 1 | youtube.com/watch?v=NU4h4GC-Fgg (paneer masala video) | `youtube_direct` | `recipe` | typed | 72s | ok |
| 2 | youtube.com/watch?v=Xw5b9prgVkU (10-min dumbbell workout) | `youtube_direct` | `workout` | typed | 28s | ok |
| 3 | youtube.com/watch?v=a03U45jFxOI (butter chicken video) | `youtube_direct` | `recipe` | typed | 22s | ok |
| 4 | youtube.com/watch?v=JxgmHe2NyeY (6-hour ML lecture) | `youtube_transcript` | `educational-tutorial` | composed(facts+table+steps) | 17s | ok — over-cap correctly fell back to transcript |
| 5 | instagram.com/reel/DYGzlp4sKJQ (post-workout meals) | `ytdlp_gcs` | `recipe` | typed | 45s | ok |
| 6 | instagram.com/reel/DIEMAERyzi- (pre-workout meal) | `ytdlp_gcs` | `recipe` | typed | 46s | ok |
| 7 | instagram.com/reel/DJlEdTnzWeh (partner workout) | `ytdlp_gcs` | `workout` | typed | 35s | ok |
| 8 | amazon.in AirPods 4 | `product_direct` | `product` | typed | 14s | ok — Tier 1 (selectors), no Firecrawl needed |
| 9 | amazon.in realme Earbuds Air 7 | `product_direct` | `product` | typed | 12s | ok |
| 10 | amazon.in Noise Pure Pods | `product_direct` | `product` | typed | 14s | ok |
| 11 | reddit.com r/Fitness Gym Story Saturday | `reddit_rss` | `fitness-discussion` | composed(sections×3) | 12s | ok — after anti-fabrication fix (see Finding 2) |
| 12 | indianhealthyrecipes.com paneer butter masala | `web_json_ld` | `recipe` | typed | 16s | ok — JSON-LD ground truth |
| 13 | recipetineats.com butter chicken | `web_json_ld` | `recipe` | typed | 13s | ok |
| 14 | waitbutwhy.com AI revolution | `web_json_ld` | `educational-tutorial` | composed(facts+table) | 16s | ok |
| 15 | jamesclear.com habit stacking | `web_scrape` | `educational-tutorial` | composed(facts+steps) | 14s | ok |
| 16 | nomadicmatt.com Japan travel tips | `web_scrape` | `itinerary` | typed | 22s | ok — organized tips into a day-structured route |
| 17 | **(user)** instagram.com/reel/DXOfVzQE08M | `ytdlp_gcs` | `itinerary` | typed | 70s | ok — 6-day Meghalaya itinerary extracted from video |
| 18 | **(user)** instagram.com/reel/DZUuq_FTJoI | `ytdlp_gcs` | `recipe` | typed | 37s | ok — makhana bhelpuri recipe |
| 19 | **(user)** youtube.com/shorts/6p1wXbGJHws | `youtube_direct` | `educational-tutorial` | composed(facts) | 14s | ok — 3 Mac apps, one section each |
| 20 | **(user)** nykaaman.com Puma Ferrari backpack | `product_direct` | `product` | typed | 12s | ok |

Verdict legend: `typed` = bespoke template schema · `composed(...)` = GenericNote building blocks · `⚠️ GENERIC` = bullets-only output (none occurred).

## Findings

1. **Direct YouTube analysis works and is the right default.** `gemini-3.5-flash` (global endpoint only — 404 on us-central1) ingests YouTube URLs natively; `mimeType` is mandatory on Vertex. A 5.5-min video ≈ 30k input tokens at `MEDIA_RESOLUTION_LOW`. Form cues in the workout note (#2) were extracted from the *demonstration*, not narration — transcripts could never produce this.
2. **Fabrication was the one real failure (fixed).** The Reddit anecdote thread initially classified as `workout` and the model invented a complete routine (sets, reps, rest, duration) to fill the schema. Fixes applied to `gemini.py`: categorizer rule 5 (discussion threads are never plan-types) + a NEVER-FABRICATE extraction rule. Re-run produced an honest `fitness-discussion` note with real attributed quotes.
3. **Instagram works cookie-less from a residential IP** (probe + 480p download + GCS upload). Cloud Run datacenter IPs are likely to be blocked — Stage B must ship the cookies-file secret path (`YTDLP_COOKIES_FILE`) and verify on the deployed worker.
4. **Amazon.in needs no Firecrawl.** Mobile UA + selector/regex hybrid (mobile layout lacks `#productTitle`/`#acrPopover`/`#landingImage`; price recovered from embedded `displayPrice` JSON) extracts title/price/bullets/rating reliably. Nykaa Man worked the same way.
5. **Reddit: `.json` is 403-blocked; `.rss` passes** and contains post + comments. Quirk: a failed `.json` request poisons the immediately-following request, so RSS is tried first. Production option: free OAuth API.
6. **Gemini 3.x thinking gotcha:** small `max_output_tokens` budgets get consumed by thinking and return `text=None`. Never set tight output caps.
7. **Over-cap videos fall back correctly** — the 6-hour lecture took the transcript path (~28k chars) and still produced a structured note.
8. **Latency:** webpages 12–22s, YouTube direct 14–72s, IG reels 35–70s (download+upload dominates). All well within the Cloud Tasks worker model; the UI's live job status covers the wait.
