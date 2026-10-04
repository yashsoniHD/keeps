"""Builds the "Save to Clipnote" iOS shortcut and signs it for distribution.

The shortcut: [Text: token] → [POST /api/ingest, shared URL in X-Clipnote-Url header]
→ [Notification]. A WFWorkflowImportQuestion targets the Text action, so iOS prompts
"Paste your Clipnote token" at install time and bakes the value in — no manual
shortcut editing for the user.

Why headers, not a JSON body: WFJSONValues dictionaries get silently STRIPPED when a
signed .shortcut file is imported on-device (verified iOS 18, 2026-06-11) — the action
keeps its method/URL/headers but loses the body fields. Header dictionaries survive
import intact, so the URL travels in X-Clipnote-Url and /api/ingest reads it from there.

Usage:  python3 infra/build_shortcut.py            # writes + signs frontend/public/clipnote.shortcut
Signing uses the macOS `shortcuts sign` CLI (requires this Mac to be signed into iCloud).
"""
import plistlib
import subprocess
import sys
import uuid
from pathlib import Path

API_URL = "https://clip-note-api-yashsoni102-progs-projects.vercel.app/api/ingest"
ROOT = Path(__file__).resolve().parent.parent
UNSIGNED = ROOT / "infra" / "build" / "clipnote-unsigned.shortcut"
SIGNED = ROOT / "frontend" / "public" / "clipnote.shortcut"

TOKEN_UUID = str(uuid.uuid4()).upper()


def text_token(string: str, attachments: dict | None = None) -> dict:
    return {
        "Value": {"string": string, "attachmentsByRange": attachments or {}},
        "WFSerializationType": "WFTextTokenString",
    }


def action_output(uuid_: str, name: str) -> dict:
    return {"OutputUUID": uuid_, "OutputName": name, "Type": "ActionOutput"}


def dict_item(key: str, value: dict) -> dict:
    return {"WFItemType": 0, "WFKey": text_token(key), "WFValue": value}


workflow = {
    "WFWorkflowClientVersion": "2607.0.3",
    "WFWorkflowMinimumClientVersion": 900,
    "WFWorkflowMinimumClientVersionString": "900",
    "WFWorkflowHasOutputFallback": False,
    "WFWorkflowHasShortcutInputVariables": True,
    "WFWorkflowIcon": {
        "WFWorkflowIconStartColor": 431817727,  # warm dark
        "WFWorkflowIconGlyphNumber": 59511,     # sparkle-ish glyph
    },
    "WFWorkflowImportQuestions": [
        {
            "ActionIndex": 0,
            "Category": "Parameter",
            "DefaultValue": "",
            "ParameterKey": "WFTextActionText",
            "Text": "Your Clipnote token is already copied to your clipboard — just paste it below.",
        }
    ],
    "WFWorkflowInputContentItemClasses": [
        "WFURLContentItem",
        "WFStringContentItem",
        "WFSafariWebPageContentItem",
        "WFArticleContentItem",
    ],
    "WFWorkflowTypes": ["ActionExtension"],
    "WFWorkflowActions": [
        {
            "WFWorkflowActionIdentifier": "is.workflow.actions.gettext",
            "WFWorkflowActionParameters": {
                "UUID": TOKEN_UUID,
                "WFTextActionText": "PASTE_YOUR_CLIPNOTE_TOKEN_HERE",
            },
        },
        {
            "WFWorkflowActionIdentifier": "is.workflow.actions.downloadurl",
            "WFWorkflowActionParameters": {
                "WFURL": API_URL,
                "WFHTTPMethod": "POST",
                "ShowHeaders": True,
                "WFHTTPHeaders": {
                    "Value": {
                        "WFDictionaryFieldValueItems": [
                            dict_item(
                                "Authorization",
                                text_token(
                                    "Bearer ￼",
                                    {"{7, 1}": action_output(TOKEN_UUID, "Text")},
                                ),
                            ),
                            # Shared URL rides in a header: the share-sheet input is
                            # interpolated directly (no Get-URLs step), and the backend
                            # sanitizes whatever text arrives.
                            dict_item(
                                "X-Clipnote-Url",
                                text_token("￼", {"{0, 1}": {"Type": "ExtensionInput"}}),
                            ),
                            dict_item("X-Clipnote-Source", text_token("shortcut")),
                        ]
                    },
                    "WFSerializationType": "WFDictionaryFieldValue",
                },
            },
        },
        {
            "WFWorkflowActionIdentifier": "is.workflow.actions.notification",
            "WFWorkflowActionParameters": {
                "WFNotificationActionBody": "Saved to Clipnote ✓ — your note is being drafted.",
                "WFNotificationActionSound": True,
            },
        },
    ],
}

UNSIGNED.parent.mkdir(parents=True, exist_ok=True)
with open(UNSIGNED, "wb") as f:
    plistlib.dump(workflow, f)
print(f"wrote {UNSIGNED}")

result = subprocess.run(
    ["shortcuts", "sign", "--mode", "anyone", "--input", str(UNSIGNED), "--output", str(SIGNED)],
    capture_output=True, text=True,
)
if result.returncode != 0:
    print("SIGNING FAILED:", result.stderr.strip() or result.stdout.strip())
    sys.exit(1)
print(f"signed → {SIGNED} ({SIGNED.stat().st_size} bytes)")
