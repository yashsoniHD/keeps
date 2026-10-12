import httpx

import services.sources.generic as generic


async def test_relative_og_image_resolved_against_final_url(monkeypatch):
    html = '<html><head><meta property="og:image" content="/img/x.png"></head><body></body></html>'

    def handler(req):
        if req.url.path == "/old":
            return httpx.Response(301, headers={"Location": "https://cdn.example.org/post/1"})
        return httpx.Response(200, text=html)

    monkeypatch.setattr(generic, "guarded_async_client", lambda **kw: httpx.AsyncClient(
        transport=httpx.MockTransport(handler), follow_redirects=True))
    bundle = await generic.acquire("https://example.org/old")
    assert bundle.images == ["https://cdn.example.org/img/x.png"]
