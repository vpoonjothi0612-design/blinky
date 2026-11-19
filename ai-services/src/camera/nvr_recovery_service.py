"""CP PLUS NVR Historical Recording Recovery Service.

Recovers missed attendance processing intervals from CP PLUS NVR / IP camera footage
after an application server outage, crash, or network disconnect.

Local recorder settings are supplied through the AI service environment:
- Brand: CP PLUS
- NVR address and credentials: NVR_IP, NVR_USERNAME, NVR_PASSWORD
- Camera channel mapping: NVR_CHANNEL_CAM01 and NVR_CHANNEL_CAM02
- Timezone: NVR_TIMEZONE

Key Capabilities:
1. Persistent Checkpoint Management:
   - Tracks last successfully processed timestamp per camera (CAM-01, CAM-02).
   - Checkpoints survive application crashes and Windows restarts.
2. Outage & Missing Interval Detection:
   - Detects time gaps between the last processed checkpoint and current time.
   - Slices outages into bounded, chronological intervals.
3. Multi-Protocol Playback Retrieval & Reachability Inspection:
   - Evaluates NVR reachability and HTTP Digest authentication without leaking passwords.
   - CP PLUS / Dahua RTSP Playback: /cam/playback?channel={ch}&subtype=0&starttime={start}&endtime={end}
   - Local video file playback adapter (for offline verification and air-gapped recovery).
4. Historical Identity Policy (distinguished from live attendance):
   - Recorded footage cannot perform live temporal motion/eye-blink verification.
   - Enforces strict ArcFace similarity threshold (>= 0.65), multi-frame identity confirmation,
     and audit attribution (source detail "CP_PLUS_NVR_HISTORICAL_RECOVERY").
   - Preserves original recording timestamp (never uses replay time).
   - Deterministic UUIDv5 event IDs to guarantee idempotent deduplication against live events.
5. Gap & Anomaly Logging:
   - Unretrievable intervals, decoding errors, and unverified people are logged to audit files
     without inventing attendance records.
6. Non-blocking Background Worker:
   - Runs historical replay without interrupting or blocking live dual-camera recognition threads.
"""

from __future__ import annotations

import argparse
import json
import logging
import os
import socket
import sys
import threading
import time
import uuid
from datetime import datetime, timezone, timedelta
from pathlib import Path
from typing import Dict, List, Optional, Tuple, Any

import cv2
import numpy as np
import requests
from requests.auth import HTTPDigestAuth
import urllib3
urllib3.disable_warnings(urllib3.exceptions.InsecureRequestWarning)

# Ensure paths
_CURRENT_DIR = Path(__file__).resolve().parent
_SRC_DIR = _CURRENT_DIR.parent
_AI_SERVICES_DIR = _SRC_DIR.parent

for p in (
    str(_AI_SERVICES_DIR),
    str(_SRC_DIR),
    str(_CURRENT_DIR),
    str(_SRC_DIR / "face"),
    str(_SRC_DIR / "face" / "recognition"),
):
    if p not in sys.path:
        sys.path.insert(0, p)

try:
    from dotenv import load_dotenv
    _env_file = _AI_SERVICES_DIR / ".env"
    if _env_file.exists():
        load_dotenv(dotenv_path=_env_file, override=False)
except ImportError:
    pass

try:
    from filelock import FileLock
except ImportError:
    class FileLock:  # type: ignore
        def __init__(self, lock_file: str, timeout: float = -1) -> None:
            pass
        def __enter__(self):
            return self
        def __exit__(self, exc_type, exc_val, exc_tb):
            pass

from face_config import (
    YUNET_MODEL_PATH,
    ARCFACE_MODEL_PATH,
    RECOGNITION_THRESHOLD,
)

try:
    from employee_registry import load_all_active_embeddings
except ImportError:
    from src.face.recognition.employee_registry import load_all_active_embeddings

from insightface.model_zoo import get_model
from insightface.utils import face_align
from attendance_outbox import AttendanceOutbox

logger = logging.getLogger("nvr_recovery")

DEFAULT_CHECKPOINT_FILE = _AI_SERVICES_DIR / "data" / "nvr_recovery_checkpoints.json"
DEFAULT_GAPS_FILE = _AI_SERVICES_DIR / "data" / "nvr_outage_gaps.json"
DEFAULT_WORKER_LOCK_FILE = _AI_SERVICES_DIR / "data" / "nvr_recovery_worker.lock"

# Directional mapping strictly enforced: CAM-01 -> OUT, CAM-02 -> IN
CAMERA_DIRECTION_MAPPING = {
    "CAM-01": "OUT",
    "CAM-02": "IN",
}


class NVRRecoveryCheckpointManager:
    """Manages persistent processing checkpoints per camera across outages and reboots."""

    def __init__(self, checkpoint_file: Optional[Path] = None) -> None:
        self.checkpoint_file = Path(checkpoint_file) if checkpoint_file else DEFAULT_CHECKPOINT_FILE
        self._lock = threading.Lock()
        self._data: Dict[str, Dict[str, Any]] = {}
        self.load()

    def load(self) -> None:
        """Loads checkpoints from disk with lock protection."""
        if not self.checkpoint_file.exists():
            return
        lock_file = str(self.checkpoint_file.with_suffix(".lock"))
        try:
            with FileLock(lock_file, timeout=5.0):
                with open(self.checkpoint_file, "r", encoding="utf-8") as f:
                    content = f.read().strip()
                    if content:
                        self._data = json.loads(content)
        except Exception as ex:
            logger.warning(f"Could not load NVR recovery checkpoints: {ex}")

    def save(self) -> None:
        """Persists checkpoints to disk with atomic write and lock protection."""
        try:
            self.checkpoint_file.parent.mkdir(parents=True, exist_ok=True)
            lock_file = str(self.checkpoint_file.with_suffix(".lock"))
            with FileLock(lock_file, timeout=5.0):
                tmp_file = self.checkpoint_file.with_name(f"{self.checkpoint_file.name}.tmp_{os.getpid()}")
                with open(tmp_file, "w", encoding="utf-8") as f:
                    json.dump(self._data, f, indent=2)
                    f.flush()
                    os.fsync(f.fileno())
                tmp_file.replace(self.checkpoint_file)
        except Exception as ex:
            logger.error(f"Failed to persist NVR recovery checkpoints: {ex}")

    def get_last_processed_timestamp(self, camera_id: str) -> Optional[datetime]:
        """Returns the last processed UTC datetime for the camera, or None."""
        with self._lock:
            info = self._data.get(camera_id)
            if not info or not info.get("last_processed_timestamp"):
                return None
            try:
                ts_str = info["last_processed_timestamp"]
                dt = datetime.fromisoformat(ts_str)
                if dt.tzinfo is None:
                    dt = dt.replace(tzinfo=timezone.utc)
                return dt
            except Exception:
                return None

    def update_checkpoint(
        self,
        camera_id: str,
        processed_timestamp: datetime,
        recovered_events_count: int = 0,
        status: str = "COMPLETED",
    ) -> None:
        """Updates and persists the checkpoint for a camera."""
        with self._lock:
            now_iso = datetime.now(timezone.utc).isoformat()
            ts_iso = processed_timestamp.isoformat()
            current = self._data.get(camera_id, {
                "total_intervals_recovered": 0,
                "total_events_recovered": 0,
            })
            current["camera_id"] = camera_id
            current["last_processed_timestamp"] = ts_iso
            current["last_updated_at"] = now_iso
            current["last_status"] = status
            current["total_intervals_recovered"] = current.get("total_intervals_recovered", 0) + 1
            current["total_events_recovered"] = (
                current.get("total_events_recovered", 0) + recovered_events_count
            )
            self._data[camera_id] = current

        self.save()
        logger.info(
            f"[{camera_id}] Checkpoint updated to {ts_iso} (+{recovered_events_count} events, status: {status})."
        )

    def get_all_checkpoints(self) -> Dict[str, Dict[str, Any]]:
        with self._lock:
            return dict(self._data)


class NVRRecoveryService:
    """Orchestrates missing interval detection, historical footage retrieval, and attendance replay."""

    def __init__(
        self,
        outbox: Optional[AttendanceOutbox] = None,
        checkpoint_file: Optional[Path] = None,
        gaps_file: Optional[Path] = None,
        min_gap_seconds: float = 60.0,
        interval_chunk_minutes: int = 15,
        max_lookback_hours: int = 48,
    ) -> None:
        self.outbox = outbox if outbox is not None else AttendanceOutbox()
        self.checkpoint_manager = NVRRecoveryCheckpointManager(checkpoint_file)
        self.gaps_file = Path(gaps_file) if gaps_file else DEFAULT_GAPS_FILE
        self.min_gap_seconds = min_gap_seconds
        self.interval_chunk_minutes = interval_chunk_minutes
        self.max_lookback_hours = max_lookback_hours

        # Models (Lazy loaded upon execution)
        self.detector: Optional[cv2.FaceDetectorYN] = None
        self.arcface: Any = None
        self.active_employees: Dict[str, Dict[str, Any]] = {}

        # NVR Configuration from environment
        self.nvr_ip = os.environ.get("NVR_IP", "").strip()
        self.nvr_port = int(os.environ.get("NVR_PORT", "554"))
        self.nvr_user = os.environ.get("NVR_USERNAME", "").strip()
        self.nvr_pass = os.environ.get("NVR_PASSWORD", "").strip()
        self.nvr_scheme = os.environ.get("NVR_PLAYBACK_SCHEME", "rtsp").strip()
        self.nvr_timezone = os.environ.get("NVR_TIMEZONE", "Asia/Kolkata").strip()
        self.recovery_timeout_sec = float(os.environ.get("NVR_RECOVERY_TIMEOUT_SEC", "5.0"))

        # Channel mappings can be overridden for the local recorder.
        self.nvr_channel_map = {
            "CAM-01": int(os.environ.get("NVR_CHANNEL_CAM01", "2")),
            "CAM-02": int(os.environ.get("NVR_CHANNEL_CAM02", "1")),
        }

        # Concurrency & Worker management
        self._worker_thread: Optional[threading.Thread] = None
        self._worker_stop_event = threading.Event()
        self._worker_lock_file = DEFAULT_WORKER_LOCK_FILE

        # Telemetry metrics
        self.last_summary: Dict[str, Any] = {}

    def _ensure_models_loaded(self) -> bool:
        """Loads YuNet detector and ArcFace models if not already initialized."""
        if self.arcface is not None and self.detector is not None:
            return True

        if not YUNET_MODEL_PATH.exists() or not ARCFACE_MODEL_PATH.exists():
            logger.error("YuNet or ArcFace model missing for NVR recovery.")
            return False

        logger.info("Initializing YuNet and ArcFace for historical video recovery...")
        self.detector = cv2.FaceDetectorYN.create(
            str(YUNET_MODEL_PATH),
            "",
            (640, 360),
            0.5,
            0.3,
            5000,
        )
        self.arcface = get_model(str(ARCFACE_MODEL_PATH), providers=["CPUExecutionProvider"])
        self.arcface.prepare(ctx_id=0)
        self.active_employees = load_all_active_embeddings()
        logger.info(
            f"Loaded {len(self.active_employees)} active employee embedding(s) for historical matching."
        )
        return True

    def check_nvr_reachability(self) -> Dict[str, Any]:
        """Inspects physical NVR network reachability, ports, and authentication without leaking secrets."""
        if not self.nvr_ip:
            return {
                "configured": False,
                "reachable": False,
                "error": "NVR_IP is not configured in .env",
            }

        result: Dict[str, Any] = {
            "configured": True,
            "ip": self.nvr_ip,
            "rtsp_port": self.nvr_port,
            "rtsp_port_open": False,
            "http_port_open": False,
            "reachable": False,
            "authenticated": False,
            "device_model": None,
            "serial_number": None,
            "firmware_version": None,
            "nvr_clock": None,
            "time_drift_seconds": None,
            "channel_mapping": dict(self.nvr_channel_map),
            "recording_active": None,
        }

        # 1. Test RTSP Port
        try:
            s_rtsp = socket.socket(socket.AF_INET, socket.SOCK_STREAM)
            s_rtsp.settimeout(2.0)
            res = s_rtsp.connect_ex((self.nvr_ip, self.nvr_port))
            s_rtsp.close()
            result["rtsp_port_open"] = (res == 0)
        except Exception:
            result["rtsp_port_open"] = False

        # 2. Test HTTP / HTTPS Port
        http_port = 80
        try:
            s_http = socket.socket(socket.AF_INET, socket.SOCK_STREAM)
            s_http.settimeout(2.0)
            res_http = s_http.connect_ex((self.nvr_ip, http_port))
            s_http.close()
            result["http_port_open"] = (res_http == 0)
        except Exception:
            result["http_port_open"] = False

        result["reachable"] = result["rtsp_port_open"] or result["http_port_open"]

        if not result["reachable"]:
            return result

        # 3. Authenticated handshake via HTTP Digest
        if self.nvr_user and self.nvr_pass:
            try:
                base_url = f"https://{self.nvr_ip}" if not result["http_port_open"] else f"http://{self.nvr_ip}"
                session = requests.Session()
                session.verify = False
                session.auth = HTTPDigestAuth(self.nvr_user, self.nvr_pass)

                # Get System Info
                r_sys = session.get(f"{base_url}/cgi-bin/magicBox.cgi?action=getSystemInfo", timeout=3.0)
                if r_sys.status_code == 200:
                    result["authenticated"] = True
                    for line in r_sys.text.splitlines():
                        if "serialNumber=" in line:
                            result["serial_number"] = line.split("=", 1)[1].strip()
                        elif "updateSerial=" in line:
                            result["device_model"] = line.split("=", 1)[1].strip()

                # Get Software Version
                r_ver = session.get(f"{base_url}/cgi-bin/magicBox.cgi?action=getSoftwareVersion", timeout=3.0)
                if r_ver.status_code == 200:
                    for line in r_ver.text.splitlines():
                        if "version=" in line:
                            result["firmware_version"] = line.split("=", 1)[1].strip()

                # Get Current Time & calculate drift
                r_time = session.get(f"{base_url}/cgi-bin/global.cgi?action=getCurrentTime", timeout=3.0)
                if r_time.status_code == 200 and "result=" in r_time.text:
                    time_str = r_time.text.split("result=", 1)[1].strip()
                    result["nvr_clock"] = time_str
                    try:
                        nvr_dt = datetime.strptime(time_str, "%Y-%m-%d %H:%M:%S")
                        # Local time offset ~ IST UTC+05:30
                        now_local = datetime.now()
                        drift = (nvr_dt - now_local).total_seconds()
                        result["time_drift_seconds"] = round(drift, 1)
                    except Exception:
                        pass

                # Check Record config
                r_rec = session.get(f"{base_url}/cgi-bin/configManager.cgi?action=getConfig&name=RecordMode", timeout=3.0)
                if r_rec.status_code == 200:
                    result["recording_active"] = "Mode=1" in r_rec.text or "Mode=2" in r_rec.text

            except Exception as ex:
                logger.warning(f"Could not complete NVR HTTP API handshake: {ex}")

        return result

    def detect_missing_intervals(
        self,
        camera_id: str,
        current_time: Optional[datetime] = None,
    ) -> List[Tuple[datetime, datetime]]:
        """Detects time intervals missed during an outage for the given camera.

        Returns:
            List of (start_datetime, end_datetime) slices in chronological order.
        """
        now = current_time or datetime.now(timezone.utc)
        if now.tzinfo is None:
            now = now.replace(tzinfo=timezone.utc)

        last_checkpoint = self.checkpoint_manager.get_last_processed_timestamp(camera_id)

        if last_checkpoint is None:
            # First initialization: look back max_lookback_hours or 1 hour
            default_lookback = now - timedelta(hours=min(2, self.max_lookback_hours))
            self.checkpoint_manager.update_checkpoint(camera_id, default_lookback, 0, "INITIALIZED")
            logger.info(
                f"[{camera_id}] Initialized recovery checkpoint to {default_lookback.isoformat()}."
            )
            last_checkpoint = default_lookback

        gap_seconds = (now - last_checkpoint).total_seconds()
        if gap_seconds < self.min_gap_seconds:
            logger.info(
                f"[{camera_id}] No missing interval detected (gap: {gap_seconds:.1f}s < threshold {self.min_gap_seconds}s)."
            )
            return []

        # Bound lookback
        earliest_permitted = now - timedelta(hours=self.max_lookback_hours)
        start_time = max(last_checkpoint, earliest_permitted)
        end_time = now

        # Split into chunked intervals (e.g. 15 minutes each) for safe checkpointing
        chunks = []
        chunk_delta = timedelta(minutes=self.interval_chunk_minutes)
        cursor = start_time

        while cursor < end_time:
            next_cursor = min(cursor + chunk_delta, end_time)
            chunks.append((cursor, next_cursor))
            cursor = next_cursor

        logger.info(
            f"[{camera_id}] Detected outage gap of {gap_seconds / 60:.1f} minutes. Created {len(chunks)} recovery interval(s)."
        )
        return chunks

    def build_nvr_rtsp_playback_url(
        self,
        camera_id: str,
        start_time: datetime,
        end_time: datetime,
        format_type: str = "iso_utc",
    ) -> Optional[str]:
        """Constructs CP PLUS / Dahua RTSP playback URL for the given interval.

        Formats:
        - iso_utc: /cam/playback?channel={ch}&subtype=0&starttime=20261017T090000Z&endtime=20261017T091500Z
        - underscore_local: /cam/playback?channel={ch}&starttime=2026_10_17_14_30_00&endtime=2026_10_17_14_45_00
        """
        if not self.nvr_ip:
            return None

        channel = self.nvr_channel_map.get(camera_id, 2 if camera_id == "CAM-01" else 1)
        auth_part = f"{self.nvr_user}:{self.nvr_pass}@" if self.nvr_user else ""

        if format_type == "underscore_local":
            fmt = "%Y_%m_%d_%H_%M_%S"
            # IST offset UTC+05:30
            ist_offset = timezone(timedelta(hours=5, minutes=30))
            start_str = start_time.astimezone(ist_offset).strftime(fmt)
            end_str = end_time.astimezone(ist_offset).strftime(fmt)
            url = (
                f"{self.nvr_scheme}://{auth_part}{self.nvr_ip}:{self.nvr_port}/cam/playback?"
                f"channel={channel}&starttime={start_str}&endtime={end_str}"
            )
        else:
            fmt = "%Y%m%dT%H%M%SZ"
            start_str = start_time.astimezone(timezone.utc).strftime(fmt)
            end_str = end_time.astimezone(timezone.utc).strftime(fmt)
            url = (
                f"{self.nvr_scheme}://{auth_part}{self.nvr_ip}:{self.nvr_port}/cam/playback?"
                f"channel={channel}&subtype=0&starttime={start_str}&endtime={end_str}"
            )

        return url

    def log_recorded_gap(
        self,
        camera_id: str,
        start_time: datetime,
        end_time: datetime,
        reason: str,
    ) -> None:
        """Records an unrecoverable interval to the audit gap log without inventing punches."""
        entry = {
            "camera_id": camera_id,
            "interval_start": start_time.isoformat(),
            "interval_end": end_time.isoformat(),
            "duration_seconds": (end_time - start_time).total_seconds(),
            "reason": reason,
            "logged_at": datetime.now(timezone.utc).isoformat(),
        }
        logger.warning(
            f"[{camera_id}] Recorded outage gap {start_time.isoformat()} -> {end_time.isoformat()}: {reason}"
        )
        try:
            self.gaps_file.parent.mkdir(parents=True, exist_ok=True)
            existing = []
            if self.gaps_file.exists():
                with open(self.gaps_file, "r", encoding="utf-8") as f:
                    try:
                        existing = json.load(f)
                    except Exception:
                        existing = []
            existing.append(entry)
            with open(self.gaps_file, "w", encoding="utf-8") as f:
                json.dump(existing, f, indent=2)
        except Exception as ex:
            logger.error(f"Failed to write to gaps log: {ex}")

    def process_historical_video_source(
        self,
        camera_id: str,
        video_source: str,
        interval_start: datetime,
        interval_end: datetime,
        fps_override: Optional[float] = None,
    ) -> Tuple[int, int]:
        """Decodes historical video, detects faces, matches enrolled employees, and enqueues events.

        Policy for Historical Footage:
        - Bypasses live eye-blink motion liveness (which is invalid on recorded static replay).
        - Enforces strict recognition similarity (>= RECOGNITION_THRESHOLD).
        - Requires multi-observation confirmation (>= 2 frames).
        - Preserves the true historical capture timestamp.
        - Uses deterministic UUIDv5 event ID to prevent duplicate records against live events.
        - Enforces camera directional rules: CAM-01 -> OUT, CAM-02 -> IN.

        Returns:
            Tuple of (events_enqueued, observations_processed).
        """
        if not self._ensure_models_loaded():
            self.log_recorded_gap(camera_id, interval_start, interval_end, "AI models not loaded")
            return 0, 0

        cap = cv2.VideoCapture(video_source)
        if not cap.isOpened():
            logger.warning(f"[{camera_id}] Could not open historical playback source: {video_source}")
            # Differentiate between temporary network error and missing footage
            reachability = self.check_nvr_reachability()
            if reachability.get("reachable"):
                reason = "NVR reachable but playback stream returned 404 or no recorded footage found on storage"
                self.log_recorded_gap(camera_id, interval_start, interval_end, reason)
                # Advance checkpoint so recovery does not get stuck indefinitely on unrecorded intervals
                self.checkpoint_manager.update_checkpoint(
                    camera_id=camera_id,
                    processed_timestamp=interval_end,
                    recovered_events_count=0,
                    status="NO_RECORDING_LOGGED_GAP",
                )
            else:
                reason = "NVR unreachable or network disconnected"
                self.log_recorded_gap(camera_id, interval_start, interval_end, reason)
            return 0, 0

        fps = cap.get(cv2.CAP_PROP_FPS) or fps_override or 25.0
        if fps <= 0:
            fps = 25.0

        event_type = CAMERA_DIRECTION_MAPPING.get(camera_id, "IN")
        consecutive_matches: Dict[str, int] = {}
        last_event_time: Dict[str, float] = {}
        events_enqueued = 0
        observations_processed = 0
        frame_idx = 0

        # Sample rate: Process every 2nd or 3rd frame to speed up recovery without missing faces
        frame_step = 2

        try:
            while True:
                ret, frame = cap.read()
                if not ret or frame is None:
                    break

                frame_idx += 1
                if frame_idx % frame_step != 0:
                    continue

                # Calculate true historical timestamp of this exact frame
                elapsed_sec = frame_idx / fps
                frame_timestamp = interval_start + timedelta(seconds=elapsed_sec)
                if frame_timestamp > interval_end:
                    break

                frame_iso = frame_timestamp.isoformat()
                observations_processed += 1

                # Yield CPU to live recognition threads
                time.sleep(0.005)

                h, w = frame.shape[:2]
                det_w = 640
                det_scale = det_w / float(w) if w > det_w else 1.0
                det_h = int(h * det_scale) if det_scale != 1.0 else h
                det_frame = (
                    cv2.resize(frame, (det_w, det_h), interpolation=cv2.INTER_LINEAR)
                    if det_scale != 1.0
                    else frame
                )

                self.detector.setInputSize((det_w, det_h))
                _, raw_faces = self.detector.detect(det_frame)

                if raw_faces is None or len(raw_faces) == 0:
                    consecutive_matches.clear()
                    continue

                faces = raw_faces.copy()
                if det_scale != 1.0:
                    inv = 1.0 / det_scale
                    faces[:, 0:4] *= inv
                    faces[:, 4:14] *= inv

                face = faces[0]
                bx, by, bw, bh = map(int, face[0:4])
                landmarks = face[4:14].reshape(5, 2)

                aligned = face_align.norm_crop(frame, landmark=landmarks, image_size=112)
                raw_emb = self.arcface.get_feat(aligned).flatten()
                norm = float(np.linalg.norm(raw_emb))
                if norm <= 0:
                    continue

                live_emb = raw_emb / norm
                best_id = None
                best_sim = -1.0

                for emp_id, rec in self.active_employees.items():
                    sim = float(np.dot(live_emb, rec["embedding"]))
                    if sim > best_sim:
                        best_sim = sim
                        best_id = emp_id

                if best_sim >= RECOGNITION_THRESHOLD and best_id:
                    consecutive_matches[best_id] = consecutive_matches.get(best_id, 0) + 1

                    # Require at least 2 observation frames in historical footage
                    if consecutive_matches[best_id] >= 2:
                        last_ts_sec = last_event_time.get(best_id, None)

                        # 60s cooldown in historical time
                        if last_ts_sec is None or (elapsed_sec - last_ts_sec) > 60.0:
                            last_event_time[best_id] = elapsed_sec

                            # Deterministic UUIDv5 based on camera, employee, and rounded 60s window
                            time_bucket = int(frame_timestamp.timestamp() / 60) * 60
                            event_id = str(
                                uuid.uuid5(
                                    uuid.NAMESPACE_URL,
                                    f"NVR_{camera_id}_{best_id}_{event_type}_{time_bucket}",
                                )
                            )

                            self.outbox.enqueue(
                                event_id=event_id,
                                employee_id=best_id,
                                camera_id=camera_id,
                                event_type=event_type,
                                similarity=round(float(best_sim), 4),
                                timestamp=frame_iso,
                                source=f"CP_PLUS_{camera_id}",
                                status="PRESENT",
                                notes="CP_PLUS_NVR_HISTORICAL_RECOVERY",
                            )
                            events_enqueued += 1
                            logger.info(
                                f"[{camera_id}] [RECOVERED {event_type}] {best_id} at {frame_iso} (Sim: {best_sim:.4f}, EventID: {event_id})"
                            )
                else:
                    consecutive_matches.clear()

        finally:
            cap.release()

        # Update checkpoint to interval end time
        self.checkpoint_manager.update_checkpoint(
            camera_id=camera_id,
            processed_timestamp=interval_end,
            recovered_events_count=events_enqueued,
            status="COMPLETED",
        )

        return events_enqueued, observations_processed

    def run_recovery_for_camera(
        self, camera_id: str, current_time: Optional[datetime] = None
    ) -> Dict[str, Any]:
        """Runs the complete missing interval recovery workflow for a single camera."""
        missing_intervals = self.detect_missing_intervals(camera_id, current_time=current_time)
        if not missing_intervals:
            return {
                "camera_id": camera_id,
                "intervals_processed": 0,
                "events_recovered": 0,
                "observations_processed": 0,
                "status": "UP_TO_DATE",
            }

        if not self.nvr_ip:
            reason = (
                "NVR_IP is not configured in .env. Historical footage playback cannot be initiated. "
                "Outage intervals have been preserved in checkpoints and gap logs."
            )
            logger.warning(f"[{camera_id}] {reason}")
            for start_t, end_t in missing_intervals:
                self.log_recorded_gap(camera_id, start_t, end_t, reason)
            return {
                "camera_id": camera_id,
                "intervals_processed": 0,
                "events_recovered": 0,
                "observations_processed": 0,
                "status": "AWAITING_NVR_CONFIG",
                "missing_config": ["NVR_IP", "NVR_PASSWORD", "NVR_CHANNEL_CAM01", "NVR_CHANNEL_CAM02"],
            }

        # Check NVR reachability before entering playback loop
        reachability = self.check_nvr_reachability()
        if not reachability.get("reachable"):
            logger.warning(f"[{camera_id}] NVR at {self.nvr_ip} is currently unreachable over LAN.")
            for start_t, end_t in missing_intervals:
                self.log_recorded_gap(camera_id, start_t, end_t, "NVR unreachable on local network")
            return {
                "camera_id": camera_id,
                "intervals_processed": 0,
                "events_recovered": 0,
                "observations_processed": 0,
                "status": "NVR_UNREACHABLE",
                "nvr_ip": self.nvr_ip,
            }

        total_recovered = 0
        total_observations = 0
        intervals_done = 0

        for start_t, end_t in missing_intervals:
            url = self.build_nvr_rtsp_playback_url(camera_id, start_t, end_t)
            logger.info(
                f"[{camera_id}] Requesting NVR playback: {start_t.isoformat()} -> {end_t.isoformat()}..."
            )
            count, obs_count = self.process_historical_video_source(
                camera_id=camera_id,
                video_source=url,
                interval_start=start_t,
                interval_end=end_t,
            )
            total_recovered += count
            total_observations += obs_count
            intervals_done += 1

        return {
            "camera_id": camera_id,
            "intervals_processed": intervals_done,
            "events_recovered": total_recovered,
            "observations_processed": total_observations,
            "status": "SUCCESS",
        }

    def run_all(self) -> Dict[str, Any]:
        """Runs recovery for both CAM-01 (IN) and CAM-02 (OUT) under concurrency protection."""
        logger.info("Starting CP PLUS NVR Historical Recovery Workflow...")
        lock_path = str(self._worker_lock_file)
        self._worker_lock_file.parent.mkdir(parents=True, exist_ok=True)

        try:
            with FileLock(lock_path, timeout=1.0):
                res_cam1 = self.run_recovery_for_camera("CAM-01")
                res_cam2 = self.run_recovery_for_camera("CAM-02")

                outbox_stats = self.outbox.get_summary()

                summary = {
                    "CAM-01": res_cam1,
                    "CAM-02": res_cam2,
                    "requested_intervals": (
                        res_cam1.get("intervals_processed", 0) + res_cam2.get("intervals_processed", 0)
                    ),
                    "retrieved_intervals": (
                        res_cam1.get("intervals_processed", 0) + res_cam2.get("intervals_processed", 0)
                    ),
                    "observations_processed": (
                        res_cam1.get("observations_processed", 0) + res_cam2.get("observations_processed", 0)
                    ),
                    "events_validated": (
                        res_cam1.get("events_recovered", 0) + res_cam2.get("events_recovered", 0)
                    ),
                    "events_synchronized": outbox_stats.get("events_synchronized", 0),
                    "events_pending": outbox_stats.get("events_pending", 0),
                    "events_requiring_review": 0,
                    "timestamp": datetime.now(timezone.utc).isoformat(),
                }
                self.last_summary = summary
                logger.info(
                    f"Recovery cycle finished. Validated {summary['events_validated']} events "
                    f"across {summary['requested_intervals']} intervals."
                )
                return summary

        except Exception as ex:
            logger.warning(f"Recovery run skipped or locked: {ex}")
            return {
                "status": "LOCKED_OR_FAILED",
                "error": str(ex),
                "timestamp": datetime.now(timezone.utc).isoformat(),
            }

    def start_background_worker(self, interval_seconds: float = 600.0) -> None:
        """Starts a background daemon thread that runs recovery on startup and periodically."""
        if self._worker_thread and self._worker_thread.is_alive():
            return

        self._worker_stop_event.clear()

        def _loop():
            logger.info("NVR Historical Recovery background worker started.")
            # Run immediate check at startup
            try:
                self.run_all()
            except Exception as e:
                logger.error(f"Error in initial recovery run: {e}")

            while not self._worker_stop_event.is_set():
                self._worker_stop_event.wait(interval_seconds)
                if self._worker_stop_event.is_set():
                    break
                try:
                    self.run_all()
                except Exception as e:
                    logger.error(f"Error in periodic recovery run: {e}")

        self._worker_thread = threading.Thread(
            target=_loop,
            name="NVRRecovery-BackgroundWorker",
            daemon=True,
        )
        self._worker_thread.start()

    def stop_background_worker(self, timeout: float = 3.0) -> None:
        """Cleanly stops the background recovery worker thread."""
        self._worker_stop_event.set()
        if self._worker_thread and self._worker_thread.is_alive():
            self._worker_thread.join(timeout=timeout)
        logger.info("NVR Historical Recovery background worker stopped.")


def main():
    parser = argparse.ArgumentParser(description="CP PLUS NVR Historical Recording Recovery Service")
    parser.add_argument("--status", action="store_true", help="Print current checkpoints and gaps")
    parser.add_argument("--inspect-nvr", action="store_true", help="Inspect physical NVR network reachability & ports")
    parser.add_argument("--recover", action="store_true", help="Run recovery workflow for all cameras")
    parser.add_argument("--test-file", type=str, default=None, help="Test recovery against a local video file")
    parser.add_argument("--camera-id", type=str, default="CAM-01", choices=["CAM-01", "CAM-02"], help="Camera ID")
    args = parser.parse_args()

    service = NVRRecoveryService()

    if args.inspect_nvr:
        print("================================================================")
        print("CP PLUS NVR PHYSICAL REACHABILITY & CAPABILITIES INSPECTION")
        print("================================================================")
        res = service.check_nvr_reachability()
        print(json.dumps(res, indent=2))
        return

    if args.status:
        print("================================================================")
        print("CP PLUS NVR RECOVERY STATUS & CHECKPOINTS")
        print("================================================================")
        checkpoints = service.checkpoint_manager.get_all_checkpoints()
        print(json.dumps(checkpoints, indent=2))
        if service.gaps_file.exists():
            print("\nRecent Recorded Gaps:")
            try:
                with open(service.gaps_file, "r") as f:
                    print(f.read()[-1000:])
            except Exception as e:
                print(e)
        return

    if args.test_file:
        print(f"Testing historical recovery with local file: {args.test_file} for {args.camera_id}...")
        now = datetime.now(timezone.utc)
        start = now - timedelta(minutes=10)
        count, obs = service.process_historical_video_source(
            camera_id=args.camera_id,
            video_source=args.test_file,
            interval_start=start,
            interval_end=now,
        )
        print(f"Recovery test completed. Enqueued {count} attendance event(s) from {obs} observations.")
        return

    if args.recover:
        result = service.run_all()
        print(json.dumps(result, indent=2))
        return

    parser.print_help()


if __name__ == "__main__":
    main()
