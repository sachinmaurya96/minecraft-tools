"""Bounded image decoding for worker inputs (decompression-bomb safe)."""

from __future__ import annotations

from pathlib import Path

from PIL import Image

from ..jobs import TaskError


def open_checked(path: Path, max_pixels: int = 50_000_000) -> tuple[int, int]:
    """Fully decode once to catch truncated/corrupt files; return (width, height)."""
    Image.MAX_IMAGE_PIXELS = max_pixels
    try:
        with Image.open(path) as im:
            im.verify()
        with Image.open(path) as im:
            im.load()
            return im.size
    except Image.DecompressionBombError as e:
        raise TaskError("IMAGE_TOO_LARGE", "The image has too many pixels.") from e
    except Exception as e:  # noqa: BLE001
        raise TaskError("BAD_IMAGE", "The image could not be decoded.") from e
