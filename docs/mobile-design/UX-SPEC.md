# Clipnote: mobile experience specification

3 October 2026 · Proposed design · Companion to the interactive prototype

## 1. Outcome and evidence

**A saved video becomes something you can use, then find when you need it.** Success is a person cooking from a saved recipe, revisiting a recommendation or comparing their sources. Saving is the beginning of that loop.

This specification was created without inspecting Clipnote's existing frontend or mobile design. Product capabilities come from the supplied project brief and have not been independently audited against the backend. The prototype demonstrates selected interactions with fixture data; this document defines the fuller production behavior. Additional states, integrations and capabilities require implementation.

Apple emphasizes purpose, agency, familiarity, flexibility and simplicity. The resulting Clipnote decisions are ours: optional filing, predictable navigation, readable notes and recoverable actions. HIG guidance is not an App Review ruling. [Apple design principles](https://developer.apple.com/design/human-interface-guidelines/design-principles)

Competitor documentation establishes available patterns, not measured efficacy. Reader shows optional capture context; mymind separates summary from deeper reading; Raindrop provides explicit retrieval scope; Fabric supports retrieval without filing; Recall makes chat context and sources visible. These inform hypotheses to test with Clipnote users. [Reader saving](https://docs.readwise.io/reader/docs/saving-content), [mymind Reading Mode](https://mymind.helpscoutdocs.com/article/67-how-reading-mode-works), [Raindrop Search](https://help.raindrop.io/using-search), [Fabric Organization](https://fabric.so/features/organization), [Recall Chat](https://docs.recall.it/deep-dives/chat/overview)

## 2. Navigation and screen inventory

Use three persistent destinations: **Notes · Collections · Ask**. Notes opens **Your library**, with a labeled **Search** button beside the title. Search opens its own screen within the Notes navigation flow. Save is a labeled action above the tab bar. Keep each tab's scroll, filters and navigation history when switching. This follows Apple's distinction between destinations and actions. [Tab bars](https://developer.apple.com/design/human-interface-guidelines/tab-bars)

| Surface | Primary job | Important content and exits |
|---|---|---|
| Welcome/auth | Begin with a real save | One sentence, illustrative note, sign-in, preserved inbound link |
| Notes / Your library | Recognize and reopen | Header Search, All/type filters, one Continue reading card, Recently saved, Save |
| Collections | Browse by purpose | Dedicated tab, user collections, counts, create; no mandatory setup |
| Collection detail | Use a coherent set | Notes, search within, Ask this collection, membership controls |
| Save sheet | Accept a link | URL preview, Save, optional context, Cancel |
| Saved acknowledgement | Confirm durable receipt | Preparing status, Done, View progress |
| Note detail | Read and act | Structured content, provenance, favorite, collection, edit, source |
| Search screen | Find existing notes | Opens from Your library header; query, filters, match snippets, Ask about these results |
| Ask | Explain or compose | Scope, examples, answer, citations, follow-up, Save as note |
| Supporting sheets | Make a short decision | Filters, collections, note actions, answer preview |
| Settings | Manage personal choices | Account, region, capture setup, digest, plan, privacy/data actions |

Sheets handle short contextual tasks; note reading and sustained chat use full screens. Present one sheet at a time. [Apple sheets](https://developer.apple.com/design/human-interface-guidelines/sheets)

## 3. First use, authentication and entry points

A fresh visit offers **Save your first link**, a sample note clearly labeled Example, and sign-in when needed. Do not require topic selection, collections or notifications. An inbound shared link goes directly to its preview, retaining the URL and optional text through authentication. Display the destination account before completing a save if account selection changed. Canceling authentication preserves the draft for that session and offers a clear retry.

After the first note is useful, offer one dismissible instruction for saving from other apps, tailored to the platform. Existing users return to their last destination; a specific note or digest link takes precedence. After login, resume that exact destination. An inaccessible note gets a neutral unavailable screen with Back to library; it must not expose another account's title.

### Platform-specific capture

| Platform | Supported design contract |
|---|---|
| Any browser | Paste URL remains available; explicit Paste action only when permission/capability permits |
| Compatible installed PWA | Register an inbound share target and route shared content to the same Save flow |
| iPhone web/PWA | Teach paste or the configured iOS Shortcut; do not promise native share-extension behavior |
| Native iOS app | A separately implemented share extension can preview and submit the link; only teach it when verified |

MDN marks `share_target` as limited and experimental; it requires an installed PWA. Use POST for saving mutations and validate shared data. Outbound Web Share and inbound Web Share Target are different capabilities. The web.dev guide documents inbound support for Android WebAPK and ChromeOS; validate the actual browser/device matrix before release. [MDN share_target](https://developer.mozilla.org/en-US/docs/Web/Progressive_web_apps/Manifest/Reference/share_target), [web.dev OS integration](https://web.dev/learn/pwa/os-integration)

## 4. Save a video, leave, return

1. Receive or paste the URL. Show domain and available title/thumbnail without waiting for rich metadata. If shared text contains several URLs, ask which one to save.
2. Tap **Save link**. Lock repeat submissions while the request is active. Optional personal context stays collapsed initially; type and collection are unnecessary.
3. After durable server acknowledgement, show **Link saved. Preparing your note.** Include Done and View progress. Only now may the interface say **You can close this**.
4. Show a pending row immediately in Notes with the same identity and URL. Completion updates that row in place. Do not move the reader away from another note or reset their scroll.
5. Opening the ready note reveals useful content. Offer optional collection assignment after the content is available. Show a readiness announcement in-app without automatically requesting push permission.

Use indeterminate feedback when actual progress is unknown. Do not invent percentages or claim stages the server cannot observe. [Apple loading](https://developer.apple.com/design/human-interface-guidelines/loading), [Progress indicators](https://developer.apple.com/design/human-interface-guidelines/progress-indicators)

### Recovery and limits

- **Duplicate:** show Already saved and Open note; offer adding to another collection. Canonicalization must be conservative. Repeated request/retry must not create additional notes or paid extraction jobs.
- **Offline before receipt:** show Not saved — reconnect to try again and retain the draft. A future durable local queue can say Saved on this device · Waiting to sync, clearly distinct from cloud receipt. Do not promise background delivery before it exists.
- **Connection lost after submission:** show Checking save and reconcile by request identity before retrying. A timeout alone does not prove failure.
- **Private, removed or unsupported video:** keep the accepted source card; explain the limitation and offer Open source, Add text, or Retry only when useful.
- **Partial extraction:** display a precise banner, for example Made from the caption; video unavailable. Missing details remain missing.
- **Daily limit:** retain the URL and explain the actual reset time. A global service cap receives service-unavailable copy, not an upgrade pitch.
- **Plan limit:** explain remaining allowance before committing paid work, preserve the draft, show plan terms and a clear dismissal. Cancellation returns to the same URL. Existing notes remain readable. Pricing and entitlement rules require a separate product/backend decision.

Preserving accepted links on extraction failure may require a durable source-record contract; verify this before using saved-state copy.

## 5. Reading and editing a useful note

The first viewport contains back navigation, a descriptive title, provenance and the first useful section. A modest cover provides recognition without occupying the whole screen. Missing images use a quiet type icon/surface. Text, source identity and actions remain available when media fails.

**Recipe:** short overview → time/servings where present → grouped ingredients → numbered steps. Ingredient selection may be local reading state; clearly distinguish it from editing quantities. **Place:** venue names, location, useful details, optional map/actions. **Product:** described price/date, specs and source link. **Itinerary:** days and stops. **Summary/workout:** takeaways or usable sequence. Entertainment providers retain required JustWatch attribution wherever shown.

Unknown types use the same readable building blocks: facts, sections, steps, table, checklist and quotes. Type labels can be novel; layout remains understandable. Composed Ask notes use these blocks regardless of their friendly type. No model-generated HTML enters the renderer.

Label generated content subtly and provide Open original. Verified timestamps may link into source media; never create them from guesses. Do not claim the full original article/video is archived unless it is stored. Reader's transcript and mymind's layered reading are useful references for skimming and verification, not a commitment to replicate their storage. [Reader videos](https://docs.readwise.io/reader/docs/faqs/videos), [mymind Reading Mode](https://mymind.helpscoutdocs.com/article/67-how-reading-mode-works)

Keep favorite and collection actions accessible; place secondary actions in a labeled menu. Editing has Save and Cancel, preserves original provenance and distinguishes personal additions. Regeneration must preview replacement when user edits exist. Deletion offers undo only if recovery is actually supported; otherwise explain the consequence before confirmation.

## 6. Organization without chores

**Types mean what the note is.** AI suggests an editable type. Normalize related names against the user's existing types; keep All visible. A type correction must not silently discard structured content or collection membership.

**Collections mean what the person will use it for.** Weeknight dinners, Japan trip and New apartment can mix types. A note may belong to several collections through references, without duplicate content. Creation asks for a name only. The picker is searchable, shows membership and applies changes explicitly. Removing a collection retains its notes in All notes.

All notes works with zero collections; avoid an Unsorted badge implying unfinished work. Suggestions may propose an existing collection with a reason and one-tap acceptance. Do not create or reorganize personal collections silently. Recall's multi-tag contexts and Fabric's optional filing support this direction; the exact Clipnote model is a product proposal. [Recall tagging](https://docs.recall.it/deep-dives/tagging), [Fabric Organization](https://fabric.so/features/organization)

## 7. Search and Ask

### Find an existing note

Tap Search beside **Your library** to open a dedicated search screen and focus the query field. Back returns to the previous Notes position. Collection detail can open the same screen with that collection preselected; Back then returns to the collection. Search accepts remembered title fragments, creators, concepts and source text available in the stored note. Results show title, concise matching excerpt, type, source and saved date; collections form a separate result group. Filters: Type, Collection, Source and Saved date. Active selections remain visible and removable. Preserve query/filter/scroll state after opening a result. [Apple search fields](https://developer.apple.com/design/human-interface-guidelines/search-fields), [Raindrop Search](https://help.raindrop.io/using-search)

An empty result explains the current scope and offers Clear filters or a revised query. A note still indexing remains discoverable through its saved metadata where supported. Search never silently substitutes a generated answer for the results list.

### Work across saved notes

Ask starts with **All notes**, a changeable scope chip and three relevant example tasks. Example: Which dinners can I make in 20 minutes? From search, **Ask about these results** carries the query and an explicit result set or stable filter definition. From a collection or note, preselect that scope. Scope controls must not be rendered as functioning until the backend honors them.

Answers include source links near supported claims, a compact source list and optional useful follow-ups. Opening a citation preserves conversation state. Display actual coverage: Used 8 relevant notes for ranked retrieval; Reviewed all 12 notes only for exhaustive processing; Reviewed 50 of 83 matching notes when capped. Render the interpreted date range in the user's timezone. Do not equate All notes scope with reviewing every note.

Absent evidence receives a direct explanation. General conversation is labeled General answer and carries no invented note citations. This design does not add web search. Recall documents visible source scope, pinned context and source references; Clipnote adopts the inspectability principle. [Recall Chat](https://docs.recall.it/deep-dives/chat/overview), [Apple generative AI](https://developer.apple.com/design/human-interface-guidelines/generative-ai)

**Save as note** opens a preview with editable title and optional collection. Saving creates one structured artifact with source-note references. Repeat taps are idempotent; a saved state offers Open note. Failure preserves the answer and allows retry. Do not silently mutate existing notes or organize the library through chat.

## 8. Returning without pressure

The Notes tab's Your library screen shows recent saves and, when available, one Continue reading card for an explicitly opened note. Hide the card when there is no history; dismissal persists. This is continuation, not a recommendation engine. The Collections tab and favorites provide intentional return paths.

The weekly digest should give a concrete reason to reopen: Three dinners you saved this week. Link directly to relevant notes. Ask for email preference after demonstrated value; show frequency and unsubscribe controls. Do not send empty digests. Fabric's scheduled Recap establishes a comparable pattern, not evidence of retention uplift. [Fabric Recap](https://fabric.so/product/recap)

Keep new reminder scheduling, algorithmic resurfacing, streaks and push campaigns deferred. The supplied phase gates still apply: verify Phase 3 paywall/digest readiness before public launch.

## 9. Visual and accessible interaction system

| Token | Starting value |
|---|---|
| Canvas / surface | Cloud `#F5F7FA` / Paper `#FFFFFF` |
| Primary / secondary text | Ink `#192333` / Slate `#596579` |
| Action / quiet emphasis | Cobalt `#2556D8` / Mist `#EAF0FF` |
| Type | System family; 34 title, 22 section, 17 reading, 15 supporting, 12–13 short metadata |
| Spacing | 4, 8, 12, 16, 24, 32; page inset 20; card inset 16 |
| Radius | 12 media, 20 cards, 28 sheets |

These are light-theme starting tokens. Native uses semantic text styles; web uses scalable relative sizes and zoom. Dark appearance needs semantic equivalents and contrast testing, not image inversion. Keep text-heavy surfaces solid, imagery within notes and motion brief. Respect reduced-motion preferences.

Choose minimum 44 CSS px hit regions on web and 44 pt targets natively. Apple recommends 17 pt default custom text and support for enlarged text; points and CSS pixels differ. Validate normal text at 4.5:1, large text and essential non-text controls at applicable WCAG thresholds. [Apple buttons](https://developer.apple.com/design/human-interface-guidelines/buttons), [Accessibility](https://developer.apple.com/design/human-interface-guidelines/accessibility), [WCAG target size](https://www.w3.org/WAI/WCAG22/Understanding/target-size-enhanced)

Use semantic headings, labeled icons, visible focus and meaningful status announcements. Modal focus enters the sheet, stays within it and returns to the trigger. Keyboard Escape/visible Cancel closes safely; dirty drafts survive interruption. Selected filters expose state. No action depends only on gesture, color or hover. At 200% text, content reflows and controls stay reachable above the keyboard and safe areas. [Apple VoiceOver](https://developer.apple.com/design/human-interface-guidelines/voiceover), [Layout](https://developer.apple.com/design/human-interface-guidelines/layout)

On tablet/desktop, replace the bottom bar with a stable Notes / Collections / Ask side rail and optionally show list plus detail. Keep Search beside the Your library heading, retain a comfortable reading width and support keyboard operation. Avoid stretching mobile cards across the entire desktop.

## 10. Cross-flow state contract

| State | User sees | Required behavior |
|---|---|---|
| Empty library | First-save invitation | No fabricated personal content |
| Submitting | Saving link | Prevent duplicate submit; preserve draft |
| Acknowledged | Saved · Preparing note | Safe to leave; durable identity |
| Processing delayed | Still preparing | Open source; refresh actual status |
| Ready | Note content | Update pending entry in place |
| Partial / failed | Specific limitation | Preserve accepted link and edits |
| Offline | Connection status | Distinguish local draft from server save |
| Auth expired | Sign in to continue | Resume intended action once |
| Limit reached | Relevant allowance/reset | Preserve input; retain library access |
| No search matches | Scope-aware explanation | Clear filters or revise query |
| Ask working / failed | Honest status / retry | Preserve question and prior answers |
| Missing source | Source unavailable | Keep answer context; no broken navigation |

## 11. Implementation priorities and contracts

**First:** implement navigation/state preservation, durable save acknowledgement, job-to-note continuity, structured detail, optional organization and recoverable errors. Then implement search-to-Ask handoff, coverage/citations and artifact saving. Validate accessibility throughout. Add digest/entitlement presentation before any public launch.

The brief documents async jobs, structured templates, note queries, query-aware Ask, coverage, artifacts and user authentication. Verify their current response shapes. Explicit dependencies needing confirmation or additional work: durable failed-source records; request idempotency and URL deduplication; extraction provenance; optional many-to-many collection membership; scope-aware Ask contracts; content-index readiness; reading-position storage; chat persistence; editable note conflict handling; entitlement/reset metadata; digest settings; local offline queue and cache clearing.

Private notes are the default. External source opening is explicit. Public sharing requires an intentional preview and must never be implied by adding to a collection. Explain which saved material is used for AI processing in product privacy information. Keep sensitive note text and full URLs out of routine analytics. Clear private cached data on sign-out; require confirmation for account deletion. Do not claim encryption or offline availability beyond verified implementation.

## 12. Acceptance and measurement

Test with realistic libraries and actual iPhone/Android devices:

1. Share a reel, leave after receipt, return and open the same completed note.
2. Interrupt authentication, then recover the original URL without duplicate processing.
3. Retry after a lost response; get one note. Recover a private/deleted video honestly.
4. Read a recipe at 200% text; navigate with VoiceOver and keyboard.
5. Put one note in two collections; remove a collection without deleting the note.
6. Find a vaguely remembered reel, then return to unchanged search results.
7. Ask across a full collection, inspect a citation and recognize a missing fact or cap.
8. Save an answer once and reopen it with its source references.
9. Follow a digest deep link through login; retain destination and privacy.

Measure unassisted completion, time to first useful note, retrieval time, duplicate rate, failed-save recovery, correct scope understanding and citation verification. For retention, track useful reopening and voluntary reuse, supported by interviews; raw save counts and email opens are insufficient. Establish baselines in usability testing before setting improvement targets.
