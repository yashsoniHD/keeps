# Apple guidance for Clipnote on mobile

Researched 3 October 2026. Sources are official Apple documentation and W3C. No existing Clipnote frontend or mobile design was inspected. HIG statements below are platform **guidance**, not claims about mandatory App Review rules. **Product decisions** are recommendations for Clipnote, not prescriptions from Apple.

## 1. Design around returning to useful content

**Apple guidance:** The current principles emphasize purpose, agency, responsibility, familiarity, flexibility, simplicity, craft, and delight. Focus on the task people value, preserve their freedom to navigate, make recovery easy, and communicate what is happening. Accessibility belongs in the initial design. Simplicity means removing unnecessary work, rather than merely reducing visual elements. [Design principles](https://developer.apple.com/design/human-interface-guidelines/design-principles)

**Product decision:** The core promise is “I can find and use this later.” Present recognizable titles, useful excerpts, source identity, and saved dates. Make saving quick; ask for organizational effort only when it helps. Auto-categorization should be editable and optional to act on. Never require a collection before accepting a link. Favoriting, editing, and undoing accidental changes should be easy.

## 2. Stable navigation; capture is an action

**Apple guidance:** Tab bars navigate between top-level destinations, preserve each destination’s navigation state, and should have text labels. Controls that perform actions belong in a toolbar. Keep navigation predictable, including empty sections. [Tab bars](https://developer.apple.com/design/human-interface-guidelines/tab-bars)

**Product decision:** Use a small set of stable destinations such as Library, Search, and Ask. Put a clearly labeled Save action within easy reach, separate from destination tabs. Preserve search terms, scroll positions, and selected filters when opening a note and returning. Avoid making every note type a top-level destination; types change as the library grows.

## 3. Search can support both recall and discovery

**Apple guidance:** Search may live in a tab, toolbar, or content. A standard Search tab can reveal suggestions and categories before typing; a button-style Search entry prioritizes immediate keyboard access. Placeholder text can clarify the searchable scope. Scope controls and tokens narrow results. [Search fields](https://developer.apple.com/design/human-interface-guidelines/search-fields)

**Product decision:** A Search landing screen should offer recent queries and useful type/date/collection filters. Search actual note contents, not only titles. Keep filters visible as removable selections. Distinguish finding existing notes from asking for an answer across notes, while allowing a query to continue into Ask without retyping. Empty results should explain the active scope and offer to clear filters.

## 4. Capture should survive the user leaving

**Apple guidance:** Share extensions support content preview, annotation, and configuration where appropriate. This extension guide is archived, so use it for interaction intent rather than current implementation details. [Share extension guide](https://developer.apple.com/library/archive/documentation/General/Conceptual/ExtensibilityPG/Share.html)

**Apple guidance:** Display useful content promptly and allow other activity while work continues in the background. Use determinate progress only when duration is known; otherwise use indeterminate feedback. [Loading](https://developer.apple.com/design/human-interface-guidelines/loading), [Progress indicators](https://developer.apple.com/design/human-interface-guidelines/progress-indicators)

**Product decision:** The inbound flow is Share → Clipnote → source preview → Save → durable saved acknowledgement. Collection and “Why I saved this” are optional. Confirm “Link saved. Preparing your note.” only after persistence succeeds. Show the pending note in Library; allow leaving immediately. Processing, ready, and failed are distinct states. A failure keeps the original URL and offers Retry/Open source. Do not fabricate percentages or describe extraction stages the backend cannot observe. Native share extension, PWA share target, and iOS Shortcut are different implementations; demonstrate the applicable entry point honestly.

## 5. Use sheets for brief decisions

**Apple guidance:** Sheets suit scoped tasks related to the current view. Avoid stacking sheets. Provide a clear exit; Done should have an alternative such as Cancel. Resizable iPhone sheets use a grabber, and dismissal must handle unsaved changes. Prolonged or complex work deserves a fuller presentation. [Sheets](https://developer.apple.com/design/human-interface-guidelines/sheets)

**Product decision:** Save-link entry, collection selection, and filter choices can use sheets. Reading a rich note and sustained Ask conversations should use full screens. A long collection list must remain searchable and scrollable when the keyboard opens. Preserve unfinished text if a sheet is interrupted.

## 6. Make AI useful and inspectable

**Apple guidance:** Explain AI involvement, account for incorrect output, offer examples, let people refine or undo generated results, and give meaningful generation feedback. Voluntary feedback controls should avoid interrupting the task. [Generative AI](https://developer.apple.com/design/human-interface-guidelines/generative-ai)

**Product decision:** Label the generated note clearly and retain an Open source action. Show coverage limits when extraction is incomplete. Let people edit the title, category, and body. Ask answers should show the notes used and link each citation to the relevant note. Keep the current scope explicit: All notes / Collection / This note. Say when the saved material cannot support an answer. Provide useful follow-ups such as “Compare these” or “Make a checklist”; saving an answer creates an editable note. Offer correction and retry near the result without making ratings a mandatory step.

## 7. Accessibility acceptance criteria

- **Apple guidance:** Aim for 44 × 44 pt button hit regions, with spacing and visible press feedback. Use familiar icons and concise labels. [Buttons](https://developer.apple.com/design/human-interface-guidelines/buttons)
- **Apple guidance:** iOS’s recommended default custom text size is 17 pt. Support enlarged text, ideally at least 200%, through Dynamic Type or equivalent behavior. [Accessibility](https://developer.apple.com/design/human-interface-guidelines/accessibility)
- **Apple guidance:** Give important controls accessible labels, expose document headings, and report meaningful content changes to assistive technology. [VoiceOver](https://developer.apple.com/design/human-interface-guidelines/voiceover)
- **Official criteria:** Apple’s Sufficient Contrast declaration generally expects 4.5:1 for ordinary text in common tasks. Its Reduced Motion declaration concerns respecting reduced-motion needs. [Contrast](https://developer.apple.com/help/app-store-connect/manage-app-accessibility/sufficient-contrast-evaluation-criteria/), [Reduced Motion](https://developer.apple.com/help/app-store-connect/manage-app-accessibility/reduced-motion-evaluation-criteria)
- **Web distinction:** WCAG 2.2 AA target-size guidance is 24 × 24 CSS px with exceptions; AAA enhanced guidance is 44 × 44 CSS px. Apple points and CSS pixels are separate units. Clipnote should choose 44 CSS px targets as its web design baseline. [WCAG minimum](https://www.w3.org/WAI/WCAG22/Understanding/target-size-minimum), [WCAG enhanced](https://www.w3.org/WAI/WCAG22/Understanding/target-size-enhanced)

**Product decision:** Verify the entire save → read → organize → find → ask loop with large text, VoiceOver, keyboard navigation, reduced motion, light/dark appearance, and a narrow viewport. No key action should depend solely on a swipe, long press, color, hover, or an image. Respect safe areas and keep controls clear of the software keyboard. Prefer solid readable content surfaces; any translucent navigation must preserve contrast over arbitrary covers. [Layout](https://developer.apple.com/design/human-interface-guidelines/layout)
