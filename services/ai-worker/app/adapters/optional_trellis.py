"""Placeholder status for Microsoft TRELLIS / TRELLIS.2 (PLAN §4.4).

Not integrated in v1: it needs Linux and an NVIDIA GPU with >= 16 GB (TRELLIS)
or >= 24 GB (TRELLIS.2) VRAM and a separate licence/dependency review. This
module only reports that truthfully so it can never be shown as available.
"""

from __future__ import annotations

from .base import ProviderStatus

PROVIDER_ID = "trellis"


def status() -> ProviderStatus:
    return ProviderStatus(
        "disabled",
        "TRELLIS is not integrated in this release (future enhancement; requires Linux and a >=16 GB NVIDIA GPU).",
        "MODEL_NOT_CONFIGURED",
    )
