from __future__ import annotations

import time
from pathlib import Path

import numpy as np
import pytest
import trimesh
from fastapi.testclient import TestClient

from app.config import Settings
from app.main import create_app

TOKEN = "test-token-" + "x" * 40


def make_settings(tmp_path: Path, **overrides) -> Settings:
    base = dict(
        ai_worker_token=TOKEN,
        worker_data_dir=tmp_path / "data",
        model_cache_dir=tmp_path / "cache",
        sking_dir=tmp_path / "no-sking",
        triposr_dir=tmp_path / "no-triposr",
        triposr_model=str(tmp_path / "no-weights"),
    )
    base.update(overrides)
    return Settings(_env_file=None, **base)


@pytest.fixture
def settings(tmp_path):
    return make_settings(tmp_path)


@pytest.fixture
def client(settings):
    return TestClient(create_app(settings))


AUTH = {"Authorization": f"Bearer {TOKEN}"}


def wait_job(client: TestClient, job_id: str, timeout: float = 60) -> dict:
    start = time.time()
    while time.time() - start < timeout:
        job = client.get(f"/v1/jobs/{job_id}", headers=AUTH).json()
        if job["status"] in ("ready", "failed", "cancelled"):
            return job
        time.sleep(0.05)
    raise AssertionError("job did not finish")


def coloured_box(extents, centre, rgb) -> trimesh.Trimesh:
    m = trimesh.creation.box(extents=extents)
    m.apply_translation(centre)
    m.visual = trimesh.visual.ColorVisuals(m, vertex_colors=np.tile([*rgb, 255], (len(m.vertices), 1)).astype(np.uint8))
    return m


def glb_bytes(*meshes: trimesh.Trimesh) -> bytes:
    scene = trimesh.Scene(list(meshes))
    return scene.export(file_type="glb")
