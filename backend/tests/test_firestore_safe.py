"""firestore_safe: Gemini's natural output must always be storable.

Regression for the 2026-06-11 incident: the composer prompt's table block
(rows: [[str]]) is an array-of-arrays, which Firestore rejects with
"invalid nested entity" — every note containing a table failed to write.
"""
from services.firebase import firestore_safe


def test_table_rows_get_wrapped():
    data = {"table": {"columns": ["Team", "Group"], "rows": [["India", "A"], ["Brazil", "B"]]}}
    safe = firestore_safe(data)
    assert safe["table"]["rows"] == [{"cells": ["India", "A"]}, {"cells": ["Brazil", "B"]}]


def test_deeply_nested_arrays():
    assert firestore_safe([[1, [2, 3]]]) == [{"cells": [1, {"cells": [2, 3]}]}]


def test_plain_structures_unchanged():
    data = {"facts": [{"label": "Host", "value": "USA/Mexico/Canada"}], "steps": ["a", "b"]}
    assert firestore_safe(data) == data


def test_non_string_dict_keys_coerced():
    assert firestore_safe({1: "x"}) == {"1": "x"}


def test_scalars_pass_through():
    for v in ("s", 3, 2.5, True, None):
        assert firestore_safe(v) == v
