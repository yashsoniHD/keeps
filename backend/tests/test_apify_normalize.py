"""apify: URL→actor routing and output normalization across the per-platform actors.

Field names are locked to the actors' documented output schemas (verified 2026-06-14):
instagram-reel/post-scraper use flat fields (downloadedVideo/caption/displayUrl/...),
clockworks/tiktok-scraper uses mediaUrls (array) + nested authorMeta.
"""
import services.apify as apify


def test_actor_routing():
    assert apify.actor_kind("https://www.instagram.com/reel/ABC/") == "instagram_reel"
    assert apify.actor_kind("https://www.instagram.com/p/ABC/?img_index=1") == "instagram_post"
    assert apify.actor_kind("https://www.tiktok.com/@u/video/123") == "tiktok"
    # Facebook is off by default (no actor id) → falls to the free og-caption path.
    assert apify.actor_kind("https://www.facebook.com/reel/123") is None
    assert apify.actor_kind("https://example.com/x") is None


def test_unconfigured_actor_does_not_route(monkeypatch):
    """A platform with its actor id cleared must NOT route to Apify (no wasted paid run)."""
    monkeypatch.setattr(apify.settings, "APIFY_INSTAGRAM_REEL_ACTOR", "")
    assert apify.actor_kind("https://www.instagram.com/reel/ABC/") is None
    assert "instagram_reel" not in apify._registry()


def test_facebook_routes_only_when_opted_in(monkeypatch):
    """FB opt-in: setting APIFY_FACEBOOK_ACTOR wires it with the startUrls input shape."""
    fb = "https://www.facebook.com/reel/123"
    monkeypatch.setattr(apify.settings, "APIFY_FACEBOOK_ACTOR", "neuro-scraper~fb")
    assert apify.actor_kind(fb) == "facebook"
    assert apify._registry()["facebook"].build_input(fb) == {
        "startUrls": [{"url": fb}], "resultsLimit": 1}


def test_input_builders_match_actor_schemas():
    reg = apify._registry()
    assert reg["instagram_reel"].build_input("u") == {"username": ["u"], "resultsLimit": 1}
    assert reg["instagram_post"].build_input("u")["username"] == ["u"]
    tk = reg["tiktok"].build_input("u")
    assert tk["postURLs"] == ["u"] and tk["shouldDownloadVideos"] is True


def test_normalize_instagram_reel_item():
    """Exact instagram-reel-scraper output fields → normalized bundle inputs. Prefers the
    Apify-hosted downloadedVideo over the expiring IG CDN videoUrl."""
    item = {
        "downloadedVideo": "https://api.apify.com/v2/key-value-stores/abc/records/vid",
        "videoUrl": "https://scontent.cdninstagram.com/expiring.mp4",
        "caption": "How many lakes did you recognize?\nMore details here",
        "displayUrl": "https://scontent.cdninstagram.com/poster.jpg",
        "ownerUsername": "geodesaurus",
        "videoDuration": 90.011,
    }
    out = apify._normalize(item)
    assert out["video_url"].startswith("https://api.apify.com/")  # Apify-hosted preferred
    assert out["title"] == "How many lakes did you recognize?"     # first caption line
    assert out["thumbnail"] == "https://scontent.cdninstagram.com/poster.jpg"
    assert out["author"] == "geodesaurus"
    assert out["duration"] == 90  # float seconds floored to int


def test_normalize_tiktok_item():
    """clockworks/tiktok-scraper: mediaUrls array for the video, nested authorMeta for author."""
    item = {
        "text": "wait for it 😂",
        "mediaUrls": ["https://v.tiktokcdn.com/video.mp4"],
        "authorMeta": {"name": "someuser", "nickName": "Some User"},
        "webVideoUrl": "https://www.tiktok.com/@someuser/video/123",  # page URL, not media
    }
    out = apify._normalize(item)
    assert out["video_url"] == "https://v.tiktokcdn.com/video.mp4"  # array element, not page URL
    assert out["author"] == "someuser"
    assert out["title"] == "wait for it 😂"


def test_normalize_tiktok_videometa_shape():
    """clockworks can nest media under videoMeta — video/cover/duration must still resolve."""
    item = {
        "text": "tutorial",
        "authorMeta": {"name": "chef"},
        "videoMeta": {"downloadAddr": "https://v.tiktokcdn.com/dl.mp4",
                      "coverUrl": "https://p.tiktokcdn.com/cover.jpg", "duration": 42},
    }
    out = apify._normalize(item)
    assert out["video_url"] == "https://v.tiktokcdn.com/dl.mp4"
    assert out["thumbnail"] == "https://p.tiktokcdn.com/cover.jpg"
    assert out["duration"] == 42
    assert out["author"] == "chef"
