# Production Readiness Plan — First 1,000 Users

**Date:** 2026-06-11 · **Current state:** Phase 2 deployed (PWA share target + iOS shortcut PATs), live at clipnote.web.app
**Binding constraint from CLAUDE.md:** do **not** launch publicly before Phase 3 (paywall + weekly digest).

---

## Where the app stands

**What's solid (verified in this audit):**
- Cost guardrails are real and transactional: 50 ingests/user/day, 500 notes/user, 1,000 notes/day global kill-switch (`backend/routers/ingest.py`, `backend/config.py:33-35`), enforced before job creation, HTTP 429 on breach.
- Auth is correct: Firebase JWT + PAT (`cn_<id>.<secret>`, bcrypt) both async-threaded; PATs can't mint PATs; `/api/process` verifies Cloud Tasks OIDC (signature + SA email + audience). Live Cloud Run env has the correct audience URL (verified 2026-06-11).
- Process worker is idempotent — completed jobs no-op on retry, permanent failures return 200 so Cloud Tasks never re-bills Gemini.
- Firestore rules are tight: clients can only read/delete their own notes, read their own jobs; `notes`/`jobs` writes, `shortcut_tokens`, `usage`, `system` are backend-only (`infra/firestore.rules`).
- No blocking calls on the event loop; no `dangerouslySetInnerHTML` anywhere; no secrets in the repo (the Firebase web API key is public by design).
- Live Cloud Run: 1Gi / concurrency 80 / 600s timeout — adequate for this scale.

**What's not ready:** ~20 files of uncommitted work (URL sanitizer, Amazon multi-tier resolver, shortcut header parsing, CORS additions); no SSRF guard on the scraper; print-only logging with zero alerting; no Firestore backups; no tests; no error states on several frontend paths; no paywall (budget is ₹30k total ≈ a few thousand-to-tens-of-thousands of notes); and the OAuth consent screen / legal pages haven't been confirmed for >100 users.

**Cost math that drives everything:** at roughly $0.005–0.02 of Gemini per note, the ₹30k (~$360) budget funds on the order of 20k–50k notes *total*. 1,000 active users saving even 10 notes/month is 10k notes/month — the budget dies in ~1 quarter without revenue. Phase 3 is not optional polish; it is the survival mechanism. The global 1,000/day kill-switch is the backstop until then.

---

## Workstream 0 — Stabilize the working tree (½–1 day) ✅ prerequisite for everything

1. Verify the two recently-reported bugs are actually fixed on prod (memory: "shortcut returns HTML", "Amazon products broken"; later entries suggest both were addressed): ingest one Amazon URL and one URL via the iOS shortcut against the live API.
2. Commit the uncommitted work in logical commits (URL sanitizer · Amazon resolver tiers · shortcut header parsing · frontend card redesign · CORS/hosting).
3. Repo hygiene: untrack `frontend/tsconfig.tsbuildinfo`; gitignore or move `frontend/rowpreview.html` + `src/rowpreview-main.tsx`; decide where `2026-06-07-clip-note-mvp.md` lives; commit `.claude/`, `infra/build_shortcut.py` or ignore them.
4. Finish the shortcut install path: `SHORTCUT_ICLOUD_LINK` in `settings.tsx:20` is an empty string — either publish the iCloud link or commit fully to the signed-download flow.

## Workstream 1 — Security hardening (2–3 days)

| # | Item | Where | Notes |
|---|------|-------|-------|
| 1.1 | **SSRF guard** (P0) | `services/sources/generic.py`, `product.py`, any direct `httpx.get` | Resolve hostname, reject private/link-local/loopback ranges (169.254.169.254, 10/8, 172.16/12, 192.168/16, 127/8, ::1) before fetching and on redirects. Single helper, applied at every fetch site. |
| 1.2 | **PAT limits** | `routers/tokens.py`, `services/auth_dep.py` | Cap ~5 tokens/user; lock token after N failed secret attempts; log failures. |
| 1.3 | **Console checks** (no code) | GCP/Firebase console | Firebase API key restrictions; OAuth redirect URIs; **OAuth consent screen publishing status = "In production"** — in "Testing" it hard-caps at 100 test users, a silent launch blocker. |
| 1.4 | IAM least privilege | `infra/setup.sh` | Replace `roles/storage.objectAdmin` with objectCreator+objectViewer (+delete if needed for temp cleanup). |
| 1.5 | Security headers | `firebase.json` | CSP, `X-Content-Type-Options`, `Referrer-Policy`. Low effort, do while in the file. |

## Workstream 2 — Reliability, observability, data safety (2–3 days)

| # | Item | Notes |
|---|------|-------|
| 2.1 | **Firestore backups** (P0) | Enable PITR + daily scheduled backups, 30-day retention. One gcloud command; user data is currently unrecoverable. |
| 2.2 | **Structured logging** | Replace `print()` with `logging` + JSON formatter (Cloud Run parses `severity` automatically); include `job_id`/`user_id` fields as correlation IDs. |
| 2.3 | **Alerts** | Log-based alerts: worker failure rate >5% over 15 min; Cloud Tasks queue depth; Cloud Run 5xx rate. Uptime check on a `/healthz` endpoint (add one). Billing budget already exists. |
| 2.4 | Cloud Tasks queue | Add `--max-backoff=600s` (currently unbounded exponential); confirm max-attempts=3. |
| 2.5 | Cloud Run | Set `--max-instances` explicitly (e.g. 10) as a cost ceiling. Current 1Gi/80/600s is fine for 1k users (≤ ~2k notes/day realistic). |
| 2.6 | Gemini retry | One internal retry with backoff on transient 5xx in `extract_async` (the search-grounded path already has this; the main path doesn't). |

## Workstream 3 — Frontend correctness (2–3 days)

| # | Item | Where |
|---|------|-------|
| 3.1 | Error states: `.catch()` on `getNote()` (currently spins forever on failure); error UI for failed jobs in the feed; ingest failure feedback | `routes/notes.$noteId.tsx`, `routes/index.tsx` |
| 3.2 | Auth resilience: retry API calls once with `getIdToken(true)` on 401; preserve deep-link destination through login redirect | `integrations/firebase/auth-middleware.ts`, route guards |
| 3.3 | Feed scale: keep `limit(50)` but add a "load more" cursor; push the content-type filter into the Firestore query (composite index already exists in `infra/firestore.indexes.json`, unused) | `lib/firestore.ts`, `routes/index.tsx` |
| 3.4 | Bundle: remove unused `recharts` + `embla-carousel-react` (~85KB gz) and their orphan ui components | `package.json` |
| 3.5 | Polish: favicon `onError` fallback; feed loading skeleton (currently flashes "No notes yet"); verify Firestore listener cleanup on route unmount in devtools | `NoteCard.tsx`, `index.tsx` |
| 3.6 | Client error reporting: Sentry free tier (or GCP Error Reporting) so frontend failures are visible at all | `main.tsx` |

## Workstream 4 — Phase 3 gate: monetization + retention (~1 week) 🔒 blocks public launch

1. **Plans:** `users/{uid}.plan` (`free`|`pro`). Free tier sized so the budget survives — e.g. 25 notes/month free; Pro removes it. Enforce inside the existing `_enforce_cost_caps()` transaction (it's already the single choke point — this is a small diff).
2. **Payments:** pick Stripe (global, better docs) or Razorpay (INR-native, no foreign-entity friction) — decide based on who the first 1,000 users are. Checkout + webhook → set `plan=pro` + `stripe_customer_id`.
3. **Weekly digest email:** Cloud Scheduler → new authenticated backend endpoint → per-user query of the week's notes → templated email (Resend/Postmark/SendGrid free tiers all fine at 1k users). This is the retention hook; ship it with the paywall, not after.
4. Raise/retune caps once paywall exists: global kill-switch can rise from 1,000/day as paying users justify spend.

## Workstream 5 — Launch operations (2 days)

1. **Tests (minimum viable):** pytest for cost-cap enforcement, PAT auth accept/reject, worker idempotency (completed job no-op, permanent failure → 200), URL sanitizer. These guard the money paths.
2. **CI:** GitHub Actions — lint + tests + frontend build on push; deploys stay manual (fine at this stage), but script them (`infra/deploy.sh`) so they're one command each.
3. **Legal/listing:** privacy policy + ToS pages (required for OAuth verification and app-store-quality trust); account-deletion path (delete user doc + notes + tokens — a small backend endpoint).
4. **Soft launch:** 20–50 users for a week with alerts on, watch failure rate and cost/note, then open up.

---

## Sequencing

```
Week 1:  WS0 → WS1 (security) + WS2 (reliability) in parallel
Week 2:  WS3 (frontend) + start WS4 (paywall scaffolding)
Week 3:  WS4 (payments + digest) + WS5 (tests/CI/legal)
Week 4:  Soft launch (50 users) → fix what breaks → public
```

**Explicitly deferred (don't build now):** Typesense search, public notes (Phase 4), Expo share extension (Phase 5), Imagen covers (`ENABLE_IMAGEN=false` stays), signed GCS URLs, Binary Authorization, image-digest pinning.

## Non-issues investigated and dismissed

- Firestore "batch delete bypass" — rules evaluate per-document in batches; current rules are safe.
- OIDC audience misconfiguration — live Cloud Run env verified correct (2026-06-11).
- Public GCS bucket — cover URLs are 128-bit UUIDs; enumeration infeasible; acceptable for MVP.
- Throughput — at realistic usage (≤2k notes/day) the current queue/instance config has >10× headroom.
