"""Generate a small, local poster image from downloaded video bytes."""

import asyncio
import base64
import os
import tempfile


MAX_DATA_URI_CHARS = 40_000
DATA_URI_PREFIX = "data:image/jpeg;base64,"
MAX_JPEG_BYTES = ((MAX_DATA_URI_CHARS - len(DATA_URI_PREFIX)) // 4) * 3
MAX_VIDEO_BYTES = 25 * 1024 * 1024
FFMPEG_TIMEOUT_SECONDS = 8
FRAME_WIDTH = 240
_MP4_FTYP = b"ftyp"
_WEBM_EBML = b"\x1a\x45\xdf\xa3"


def _input_format(data: bytes) -> str | None:
    """Recognize the two containers returned by our video acquisition paths."""
    if len(data) >= 8 and data[4:8] == _MP4_FTYP:
        return "mov"  # ISO BMFF (MP4/MOV), decoded by ffmpeg's MOV demuxer.
    if data.startswith(_WEBM_EBML):
        return "matroska"  # WebM uses the Matroska demuxer.
    return None


async def video_thumbnail(video_bytes: bytes) -> str | None:
    """Return a bounded JPEG data URI for the video's first frame, or ``None``.

    The video is written to a temporary file and ffmpeg writes a size-limited JPEG file.
    Both are removed on success, failure, timeout, or task cancellation. No network access
    is performed. A short clip is fine: ffmpeg emits its first decodable frame.
    """
    if not video_bytes or len(video_bytes) > MAX_VIDEO_BYTES:
        return None
    input_format = _input_format(video_bytes)
    if input_format is None:
        return None

    try:
        with tempfile.TemporaryDirectory(prefix="keeps-thumb-") as workdir:
            input_path = os.path.join(workdir, "input.video")
            output_path = os.path.join(workdir, "frame.jpg")
            with open(input_path, "wb") as media:
                media.write(video_bytes)

            proc = None
            try:
                proc = await asyncio.create_subprocess_exec(
                    "ffmpeg", "-hide_banner", "-loglevel", "error",
                    "-protocol_whitelist", "file", "-f", input_format, "-i", input_path,
                    "-frames:v", "1", "-vf", f"scale='min({FRAME_WIDTH},iw)':-2",
                    "-fs", str(MAX_JPEG_BYTES), "-f", "image2", "-c:v", "mjpeg",
                    "-q:v", "12", output_path,
                    stdin=asyncio.subprocess.DEVNULL,
                    stdout=asyncio.subprocess.DEVNULL,
                    stderr=asyncio.subprocess.DEVNULL,
                )
                try:
                    await asyncio.wait_for(proc.wait(), timeout=FFMPEG_TIMEOUT_SECONDS)
                except asyncio.TimeoutError:
                    return None
                if proc.returncode != 0 or not os.path.exists(output_path):
                    return None
                size = os.path.getsize(output_path)
                if size < 4 or size > MAX_JPEG_BYTES:
                    return None
                with open(output_path, "rb") as image:
                    frame = image.read(MAX_JPEG_BYTES + 1)
                if (len(frame) > MAX_JPEG_BYTES or not frame.startswith(b"\xff\xd8")
                        or not frame.endswith(b"\xff\xd9")):
                    return None
                uri = DATA_URI_PREFIX + base64.b64encode(frame).decode("ascii")
                return uri if len(uri) <= MAX_DATA_URI_CHARS else None
            finally:
                # Keep the temp directory alive until ffmpeg is stopped and reaped. This
                # also runs on caller cancellation, before TemporaryDirectory removes files.
                if proc is not None and proc.returncode is None:
                    try:
                        proc.kill()
                    except ProcessLookupError:
                        pass
                    try:
                        await proc.wait()
                    except Exception:
                        pass
    except Exception:
        return None
