# A/B links (links-only baseline)

**There are no old-pipeline outputs in Firestore.** Only 2 notes survive in `notes`
(the first two links in `links.txt`); the rest of the old notes are gone. `jobs` holds
inputs only (url, status, attempts) - no outputs, tiers, cost or latency.

So this is NOT a true old-vs-new A/B. It is Phase 0 style: run the new pipeline on each
link and judge the note by hand against the source (does it describe what is in the
video/post? is it thin?). The 2 surviving notes in `baseline.json` (`surviving_notes`)
are the only real old-vs-new pairs.

## Files
- `links.txt` - 27 distinct URLs sampled from completed jobs (seed 7), one per line.
- `baseline.json` - `surviving_notes` (full docs, embeddings stripped) + `links[]` with the
  jobs metadata for each URL.
- Regenerate (read-only): `cd backend && .venv/bin/python -m scripts.ab_baseline`

## Running the new side
POST each link in `links.txt` to `/api/ingest` on the branch deployment (or run locally with
`WORKER_SECRET` unset), then compare each resulting note to its source by hand. For the 2
surviving notes, diff against `surviving_notes` entries. Record per link: cost, latency,
Apify runs, free vs paid model, fallbacks.
