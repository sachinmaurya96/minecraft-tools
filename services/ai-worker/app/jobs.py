"""In-process job registry: bounded thread pool, per-job scratch directory,
cancellation that kills child processes, timeouts and TTL cleanup.

The Node API is the durable source of truth for user-facing jobs; if this
worker restarts, its jobs are gone and the API marks them failed.
"""

from __future__ import annotations

import logging
import os
import secrets
import shutil
import signal
import subprocess
import threading
import time
from concurrent.futures import ThreadPoolExecutor
from dataclasses import dataclass, field
from pathlib import Path
from typing import Any, Callable

log = logging.getLogger("worker.jobs")


class TaskError(Exception):
    """A task failure with an API error code and a user-safe message."""

    def __init__(self, code: str, message: str):
        super().__init__(message)
        self.code = code
        self.message = message


class Cancelled(Exception):
    pass


@dataclass
class Job:
    id: str
    type: str
    params: dict[str, Any]
    dir: Path
    status: str = "queued"
    stage: str = "Queued"
    error_code: str | None = None
    error_message: str | None = None
    artifacts: list[str] = field(default_factory=list)
    result: dict[str, Any] = field(default_factory=dict)
    created: float = field(default_factory=time.time)
    updated: float = field(default_factory=time.time)
    cancel_event: threading.Event = field(default_factory=threading.Event)
    proc: subprocess.Popen | None = None
    delete_requested: bool = False

    def view(self) -> dict[str, Any]:
        return {
            "id": self.id,
            "type": self.type,
            "status": self.status,
            "stage": self.stage,
            "error_code": self.error_code,
            "error_message": self.error_message,
            "artifacts": list(self.artifacts),
            "result": self.result,
        }


class JobContext:
    """What a task can do: report stages, check cancellation, run bounded subprocesses, emit artifacts."""

    def __init__(self, job: Job):
        self.job = job
        self.inputs = job.dir / "inputs"
        self.outputs = job.dir / "outputs"
        self.work = job.dir / "work"
        for d in (self.inputs, self.outputs, self.work):
            d.mkdir(parents=True, exist_ok=True)

    def stage(self, name: str) -> None:
        self.check_cancelled()
        self.job.stage = name
        self.job.updated = time.time()
        log.info("job %s: %s", self.job.id, name)

    def check_cancelled(self) -> None:
        if self.job.cancel_event.is_set():
            raise Cancelled()

    def run(
        self,
        cmd: list[str],
        timeout_s: float,
        cwd: Path | None = None,
        env: dict[str, str] | None = None,
        log_name: str = "process",
    ) -> subprocess.CompletedProcess[str]:
        """Run a child process with a wall-clock timeout; killed on cancel/timeout. Output is captured to files."""
        self.check_cancelled()
        out_path = self.work / f"{log_name}.stdout.log"
        err_path = self.work / f"{log_name}.stderr.log"
        start = time.time()
        with open(out_path, "w") as out, open(err_path, "w") as err:
            proc = subprocess.Popen(cmd, cwd=cwd, env=env, stdout=out, stderr=err, text=True, start_new_session=True)
            self.job.proc = proc
            try:
                while proc.poll() is None:
                    if self.job.cancel_event.is_set():
                        _kill(proc)
                        raise Cancelled()
                    if time.time() - start > timeout_s:
                        _kill(proc)
                        raise TaskError("JOB_FAILED", f"{log_name} timed out after {int(timeout_s)} s")
                    time.sleep(0.2)
            finally:
                self.job.proc = None
        # cancel() may have killed the process directly: report a cancellation, not a crash
        self.check_cancelled()
        return subprocess.CompletedProcess(cmd, proc.returncode, out_path.read_text(errors="replace"), err_path.read_text(errors="replace"))

    def add_artifact(self, name: str, data: bytes | Path) -> Path:
        if "/" in name or "\\" in name or name.startswith("."):
            raise ValueError("bad artifact name")
        dest = self.outputs / name
        if isinstance(data, Path):
            shutil.copyfile(data, dest)
        else:
            dest.write_bytes(data)
        self.job.artifacts.append(name)
        return dest


def _kill(proc: subprocess.Popen) -> None:
    try:
        os.killpg(proc.pid, signal.SIGKILL)
    except (ProcessLookupError, PermissionError):
        proc.kill()
    proc.wait(timeout=10)


Runner = Callable[[JobContext], dict[str, Any]]


class JobRegistry:
    def __init__(self, data_dir: Path, max_workers: int, ttl_s: int):
        self.root = data_dir / "jobs"
        self.root.mkdir(parents=True, exist_ok=True)
        self.ttl_s = ttl_s
        self.jobs: dict[str, Job] = {}
        self.lock = threading.Lock()
        self.pool = ThreadPoolExecutor(max_workers=max_workers, thread_name_prefix="job")
        self.cleanup_expired()

    def submit(self, job_type: str, params: dict[str, Any], files: dict[str, bytes], runner: Runner) -> Job:
        self.cleanup_expired()
        job_id = secrets.token_urlsafe(16)
        job = Job(id=job_id, type=job_type, params=params, dir=self.root / job_id)
        ctx = JobContext(job)
        for name, data in files.items():
            (ctx.inputs / name).write_bytes(data)
        with self.lock:
            self.jobs[job_id] = job
        self.pool.submit(self._execute, job, ctx, runner)
        return job

    def _execute(self, job: Job, ctx: JobContext, runner: Runner) -> None:
        if job.cancel_event.is_set():
            job.status = "cancelled"
            if job.delete_requested:
                self._remove(job)
            return
        job.status = "running"
        try:
            job.result = runner(ctx) or {}
            ctx.check_cancelled()
            job.status = "ready"
            job.stage = "Done"
        except Cancelled:
            job.status, job.stage = "cancelled", "Cancelled"
        except TaskError as e:
            job.status, job.stage, job.error_code, job.error_message = "failed", "Failed", e.code, e.message
        except Exception:  # noqa: BLE001 - never leak internals to users
            log.exception("job %s crashed", job.id)
            job.status, job.stage, job.error_code = "failed", "Failed", "JOB_FAILED"
            job.error_message = "The worker hit an internal error while processing this job."
        finally:
            job.updated = time.time()
            if job.delete_requested:
                self._remove(job)

    def get(self, job_id: str) -> Job | None:
        with self.lock:
            return self.jobs.get(job_id)

    def cancel(self, job_id: str) -> Job | None:
        job = self.get(job_id)
        if job and job.status in ("queued", "running"):
            job.cancel_event.set()
            if job.proc and job.proc.poll() is None:
                _kill(job.proc)
            if job.status == "queued":
                job.status, job.stage = "cancelled", "Cancelled"
        return job

    def artifact_path(self, job_id: str, name: str) -> Path | None:
        job = self.get(job_id)
        if not job or name not in job.artifacts:
            return None
        p = job.dir / "outputs" / name
        return p if p.is_file() else None

    def _remove(self, job: Job) -> None:
        with self.lock:
            self.jobs.pop(job.id, None)
        shutil.rmtree(job.dir, ignore_errors=True)

    def delete(self, job_id: str) -> None:
        job = self.get(job_id)
        if not job:
            return
        job.delete_requested = True
        self.cancel(job_id)
        if job.status != "running":
            self._remove(job)

    def close(self) -> None:
        for job in list(self.jobs.values()):
            self.cancel(job.id)
        self.pool.shutdown(wait=False, cancel_futures=True)

    def cleanup_expired(self) -> None:
        now = time.time()
        with self.lock:
            stale = [j for j in self.jobs.values() if j.status in ("ready", "failed", "cancelled") and now - j.updated > self.ttl_s]
            for j in stale:
                self.jobs.pop(j.id, None)
        for j in stale:
            shutil.rmtree(j.dir, ignore_errors=True)
        # scratch dirs left behind by a previous process
        for d in self.root.iterdir():
            try:
                if d.is_dir() and d.name not in self.jobs and now - d.stat().st_mtime > self.ttl_s:
                    shutil.rmtree(d, ignore_errors=True)
            except FileNotFoundError:
                pass  # a completed job can delete its scratch concurrently
