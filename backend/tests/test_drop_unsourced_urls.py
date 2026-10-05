from models.note import ContentBundle
from routers.process import _drop_unsourced_urls


def test_keeps_only_urls_present_in_source():
    b = ContentBundle(url="https://x", kind="text", strategy="reel_video", text="",
                      metadata={"caption": "repo: github.com/cf/audit", "comments": ["see youtu.be/abc"]})
    data = {"items": [{"name": "a", "url": "https://github.com/cf/audit/"},
                      {"name": "b", "url": "https://youtu.be/abc"},
                      {"name": "c", "url": "https://www.youtube.com/watch?v=made-up"},
                      {"name": "d", "url": None}, "junk"]}
    _drop_unsourced_urls(data, b)
    assert [it.get("url") for it in data["items"][:4]] == [
        "https://github.com/cf/audit/", "https://youtu.be/abc", None, None]
    assert "url" not in data["items"][2]
