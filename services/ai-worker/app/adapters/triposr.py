"""TripoSR adapter (single image -> generic triangle mesh).

Runs the official repository's `run.py` as a subprocess from an isolated
virtualenv (TRIPOSR_PYTHON), with locally downloaded weights and HF offline
mode. The mesh it returns is NOT a Minecraft model; it only becomes one after
mesh_to_cuboids conversion and the API's Bedrock validator.
"""

from __future__ import annotations

import os
import re
import sys
import time
from pathlib import Path
from typing import Any

import trimesh

from ..config import Settings
from ..jobs import JobContext, TaskError
from ..preprocessing.images import open_checked
from .base import ProviderStatus, probe_python, python_ok

PROVIDER_ID = "triposr"

IMPORT_PROBE = (
    "import json, torch, rembg, xatlas, trimesh\n"
    "from tsr.system import TSR\n"
    "import torchmcubes\n"
    "cuda = torch.cuda.is_available()\n"
    "print(json.dumps({'torch': torch.__version__, 'cuda': cuda,"
    " 'gpu': torch.cuda.get_device_name(0) if cuda else None, 'trimesh': trimesh.__version__}))\n"
)

TIMER_RE = re.compile(r"(Initializing model|Processing images|Running model|Extracting mesh|Exporting mesh) finished in ([0-9.]+)ms")


class TripoSRAdapter:
    def __init__(self, settings: Settings):
        self.s = settings
        self._probe: dict[str, Any] | None = None

    @property
    def weights(self) -> Path:
        p = Path(self.s.triposr_model)
        return p if p.is_absolute() else (Path(__file__).resolve().parents[2] / p).resolve()

    def diagnose(self) -> ProviderStatus:
        details: dict[str, Any] = {"platform": sys.platform}
        repo = self.s.triposr_dir
        if not (repo / "run.py").is_file() or not (repo / "tsr" / "system.py").is_file():
            return ProviderStatus("unavailable", "The official TripoSR repository is not installed on the worker.", "MODEL_NOT_CONFIGURED", details)
        if not python_ok(self.s.triposr_python):
            return ProviderStatus("unavailable", "The TripoSR Python environment is not configured on the worker.", "MODEL_NOT_CONFIGURED", details)
        if not ((self.weights / "config.yaml").is_file() and (self.weights / "model.ckpt").is_file()):
            return ProviderStatus("unavailable", "TripoSR weights are not downloaded on the worker.", "MODEL_NOT_CONFIGURED", details)
        if self._probe is None:
            self._probe = probe_python(self.s.triposr_python, IMPORT_PROBE, cwd=str(repo), timeout=300)
        details["runtime"] = self._probe
        if not self._probe.get("ok"):
            return ProviderStatus("error", "TripoSR dependencies failed to import in its environment.", "MODEL_NOT_CONFIGURED", details)
        details["device"] = self.device()
        return ProviderStatus("ready", None, None, details)

    def device(self) -> str:
        if self.s.triposr_device in ("cpu", "cuda:0"):
            return self.s.triposr_device
        return "cuda:0" if (self._probe or {}).get("cuda") else "cpu"

    def status(self) -> ProviderStatus:
        if not self.s.enable_triposr:
            return ProviderStatus("disabled", "Disabled on the worker (ENABLE_TRIPOSR=false).", "MODEL_NOT_CONFIGURED")
        return self.diagnose()

    def run(self, ctx: JobContext, image: Path, params: dict[str, Any]) -> dict[str, Any]:
        ctx.stage("Checking image")
        w, h = open_checked(image)
        st = self.status()
        if st.status != "ready":
            raise TaskError(st.code or "MODEL_NOT_CONFIGURED", st.reason or "TripoSR is not available.")
        out_dir = ctx.work / "triposr"
        cmd = [
            self.s.triposr_python,
            str(self.s.triposr_dir / "run.py"),
            str(image),
            "--output-dir",
            str(out_dir),
            "--model-save-format",
            "glb",
            "--pretrained-model-name-or-path",
            str(self.weights),
            "--mc-resolution",
            str(int(params.get("mcResolution", 192))),
            "--foreground-ratio",
            str(float(params.get("foregroundRatio", 0.85))),
            "--device",
            self.device(),
        ]
        if not params.get("removeBackground", True):
            cmd.append("--no-remove-bg")
        env = {
            **os.environ,
            "HF_HUB_OFFLINE": "1",
            "U2NET_HOME": str(self.s.model_cache_dir / "u2net"),
            "PYTHONUNBUFFERED": "1",
        }
        ctx.stage(f"Running TripoSR on {self.device()} (model load + reconstruction)")
        start = time.time()
        res = ctx.run(cmd, self.s.triposr_timeout_s, cwd=self.s.triposr_dir, env=env, log_name="triposr")
        elapsed = round(time.time() - start, 1)
        if res.returncode != 0:
            raise TaskError("JOB_FAILED", f"TripoSR exited with code {res.returncode}.")
        mesh_path = out_dir / "0" / "mesh.glb"
        if not mesh_path.is_file():
            raise TaskError("JOB_FAILED", "TripoSR did not write a mesh.")
        ctx.stage("Validating mesh")
        try:
            mesh = trimesh.load(mesh_path, force="mesh")
        except Exception as e:  # noqa: BLE001
            raise TaskError("JOB_FAILED", "TripoSR wrote an unreadable mesh.") from e
        if len(mesh.faces) == 0:
            raise TaskError("JOB_FAILED", "TripoSR produced an empty mesh (the foreground may not have been found).")
        ctx.add_artifact("mesh.glb", mesh_path)
        processed = out_dir / "0" / "input.png"
        if processed.is_file():
            ctx.add_artifact("input.png", processed)
        timings = {m.group(1): round(float(m.group(2)) / 1000, 2) for m in TIMER_RE.finditer(res.stderr + res.stdout)}
        return {
            "elapsed_s": elapsed,
            "device": self.device(),
            "input_px": [w, h],
            "vertices": int(len(mesh.vertices)),
            "faces": int(len(mesh.faces)),
            "watertight": bool(mesh.is_watertight),
            "has_vertex_colors": mesh.visual.kind == "vertex",
            "timings_s": timings,
            "mc_resolution": int(params.get("mcResolution", 192)),
        }
