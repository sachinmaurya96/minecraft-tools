"""TEST DOUBLE of the Sking launcher CLI. Produces a flat 64x64 RGBA PNG. Not a model."""
import argparse, hashlib, json, os, sys
from PIL import Image

p = argparse.ArgumentParser()
p.add_argument("--input"); p.add_argument("--output")
p.add_argument("--parser-python"); p.add_argument("--foreground-python")
p.add_argument("--verify-only", action="store_true")
a = p.parse_args()
mode = os.environ.get("FAKE_SKING_MODE", "ok")
if a.verify_only:
    print(json.dumps({"verified_files": 1, "model_version": "SKING_DDJ_v101c"})); sys.exit(0)
if mode == "fail":
    print("simulated failure", file=sys.stderr); sys.exit(3)
size = (32, 32) if mode == "small" else (64, 64)
Image.new("RGBA", size, (120, 80, 40, 255)).save(a.output)
digest = hashlib.sha256(open(a.output, "rb").read()).hexdigest()
print(json.dumps({"model_version": "SKING_DDJ_v101c", "output": a.output, "sha256": "0" * 64 if mode == "badsha" else digest}))
