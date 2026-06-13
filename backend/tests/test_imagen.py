"""imagen.generate_cover: best-effort AI cover generation. A miss (disabled, empty
prompt, no image, RAI-filter, or any exception) must return None so the note falls back
to the frontend's gradient hero — it must never raise into the worker."""
import pytest

import services.imagen as imagen


class _Img:
    def __init__(self, image_bytes):
        self.image_bytes = image_bytes


class _Generated:
    def __init__(self, image_bytes=b"jpegbytes", rai=None):
        self.image = _Img(image_bytes) if image_bytes is not None else None
        self.rai_filtered_reason = rai


class _Resp:
    def __init__(self, generated):
        self.generated_images = generated


class _FakeClient:
    def __init__(self, resp=None, exc=None):
        self._resp = resp
        self._exc = exc
        self.models = self

    def generate_images(self, model, prompt, config):  # noqa: ARG002
        if self._exc:
            raise self._exc
        return self._resp


@pytest.fixture(autouse=True)
def enable(monkeypatch):
    monkeypatch.setattr(imagen.settings, "ENABLE_IMAGEN", True)
    monkeypatch.setattr(imagen.settings, "COVERS_BUCKET", "covers-bucket")
    monkeypatch.setattr(imagen, "upload_cover_bytes",
                        lambda data, suffix, ct: "https://storage.googleapis.com/covers-bucket/covers/x.jpg")


async def test_success_returns_uploaded_url(monkeypatch):
    monkeypatch.setattr(imagen, "_get_client", lambda: _FakeClient(_Resp([_Generated()])))
    url = await imagen.generate_cover("a vivid scene", "recipe")
    assert url == "https://storage.googleapis.com/covers-bucket/covers/x.jpg"


async def test_no_images_returns_none(monkeypatch):
    monkeypatch.setattr(imagen, "_get_client", lambda: _FakeClient(_Resp([])))
    assert await imagen.generate_cover("prompt", "summary") is None


async def test_empty_image_bytes_returns_none(monkeypatch):
    monkeypatch.setattr(imagen, "_get_client", lambda: _FakeClient(_Resp([_Generated(image_bytes=b"")])))
    assert await imagen.generate_cover("prompt", "summary") is None


async def test_exception_is_swallowed(monkeypatch):
    monkeypatch.setattr(imagen, "_get_client", lambda: _FakeClient(exc=RuntimeError("quota")))
    assert await imagen.generate_cover("prompt", "article") is None


async def test_disabled_short_circuits(monkeypatch):
    monkeypatch.setattr(imagen.settings, "ENABLE_IMAGEN", False)
    # _get_client must never be called when the feature is off.
    monkeypatch.setattr(imagen, "_get_client", lambda: (_ for _ in ()).throw(AssertionError("called")))
    assert await imagen.generate_cover("prompt", "recipe") is None


async def test_empty_prompt_short_circuits(monkeypatch):
    monkeypatch.setattr(imagen, "_get_client", lambda: (_ for _ in ()).throw(AssertionError("called")))
    assert await imagen.generate_cover("", "recipe") is None
