import asyncio
import os

import pytest

from services import video_thumbnail as thumbnail

MP4 = b"\x00\x00\x00\x18ftypisom\x00\x00\x00\x00"


class FakeProcess:
    def __init__(self, output_path, *, output=b"\xff\xd8small\xff\xd9", hang=False):
        self.output_path = output_path
        self.output = output
        self.hang = hang
        self.returncode = None
        self.killed = False
        self.reaped = False

    async def wait(self):
        if self.killed:
            self.reaped = True
            self.returncode = -9
            return self.returncode
        if self.hang:
            await asyncio.Future()
        with open(self.output_path, "wb") as output:
            output.write(self.output)
        self.returncode = 0
        self.reaped = True
        return self.returncode

    def kill(self):
        self.killed = True


@pytest.fixture
def fake_ffmpeg(monkeypatch):
    processes = []
    paths = []

    async def create(*args, **kwargs):
        output_path = args[-1]
        proc = FakeProcess(output_path)
        processes.append((proc, args, kwargs))
        paths.append(output_path)
        return proc

    monkeypatch.setattr(thumbnail.asyncio, "create_subprocess_exec", create)
    return processes, paths


async def test_returns_small_jpeg_data_uri_and_cleans_tempfiles(fake_ffmpeg):
    processes, paths = fake_ffmpeg
    uri = await thumbnail.video_thumbnail(MP4)
    assert uri == "data:image/jpeg;base64,/9hzbWFsbP/Z"
    proc, args, kwargs = processes[0]
    assert args[0] == "ffmpeg"
    input_path = args[args.index("-i") + 1]
    assert os.path.isfile(input_path) is False
    assert os.path.isfile(paths[0]) is False
    assert kwargs["stdin"] == asyncio.subprocess.DEVNULL
    assert "-fs" in args and int(args[args.index("-fs") + 1]) == thumbnail.MAX_JPEG_BYTES
    assert args[args.index("-protocol_whitelist") + 1] == "file"
    assert args[args.index("-f") + 1] == "mov"
    assert "scale='min(240,iw)':-2" in args


@pytest.mark.parametrize("output", [b"not jpeg", b"\xff\xd8truncated"])
async def test_rejects_invalid_jpeg(monkeypatch, output):
    async def create(*args, **kwargs):
        return FakeProcess(args[-1], output=output)

    monkeypatch.setattr(thumbnail.asyncio, "create_subprocess_exec", create)
    assert await thumbnail.video_thumbnail(MP4) is None


async def test_rejects_oversized_file_even_if_ffmpeg_ignores_size_limit(monkeypatch):
    output = b"\xff\xd8" + b"x" * (thumbnail.MAX_JPEG_BYTES + 10) + b"\xff\xd9"

    async def create(*args, **kwargs):
        return FakeProcess(args[-1], output=output)

    monkeypatch.setattr(thumbnail.asyncio, "create_subprocess_exec", create)
    assert await thumbnail.video_thumbnail(MP4) is None


async def test_timeout_kills_and_reaps_child_and_cleans_tempfiles(monkeypatch):
    proc_holder = []
    paths = []

    async def create(*args, **kwargs):
        proc = FakeProcess(args[-1], hang=True)
        proc_holder.append(proc)
        paths.extend((args[args.index("-i") + 1], args[-1]))
        return proc

    monkeypatch.setattr(thumbnail.asyncio, "create_subprocess_exec", create)
    monkeypatch.setattr(thumbnail, "FFMPEG_TIMEOUT_SECONDS", 0.001)
    assert await thumbnail.video_thumbnail(MP4) is None
    assert proc_holder[0].killed and proc_holder[0].reaped
    assert all(not os.path.exists(path) for path in paths)


async def test_cancellation_kills_and_reaps_child(monkeypatch):
    started = asyncio.Event()
    proc_holder = []

    async def create(*args, **kwargs):
        proc = FakeProcess(args[-1], hang=True)
        proc_holder.append(proc)
        started.set()
        return proc

    monkeypatch.setattr(thumbnail.asyncio, "create_subprocess_exec", create)
    task = asyncio.create_task(thumbnail.video_thumbnail(MP4))
    await started.wait()
    task.cancel()
    with pytest.raises(asyncio.CancelledError):
        await task
    assert proc_holder[0].killed and proc_holder[0].reaped


async def test_missing_ffmpeg_and_invalid_input_fail_softly(monkeypatch):
    async def missing(*args, **kwargs):
        raise FileNotFoundError("ffmpeg")

    monkeypatch.setattr(thumbnail.asyncio, "create_subprocess_exec", missing)
    assert await thumbnail.video_thumbnail(MP4) is None
    assert await thumbnail.video_thumbnail(b"") is None
    assert await thumbnail.video_thumbnail(b"x" * (thumbnail.MAX_VIDEO_BYTES + 1)) is None


async def test_rejects_unrecognized_container_without_starting_ffmpeg(monkeypatch):
    async def unexpected(*args, **kwargs):
        raise AssertionError("unsupported formats must be rejected before ffmpeg")

    monkeypatch.setattr(thumbnail.asyncio, "create_subprocess_exec", unexpected)
    assert await thumbnail.video_thumbnail(b"#EXTM3U\nhttps://example.invalid/video.ts") is None
