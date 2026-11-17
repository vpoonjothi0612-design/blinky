"""AI Services Main API Entrypoint (FastAPI + Uvicorn).

Run with uvicorn CLI:
    uvicorn src.main:app --host 127.0.0.1 --port 8000 --reload

Or run directly with Python:
    python src/main.py
"""

from __future__ import annotations

import sys
import os
import json
import signal
import subprocess
import asyncio
import time
from pathlib import Path

# Ensure src is on sys.path
_CURRENT_DIR = Path(__file__).resolve().parent
if str(_CURRENT_DIR) not in sys.path:
    sys.path.insert(0, str(_CURRENT_DIR))

# Import consolidated FastAPI app (contains both Vehicle and Face endpoints)
from vehicle.vehicle_api import app

AI_ROOT = Path(__file__).resolve().parents[1]
LIVE_WORKER = AI_ROOT / "src" / "face" / "dual_camera_live_face_recognition.py"
STATUS_FILE = AI_ROOT / "data" / "ai_camera_status.json"
_live_worker_process = None
_live_worker_monitor_task = None
_live_worker_started_at = 0.0
_LIVE_WORKER_STARTUP_GRACE_SECONDS = 90.0
_LIVE_WORKER_MONITOR_INTERVAL_SECONDS = 5.0


def _worker_heartbeat_is_live() -> bool:
    try:
        status = json.loads(STATUS_FILE.read_text(encoding="utf-8"))
        pid = int(status.get("pid") or 0)
        updated_at = status.get("updated_at")
        if not pid or not updated_at or status.get("status") != "RUNNING":
            return False
        from datetime import datetime, timezone
        age = (datetime.now(timezone.utc) - datetime.fromisoformat(updated_at)).total_seconds()
        if age > 15:
            return False
        os.kill(pid, 0)
        return True
    except (OSError, ValueError, TypeError, json.JSONDecodeError):
        return False


def _launch_live_camera_worker() -> bool:
    """Launch the standalone camera/MJPEG worker if no healthy worker exists."""
    global _live_worker_process, _live_worker_started_at
    if _worker_heartbeat_is_live():
        return False
    if _live_worker_process is not None and _live_worker_process.poll() is None:
        return False

    try:
        _live_worker_process = subprocess.Popen(
            [sys.executable, str(LIVE_WORKER), "--no-gui"],
            cwd=str(AI_ROOT),
            stdin=subprocess.DEVNULL,
        )
        _live_worker_started_at = time.monotonic()
        print(f"[LiveWorker] Started dual-camera worker (pid={_live_worker_process.pid}).")
        return True
    except OSError as exc:
        print(f"[LiveWorker] Could not start camera worker: {exc}")
        return False


async def _monitor_live_camera_worker() -> None:
    """Restart the camera worker if it exits or stops updating its heartbeat."""
    while True:
        await asyncio.sleep(_LIVE_WORKER_MONITOR_INTERVAL_SECONDS)
        if os.environ.get("AI_LIVE_WORKER_ENABLED", "true").strip().lower() not in {"1", "true", "yes"}:
            return
        if _worker_heartbeat_is_live():
            continue

        if _live_worker_process is not None and _live_worker_process.poll() is None:
            if time.monotonic() - _live_worker_started_at < _LIVE_WORKER_STARTUP_GRACE_SECONDS:
                continue
            print("[LiveWorker] Camera heartbeat is stale; restarting the camera worker.")
            _stop_live_worker(timeout=8)

        _launch_live_camera_worker()


@app.on_event("startup")
async def start_live_camera_worker():
    """Start and supervise the standalone camera/MJPEG worker."""
    global _live_worker_monitor_task
    if os.environ.get("AI_LIVE_WORKER_ENABLED", "true").strip().lower() not in {"1", "true", "yes"}:
        print("[LiveWorker] Automatic camera worker start is disabled.")
        return
    if not _launch_live_camera_worker():
        print("[LiveWorker] Camera worker is already running or starting.")
    _live_worker_monitor_task = asyncio.create_task(_monitor_live_camera_worker())


def _stop_live_worker(timeout: float = 8) -> None:
    global _live_worker_process
    if _live_worker_process is not None and _live_worker_process.poll() is None:
        _live_worker_process.send_signal(signal.SIGTERM)
        try:
            _live_worker_process.wait(timeout=timeout)
        except subprocess.TimeoutExpired:
            _live_worker_process.kill()
            _live_worker_process.wait(timeout=3)
        print("[LiveWorker] Camera worker stopped.")
    _live_worker_process = None


@app.on_event("shutdown")
async def stop_live_camera_worker():
    global _live_worker_monitor_task
    if _live_worker_monitor_task is not None:
        _live_worker_monitor_task.cancel()
        try:
            await _live_worker_monitor_task
        except asyncio.CancelledError:
            pass
        _live_worker_monitor_task = None
    _stop_live_worker(timeout=8)

__all__ = ["app"]


if __name__ == "__main__":
    import argparse
    import uvicorn

    parser = argparse.ArgumentParser(description="FaceDetect AI API")
    parser.add_argument("--dev", action="store_true", help="Enable Uvicorn auto-reload for development")
    args = parser.parse_args()

    print("==================================================")
    print("Starting AI Services API Server (Uvicorn)")
    print("API Documentation: http://127.0.0.1:8000/docs")
    print("Health Check     : http://127.0.0.1:8000/health")
    print("==================================================")
    if args.dev:
        uvicorn.run("src.main:app", host="0.0.0.0", port=8000, reload=True)
    else:
        uvicorn.run(app, host="0.0.0.0", port=8000, reload=False)
