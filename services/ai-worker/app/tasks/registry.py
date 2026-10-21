"""Job types the worker accepts, their parameter schemas and runners."""

from __future__ import annotations

import json
from dataclasses import dataclass
from typing import Any, Callable, Literal

from pydantic import BaseModel, Field, ValidationError

from ..adapters.sking import SkingAdapter
from ..adapters.triposr import TripoSRAdapter
from ..geometry.cuboids import ConversionParams, convert_mesh
from ..jobs import JobContext, Runner, TaskError


class SkingParams(BaseModel):
    model_config = {"extra": "ignore"}


class TripoSRParams(BaseModel):
    model_config = {"extra": "ignore"}
    removeBackground: bool = True
    foregroundRatio: float = Field(0.85, ge=0.5, le=1.0)
    mcResolution: Literal[128, 192, 256] = 192


class MeshToCuboidsParams(BaseModel):
    model_config = {"extra": "ignore"}
    resolution: Literal["low", "medium", "high"] = "medium"
    maxCubes: int = Field(300, ge=8, le=512)
    paletteSize: int = Field(16, ge=2, le=64)
    orientation: Literal["gltf", "z-up", "triposr"] | None = None


@dataclass
class TaskSpec:
    files: dict[str, tuple[str, ...]]  # form field -> allowed stored filenames
    build: Callable[[dict[str, Any], dict[str, str]], Runner]


def make_registry(sking: SkingAdapter, triposr: TripoSRAdapter) -> dict[str, TaskSpec]:
    def sking_runner(params: dict[str, Any], names: dict[str, str]) -> Runner:
        SkingParams.model_validate(params)
        return lambda ctx: sking.run(ctx, ctx.inputs / names["composite"])

    def triposr_runner(params: dict[str, Any], names: dict[str, str]) -> Runner:
        p = TripoSRParams.model_validate(params).model_dump()
        return lambda ctx: triposr.run(ctx, ctx.inputs / names["image"], p)

    def cuboid_runner(params: dict[str, Any], names: dict[str, str]) -> Runner:
        p = MeshToCuboidsParams.model_validate(params)
        source = params.get("source") or {}
        # meshes produced by our TripoSR adapter are in TripoSR's native frame
        orientation = p.orientation or ("triposr" if source.get("kind") == "artifact" else "gltf")

        def run(ctx: JobContext) -> dict[str, Any]:
            ctx.stage("Voxelizing mesh and merging cuboids")
            out = convert_mesh(
                ctx.inputs / names["mesh"],
                ConversionParams(resolution=p.resolution, max_cubes=p.maxCubes, palette_size=p.paletteSize, orientation=orientation),
            )
            ctx.add_artifact("cuboids.json", json.dumps(out).encode())
            return {"stats": out["stats"]}

        return run

    return {
        "sking": TaskSpec({"composite": ("composite.png",)}, sking_runner),
        "triposr": TaskSpec({"image": ("image.png",)}, triposr_runner),
        "mesh_to_cuboids": TaskSpec({"mesh": ("mesh.glb", "mesh.obj")}, cuboid_runner),
    }


def parse_params(raw: str) -> dict[str, Any]:
    try:
        value = json.loads(raw or "{}")
    except ValueError as e:
        raise TaskError("BAD_REQUEST", "params must be JSON") from e
    if not isinstance(value, dict):
        raise TaskError("BAD_REQUEST", "params must be a JSON object")
    return value


__all__ = ["make_registry", "parse_params", "TaskSpec", "ValidationError"]
