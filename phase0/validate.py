"""Phase 0 validation runner.

Runs each URL in phase0/urls.txt through the production pipeline
(source resolver → categorize → type-focused extraction) and writes:
  - phase0/results/<NN>-<slug>.md   one human-readable note per URL, rendered the way
                                    its React template would lay it out
  - phase0/REPORT.md                summary table for the go/no-go gate

Simulates the per-user category mechanism: categories accumulate across the run, so
convergence (recipe #2 joining recipe #1's category) is validated too.

Usage:  cd backend && ./venv/bin/python ../phase0/validate.py [--only N]
"""
import asyncio
import json
import re
import sys
import time
from pathlib import Path

PHASE0_DIR = Path(__file__).parent
BACKEND_DIR = PHASE0_DIR.parent / "backend"
sys.path.insert(0, str(BACKEND_DIR))

from models.note import ContentBundle, NoteExtraction          # noqa: E402
from services import sources                                   # noqa: E402
from services.gemini import gemini_service                     # noqa: E402

RESULTS_DIR = PHASE0_DIR / "results"
RESULTS_DIR.mkdir(exist_ok=True)


# ---------- type-aware markdown rendering (mirrors the React templates) ----------

def _facts_block(facts: list) -> list[str]:
    out = ["| | |", "|---|---|"]
    out += [f"| **{f.get('label', '')}** | {f.get('value', '')} |" for f in facts]
    return out


def render_data(content_type: str, data: dict) -> str:
    L: list[str] = []

    if content_type == "recipe":
        stats = [(k, data.get(k)) for k in ("totalTime", "prepTime", "cookTime", "servings",
                                            "difficulty", "cuisine", "calories")]
        L += _facts_block([{"label": k, "value": v} for k, v in stats if v])
        L.append("\n## Ingredients")
        for grp in data.get("ingredients", []):
            if grp.get("group"):
                L.append(f"\n**{grp['group']}**")
            L += [f"- {i}" for i in grp.get("items", [])]
        L.append("\n## Method")
        L += [f"{n}. {s}" for n, s in enumerate(data.get("steps", []), 1)]
        if data.get("tips"):
            L.append("\n## Tips")
            L += [f"- {t}" for t in data["tips"]]

    elif content_type == "itinerary":
        stats = [(k, data.get(k)) for k in ("destination", "duration", "budget", "bestSeason")]
        L += _facts_block([{"label": k, "value": v} for k, v in stats if v])
        for day in data.get("days", []):
            L.append(f"\n## Day {day.get('day')}: {day.get('title', '')}")
            for stop in day.get("stops", []):
                t = f"`{stop['time']}` " if stop.get("time") else ""
                L.append(f"- {t}**{stop.get('place', '')}** — {stop.get('note', '')}")
        if data.get("tips"):
            L.append("\n## Tips")
            L += [f"- {t}" for t in data["tips"]]

    elif content_type == "product":
        stats = [(k, data.get(k)) for k in ("price", "brand", "rating")]
        L += _facts_block([{"label": k, "value": v} for k, v in stats if v])
        if data.get("specs"):
            L.append("\n## Specs")
            L += _facts_block(data["specs"])
        cols = []
        if data.get("pros"):
            cols.append("### Pros\n" + "\n".join(f"- ✅ {p}" for p in data["pros"]))
        if data.get("cons"):
            cols.append("### Cons\n" + "\n".join(f"- ❌ {c}" for c in data["cons"]))
        L += ["\n" + "\n\n".join(cols)] if cols else []
        if data.get("verdict"):
            L.append(f"\n> **Verdict:** {data['verdict']}")

    elif content_type == "workout":
        stats = [(k, data.get(k)) for k in ("goal", "level", "duration", "frequency")]
        L += _facts_block([{"label": k, "value": v} for k, v in stats if v])
        if data.get("equipment"):
            L.append(f"\n**Equipment:** {', '.join(data['equipment'])}")
        for block in data.get("structure", []) or []:
            L.append(f"\n## {block.get('block', '')}")
            L += [f"- {i}" for i in block.get("items", [])]
        if data.get("exercises"):
            L.append("\n## Exercises")
            L.append("| Exercise | Sets | Reps | Duration | Rest | Form cue |")
            L.append("|---|---|---|---|---|---|")
            for ex in data["exercises"]:
                L.append("| {name} | {sets} | {reps} | {duration} | {rest} | {formCues} |".format(
                    **{k: ex.get(k, "—") or "—" for k in
                       ("name", "sets", "reps", "duration", "rest", "formCues")}))
        if data.get("tips"):
            L.append("\n## Tips")
            L += [f"- {t}" for t in data["tips"]]

    elif content_type == "summary":
        stats = [(k, data.get(k)) for k in ("medium", "readTime", "videoLength")]
        L += _facts_block([{"label": k, "value": v} for k, v in stats if v])
        L.append(f"\n> **TL;DR** — {data.get('tldr', '')}")
        L.append("\n## Key points")
        L += [f"{n}. {p}" for n, p in enumerate(data.get("keyPoints", []), 1)]
        for q in data.get("quotes", []) or []:
            ts = f" *({q['timestamp']})*" if q.get("timestamp") else ""
            L.append(f"\n> “{q.get('text', '')}”{ts}")
        if data.get("actionItems"):
            L.append("\n## Action items")
            L += [f"- [ ] {a}" for a in data["actionItems"]]

    else:
        # Generic building blocks (what GenericNote renders).
        if data.get("facts"):
            L += _facts_block(data["facts"])
        for sec in data.get("sections", []) or []:
            L.append(f"\n## {sec.get('heading', '')}")
            L += [f"- {i}" for i in sec.get("items", [])]
        if isinstance(data.get("table"), dict):
            t = data["table"]
            L.append("\n| " + " | ".join(t.get("columns", [])) + " |")
            L.append("|" + "---|" * len(t.get("columns", [])))
            L += ["| " + " | ".join(str(c) for c in row) + " |" for row in t.get("rows", [])]
        if data.get("steps"):
            L.append("\n## Steps")
            L += [f"{n}. {s}" for n, s in enumerate(data["steps"], 1)]
        if data.get("checklist"):
            L.append("\n## Checklist")
            L += [f"- [ ] {c}" for c in data["checklist"]]
        for q in data.get("quotes", []) or []:
            att = f" — {q['attribution']}" if q.get("attribution") else ""
            L.append(f"\n> “{q.get('text', '')}”{att}")
        # Anything not covered by known blocks: dump so we can see what the model invented.
        known = {"facts", "sections", "table", "steps", "checklist", "quotes"}
        extras = {k: v for k, v in data.items() if k not in known}
        if extras:
            L.append("\n<details><summary>Unrendered keys (template gap?)</summary>\n")
            L.append("```json\n" + json.dumps(extras, indent=1, ensure_ascii=False)[:3000] + "\n```\n</details>")

    return "\n".join(L)


def genericness_verdict(content_type: str, data: dict) -> str:
    """Heuristic flag for the report: did we get structure or just bullets?"""
    if content_type in ("recipe", "itinerary", "product", "workout", "place", "book"):
        return "typed"
    if content_type == "summary":
        return "summary(ok-if-prose)"
    blocks = [k for k in ("facts", "table", "steps", "checklist") if data.get(k)]
    n_sections = len(data.get("sections", []) or [])
    if blocks:
        return f"composed({'+'.join(blocks)})"
    if n_sections >= 2:
        return f"composed(sections×{n_sections})"
    return "⚠️ GENERIC"


# ---------- runner ----------

async def run_one(idx: int, url: str, categories: list[str]) -> dict:
    row = {"idx": idx, "url": url, "strategy": "-", "category": "-", "verdict": "-",
           "elapsed": 0.0, "status": "ok", "error": None}
    t0 = time.time()
    try:
        bundle = await sources.acquire(url)
        row["strategy"] = bundle.strategy
        content_type = await gemini_service.assign_category(url, bundle, categories)
        row["category"] = content_type
        extraction = await gemini_service.extract_async(url, bundle, content_type)
        row["elapsed"] = time.time() - t0
        row["verdict"] = genericness_verdict(content_type, extraction.data)

        slug = re.sub(r"[^a-z0-9]+", "-", extraction.title.lower())[:40].strip("-")
        out = RESULTS_DIR / f"{idx:02d}-{slug or 'untitled'}.md"
        body = render_data(content_type, extraction.data)
        out.write_text(f"""# {extraction.title}

> **AI summary:** {extraction.ai_summary}

| | |
|---|---|
| Source | {url} |
| Category | `{content_type}` |
| Pipeline | `{bundle.strategy}` ({bundle.kind}) |
| Time | {row['elapsed']:.1f}s |
| Verdict | {row['verdict']} |
| Cover candidates | {', '.join(bundle.images[:3]) or '(none — gradient placeholder)'} |

---

{body}

<details><summary>Raw data JSON</summary>

```json
{json.dumps(extraction.data, indent=1, ensure_ascii=False)}
```
</details>
""")
        row["file"] = out.name
        if content_type not in categories:
            categories.append(content_type)   # simulate users/{uid}.categories ArrayUnion
    except Exception as e:
        row["status"] = "FAILED"
        row["error"] = f"{type(e).__name__}: {e}"
        row["elapsed"] = time.time() - t0
        print(f"  [{idx:02d}] FAILED: {row['error']}")
    return row


async def main():
    only = None
    if "--only" in sys.argv:
        only = int(sys.argv[sys.argv.index("--only") + 1])

    urls = [u.strip() for u in (PHASE0_DIR / "urls.txt").read_text().splitlines()
            if u.strip() and not u.strip().startswith("#")]
    categories: list[str] = []   # grows across the run, like users/{uid}.categories
    rows = []
    for idx, url in enumerate(urls, 1):
        if only and idx != only:
            continue
        print(f"[{idx:02d}/{len(urls)}] {url}")
        row = await run_one(idx, url, categories)
        print(f"        → {row['strategy']} | {row['category']} | {row['verdict']} | {row['elapsed']:.1f}s")
        rows.append(row)

    # REPORT.md
    lines = [
        "# Phase 0 Validation Report", "",
        f"URLs run: {len(rows)} · OK: {sum(r['status'] == 'ok' for r in rows)} · "
        f"Failed: {sum(r['status'] != 'ok' for r in rows)}", "",
        f"Categories that emerged (in order): {', '.join(f'`{c}`' for c in categories)}", "",
        "| # | URL | Strategy | Category | Verdict | Time | Status |",
        "|---|---|---|---|---|---|---|",
    ]
    for r in rows:
        short = r["url"][:60] + ("…" if len(r["url"]) > 60 else "")
        status = "ok" if r["status"] == "ok" else f"**{r['error'][:80]}**"
        lines.append(f"| {r['idx']} | {short} | `{r['strategy']}` | `{r['category']}` "
                     f"| {r['verdict']} | {r['elapsed']:.0f}s | {status} |")
    lines += ["", "Verdict legend: `typed` = bespoke template schema · `composed(...)` = "
              "GenericNote building blocks · `⚠️ GENERIC` = bullets-only output (FAIL — fix prompts).", ""]
    (PHASE0_DIR / "REPORT.md").write_text("\n".join(lines))
    print(f"\nReport: {PHASE0_DIR / 'REPORT.md'}")


if __name__ == "__main__":
    asyncio.run(main())
