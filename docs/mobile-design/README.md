# Keeps mobile design

> Superseded: the shipped frontend is the "Keeps" redesign (`frontend/src/keeps/`). This folder is historical design research.

## Open the prototype

Run from the repository root:

```sh
python3 -m http.server 4174 --bind 127.0.0.1 --directory docs/mobile-design/prototype
```

Open http://127.0.0.1:4174/. On a narrow viewport the prototype fills the screen; desktop includes an explanatory presentation frame.

## Deliverables

- `UX-SPEC.md`: end-to-end product behavior, states, accessibility, and implementation requirements.
- `DIRECTION.md`: visual and interaction direction.
- `RESEARCH-SYNTHESIS.md` and `research/`: official Apple and competitor sources with design implications.
- `prototype/`: standalone interactive HTML, CSS, and JavaScript. Existing app frontend was not inspected or changed.

## Final navigation

Bottom bar: **Notes · Collections · Ask**. **Search** sits beside **Your library**, and results can become the scope for Ask. Saving remains an action available from the main screens.

## Try the journey

1. Save a link → Try a sample cooking video → Save link.
2. Open the prepared recipe and add it to Weeknight cooking.
3. Open Collections and revisit the recipe.
4. Return to Notes, open Search, and type dinner.
5. Ask about those results, send the question, open a cited note, and return to the answer.
6. Save the answer as a note.

## Validation and boundaries

Verified in the in-app browser at 390 × 844: capture acknowledgement, completed sample recipe, collection membership, Notes/Collections navigation, live search, search-to-Ask scope and draft transfer, answer citations and return, saved answer confirmation. Browser reported no errors or warnings. JavaScript syntax check passed. Code review fixed return scroll preservation, collection back labels, active navigation semantics, and dialog transition focus.

This is a design prototype using local sample data and scripted answers. It stores demo notes in browser localStorage. Live extraction, semantic search, AI generation, accounts, share extensions, offline synchronization, email, and billing are specified rather than connected. Collection-scoped Search, full conversation history, and production error recovery are specified future behavior. Screen-reader and real-device keyboard testing remain production acceptance work.
