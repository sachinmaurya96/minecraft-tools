from __future__ import annotations

import json
import os
import subprocess
from dataclasses import dataclass, field
from typing import Any


@dataclass
class ProviderStatus:
    status: str  # ready | disabled | unavailable | error
    reason: str | None = None
    code: str | None = None  # API error code to use when a job is refused
    details: dict[str, Any] = field(default_factory=dict)

    def as_dict(self) -> dict[str, Any]:
        out: dict[str, Any] = {"status": self.status, "details": self.details}
        if self.reason:
            out["reason"] = self.reason
        if self.code:
            out["code"] = self.code
        return out


def python_ok(path: str) -> bool:
    return bool(path) and os.path.isfile(path) and os.access(path, os.X_OK)


def probe_python(python: str, code: str, cwd: str | None = None, timeout: float = 120) -> dict[str, Any]:
    """Run a short probe script in another interpreter and parse the JSON it prints last."""
    try:
        res = subprocess.run([python, "-c", code], cwd=cwd, capture_output=True, text=True, timeout=timeout)
    except (OSError, subprocess.TimeoutExpired) as e:
        return {"ok": False, "error": type(e).__name__}
    if res.returncode != 0:
        tail = (res.stderr or "").strip().splitlines()[-1:] or [""]
        return {"ok": False, "error": tail[0][:300]}
    try:
        return {"ok": True, **json.loads(res.stdout.strip().splitlines()[-1])}
    except (ValueError, IndexError):
        return {"ok": False, "error": "probe printed no JSON"}


TORCH_PROBE = (
    "import json, platform, torch\n"
    "cuda = torch.cuda.is_available()\n"
    "mps = bool(getattr(torch.backends, 'mps', None) and torch.backends.mps.is_available())\n"
    "print(json.dumps({'torch': torch.__version__, 'cuda': cuda, 'cuda_version': torch.version.cuda,"
    " 'gpu': torch.cuda.get_device_name(0) if cuda else None,"
    " 'vram_gb': round(torch.cuda.get_device_properties(0).total_memory / 2**30, 1) if cuda else None,"
    " 'mps': mps, 'platform': platform.platform(), 'python': platform.python_version()}))\n"
)
