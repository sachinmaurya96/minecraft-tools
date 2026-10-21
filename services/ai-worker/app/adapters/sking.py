"""Sking SKING_DDJ_v101c adapter (render -> 64x64 skin UV).

Uses ONLY the official bundled launcher `SKING_DDJ_v101c/infer.py` (never the
obsolete root infer.py or an invented endpoint). Published run target: Linux +
NVIDIA CUDA + Python 3.12. The launcher itself verifies every bundled file,
the output provenance and the 64x64 RGBA result; we check again.
"""

from __future__ import annotations

import hashlib
import json
import subprocess
import sys
import threading
import time
from pathlib import Path
from typing import Any

from PIL import Image

from ..config import Settings
from ..jobs import JobContext, TaskError
from ..preprocessing.images import open_checked
from .base import TORCH_PROBE, ProviderStatus, probe_python, python_ok

PROVIDER_ID = "sking-v101c"
MODEL_VERSION = "SKING_DDJ_v101c"


def check_composite(path: Path) -> tuple[int, int]:
    """Sking input rule (from its README/launcher): an even square image 256-4096 px wide."""
    w, h = open_checked(path, max_pixels=4096 * 4096)
    if w != h or w < 256 or w > 4096 or w % 2:
        raise TaskError("BAD_IMAGE", f"Sking needs an even, square composite between 256 and 4096 px; got {w}x{h}.")
    return w, h


def sha256_file(path: Path) -> str:
    h = hashlib.sha256()
    with path.open("rb") as f:
        for block in iter(lambda: f.read(4 << 20), b""):
            h.update(block)
    return h.hexdigest()


class SkingAdapter:
    def __init__(self, settings: Settings):
        self.s = settings
        self._lock = threading.Lock()
        self._verify: tuple[int, dict[str, Any]] | None = None  # (release.json mtime_ns, result)
        self._torch: dict[str, dict[str, Any]] = {}

    @property
    def launcher(self) -> Path:
        return self.s.sking_dir / "infer.py"

    def bundle_present(self) -> bool:
        return self.launcher.is_file() and (self.s.sking_dir / "release.json").is_file()

    def verify(self) -> dict[str, Any]:
        """Run the official `--verify-only` (stdlib only: works on any OS). Cached until release.json changes."""
        release = self.s.sking_dir / "release.json"
        mtime = release.stat().st_mtime_ns
        with self._lock:
            if self._verify and self._verify[0] == mtime:
                return self._verify[1]
        python = self.s.sking_parser_python if python_ok(self.s.sking_parser_python) else sys.executable
        start = time.time()
        try:
            res = subprocess.run([python, str(self.launcher), "--verify-only"], cwd=self.s.sking_dir, capture_output=True, text=True, timeout=900)
            out: dict[str, Any] = {"ok": res.returncode == 0, "elapsed_s": round(time.time() - start, 2)}
            if res.returncode == 0:
                out.update(json.loads(res.stdout.strip().splitlines()[-1]))
            else:
                out["error"] = ((res.stderr or "").strip().splitlines() or ["verify failed"])[-1][:300]
        except Exception as e:  # noqa: BLE001
            out = {"ok": False, "error": type(e).__name__}
        with self._lock:
            self._verify = (mtime, out)
        return out

    def torch_info(self, python: str) -> dict[str, Any]:
        if python not in self._torch:
            self._torch[python] = probe_python(python, TORCH_PROBE)
        return self._torch[python]

    def diagnose(self) -> ProviderStatus:
        """All checks, ignoring ENABLE_SKING (used by status() and /v1/diagnostics)."""
        details: dict[str, Any] = {"model_version": MODEL_VERSION, "platform": sys.platform}
        if not self.bundle_present():
            return ProviderStatus("unavailable", "The Sking SKING_DDJ_v101c bundle is not installed on the worker.", "MODEL_NOT_CONFIGURED", details)
        v = self.verify()
        details["verify_only"] = v
        if not v.get("ok"):
            return ProviderStatus("error", "The Sking bundle failed its official integrity check (--verify-only).", "MODEL_NOT_CONFIGURED", details)
        if not (python_ok(self.s.sking_parser_python) and python_ok(self.s.sking_foreground_python)):
            return ProviderStatus(
                "unavailable",
                "Sking's parser/foreground Python environments (CUDA PyTorch) are not configured on the worker.",
                "MODEL_NOT_CONFIGURED",
                details,
            )
        t = self.torch_info(self.s.sking_parser_python)
        details["torch"] = t
        if not t.get("ok"):
            return ProviderStatus("unavailable", "PyTorch could not be imported in the Sking parser environment.", "MODEL_NOT_CONFIGURED", details)
        if not t.get("cuda"):
            return ProviderStatus(
                "unavailable",
                "Sking requires an NVIDIA CUDA GPU (its runtime hard-codes CUDA); this worker has none.",
                "GPU_UNAVAILABLE",
                details,
            )
        return ProviderStatus("ready", None, None, details)

    def status(self) -> ProviderStatus:
        if not self.s.enable_sking:
            return ProviderStatus("disabled", "Disabled on the worker (ENABLE_SKING=false).", "MODEL_NOT_CONFIGURED")
        return self.diagnose()

    def run(self, ctx: JobContext, composite: Path) -> dict[str, Any]:
        ctx.stage("Checking composite")
        w, _ = check_composite(composite)
        st = self.status()
        if st.status != "ready":
            raise TaskError(st.code or "MODEL_NOT_CONFIGURED", st.reason or "Sking is not available.")
        out = ctx.work / "sking_result.png"
        cmd = [
            self.s.sking_parser_python,
            str(self.launcher),
            "--parser-python",
            self.s.sking_parser_python,
            "--foreground-python",
            self.s.sking_foreground_python,
            "--input",
            str(composite),
            "--output",
            str(out),
        ]
        ctx.stage("Running Sking (foreground, parser, inpainting)")
        start = time.time()
        res = ctx.run(cmd, self.s.sking_timeout_s, cwd=self.s.sking_dir, log_name="sking")
        elapsed = round(time.time() - start, 1)
        if res.returncode != 0:
            raise TaskError("JOB_FAILED", f"The Sking launcher exited with code {res.returncode}. The composite may not match the expected layout.")
        ctx.stage("Validating output")
        try:
            report = json.loads(res.stdout.strip().splitlines()[-1])
        except (ValueError, IndexError) as e:
            raise TaskError("JOB_FAILED", "The Sking launcher did not report its result.") from e
        if report.get("model_version") != MODEL_VERSION or not out.is_file() or report.get("sha256") != sha256_file(out):
            raise TaskError("JOB_FAILED", "Sking output provenance check failed.")
        with Image.open(out) as im:
            if im.size != (64, 64) or im.mode != "RGBA" or not im.getchannel("A").getbbox():
                raise TaskError("JOB_FAILED", "Sking did not produce a valid 64x64 RGBA skin.")
        ctx.add_artifact("skin.png", out)
        t = self.torch_info(self.s.sking_parser_python)
        return {
            "model_version": MODEL_VERSION,
            "sha256": report["sha256"],
            "elapsed_s": elapsed,
            "input_px": w,
            "gpu": t.get("gpu"),
            "torch": t.get("torch"),
            "cuda_version": t.get("cuda_version"),
        }
