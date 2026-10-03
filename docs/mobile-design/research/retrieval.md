# Organizing, finding and reusing saved knowledge

Research date: 3 October 2026. Scope: Raindrop.io, Fabric and Recall official documentation. No existing Clipnote frontend or mobile design was inspected. These sources establish documented features, not independent evidence that the features improve retention or task success. Recommendations below are design hypotheses to validate.

## What the products document

### Raindrop.io: predictable retrieval and explicit structure

- One search covers bookmarks, collections, tags, highlights and annotations. Results are grouped by kind. Queries can combine text with filters; search can be restricted to the current collection. The documentation also describes matching by meaning and full-content search, including YouTube transcripts. Newly saved metadata is searchable before content indexing finishes. [Search documentation](https://help.raindrop.io/using-search)
- Collections represent topics, projects or interests. Unfiled bookmarks remain in Unsorted. A bookmark belongs to one collection; placing it in another requires a separate copy. Collections support nesting and independent list/grid/moodboard settings. [Collections documentation](https://help.raindrop.io/collections)

**Transferable principle:** clear scope and visible filters help users understand what they are searching. A familiar collection name can be a stronger memory cue than a generated tag. **Tradeoff:** single-folder membership forces a choice when one item serves several purposes; Clipnote should avoid duplicate notes merely to support multiple contexts.

### Fabric: useful without maintaining a filing system

- Fabric describes manual folders, spaces and tags alongside automatic metadata and tag suggestions. Unfiled material stays searchable. Its stated distinction: folders provide hierarchy, spaces provide broader contexts, and tags cut across folders. [Organization documentation](https://fabric.so/features/organization)
- Search accepts natural-language descriptions, finds related content by meaning and can jump to matching paragraphs or media timestamps. It also offers a route from search results into an AI conversation. [Search feature page](https://fabric.so/features/search)
- Recap packages recent saved material and writing into an email summary. Users choose a schedule. This demonstrates a deliberate return loop, although the page supplies no controlled retention results. [Recap feature page](https://fabric.so/product/recap)

**Transferable principle:** organization should improve a working library, not be a prerequisite for one. Search results should explain the match and support the next task. **Tradeoff:** exposing folders, spaces, tags, boards and canvases together would be excessive for Clipnote's mobile purpose.

### Recall: explicit context and reusable answers

- Recall automatically assigns tags using existing structure; one card can have multiple tags. Active filters appear in a removable row, with a searchable tag picker. [Tagging documentation](https://docs.recall.it/deep-dives/tagging)
- Chat supports library, web or combined scope, plus pinned cards/tags/folders. Pinned context remains above the input. Answers reference source cards; the documentation describes timestamps for media, a source list, follow-up questions and saving useful answers as new cards. These are documented capabilities, not guarantees of complete or correct citation in every response. [Chat documentation](https://docs.recall.it/deep-dives/chat/overview)
- Augmented Browsing surfaces connections while reading related material and offers controls to hide entities or disable sites. The documentation marks it beta and off by default. [Augmented Browsing documentation](https://docs.recall.it/deep-dives/recall-augmented-browsing)
- Scheduled review requires adding selected material to a quiz schedule. Its learning-specific commitment is relevant: a study routine should be intentional. [Review documentation](https://docs.recall.it/getting-started/6-review-content)

**Transferable principle:** make the evidence set visible, then let useful synthesis become another saved object. **Tradeoff:** graph browsing, quizzes, model pickers and personas create demands beyond everyday recipe, travel and product retrieval.

## Proposed Clipnote behavior

### 1. Two understandable kinds of organization

**Types answer “What is it?”** Automatically suggest Recipe, Place, Product, Workout or another suitable name. Types remain editable; reconcile near-duplicate names rather than generating a new filter for every save. A type filter must never hide other types permanently or change a user's collection membership.

**Collections answer “What am I using it for?”** Examples: Weeknight dinners, Japan trip, New apartment. Make these optional and user controlled. One note can belong to several collections without copies. Suggest one relevant existing collection after extraction; show the reason and require a tap to apply it. Creation begins with a name only. Keep nested taxonomies out of the initial mobile experience.

Library remains useful with zero collections. Every completed note appears in All notes immediately. Avoid an “Unsorted” debt badge: lack of filing is a valid state.

### 2. Search first, then answer

Offer one consistent search entry, with results appearing for titles, source names, note text and meaning. Show compact matching snippets, note type and saved date. Include collection results as a distinct group. Filters use plain labels: Type, Collection, Source, Saved date. Selected filters remain visible and removable.

Search “that miso pasta reel” should retrieve notes directly. “Which of my dinners take under 20 minutes?” can offer **Ask about these notes**. Preserve the query and visible scope when moving into Ask. Never require a conversation merely to open a remembered note.

### 3. Make Ask inspectable

Start in **My notes**. A scope chip can narrow to a collection or selected notes. Show interpreted dates explicitly: “Saved 1–7 October,” calculated in the user's timezone. Responses provide claim-level note links and a compact Sources list; open a citation without losing the question or scroll position.

Coverage must say what happened: “Used 8 relevant notes” for ranked retrieval; “Reviewed all 12 notes in Japan trip” only after exhaustive retrieval. If capped: “Reviewed 50 of 83 matching notes · Narrow results.” Do not imply every note was reviewed simply because the library is in scope.

Missing evidence gets a useful answer: “I couldn't find the cooking time in your saved notes.” General answers should be visibly labeled and have no invented note citations. Keep **Save as note** explicit, with a preview, title and source links; repeat taps must not create duplicate artifacts.

### 4. Rediscovery should have a reason

Near-term: recent notes, favorites, recently opened collections and a weekly digest entry give reliable return paths. A digest should show concrete value, such as “Three dinners you saved this week,” and link to the notes. Let users control email frequency and stop it easily.

Later, when deferred resurfacing is scheduled: suggest a small number of related older notes with an explanation such as “Also in your Japan trip.” Allow dismissal and honor it. Avoid daily nags, streak pressure or an infinite recommendation feed. Contextual relationships are more credible than random old saves.

## Validation

Test five tasks on a realistic library: recover a vaguely remembered reel; find it without knowing its type; place one note in two goal-based collections; answer across a complete collection; identify a deliberately missing fact. Measure completion, time, scope errors and whether users can trace answers to evidence. Test digest usefulness through note reopenings and explicit feedback, rather than email opens alone.
