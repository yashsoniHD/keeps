# New-side A/B: results (2026-10-04)

Script: `phase0/ab/run_new_side.py`. Raw data: `new_side_results.json`. 26 links, real network,
real OpenRouter calls. No `jobs` or `notes` writes; `acq_cache` writes only. Apify slot
reservation was stubbed, so `system/usage-*` was never touched. The script calls
`sources.acquire` → `classify` → `routers.process._extract`, with `start_metering` on.

## Caveats (read first)
- **There is no `APIFY_TOKEN` in `backend/.env` or `backend/.env.local`.** Every Apify rung
  returned None, so this run measures the free ladder only. Apify runs: **0**.
- **Free endpoints ARE enabled.** `nvidia/nemotron-3-super-120b-a12b:free` answered 22 of 23
  TEXT calls. The free classify/image head, `google/gemma-4-26b-a4b-it:free`, answered **0 of 7**.
  A direct probe got `429 temporarily rate-limited upstream` (a shared free pool), so every
  classify call fell back to paid qwen3-30b.
- The first 2 IG links were also run in a smoke test 2 minutes earlier, so the full run hit
  `acq_cache` for them. Both fell through in the smoke run, and they are counted as
  fall-throughs below.

## Headline numbers
| Metric | Value |
|---|---|
| Total OpenRouter spend | **$0.1047** (26 links), well under the $2 budget |
| Model calls | 22 free / 12 paid (nemotron:free 22, qwen3-30b 7, gemini-2.5-flash-lite 4, deepseek-v3.2 1) |
| Videos actually watched | **4 / 16** video links (4 YouTube direct; 0 of 11 Instagram) |
| IG embed fall-throughs | **11 / 11**. None of the embed pages has a `video_url`, `<video>` or `.mp4` (checked by hand with curl from this residential IP) |
| YouTube fallback hits | 1 / 5 (`JsEE5g_6IEw`: Gemini 502 wrapping an upstream 403 → description-only thin note) |
| Thin notes | 12 / 26 (all 11 IG + 1 YouTube) |
| Salvaged (bookmark) | 1 (`Dasqshyisvz` carousel: `venues: []`, under the 40-char data gate) |
| Errors / failed jobs | 0 |
| Client timeouts / JSON nudges | 0 / 0 |

## Cost and latency by type
| Type | n | Total $ | Avg $ | Max $ | Avg latency | Max latency | Thin |
|---|---|---|---|---|---|---|---|
| IG reel | 7 | 0.0000 | 0.0000 | 0.0000 | 5.8 s | 7.9 s | 7 |
| IG post / carousel | 4 | 0.0000 | 0.0000 | 0.0000 | 5.4 s | 6.3 s | 4 |
| YouTube | 5 | 0.0968 | 0.0194 | 0.0674 (30 min video) | 38.5 s | 101.2 s | 1 |
| X | 2 | 0.0006 | 0.0003 | 0.0005 | 25.9 s | 47.1 s (free model failed → deepseek) | 0 |
| Product (Amazon, Nykaa) | 3 | 0.0070 | 0.0023 | 0.0070 (Nykaa: web-search plugin) | 7.5 s | 8.6 s | 0 |
| Web / article / other | 5 | 0.0003 | 0.0001 | 0.0001 | 5.8 s | 11.4 s | 0 |

YouTube direct cost scales with length: 47 s short $0.0023, 11 min $0.0252, 30 min $0.0674.
A 60-minute video (the `MAX_DIRECT_SECONDS` ceiling) would be about $0.13 per save.

## Per link
"Seen+heard?" is my judgement: does the note describe what is in the video or page, or only the caption?

| # | Link | Strategy / via | Thin | Models (paid in bold) | Latency | $ | Title / judgement |
|---|---|---|---|---|---|---|---|
| 1 | IG reel DdyvwuOq3vf | reel_caption / ig_embed (cache) | Y | nemotron:free | 4.8 s | 0 | "Date caramel iced latte". **Caption only.** Adds `totalTime: 10 min`, `cuisine` and 3 tips that are not in the caption (fabricated). |
| 2 | IG reel DXOfVzQE08M | reel_caption / ig_embed (cache) | Y | nemotron:free | 7.9 s | 0 | "Meghalaya travel guide". **Caption + hashtags only.** Classed itinerary (one day of 5 stops); the prompt rule says a venue list is `place`. |
| 3 | IG post DZhzon_D9Ml | reel_caption / ig_embed | Y | nemotron:free | 5.1 s | 0 | "99 Claude commands cheat sheet". **Caption only**; the image content is never seen. Typed as `product` with price "Free" (odd). |
| 4 | IG reel DYrSsjNp56D | reel_caption / ig_embed | Y | nemotron:free | 7.8 s | 0 | "Movies you could watch 1000 times…". **Caption only**: 2 titles taken from hashtags; the movies shown in the reel are missed. |
| 5 | IG carousel Dasqshyisvz | reel_caption / ig_embed | Y | nemotron:free | 5.5 s | 0 | "Monsoon getaways in Bengaluru". `venues: []` → **salvaged as a bookmark.** The spots are on the slides, which the free rung never fetches. |
| 6 | IG reel DanP7kktvSE | reel_caption / ig_embed | Y | nemotron:free | 6.3 s | 0 | "Never ending infinity birthday card". **Caption only.** The 5 steps are generic and invented; the caption has none. |
| 7 | IG post DZh8-hWmOHf | reel_caption / ig_embed | Y | nemotron:free | 6.3 s | 0 | "Raj Shamani's build don't talk ebook". Caption only (a "comment BOOK" bait post); fine for what it is. |
| 8 | IG reel DZ-olanz7um | reel_caption / ig_embed | Y | nemotron:free | 6.5 s | 0 | "4 Jaipur stores worth your money". Caption only, but the caption is rich: good note, 4 venues. |
| 9 | IG reel Db1VtFryvbR | reel_caption / ig_embed | Y | nemotron:free | 3.9 s | 0 | "Vulnerability fixing guide via Claude". Caption only (bait post); the facts list includes hashtags (low value). |
| 10 | IG post DaabJFvE4Pp | reel_caption / ig_embed | Y | nemotron:free | 4.7 s | 0 | "Last minute recommendations in Bangalore". Caption only; caption is rich, good 5-venue note. Carousel slides not seen. |
| 11 | IG reel DZxTTXLSi0p | reel_caption / ig_embed | Y | nemotron:free | 3.4 s | 0 | "Try these three funk songs". **Caption only; the songs are in the AUDIO.** Invents a title entry "Try these Three funk songs". This is the clearest case for watching the video. |
| 12 | YT short JsEE5g_6IEw | youtube_direct → **fallback** (description) | Y | nemotron:free (Gemini 502/403, not billed) | 7.1 s | 0 | "The 8 secret foods every woman needs". **Description only**; the 8 foods are not listed. |
| 13 | YT 11:22 yuToKYHsAYA | youtube_direct | N | **gemini-2.5-flash-lite** | 54.6 s | 0.0252 | "How to de-slop AI output with a custom skill". **Seen+heard**: speaker, skill and checks all described. |
| 14 | YT short TSJI6-nV-t0 | youtube_direct | N | **gemini-2.5-flash-lite** | 12.8 s | 0.0018 | "Crispy air-fried zucchini rings". **Seen+heard**: quantities (300 g flour/water, 100 g cornflakes) and a sauce. |
| 15 | YT 29:59 DTCyvo6cC54 | youtube_direct | N | **gemini-2.5-flash-lite** | 101.2 s | 0.0674 | "Every level of a Claude Code second brain explained". **Seen+heard**: all 5 levels. |
| 16 | YT short wHky8QG27pQ | youtube_direct | N | **gemini-2.5-flash-lite** | 16.9 s | 0.0023 | "How to pitch like a billionaire". **Seen+heard.** |
| 17 | X dj_curfew | twitter_syndication | N | **qwen3-30b** (classify) + nemotron:free | 4.6 s | 0.0001 | "ClickUp reduces headcount by 22%…". Page content: good. |
| 18 | X gregisenberg | twitter_syndication | N | **qwen3-30b** + **deepseek-v3.2** (free failed) | 47.1 s | 0.0005 | "How a 19-year-old makes $200,000+…". Page content: good, detailed. |
| 19 | amzn.in 0fvav1hX | product_direct | N | nemotron:free | 7.9 s | 0 | "Btag SF-400 Digital Kitchen Weighing Scale". Page content: good. The single con is filler. |
| 20 | amzn.in 0cK9nT6w | product_direct | N | nemotron:free | 6.0 s | 0 | Same product. The title is the raw 180-character listing title, not concise. The cons are inferred ("no mention of…"). |
| 21 | share.google | google_share | N | **qwen3-30b** + nemotron:free | 5.6 s | 0.0001 | "Is Vibe Coding Already Dead?…". Metadata facts only (author, date). Thin in substance but not flagged. |
| 22 | LinkedIn post | web_scrape | N | **qwen3-30b** + nemotron:free | 3.0 s | 0 | "Claude Code deployments succeed through layered CLAUDE.md…". Page content: good. |
| 23 | bbcgoodfood brownies | web_json_ld | N | nemotron:free (rules classify) | 4.7 s | 0 | "Best ever chocolate brownies recipe". Full recipe. The summary says 25 min bake; the data says cookTime 35 min. |
| 24 | nykaaman backpack | product_direct (+ search-grounded) | N | **qwen3-30b** + nemotron:free ×2 (web plugin billed) | 8.6 s | 0.0070 | "Puma Ferrari SPTWR…backpack". Thin (no price, empty pros/cons) but not flagged thin. |
| 25 | GitHub affaan-m/ECC | web_scrape | N | **qwen3-30b** + nemotron:free | 4.4 s | 0.0001 | "ECC 2.2.3 agent harness…". Good facts, but classed `product`. |
| 26 | pin.it | web_scrape | N | **qwen3-30b** + nemotron:free | 11.4 s | 0.0001 | "Mango Sago". Full recipe from the Pinterest page. |

## The 2 surviving old notes vs the new output
Both old and new are `reel_caption`: neither run saw the video. The old notes came from the
pre-change caption path.

1. **IG reel DdyvwuOq3vf (Date caramel iced latte).** Same title, same 9 ingredients and same
   5 steps (copied from the caption). Old had `totalTime: null` and `tips: null`. **New invents
   `totalTime: "10 min"`, `cuisine: "Beverage"` and 3 tips** (full-fat/oat milk, adjust dates,
   soak dates). None of these is in the caption, which breaks the NEVER-FABRICATE rule. Both
   drop the protein/carbs/fat macros the caption gives. **Verdict: new is slightly worse
   (fabrication).**
2. **IG reel DXOfVzQE08M (Meghalaya).** Old: `place` with a facts block and 5 venues
   (Cherrapunji, Shillong, Dawki river, living root bridges, …) plus action links. New:
   `itinerary` with one invented "Day 1" holding 5 stops, two of which are generic
   ("Waterfalls"). It also adds world-knowledge claims that are not in the caption ("one of the
   wettest places on Earth", "the capital city"). **Verdict: new is worse.** The type flips
   against the prompt's own place-vs-itinerary rule, and the extra facts are fabricated.

## Takeaways
- **Instagram video is 100% Apify-dependent.** The free `/embed/captioned/` rung returned a
  video for 0 of 11 reels and posts. Without `APIFY_TOKEN` every IG save is a thin caption note,
  and carousels never get their slides. That matters most where the content is in the media
  (#5 carousel salvaged, #11 songs in the audio, #4 movies on screen).
- **Free text model quality:** nemotron:free is fast and costs $0, but it fabricated fields in
  several caption-only notes (#1, #6, #11). The old paid path left those fields null.
- **Free classify/image head is effectively never free:** gemma-4-26b:free is rate-limited
  upstream, so classify always pays qwen3-30b. It is cheap ($0.0001 per call), but the
  "free first" claim does not hold for this chain.
- **YouTube direct works and is the main cost:** about $0.002 for a short, $0.025–0.067 for
  10–30 min videos, with 55–101 s latency on long videos (fine against the 270 s budget).
  Rough count: about 1 in 5 YouTube links hit the description-only fallback.
