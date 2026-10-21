"""TEST DOUBLE of TripoSR's run.py CLI. Writes a cube mesh. Not a model."""
import argparse, os, sys, time
import trimesh

p = argparse.ArgumentParser()
p.add_argument("image", nargs="+"); p.add_argument("--output-dir"); p.add_argument("--device")
p.add_argument("--pretrained-model-name-or-path"); p.add_argument("--mc-resolution"); p.add_argument("--foreground-ratio")
p.add_argument("--model-save-format"); p.add_argument("--no-remove-bg", action="store_true")
a = p.parse_args()
mode = os.environ.get("FAKE_TRIPOSR_MODE", "ok")
if mode == "slow":
    time.sleep(30)
if mode == "fail":
    sys.exit(1)
os.makedirs(os.path.join(a.output_dir, "0"), exist_ok=True)
trimesh.creation.box().export(os.path.join(a.output_dir, "0", "mesh.glb"))
print("Running model finished in 1234.50ms", file=sys.stderr)
