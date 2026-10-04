---
target: docs/mobile-design/prototype/index.html
total_score: 30
max_score: 40
na_heuristics: 
p0_count: 0
p1_count: 3
target_identity: "file:/Users/yashsoni/dev/Personal/clipnote/docs/mobile-design/prototype/index.html"
target_fingerprint: "sha256:64e06f9ca0553dde0802dd11d891ea16c635c5d47d05a76765f95881d6f2931c"
target_path: /Users/yashsoni/dev/Personal/clipnote/docs/mobile-design/prototype/index.html
timestamp: 2026-10-03T11-43-59Z
slug: docs-mobile-design-prototype-index-html
---
## Design Health Score

| # | Heuristic | Score | Key issue |
|---|---|---:|---|
| 1 | Visibility of system status | 3 | Save acknowledgement, pending row, ready state, and toast are clear; live extraction status is simulated. |
| 2 | Match between system and real world | 4 | “Save a link”, “Your library”, “Collections”, and “Ask your library” use familiar language. |
| 3 | User control and freedom | 3 | Back, cancel, close, reset, and “Keep browsing” are present; interrupted production flows remain unimplemented. |
| 4 | Consistency and standards | 3 | Strong repeated patterns for rows, sheets, source chips, and bottom navigation. |
| 5 | Error prevention | 3 | URL validation and duplicate detection are explicit; real auth/offline/retry paths are only specified. |
| 6 | Recognition rather than recall | 4 | Covers, title, type, source, date, summary, and collection context appear together. |
| 7 | Flexibility and efficiency | 3 | Search-to-Ask, collections, filters, favorites, and note-level Ask support different habits. |
| 8 | Aesthetic and minimalist design | 3 | Quiet, authored visual system; the home screen still carries continuation, filters, and a long feed at once. |
| 9 | Error recovery | 2 | The UX spec is thoughtful, but the runnable prototype cannot demonstrate auth expiry, offline reconciliation, failed extraction, or retry. |
| 10 | Help and documentation | 2 | Capture guidance and an About sheet exist; contextual help for search/Ask scope is light. |
| **Total** |  | **30/40** | **Good foundation; validate the return and recovery loops before implementation.** |

## Design specificity verdict

The design feels authored for Clipnote’s promise of turning saved links into things worth using again. The “Save now. Organize later.” model is visible in the optional collection step, the list-first library, the single continuation module, and Ask answers that lead back to source notes. The illustrated fixture art, calm cloud/cobalt palette, and copy such as “A world of possibilities” give it a point of view. It is more specific than a generic AI chat or bookmark grid, although the visual language still sits near the broader “friendly AI library” category.

The deterministic detector found two warnings in `prototype/index.html`: the 10px “Interactive prototype · Sample data” label is below the review floor for functional text, and a colored shadow is treated as a glow accent. The first should become 11–12px or be treated explicitly as non-functional chrome; the second is low risk because it is a restrained presentation shadow, but a neutral shadow would avoid the detector finding.

## Overall impression

This is a strong mobile concept with a clear product thesis: the object being saved stays visible, while organization and AI are optional ways to make it useful. The biggest opportunity is to make the “come back later” promise as trustworthy as the “save now” moment. The current visual prototype is excellent at showing the happy path, but it needs real history, status, and recovery behavior before the layout should be treated as production-ready.

## What is working

- The three destinations are understandable: Notes is the object library, Collections are intentional contexts, and Ask is an action over saved material. Search being beside “Your library” keeps it available without making capture or search compete as the main tab.
- The saved acknowledgement is emotionally right. “It’s safely in your library” plus “You can get on with your day” gives permission to leave, and the pending row preserves the item’s identity.
- Note detail is practical rather than ornamental. Provenance, a trust line, quick facts, checkable ingredients, numbered steps, source notes, and a personal thought all reinforce rereading and doing.

## Priority issues

### [P1] The continuation card is not actually personalized

`library()` always renders “Pick up where you left off” for the `noodles` note whenever the All filter is active. It is not tied to an opened note or reading position, so a new or returning user can be shown a false continuation. That conflicts with the UX spec’s explicit rule to hide the card without history and show the explicitly opened note when history exists. Implement a persisted `lastOpenedNoteId` and reading position; hide the module until it exists, then show the real note with a dismiss action.

### [P1] Useful content starts too far below the fold on note detail

The detail order is back bar → 198px cover → type → 30px title → source/trust copy → summary → recipe facts and ingredients. A 390px phone sees recognition and provenance before it sees the first actionable step. Keep the cover, but shorten it on mobile or move quick facts/“The good part” immediately under the title so a saved recipe becomes usable in the first viewport.

### [P1] Recovery is described better than it is experienced

The spec names the right states—connection lost after submission, private video, partial extraction, auth expiry, daily limit, and Ask failure—but the prototype only has URL validation, duplicate handling, and a scripted unsupported-question message. The implementation must preserve the URL and question, show a real status, and offer one concrete next action for each failure. This is central to trust in a capture product.

### [P2] Search and Ask need a sharper boundary in the interface

Both accept natural language and both can lead to notes, but the distinction is mostly copy: Search finds a saved object, while Ask interprets a scope. On the Search result screen, make the handoff label explicit (“Ask about these 4 results”) and keep the carried scope visible in Ask. On Ask, show “Uses 4 of 8 notes” near the answer before the citation chips, not only after the prose.

### [P2] The home screen has a high number of simultaneous choices

At once it exposes six horizontally scrollable type/favorite filters, a continuation card, the recent list, Search, settings, Save, and three tabs. The hierarchy is good, but a first-time user still has many possible next actions. Keep the filter rail, but collapse secondary filters behind a labeled “Filter” sheet once there are more than four user-defined types, and only show the continuation module when it earns its space.

## Persona red flags

- **Casey, distracted one-handed user:** Save is correctly in the thumb zone, and rows have large tap targets. The first useful recipe step is not in the first viewport, and a long Ask answer can push the composer below the keyboard; ensure the composer remains reachable when the keyboard opens.
- **Jordan, first-timer:** Labels are unusually clear and the save acknowledgement is reassuring. “Ask” still requires learning whether it searches, chats, or creates; the scope selector and one-line explanation should be visible before the first question.
- **Sam, accessibility-dependent user:** Semantic headings, labels, `aria-live` status, visible focus, and 44px targets are strong. Verify actual focus trapping and screen-reader announcements in the native dialog, and increase the 10–11px metadata where it carries source or status meaning.

## Minor observations

- “8 notes” in the shown prototype can diverge from the six-note fixture after localStorage interactions; label the sample state consistently or reset it before presenting screenshots.
- Collection cards are attractive, but the illustration dominates the card relative to the collection name and count. Test a text-forward variant with realistic long names.
- Keep the blue action color and green type color distinguishable by text and shape, as the design already mostly does; do not rely on color alone for state.

Questions skipped: the design review was delivered in response to a location/status follow-up, and no implementation direction was requested.
