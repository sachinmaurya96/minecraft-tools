import numpy as np
import pytest
import trimesh

from app.geometry.cuboids import ConversionParams, convert_mesh, to_bedrock_frame
from app.jobs import TaskError

from .conftest import coloured_box, glb_bytes


def write(tmp_path, data: bytes, name="m.glb"):
    p = tmp_path / name
    p.write_bytes(data)
    return p


def test_single_box_becomes_one_cuboid_with_feet_on_ground(tmp_path):
    out = convert_mesh(write(tmp_path, glb_bytes(coloured_box((1, 2, 1), (5, 7, 9), (10, 200, 10)))), ConversionParams("medium"))
    assert len(out["cubes"]) == 1
    c = out["cubes"][0]
    assert c["origin"][1] == 0  # feet at y = 0
    assert c["size"] == [16.0, 32.0, 16.0]  # longest side = 16 voxels * 2 px
    assert c["origin"][0] == -8 and c["origin"][2] == -8  # centred
    assert c["color"] == "#0ac80a"
    assert out["stats"]["input_watertight"] is True


def test_two_colours_stay_separate_and_in_place(tmp_path):
    bottom = coloured_box((1, 1, 1), (0, 0.5, 0), (255, 0, 0))
    top = coloured_box((1, 1, 1), (0, 1.5, 0), (0, 0, 255))
    out = convert_mesh(write(tmp_path, glb_bytes(bottom, top)), ConversionParams("low"))
    by_colour = {c["color"]: c for c in out["cubes"]}
    assert set(by_colour) == {"#ff0000", "#0000ff"}
    assert by_colour["#ff0000"]["origin"][1] < by_colour["#0000ff"]["origin"][1]


def test_gltf_front_and_right_map_to_bedrock_north_and_negative_x(tmp_path):
    # body + a red "nose" on the glTF front (+Z) + a blue marker on the asset's right (-X in glTF)
    body = coloured_box((1, 1, 1), (0, 0.5, 0), (128, 128, 128))
    nose = coloured_box((0.25, 0.25, 0.5), (0, 0.5, 0.75), (255, 0, 0))
    right = coloured_box((0.5, 0.25, 0.25), (-0.75, 0.5, 0), (0, 0, 255))
    out = convert_mesh(write(tmp_path, glb_bytes(body, nose, right)), ConversionParams("medium", palette_size=4))
    red = [c for c in out["cubes"] if c["color"] == "#ff0000"]
    blue = [c for c in out["cubes"] if c["color"] == "#0000ff"]
    assert red and blue
    # nose must be in front: Bedrock entities face north (-Z)
    assert max(c["origin"][2] + c["size"][2] for c in red) < 0
    # the asset's right side ends up at negative X (entity's right in the Bedrock frame)
    assert max(c["origin"][0] + c["size"][0] for c in blue) < 0


def test_frame_transforms_are_rotations_or_documented_mirror():
    v = np.array([[1.0, 2.0, 3.0]])
    assert to_bedrock_frame(v, "gltf").tolist() == [[1.0, 2.0, -3.0]]
    assert to_bedrock_frame(v, "z-up").tolist() == [[1.0, 3.0, 2.0]]
    with pytest.raises(TaskError):
        to_bedrock_frame(v, "sideways")


def test_sphere_is_bounded_and_closed(tmp_path):
    s = trimesh.creation.icosphere(subdivisions=3)
    out = convert_mesh(write(tmp_path, glb_bytes(s)), ConversionParams("high", max_cubes=512))
    assert 1 < len(out["cubes"]) <= 512
    assert out["stats"]["filled_voxels"] > out["stats"]["visible_voxels"]  # interior was filled
    assert not any("hollow" in w for w in out["warnings"])


def test_open_surface_is_reported_hollow(tmp_path):
    plane = trimesh.Trimesh(vertices=[[0, 0, 0], [1, 0, 0], [1, 1, 0], [0, 1, 0]], faces=[[0, 1, 2], [0, 2, 3]])
    out = convert_mesh(write(tmp_path, plane.export(file_type="obj").encode(), "p.obj"), ConversionParams("low"))
    assert any("hollow" in w for w in out["warnings"])
    assert len(out["cubes"]) >= 1


def test_budget_simplifies_or_fails_with_model_too_complex(tmp_path):
    rng = np.random.default_rng(7)
    boxes = [coloured_box((0.1, 0.1, 0.1), rng.uniform(-1, 1, 3), rng.integers(0, 255, 3)) for _ in range(60)]
    p = write(tmp_path, glb_bytes(*boxes))
    out = convert_mesh(p, ConversionParams("high", max_cubes=200, palette_size=16, min_fragment_ratio=0))
    assert len(out["cubes"]) <= 200
    with pytest.raises(TaskError) as e:
        convert_mesh(p, ConversionParams("high", max_cubes=8, palette_size=16, min_fragment_ratio=0))
    assert e.value.code == "MODEL_TOO_COMPLEX"


def test_small_fragments_are_removed(tmp_path):
    big = coloured_box((1, 1, 1), (0, 0.5, 0), (90, 90, 90))
    speck = coloured_box((0.02, 0.02, 0.02), (3, 3, 3), (255, 255, 0))
    out = convert_mesh(write(tmp_path, glb_bytes(big, speck)), ConversionParams("high", max_cubes=512))
    assert out["stats"]["removed_fragments"] == 1
    assert all(c["color"] != "#ffff00" for c in out["cubes"])


def test_deterministic(tmp_path):
    p = write(tmp_path, glb_bytes(trimesh.creation.icosphere(2), coloured_box((0.5, 2, 0.5), (0, 0, 0), (1, 2, 3))))
    a = convert_mesh(p, ConversionParams("medium"))
    b = convert_mesh(p, ConversionParams("medium"))
    a["stats"].pop("elapsed_s")
    b["stats"].pop("elapsed_s")
    assert a == b


def test_rejects_garbage_and_empty(tmp_path):
    with pytest.raises(TaskError):
        convert_mesh(write(tmp_path, b"not a mesh at all", "x.glb"), ConversionParams())
    with pytest.raises(TaskError):
        convert_mesh(write(tmp_path, b"v 0 0 0\n", "e.obj"), ConversionParams())
