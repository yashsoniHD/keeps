# Mobile capture and readable notes: competitor evidence

Research date: 3 October 2026. Scope: capture, conversion, reading, provenance, onboarding and recovery. Official product documentation only; no existing Keeps frontend or mobile design inspected. These are documented capabilities, not usability test results or evidence of retention. Organization and rediscovery are covered separately.

## Readwise Reader

**Observed.** Its iOS and Android apps receive documents through the system share sheet. After saving, the mobile sheet offers Read Now and an optional document note, including context about why something was saved. Safari sharing can provide underlying page content, whereas sharing from another app may supply only its URL. That difference can cause partial paywalled captures. [Saving content](https://docs.readwise.io/reader/docs/saving-content)

**Inferred benefit.** Capture can finish in the app where the interest arose; adding personal context is available without becoming a required step. Explaining source limitations makes an incomplete capture understandable.

**Observed.** Saved YouTube videos have a time-synced transcript and support notes/highlights. Reader exposes enhanced transcripts and caption-language choices on mobile. When existing highlights cannot overlay an enhanced transcript, the UI explains this and preserves them in the Notebook. The documentation explicitly describes some precise seeking controls as web features; it does not justify assuming identical mobile behavior. [YouTube videos](https://docs.readwise.io/reader/docs/faqs/videos)

**Inferred benefit.** Text makes video skimmable, while time/source relationships keep it verifiable. Explaining transformations protects trust when the representation changes.

**Observed.** Reader provides a document-specific parsing report, recommends re-saving an authenticated page from Safari for paywall problems, and preserves the originally captured article version. Re-saving an identical URL brings the existing document back to the top, although its documented URL deduplication has limits. [Parsing](https://docs.readwise.io/reader/docs/faqs/parsing)

**Keeps proposal.** Keep Save separate from AI completion. Once the server acknowledges receipt, show “Saved · Making your note” with Done and View progress. Offer an optional “Why I saved this” field. In the finished note, expose the original URL and verified timestamps where available. Treat an existing save as “Already saved” with Open note, rather than creating another note.

## Matter

**Observed.** Matter documents saving through a mobile share extension; saved articles are cleanly formatted and available offline. Its official paywall article says authenticated saves can produce a reader view with highlighting and audio. The current product page also documents YouTube/podcast conversion to time-synced text, switching articles between text and audio, and highlighting with a long press and drag. [Mobile saving](https://www.getmatter.com/updates/universal-save-it-later), [authenticated saving](https://www.getmatter.com/updates/save-behind-paywalls), [current product](https://www.getmatter.com/)

**Inferred benefit.** Saving promises a usable reading experience, not simply a stored address. Different reading modes accommodate different contexts without requiring another capture.

**Keeps proposal.** Make the result immediately useful for its subject: ingredient groups and steps for a recipe; venues and practical details for a place; key points for an explainer. Keep one clear reading hierarchy. A large video player or cover should not displace all useful text from the first screen. Audio reading is a later enhancement, not a prerequisite for the first capture-to-note journey.

## mymind

**Observed.** Mobile users save from another app through the system share action. mymind describes quick notes that can be expanded later. Its current pricing page documents short AI article summaries and, for its Mastermind plan, Reading Mode and archived articles. These are plan-dependent features rather than universal free capabilities. [FAQ](https://mymind.com/faq), [feature listing](https://access.mymind.com/pricing)

**Observed.** Opening a saved article initially shows a short summary; a Reading Mode button reveals the full saved article. Reading Mode removes page clutter and retains the article if its source disappears. [Reading Mode help](https://mymind.helpscoutdocs.com/article/67-how-reading-mode-works)

**Inferred benefit.** A concise first layer helps users recognize a save quickly, while a deeper reading layer supports actual use. Deferred elaboration reduces the work of capturing something in the moment.

**Keeps proposal.** Start note detail with a descriptive title, source, and a short useful overview, followed by the structured note. Put optional details behind clear expansion controls. Keep “Your notes” visually distinct from generated content. Do not promise a preserved full article or video unless Keeps actually stores it.

## Five concrete design implications

1. **Acknowledge saving before processing finishes.** Use truthful states: Saving → Saved / Making note → Ready, or Saved / Needs attention. “You can close this” is shown only after receipt is durable. If offline capture is unsupported, show “Not saved — reconnect to try again”; never show success optimistically without recovery. The exact state model is a Keeps proposal, not a verified competitor pattern.

2. **Keep the capture decision tiny.** The first save needs the shared URL and one confirmation. Title, type and destination are optional corrections after save. Teach the share action with one short, platform-specific example after the first success. Keep paste-link available when native sharing is unavailable.

3. **Design for using the note.** Recipe: quantities and steps; place: location and useful details; summary: takeaway and key points. The title, source and first useful section should fit into the initial reading flow. Preserve font scaling, selection and a predictable back action; keep secondary actions in a labeled menu.

4. **Make evidence inspectable.** Show “From [creator/domain]” and Open original. Where extraction is incomplete, name the actual limitation: “Made from the caption; video unavailable.” Timestamps require real source metadata. Distinguish extracted content, generated synthesis and personal notes; do not fabricate source coverage or confidence scores.

5. **Recover without losing the save.** A failed extraction still has a source card with Open original, Retry where useful, and Add text. Explain private/deleted links and unsupported content concretely. Avoid infinite retries or indefinite spinners. Preserve personal edits when retrying generation; let the user review a replacement if necessary.

## Evidence gaps and validation

The reviewed pages do not establish actual capture latency, completion-notification behavior, or complete first-run/error flows for all three products. Their features are useful design references, not proof that a pattern works better. Test the proposed Keeps flow with people saving a reel, closing immediately, returning to a completed note, encountering a failed video, and saving a duplicate. Measure unassisted completion, confidence that the item was saved, and ability to locate the source.
