# New-side A/B v2: with Apify (2026-10-04)

Script: `phase0/ab/run_new_side.py` (v2). Raw data: `new_side_results_v2.json`. v1 is unchanged
in `new_side_results.md` / `.json`.

Run conditions:
- 26 links, run one at a time so latency is honest against the 270 s budget.
- REAL Apify slot reservation (`system/usage-{date}.apify_count`).
- No `jobs` or `notes` writes. `acq_cache` READS were bypassed so every link ran the full
  ladder; cache writes still happened.

Code under test:
- Instagram goes straight to Apify (the embed rung is gone).
- `VIDEO_MODELS` = gemini-2.5-flash-lite. TEXT = deepseek-v3.2 and CLASSIFY = qwen3-30b (both paid only).
- `MAX_VIDEO_SECONDS=600`, with an ffmpeg re-encode when a file is over 25 MB.
- IMAGE chain is unchanged: `gemma-4-26b:free` then `inclusionai/ling-3.0-flash-vl`.

## Headline
| Metric | v2 | v1 (no Apify, free text model) |
|---|---|---|
| OpenRouter spend | **$0.0650** | $0.1047 |
| Apify runs | **13** (11 IG + 2 YouTube fallback), 13 ok / 0 failed | 0 |
| Videos actually watched (seen+heard) | **10 / 16** (7 IG reels + 3 YouTube direct; 2 more YouTube via subtitles) | 4 / 16 |
| IG reels with the video watched | **7 / 7** | 0 / 7 |
| IG posts / carousels producing a note | **0 / 4** (all errored, see bug 1) | 3 / 4 (caption-only) + 1 bookmark |
| Re-encodes | 1 (Meghalaya: 43.06 MB → 22.1 MB, 103 s) | n/a |
| Too-long gate hits (`data.note`) | 0 (no IG video was over 600 s) | n/a |
| YouTube fallback | 2 / 5 (one Gemini 502/403, one client **timeout** at 120 s) | 1 / 5 |
| Errors | 4 (1×429 and 3×400 on the IMAGE chain) | 0 |
| Unreachable | 1 (pin.it, transient; a retry right after scraped fine) | 0 |
| Total latency | 842 s over 26 links; max **185.3 s** (30-min YouTube); every link under 270 s | |
| Model calls | gemini-2.5-flash-lite 10, qwen3-30b 10, deepseek-v3.2 12 (no free calls) | 22 free / 12 paid |

"Videos watched": 7 IG reels (Apify mp4 to the video model) + 3 YouTube direct = 10 videos the
model saw. The 2 YouTube fallbacks read Apify subtitles, which is heard content, not seen. So
10 seen+heard and 12 with real spoken content.

Apify billing isn't metered by the script. At about $2.60 per 1k reel results, 13 runs come to
roughly $0.03–0.05, so the total run is about $0.10–0.12.

## Confirmed bugs from this run
1. **Carousels with 5 or more slides always fail with 400 (permanent, so they salvage to a bookmark).**
   - `IMAGE_MODELS` free head `gemma-4-26b:free` is 429 upstream, so OpenRouter falls to
     `inclusionai/ling-3.0-flash-vl` on DeepInfra.
   - DeepInfra rejects the request: `"Too many images in request: 6 > 4"`. Meanwhile
     `social_video.MAX_SLIDES = 6`.
   - Hit 3 of 3 carousels (Dasqshyisvz, DZh8-hWmOHf, DaabJFvE4Pp).
   - A 400 is not transient in `process._is_transient`, so production salvages a bookmark and
     the carousel content is lost.
   - Fix: cap slides at 4 for this provider, use a different paid floor with a higher image
     limit (gemini-2.5-flash-lite takes many images), or split the images across calls.
2. **A single-image IG post hit 429 on the whole IMAGE chain** (DZhzon_D9Ml).
   - Transient, so production would retry (5 s, 10 s).
   - The free head is effectively always rate-limited (v1 saw 0 of 7 successes), so every image
     post depends on one paid provider's capacity.
3. **Long YouTube videos time out on the direct path.**
   - `YOUTUBE_MAX_DIRECT_SECONDS=3600`, but the YouTube call is capped at 120 s.
   - The 30-min video (DTCyvo6cC54) took 101 s in v1 and hit `APITimeoutError` in v2. It then
     paid for the fallback (Apify subtitles + deepseek): 185 s total, 85 s from the deadline.
   - Separately, an 11:22 video went direct in 88.5 s. The 600 s `MAX_VIDEO_SECONDS` gate only
     applies to downloaded files.
   - Suggest lowering `YOUTUBE_MAX_DIRECT_SECONDS` to about 1200 s, or raising the YouTube timeout.
4. **Low: a transient scrape failure salvages instead of retrying.** pin.it came back
   `unreachable` once (worked on an immediate retry). The `metadata_only` path salvages a
   bookmark with no transient retry.

## Per link
"Seen+heard?" is my judgement: does the note describe what's SEEN and HEARD in the video, or
only the caption?

| # | Link | Apify ran? | Video obtained (MB, s) | Re-encode | Strategy | Model(s) | Latency | $ | Seen+heard? / note |
|---|---|---|---|---|---|---|---|---|---|
| 1 | IG reel DdyvwuOq3vf (latte) | yes (6.7 s) | yes, 8.42 MB, 42 s | no | reel_video | gemini-flash-lite | 28.4 s | 0.0019 | Same as the caption. The caption already holds the full recipe and the video adds nothing new. **Fabrication gone** (time, cuisine, tips are null). |
| 2 | IG reel DXOfVzQE08M (Meghalaya) | yes (15.8 s) | yes, 43.06 → **22.1 MB**, 103 s | **yes** | reel_video | gemini-flash-lite | 54.0 s | 0.0033 | **SEEN**: names WahRashi, Pung Iyer, Seven Sisters and Nohkalikai falls, none of which are in the caption. Typed itinerary; `duration` is a filler sentence. |
| 3 | IG post DZhzon_D9Ml | yes (6.8 s) | n/a (image post) | n/a | apify_caption | **429 on the IMAGE chain** | 15.9 s | 0.0001 | No note (bug 2; production would retry). |
| 4 | IG reel DYrSsjNp56D (movies) | yes (14.3 s) | yes, 16.56 MB, 67 s | no | reel_video | gemini-flash-lite | 69.4 s | 0.0027 | **SEEN+HEARD**: Dark Knight, Shrek, Mean Girls, Step Brothers…; v1 had only the 2 hashtag titles. The summary over-focuses on Step Brothers. |
| 5 | IG carousel Dasqshyisvz | yes (7.0 s) | n/a, 6 slides | n/a | apify_carousel | **400 (6 > 4 images)** | 14.9 s | 0.0001 | No note (bug 1). |
| 6 | IG reel DanP7kktvSE (card) | yes (5.8 s) | yes, 4.45 MB, 39 s | no | reel_video | gemini-flash-lite | 19.0 s | 0.0018 | **SEEN**: 4×4 grid of 5×5 cm squares, cuts, glue and drawn messages; v1's steps were invented. |
| 7 | IG carousel DZh8-hWmOHf | yes (5.5 s) | n/a, 6 slides | n/a | apify_carousel | **400** | 12.9 s | 0.0001 | No note (bug 1). |
| 8 | IG reel DZ-olanz7um (Jaipur) | yes (8.9 s) | yes, 9.45 MB, 46 s | no | reel_video | gemini-flash-lite | 31.4 s | 0.0023 | **SEEN+HEARD**: adds "pricing starts around 2500" and block printing, neither in the caption. |
| 9 | IG reel Db1VtFryvbR (security) | yes (9.1 s) | yes, 4.69 MB, 42 s | no | reel_video | gemini-flash-lite | 29.0 s | 0.0020 | **SEEN+HEARD**: all 20 vulnerabilities. The caption only said "comment Hacked". Biggest win. |
| 10 | IG carousel DaabJFvE4Pp | yes (5.0 s) | n/a, 6 slides | n/a | apify_carousel | **400** | 13.3 s | 0.0000 | No note (bug 1). v1 made a good caption-only note here, so this is a regression. |
| 11 | IG reel DZxTTXLSi0p (funk) | yes (7.3 s) | yes, 2.52 MB, 23 s | no | reel_video | gemini-flash-lite | 18.5 s | 0.0013 | **HEARD**: names the songs (e.g. "Matushka Ultrafunk"); v1 invented a title. |
| 12 | YT short JsEE5g_6IEw | yes (fallback, 18.4 s) | no | no | youtube_fallback | deepseek | 34.4 s | 0.0023 | Gemini 502/403, so Apify text was used. Lists the 8 foods (subtitle content), so the spoken content is captured; v1 had description only. |
| 13 | YT 11:22 yuToKYHsAYA | no | direct URL | n/a | youtube_direct | gemini-flash-lite | 88.5 s | 0.0252 | **SEEN+HEARD.** |
| 14 | YT short TSJI6-nV-t0 | no | direct URL | n/a | youtube_direct | gemini-flash-lite | 20.5 s | 0.0018 | **SEEN+HEARD**, but the ingredients stay in Italian ("farina", "acqua"); v1 translated them. |
| 15 | YT 30:59 DTCyvo6cC54 | yes (fallback, 13.8 s) | no | no | youtube_fallback | deepseek | **185.3 s** | 0.0029 | Direct call **timed out at 120 s**, then fell back to Apify subtitles. All 5 levels (heard, via the transcript). Bug 3. |
| 16 | YT short wHky8QG27pQ | no | direct URL | n/a | youtube_direct | gemini-flash-lite | 14.1 s | 0.0023 | **SEEN+HEARD.** |
| 17 | X dj_curfew | no | n/a | n/a | twitter_syndication | qwen + deepseek | 30.6 s | 0.0007 | Page content, richer than v1. |
| 18 | X gregisenberg | no | n/a | n/a | twitter_syndication | qwen + deepseek | 28.6 s | 0.0004 | Page content, good. |
| 19 | amzn.in 0fvav1hX | no | n/a | n/a | product_direct | deepseek | 18.0 s | 0.0012 | Good. No filler cons any more (empty). |
| 20 | amzn.in 0cK9nT6w | no | n/a | n/a | product_direct | deepseek | 19.8 s | 0.0011 | Good. The title is now concise (v1 used the raw 180-character title). |
| 21 | share.google | no | n/a | n/a | google_share | qwen + deepseek | 8.7 s | 0.0004 | Generic claims, possibly beyond the snippet. Not flagged thin. |
| 22 | LinkedIn | no | n/a | n/a | web_scrape | qwen + deepseek | 10.6 s | 0.0007 | Good. |
| 23 | bbcgoodfood | no | n/a | n/a | web_json_ld | deepseek | 21.4 s | 0.0008 | Good. |
| 24 | nykaaman | no | n/a | n/a | product_direct (+ web search) | qwen + deepseek×2 | 28.3 s | 0.0077 | Now has a price (₹1,999). Pros and cons still empty. |
| 25 | GitHub ECC | no | n/a | n/a | web_scrape | qwen + deepseek | 25.3 s | 0.0019 | Good. Still typed `product`. |
| 26 | pin.it | no | n/a | n/a | unreachable | n/a | 1.4 s | 0 | Transient (bug 4); v1 got a full recipe. |

## Cost and latency by type
| Type | n | Total $ | Avg latency | Max latency |
|---|---|---|---|---|
| IG reel (video) | 7 | 0.0153 (about $0.0022 each) + Apify | 35.7 s | 69.4 s |
| IG post / carousel | 4 | 0.0003 | 14.3 s | 15.9 s (all errored) |
| YouTube | 5 | 0.0345 | 68.6 s | 185.3 s |
| X | 2 | 0.0011 | 29.6 s | 30.6 s |
| Product | 3 | 0.0100 | 22.0 s | 28.3 s |
| Web / other | 5 | 0.0038 | 13.5 s | 25.3 s |

## The 2 surviving old notes vs v2
1. **Latte (DdyvwuOq3vf).** Old (caption, deepseek): 9 ingredients, 5 steps, `totalTime` null,
   calories range. v2 (video): the same 9 ingredients and 5 steps, `totalTime`/`difficulty`/
   `cuisine` null, calories kept. **About the same as old.** The video confirms the caption and
   adds nothing new. v2 fixes v1's fabrication (v1 invented a 10-minute time, a cuisine and 3 tips).
2. **Meghalaya (DXOfVzQE08M).** Old (caption): `place` with 5 venues from hashtags (Cherrapunji,
   Shillong, Dawki river, root bridges). v2 (video, re-encoded 43 → 22 MB): `itinerary` with
   named waterfalls seen in the video (WahRashi, Pung Iyer, Seven Sisters, Nohkalikai) and 1579
   data chars vs about 1000. **Better in substance**, because it describes what is in the video.
   Two weaknesses remain: the type is `itinerary` where the old note's `place` fits the prompt
   rule better, and `duration` holds a filler sentence ("Unspecified, but implies multiple days…")
   instead of being omitted.

## Instagram: v1 vs v2 (11 links)
| Link | v1 (embed caption, nemotron:free) | v2 (Apify + video) |
|---|---|---|
| DdyvwuOq3vf latte | caption copy + invented time/tips | caption-equivalent, no fabrication: **better** |
| DXOfVzQE08M Meghalaya | hashtag stops | named waterfalls from the video: **better** |
| DZhzon_D9Ml image post | caption-only "cheat sheet" note | **error 429** (would retry): worse in this run |
| DYrSsjNp56D movies | 2 titles from hashtags | about 6 titles from the video: **better** |
| Dasqshyisvz carousel | bookmark (`venues: []`) | **400**: still no note |
| DanP7kktvSE card | invented generic steps | real steps with dimensions: **better** |
| DZh8-hWmOHf carousel | caption-only ebook note | **400**: worse |
| DZ-olanz7um Jaipur | good caption note | plus details from the video: **better** |
| Db1VtFryvbR security | 4 facts incl. hashtags | 20 vulnerabilities: **much better** |
| DaabJFvE4Pp carousel | good 5-venue caption note | **400**: worse |
| DZxTTXLSi0p funk | invented title | real song names: **much better** |

**Net: reels 7 of 7 better. Image posts and carousels 0 of 4 produce a note** because of the
IMAGE chain bugs, a regression on 2 links that v1 handled from the caption.
