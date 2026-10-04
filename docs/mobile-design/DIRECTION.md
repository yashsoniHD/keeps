# Clipnote mobile design direction

Working design, 3 October 2026. Created independently of the existing frontend.

## Product promise

A saved video becomes something you can use. The first successful experience is opening a useful note; the enduring experience is finding it when you need it.

## Chosen structure

Three persistent destinations: **Notes · Collections · Ask**. Notes opens **Your library**, with a **Search** button beside its title. **Save** is an action above the tab bar. Search opens a dedicated screen from the header and finds existing notes. Ask explains, compares, or composes from them. Both accept natural language, but the UI makes their outcomes explicit.

```
Notes                     Collections              Ask
Your library   [Search]   Your collections         Ask your library
All Recipes Places       Collection list          [All notes v]
Continue reading          Create collection        Suggested questions
Recently saved + Save     Open / search / ask      Answer + source notes
                                                   Save answer as a note

Search opens from Your library:
[Remember anything…] → filters → matched notes → Ask about these results
```

The Save action opens a sheet: URL → save acknowledgement → background processing → a new note. Filing is optional. The source link survives extraction failure.

## Visual system

- Canvas: Cloud `#F5F7FA`; surface: Paper `#FFFFFF`; text: Ink `#192333`.
- Action: Cobalt `#2556D8`; secondary text: Slate `#596579`; quiet accent: Mist `#EAF0FF`.
- Typography: the system UI family, intentionally matching familiar mobile reading and Dynamic Type conventions. 34 px bold page titles, 22 px section titles, 17 px reading copy, 15 px supporting text, 12–13 px short metadata. Native implementation uses semantic text styles; the web prototype uses relative units and supports zoom.
- Spacing: 4/8/12/16/24/32. 20 px page inset, 16 px card inset. Roundness expresses hierarchy: 12 px small media, 20 px cards, 28 px sheets. No nested borders or decorative glass behind text.
- Artwork belongs to notes. Food and travel imagery give recognition cues; the application chrome stays quiet. Original vector illustrations in the prototype are fixture art, not extracted source covers.
- Motion: short sheet and selection feedback, with reduced-motion support; no entrance choreography that delays reading.

## Review against the brief

A dashboard with statistics and five content-specific apps was rejected: it makes saving require classification and fragments retrieval. A chat-only home was rejected: it hides the user's saved objects. A masonry grid was rejected as the default on phones: summaries become hard to compare and tap order less clear. Chosen: a readable notes list, one bounded continuation module, direct Collections and Ask tabs, and Search beside Your library.

Apple conventions inform navigation and readability; this remains a web prototype, not a claim to reproduce native iOS components. New resurfacing and offline behavior are proposals requiring implementation. The research files and final specification will record evidence, tradeoffs, and platform limits.
