# Test doubles (tests only)

These scripts imitate the _command-line contracts_ of the official Sking
launcher (`SKING_DDJ_v101c/infer.py`) and TripoSR `run.py` so the worker's
subprocess handling, validation and error paths can be tested without a GPU.
They contain no model and produce trivial outputs. They are only referenced from
`tests/`, never from `app/` or any configuration, and must never be used as a
provider in a deployment.
