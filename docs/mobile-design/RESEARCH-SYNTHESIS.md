# Why this mobile design

Decision record · 3 October 2026

## The experience we are designing

**A saved video becomes something you can use.** A successful first session ends with a useful note. A successful return ends with someone finding a recipe, revisiting a recommendation, or answering a question using what they saved.

The proposed interface has three stable bottom-bar destinations: **Notes, Collections, Ask**. A Search button beside **Your library** opens retrieval from Notes. Save is an action. Notes works before a user creates any collections. There is no obligation to empty an inbox, complete a reading backlog, or maintain a taxonomy. Returning should serve a person's intent, not a streak or an unread counter.

This supports the [design direction](DIRECTION.md), interactive prototype and specification. Research used official sources; no existing Clipnote frontend was inspected. The sources document product capabilities and platform guidance. We measured no competitor efficacy, retention or usability. Publication or update dates do not prove that we tested a current native build; desktop-only and plan-dependent features must not be generalized to mobile.

## Competitor comparison and decisions

| Reference | Documented pattern | Adopt for Clipnote | Avoid carrying over |
|---|---|---|---|
| Readwise Reader | Mobile share capture, optional personal context, readable video transcripts and preservation of source relationships. | Save where interest arises; keep “Why I saved this” optional; make source evidence accessible. | Requiring reading workflow decisions during capture or assuming every video has a usable transcript. [Saving](https://docs.readwise.io/reader/docs/saving-content), [videos](https://docs.readwise.io/reader/docs/faqs/videos) |
| Matter | Clean reading, audio/text modes, and YouTube/podcast transcription. | Judge capture by the usefulness of the result; let the subject determine the note structure. | Making playback or a large cover dominate the reading screen; introducing audio as a prerequisite. [Product](https://www.getmatter.com/) |
| mymind | A short article summary can lead into a full Reading Mode; archived articles are a plan-dependent capability. | A recognizable first layer, then depth when needed. | Promising full-source preservation when Clipnote stores only extracted information. [Reading Mode](https://mymind.helpscoutdocs.com/article/67-how-reading-mode-works) |
| Raindrop.io | Visible search scope and filters; collections have single membership. | Explicit, removable filters and recognizable collection names. | Duplicating a note to place it in two contexts. [Search](https://help.raindrop.io/using-search), [collections](https://help.raindrop.io/collections) |
| Fabric | Natural-language search, optional organization and a route from results into conversation. | Find a remembered item directly, then carry its context into Ask. | Exposing folders, spaces, boards and tags as competing concepts on a phone. [Search](https://fabric.so/features/search), [organization](https://fabric.so/features/organization) |
| Recall | Explicit chat context, sources and saving an answer as a card; review scheduling is intentional. | Visible evidence scope, useful citations and Save as note. | Making graph navigation, quizzes or study commitments part of everyday capture. [Chat](https://docs.recall.it/deep-dives/chat/overview), [review](https://docs.recall.it/getting-started/6-review-content) |

These are selected design references, not a ranking of competitors. The “avoid” column records Clipnote's scope choices, not evidence that those features are ineffective elsewhere.

## Four tensions resolved

### 1. Search finds; Ask explains

Both accept ordinary language, but produce different outcomes. “That miso pasta reel” should return recognizable notes immediately. “Which dinners take under 20 minutes?” may need an answer comparing them. Search opens from the button beside **Your library**; Ask has its own labeled tab. These distinct entry points make the outcome predictable; **Ask about these results** bridges them without retyping or losing filters.

Ask starts with a visible scope. “All notes” means where retrieval may look, not a claim that every note was read. Show relevant-note counts, exhaustive coverage or truncation accurately. A citation opens its note and returns to the same conversation. Unsupported facts get an explicit absence statement. Saving synthesis is deliberate and creates an editable note with its sources.

### 2. Types describe; collections express intent

Types answer “What is this?” Collections answer “What am I using it for?” A recipe can belong to both Weeknight dinners and Camping trip. One underlying note should serve both.

Automatic type suggestions reduce capture effort but remain correctable. Collection suggestions require a user's choice; classification must not silently file or hide a note. All notes stays useful with no collections. Avoid an Unsorted debt badge and a separate top-level destination for every type. This preserves an open-ended type system without making its growth a navigation problem.

### 3. Saved is a promise; Ready is a later state

The proposed sequence is Saving → Saved / Preparing note → Ready, with a recoverable Needs attention state. The saved acknowledgement requires durable persistence. A failed extraction preserves the source and offers an appropriate next action. Unsupported offline capture says it is not saved.

Apple advises allowing other activity during loading and showing determinate progress only when measurable. Therefore no fabricated percentages or unobservable processing stages. This state model is a Clipnote proposal, not a competitor behavior we verified. [Loading](https://developer.apple.com/design/human-interface-guidelines/loading), [progress](https://developer.apple.com/design/human-interface-guidelines/progress-indicators)

### 4. Useful return without another obligation

Recently saved notes and a bounded Continue reading section offer straightforward return paths. User-controlled collections and a useful weekly digest support a purpose: cooking, planning, buying or learning. New contextual resurfacing remains a later proposal under the project's phase constraints. Avoid infinite recommendations, daily nags and completion pressure. Measure successful reuse rather than the size of someone's library.

## Apple guidance translated into interface choices

- **Agency and simplicity:** accept a link without mandatory filing; preserve personal edits and make correction easy. [Design principles](https://developer.apple.com/design/human-interface-guidelines/design-principles)
- **Familiar navigation:** Notes, Collections and Ask are labeled, stable tabs. Search sits beside Your library; Save remains an action. Preserve tab state and return from search to the previous note-list position. [Tab bars](https://developer.apple.com/design/human-interface-guidelines/tab-bars)
- **Appropriate presentation:** brief capture/filter tasks use dismissible sheets; reading and sustained conversation get full screens. [Sheets](https://developer.apple.com/design/human-interface-guidelines/sheets)
- **Inspectable AI:** identify generated content, show sources and limitations, and allow editing. [Generative AI](https://developer.apple.com/design/human-interface-guidelines/generative-ai)
- **Accessible reading:** choose large targets, scalable text, solid readable surfaces, meaningful labels and reduced motion. Native points and CSS pixels are different units; the web design target is at least 44 CSS px. [Accessibility](https://developer.apple.com/design/human-interface-guidelines/accessibility), [WCAG enhanced target size](https://www.w3.org/WAI/WCAG22/Understanding/target-size-enhanced)

Apple guidance informs the experience; this prototype does not reproduce native system components or establish App Review compliance. Validate the complete loop with realistic libraries, large text and assistive technology: save and leave, recover a failure, find a vaguely remembered reel, use two collections, and verify an answer against its evidence.
