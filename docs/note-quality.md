# Content-shaped notes

New extractions use `services/note_document.py`: source evidence → document composition →
one review/revision. The existing source-specific model reads the source once. The existing
text model composes and reviews; all calls go through the usage meter. Category selection
still supports the user's taxonomy, but no longer selects the document layout.

`data.document` version 1 contains ordered text/list/steps/facts/checklist/quote/code/table
blocks, supporting evidence IDs, and optional exact-source links. `data._evidence` preserves
source-labelled details and observed timestamps. `data._quality` records generation/review
outcomes and models. Internal evidence and review metadata do not render or enter search
embeddings. The persisted template is `document`; old per-category notes remain compatible.
Movie/TV title metadata remains alongside the document for TMDB enrichment and attribution.

Review checks the extracted packet, not the original media. It cannot certify that the
extractor captured everything. Invalid references, malformed revisions and review failures
retain the valid draft. Composition failure saves source details with comment attribution.
Editorial calls stop when the worker budget is short. Failed video extraction still uses
the existing caption/cover fallback and thin-source indication. Model citations validate
reference existence, not factual entailment; human source comparison is still necessary.

Configuration (both default to `true`):

- `NOTE_DOCUMENTS_ENABLED=false`: restore the legacy one-pass extraction prompts.
- `NOTE_REVIEW_ENABLED=false`: evidence + composition, without the editorial call.

Deploy the frontend before enabling the backend: older frontends do not understand the new
`document` field. Existing notes are not rewritten. Re-extracting an existing note uses the
new pipeline. No database migration is required. The embedding input change only excludes
new internal fields absent from legacy notes, so existing vectors need no reindex.

## Quality evaluation

Choose 20–30 real saves, including short tips, complete recipes, technique explanations,
comparisons, long tutorials, multi-item recommendations, comments, carousels and thin saves.
Review the original source first; mark indispensable facts and unsupported-claim traps.
Capture their already-acquired content as fixtures (keep private source material local):

```json
[
  {
    "id": "technique-01",
    "url": "https://example.com/source",
    "content_type": "recipe",
    "bundle": {
      "kind": "text",
      "text": "Paste the actual source text/transcript here.",
      "strategy": "evaluation"
    }
  }
]
```

`bundle` accepts the existing ContentBundle fields, including `video_uri` for a public
YouTube source. For downloaded videos or carousels, use the extraction service directly
with the acquired media bytes; JSON fixtures cannot represent raw image/video bytes.

From `backend`, run:

```sh
.venv/bin/python -m scripts.eval_notes /path/to/cases.json --out /tmp/keeps-note-eval
```

This deliberately makes paid API calls (up to six normal calls per case, plus model
fallbacks/legacy JSON repair); it never writes notes or jobs. Compare `blind.json` with the
sources and fill `scores.csv` before opening `key-and-metrics.json`. Score accuracy,
coverage, readability, usefulness, and whether you still need to reopen the source.
The key includes elapsed time, metered cost, call count and review outcome. Never infer
quality improvement from schema/unit tests alone. Composition and review each have bounded
call time, but actual overhead must be measured on these real examples.
