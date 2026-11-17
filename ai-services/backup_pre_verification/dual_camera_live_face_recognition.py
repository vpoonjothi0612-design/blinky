"""Production Dual-Camera Live Face Recognition & Attendance Pipeline (CAM-01 & CAM-02).

- CAM-01: Dedicated Exit camera  -> records "OUT" events
- CAM-02: Dedicated Entry camera -> records "IN" events

Features:
- Independent capture and inference threads per camera.
- Multi-observation identity confirmation (suppresses single-frame flickers).
- Durable attendance outbox with bounded exponential backoff.
- Direction-aware cooldown per (employee, event_type).
- Single-instance lock that is always released, even on early exit.
- Preview window failures never stop recognition.
"""

from __future__ import annotations

import argparse
import json
import os
import signal
import sys
import threading
import time
import uuid
from datetime import datetime, timezone
from pathlib import Path
from typing import Any, Dict, List, Optional, Tuple

import cv2
import numpy as np
import requests
from insightface.model_zoo import get_model

# ---------------------------------------------------------------------------
# Paths
# ---------------------------------------------------------------------------
_CURRENT_DIR = Path(__file__).resolve().parent
_SRC_DIR = _CURRENT_DIR.parent
_AI_SERVICES_DIR = _SRC_DIR.parent

for p in (
    str(_AI_SERVICES_DIR),
    str(_SRC_DIR),
    str(_SRC_DIR / "camera"),
    str(_CURRENT_DIR),
    str(_CURRENT_DIR / "recognition"),
):
    if p not in sys.path:
        sys.path.insert(0, p)

from camera_config import get_available_camera_configs
from camera_worker import CameraWorker
from camera_manager import MultiCameraManager

from face_config import (
    YUNET_MODEL_PATH,
    ARCFACE_MODEL_PATH,
    REFERENCE_POINTS,
    RECOGNITION_THRESHOLD,
    PROFILE_RECOGNITION_THRESHOLD,
    DEFAULT_MIN_MATCH_MARGIN,
    UNKNOWN_CAPTURE_COOLDOWN_SECONDS,
    is_face_in_active_gate_zone,
)

try:
    from employee_registry import load_all_active_embeddings, match_probe_against_registry
except ImportError:
    from src.face.recognition.employee_registry import load_all_active_embeddings, match_probe_against_registry

try:
    from multi_employee_recognition import MultiFaceTracker, check_face_crop_quality
except ImportError:
    from src.face.recognition.multi_employee_recognition import MultiFaceTracker, check_face_crop_quality

try:
    from face_preprocess import preprocess_face
except ImportError:
    from src.face.recognition.face_preprocess import preprocess_face

from live_face_recognition import draw_multi_person_hud
from attendance_outbox import AttendanceOutbox

try:
    from nvr_recovery_service import NVRRecoveryService
except ImportError:
    from camera.nvr_recovery_service import NVRRecoveryService


# ---------------------------------------------------------------------------
# Configuration (environment overrides)
# ---------------------------------------------------------------------------
CAMERA_EVENT_MAPPING = {
    "CAM-01": "OUT",  # Exit gate
    "CAM-02": "IN",   # Entry gate
}

BACKEND_API_URL = os.environ.get("BACKEND_API_URL", "http://127.0.0.1:3000/api").rstrip("/")
INTERNAL_TOKEN = os.environ.get("AI_INTERNAL_TOKEN", "AI_SYSTEM_INTERNAL_TOKEN_V1")
COOLDOWN_SECONDS = float(os.environ.get("ATTENDANCE_COOLDOWN_SEC", "120.0"))
OBSERVATION_CONFIRMATION_FRAMES = int(os.environ.get("CONFIRMATION_FRAMES", "2"))
MIN_MATCH_MARGIN = float(os.environ.get("MIN_MATCH_MARGIN", str(DEFAULT_MIN_MATCH_MARGIN)))
YUNET_SCORE_THRESHOLD = float(os.environ.get("YUNET_SCORE_THRESHOLD", "0.7"))
MAX_PROCESS_FPS = float(os.environ.get("MAX_PROCESS_FPS", "5"))
DISPLAY_W, DISPLAY_H = 640, 360

# Cross-camera attendance cache: key = (employee_id, event_type)
SHARED_ATTENDANCE_CACHE: Dict[Tuple[str, str], float] = {}
SHARED_ATTENDANCE_LOCK = threading.Lock()

LOCK_FILE_NAME = "dual_camera_service.lock"
STATUS_FILE_NAME = "ai_camera_status.json"
PROCESS_MARKER = "dual_camera_live_face_recognition"


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------
def is_remote_url(url: str) -> bool:
    return not any(h in url for h in ("127.0.0.1", "localhost", "[::1]"))


def verify_backend_connectivity(api_url: str) -> bool:
    """Checks that the backend is reachable. Outbox retries if not."""
    health_endpoint = f"{api_url}/health"
    try:
        resp = requests.get(health_endpoint, timeout=3.0)
        if resp.status_code == 200:
            print(f"[Backend Health] Connectivity verified: {health_endpoint} -> 200 OK")
            return True
        print(f"[Backend Health Warning] Health check returned HTTP {resp.status_code}")
        return False
    except Exception as ex:
        print(f"[Backend Health Warning] Backend not reachable ({ex}). Outbox will queue and retry.")
        return False


def fit_panel(frame: Optional[np.ndarray]) -> np.ndarray:
    """Force any frame to the fixed panel size so both cameras can be stacked."""
    if frame is None or frame.size == 0:
        return np.zeros((DISPLAY_H, DISPLAY_W, 3), dtype=np.uint8)
    if frame.shape[1] == DISPLAY_W and frame.shape[0] == DISPLAY_H:
        return frame
    return cv2.resize(frame, (DISPLAY_W, DISPLAY_H), interpolation=cv2.INTER_AREA)


def load_arcface_model_auto(model_path: Path) -> Tuple[Any, str]:
    """Loads ArcFace on GPU when available, otherwise CPU."""
    providers = ["CPUExecutionProvider"]
    try:
        import onnxruntime as ort
        if "CUDAExecutionProvider" in ort.get_available_providers():
            providers = ["CUDAExecutionProvider", "CPUExecutionProvider"]
    except Exception:
        pass

    try:
        model = get_model(str(model_path), providers=providers)
        model.prepare(ctx_id=0)
        chosen = "GPU (CUDAExecutionProvider)" if providers[0].startswith("CUDA") else "CPU (CPUExecutionProvider)"
        return model, chosen
    except Exception as ex:
        print(f"[ArcFace Loader] Falling back to CPU: {ex}")
        model = get_model(str(model_path), providers=["CPUExecutionProvider"])
        model.prepare(ctx_id=0)
        return model, "CPU (CPUExecutionProvider)"


def acquire_single_instance_lock(lock_file: Path) -> Tuple[bool, Optional[int]]:
    """Returns (acquired, blocking_pid). Only a live dual-camera process blocks startup."""
    if lock_file.exists():
        try:
            prev_pid = int(lock_file.read_text().strip())
        except (ValueError, OSError):
            prev_pid = None

        if prev_pid and prev_pid != os.getpid():
            try:
                os.kill(prev_pid, 0)  # raises if the process does not exist
                alive = True
            except ProcessLookupError:
                alive = False
            except PermissionError:
                alive = True

            if alive:
                try:
                    cmdline = Path(f"/proc/{prev_pid}/cmdline").read_bytes().replace(b"\0", b" ").decode(errors="ignore")
                except OSError:
                    cmdline = ""
                if PROCESS_MARKER in cmdline:
                    return False, prev_pid

    lock_file.write_text(str(os.getpid()), encoding="utf-8")
    return True, None


# ---------------------------------------------------------------------------
# Per-camera inference worker
# ---------------------------------------------------------------------------
class CameraInferenceWorker:
    """Independent face inference pipeline for one camera."""

    def __init__(
        self,
        camera_id: str,
        camera_worker: CameraWorker,
        event_type: str,
        active_employees: Dict[str, Dict[str, Any]],
        arcface_model: Any,
        arcface_lock: threading.Lock,
        outbox: AttendanceOutbox,
        recognition_threshold: float = RECOGNITION_THRESHOLD,
        profile_recognition_threshold: float = PROFILE_RECOGNITION_THRESHOLD,
        confirmation_frames: int = OBSERVATION_CONFIRMATION_FRAMES,
        cooldown_seconds: float = COOLDOWN_SECONDS,
        min_match_margin: float = MIN_MATCH_MARGIN,
        gui_enabled: bool = True,
    ) -> None:
        self.camera_id = camera_id
        self.camera_worker = camera_worker
        self.event_type = event_type
        self.active_employees = active_employees
        self.arcface = arcface_model
        self.arcface_lock = arcface_lock
        self.outbox = outbox
        self.recognition_threshold = recognition_threshold
        self.profile_recognition_threshold = profile_recognition_threshold
        self.confirmation_frames = confirmation_frames
        self.cooldown_seconds = cooldown_seconds
        self.min_match_margin = min_match_margin
        self.gui_enabled = gui_enabled

        self.tracker = MultiFaceTracker(max_missed=15)
        self.detector: Optional[cv2.FaceDetectorYN] = None
        self.input_size: Tuple[int, int] = (0, 0)

        self.last_unknown_sent: float = 0.0
        self._recent_unknown_embeddings: List[Dict[str, Any]] = []
        self.frame_count: int = 0
        self.last_processed_frame_idx: int = -1
        self._last_process_time: float = 0.0

        self.stats: Dict[str, Any] = {
            "frames_processed": 0,
            "faces_detected": 0,
            "registered_identified": 0,
            "unknown_tracks": 0,
            "attendance_recorded": 0,
            "duplicates_prevented": 0,
            "avg_latency_ms": 0.0,
            "connection_status": "CONNECTING",
        }

        self._hud_lock = threading.Lock()
        self.latest_display_frame: Optional[np.ndarray] = None
        self._fps: float = 0.0
        self._fps_time: float = time.time()
        self._fps_frames: int = 0

        self._thread: Optional[threading.Thread] = None
        self._stop_event = threading.Event()

    # ----- lifecycle -------------------------------------------------------
    def start(self) -> None:
        self._stop_event.clear()
        self._thread = threading.Thread(
            target=self._run_loop, name=f"InferenceWorker-{self.camera_id}", daemon=True
        )
        self._thread.start()

    def stop(self, timeout: float = 2.0) -> None:
        self._stop_event.set()
        if self._thread and self._thread.is_alive():
            self._thread.join(timeout=timeout)

    def is_alive(self) -> bool:
        return bool(self._thread and self._thread.is_alive())

    def get_stats(self) -> Dict[str, Any]:
        with self._hud_lock:
            s = dict(self.stats)
        s["camera_id"] = self.camera_id
        s["event_type"] = self.event_type
        s["fps"] = round(self._fps, 1)
        s["pending_outbox"] = self.outbox.get_depth() if self.outbox else 0
        if self.camera_worker:
            s["connection_status"] = self.camera_worker.state.value
        return s

    def get_display_frame(self) -> np.ndarray:
        with self._hud_lock:
            if self.latest_display_frame is not None:
                return self.latest_display_frame.copy()

        placeholder = np.zeros((DISPLAY_H, DISPLAY_W, 3), dtype=np.uint8)
        state_msg = self.camera_worker.state.value if self.camera_worker else "OFFLINE"
        cv2.putText(placeholder, f"[{self.camera_id} - {self.event_type}] {state_msg}",
                    (60, 160), cv2.FONT_HERSHEY_SIMPLEX, 0.7, (0, 165, 255), 2)
        cv2.putText(placeholder, "Waiting for video frames...",
                    (100, 200), cv2.FONT_HERSHEY_SIMPLEX, 0.5, (180, 180, 180), 1)
        return placeholder

    # ----- main loop -------------------------------------------------------
    def _run_loop(self) -> None:
        min_interval = (1.0 / MAX_PROCESS_FPS) if MAX_PROCESS_FPS > 0 else 0.0

        while not self._stop_event.is_set():
            try:
                self._process_once(min_interval)
            except Exception as ex:
                # One bad frame must never kill the camera thread.
                print(f"[{self.camera_id}] Inference error (continuing): {ex}")
                time.sleep(0.2)

    def _process_once(self, min_interval: float) -> None:
        has_frame, frame, capture_ts, f_idx = (
            self.camera_worker.get_latest_frame() if self.camera_worker else (False, None, 0.0, 0)
        )

        if not has_frame or frame is None or f_idx == self.last_processed_frame_idx:
            time.sleep(0.005)
            return

        # Frame-rate cap: drop frames when behind, so recognition never backlogs.
        now_perf = time.perf_counter()
        if min_interval and (now_perf - self._last_process_time) < min_interval:
            time.sleep(0.005)
            return
        self._last_process_time = now_perf

        t_f0 = now_perf
        self.last_processed_frame_idx = f_idx
        self.frame_count += 1
        self.stats["frames_processed"] = self.frame_count
        if self.camera_worker:
            self.stats["connection_status"] = self.camera_worker.state.value

        self._fps_frames += 1
        now_sec = time.time()
        if (now_sec - self._fps_time) >= 1.0:
            self._fps = self._fps_frames / (now_sec - self._fps_time)
            self._fps_frames = 0
            self._fps_time = now_sec

        capture_iso = (
            datetime.fromtimestamp(capture_ts, tz=timezone.utc).isoformat()
            if capture_ts > 0 else datetime.now(timezone.utc).isoformat()
        )

        h, w = frame.shape[:2]

        # Downscale for detection (target width 640)
        target_w = 640
        if w > target_w:
            det_scale = target_w / float(w)
            det_w = target_w
            det_h = int(h * det_scale)
            det_frame = cv2.resize(frame, (det_w, det_h), interpolation=cv2.INTER_LINEAR)
        else:
            det_scale = 1.0
            det_w, det_h = w, h
            det_frame = frame

        if self.detector is None or self.input_size != (det_w, det_h):
            self.detector = cv2.FaceDetectorYN.create(
                str(YUNET_MODEL_PATH), "", (det_w, det_h), YUNET_SCORE_THRESHOLD, 0.3, 5000
            )
            self.detector.setInputSize((det_w, det_h))
            self.input_size = (det_w, det_h)

        # 1. Face detection
        _, raw_faces = self.detector.detect(det_frame)

        raw_detections: List[Tuple[Tuple[int, int, int, int], np.ndarray]] = []
        if raw_faces is not None and len(raw_faces) > 0:
            faces = raw_faces.copy()
            if det_scale != 1.0:
                inv = 1.0 / det_scale
                faces[:, 0:4] *= inv
                faces[:, 4:14] *= inv
            for face in faces:
                bx, by, bw, bh = map(int, face[0:4])
                landmarks = face[4:14].reshape(5, 2)
                raw_detections.append(((bx, by, bw, bh), landmarks))

        self.stats["faces_detected"] += len(raw_detections)

        # 2. Tracking
        active_tracks = self.tracker.update(raw_detections)
        gray_frame = cv2.cvtColor(frame, cv2.COLOR_BGR2GRAY) if active_tracks else None
        tracks_hud_info: List[Dict[str, Any]] = []

        # 3. Per-track processing
        for track in active_tracks:
            self._process_track(track, frame, gray_frame, h, w, capture_iso, tracks_hud_info)

        frame_elapsed_ms = (time.perf_counter() - t_f0) * 1000.0
        self.stats["avg_latency_ms"] = round(0.9 * self.stats["avg_latency_ms"] + 0.1 * frame_elapsed_ms, 1)

        # 4. HUD
        if self.gui_enabled:
            hud = draw_multi_person_hud(
                frame=frame,
                tracks_info=tracks_hud_info,
                camera_id=self.camera_id,
                event_type=self.event_type,
                stats=self.stats,
                fps=self._fps,
                outbox_depth=self.outbox.get_depth() if self.outbox else 0,
            )
            resized_hud = fit_panel(hud)
            with self._hud_lock:
                self.latest_display_frame = resized_hud

    def _init_track_state(self, track: Any) -> None:
        """Ensures every dynamic field exists before use."""
        defaults = {
            "employee_id": None,
            "confirmed_employee_id": None,
            "name": None,
            "status": "DETECTED",
            "similarity": None,
            "matched_view": "FRONT",
            "consecutive_matches": 0,
            "consecutive_unknown": 0,
            "grace_frames": 0,
            "last_rec_frame": -999,
            "attendance_state": "READY",
            "is_unknown_accounted": False,
            "is_in_zone": True,
            "distance_meters": 0.0,
        }
        for key, value in defaults.items():
            if not hasattr(track, key):
                setattr(track, key, value)

    def _hud_entry(self, track: Any, state: str, landmarks: np.ndarray, dist_m: float, in_zone: bool,
                   attendance_state: Optional[str] = None) -> Dict[str, Any]:
        return {
            "track_id": track.track_id,
            "bbox": track.bbox,
            "landmarks": landmarks,
            "status": track.status if state is None else state,
            "employee_id": track.employee_id,
            "name": track.name,
            "similarity": track.similarity,
            "matched_view": getattr(track, "matched_view", "FRONT"),
            "attendance_state": attendance_state or track.attendance_state,
            "distance_meters": dist_m,
            "is_in_zone": in_zone,
        }

    def _process_track(
        self,
        track: Any,
        frame: np.ndarray,
        gray_frame: Optional[np.ndarray],
        h: int,
        w: int,
        capture_iso: str,
        tracks_hud_info: List[Dict[str, Any]],
    ) -> None:
        self._init_track_state(track)
        bx, by, bw, bh = track.bbox
        landmarks = track.landmarks

        is_in_zone, dist_m, _ = is_face_in_active_gate_zone((bx, by, bw, bh), h)
        track.is_in_zone = is_in_zone
        track.distance_meters = dist_m

        # Faces above the gate line are not evaluated yet.
        if not is_in_zone and not track.confirmed_employee_id:
            track.status = f"APPROACHING (~{dist_m:.1f}m)"
            tracks_hud_info.append(self._hud_entry(track, track.status, landmarks, dist_m, False, "APPROACHING"))
            return

        # 3a. Quality gate
        quality_ok, _quality_msg, face_crop = check_face_crop_quality(frame, (bx, by, bw, bh), strict_boundary=False)
        if not quality_ok or face_crop is None:
            track.status = "LOW_QUALITY"
            tracks_hud_info.append(self._hud_entry(track, "LOW_QUALITY", landmarks, dist_m, is_in_zone, "QUALITY_FAIL"))
            return

        # 3b. Liveness
        is_live, live_msg, _ = track.liveness_tracker.update((bx, by, bw, bh), landmarks, gray_frame)
        if not is_live:
            track.status = "CHECKING_LIVENESS" if ("CHECKING" in live_msg) else "SPOOF"
            tracks_hud_info.append(self._hud_entry(track, track.status, landmarks, dist_m, is_in_zone, "VERIFYING"))
            return

        # 3c. Reuse a recent confirmed identity without re-running ArcFace
        reuse_cached_identity = (
            track.employee_id is not None and (self.frame_count - track.last_rec_frame) < 30
        )
        if reuse_cached_identity:
            track.status = f"RECOGNIZED: {track.employee_id}"
            self._evaluate_attendance_for_track(track, capture_iso)
            tracks_hud_info.append(self._hud_entry(track, track.status, landmarks, dist_m, is_in_zone))
            return

        # 3d. Align the face to the ArcFace 112x112 template
        transform, _ = cv2.estimateAffinePartial2D(
            landmarks.astype(np.float32), REFERENCE_POINTS, method=cv2.LMEDS
        )
        if transform is None:
            track.status = "LOW_QUALITY"
            return

        source = frame
        x1, y1 = max(0, bx), max(0, by)
        x2, y2 = min(w, bx + bw), min(h, by + bh)
        if face_crop is not None and face_crop.size > 0 and x2 > x1 and y2 > y1:
            try:
                pre = preprocess_face(face_crop)
                # Only paste the preprocessed face if its shape matches the region.
                if pre is not None and pre.shape[:2] == (y2 - y1, x2 - x1):
                    source = frame.copy()
                    source[y1:y2, x1:x2] = pre
            except Exception:
                source = frame

        aligned = cv2.warpAffine(source, transform, (112, 112))

        # 3e. ArcFace embedding
        with self.arcface_lock:
            raw_emb = self.arcface.get_feat(aligned).flatten()

        raw_norm = float(np.linalg.norm(raw_emb))
        if raw_norm <= 0 or np.isnan(raw_norm):
            return
        live_emb = (raw_emb / raw_norm).astype(np.float32)

        # 3f. Matching
        decision = match_probe_against_registry(
            probe_emb=live_emb,
            active_employees=self.active_employees,
            recognition_threshold=self.recognition_threshold,
            min_match_margin=self.min_match_margin,
            profile_recognition_threshold=self.profile_recognition_threshold,
            probe_landmarks=landmarks,
        )

        sim = decision.get("similarity")
        emp_id = decision.get("employee_id")
        emp_name = decision.get("name")
        dec_status = decision.get("status", "UNKNOWN")
        matched_view = decision.get("matched_view") or "FRONT"

        track.similarity = sim
        track.matched_view = matched_view
        track.last_rec_frame = self.frame_count

        if dec_status.startswith("RECOGNIZED") and emp_id:
            track.name = emp_name
            track.consecutive_matches += 1
            track.consecutive_unknown = 0
            track.grace_frames = 15

            if track.consecutive_matches >= self.confirmation_frames:
                track.employee_id = emp_id
                track.confirmed_employee_id = emp_id
                track.status = f"RECOGNIZED: {emp_id} [{matched_view}]"
                self.stats["registered_identified"] += 1
                self._evaluate_attendance_for_track(track, capture_iso)
            else:
                track.status = f"RECOGNIZING: {emp_id} [{matched_view}]"

        elif track.confirmed_employee_id and track.grace_frames > 0:
            # Momentary dip or head turn during a verified encounter
            track.grace_frames -= 1
            sim_str = f"{sim:.2f}" if sim is not None else "OBSERVING"
            track.status = f"UNCERTAIN (OBSERVING: {sim_str})"
            track.consecutive_unknown = 0

        elif dec_status == "AMBIGUOUS":
            track.status = "AMBIGUOUS"
            track.employee_id = None
            track.confirmed_employee_id = None
            track.consecutive_matches = 0
            track.consecutive_unknown = 0
            track.grace_frames = 0

        elif sim is not None and sim >= 0.50 and track.confirmed_employee_id:
            track.status = f"UNCERTAIN (OBSERVING: {sim:.2f})"
            track.consecutive_unknown = 0

        else:
            track.confirmed_employee_id = None
            track.employee_id = None
            track.consecutive_matches = 0
            track.grace_frames = 0
            track.status = "UNKNOWN FACE"
            track.consecutive_unknown += 1

            # Capture once per track after 3 consecutive unknown observations
            if track.consecutive_unknown >= 3 and not track.is_unknown_accounted:
                track.is_unknown_accounted = True
                self.stats["unknown_tracks"] += 1
                self._maybe_capture_unknown(track, frame, live_emb)

        tracks_hud_info.append(self._hud_entry(track, track.status, landmarks, dist_m, is_in_zone))

    # ----- attendance ------------------------------------------------------
    def _evaluate_attendance_for_track(self, track: Any, capture_iso: str) -> None:
        """Enqueues attendance unless the same employee had the same event type recently.

        Cooldown key is (employee_id, event_type), so an employee cannot be recorded
        twice as IN (from either camera) within the cooldown window.
        """
        emp_id = track.employee_id
        if not emp_id:
            return

        now_time = time.time()
        key = (emp_id, self.event_type)

        with SHARED_ATTENDANCE_LOCK:
            last_time = SHARED_ATTENDANCE_CACHE.get(key)
            if last_time is not None and (now_time - last_time) < self.cooldown_seconds:
                self.stats["duplicates_prevented"] += 1
                track.attendance_state = f"Cooldown ({self.event_type})"
                return

            event_id = str(uuid.uuid4())
            sim = track.similarity if track.similarity is not None else self.recognition_threshold

            self.outbox.enqueue(
                event_id=event_id,
                employee_id=emp_id,
                camera_id=self.camera_id,
                event_type=self.event_type,
                similarity=round(float(sim), 4),
                timestamp=capture_iso,
                source=f"CP_PLUS_{self.camera_id}",
                status="PRESENT",
            )
            SHARED_ATTENDANCE_CACHE[key] = now_time

        self.stats["attendance_recorded"] += 1
        track.attendance_state = f"{self.event_type} Recorded"
        print(
            f"[{self.camera_id}] [{self.event_type} PRESENT] {emp_id} ({track.name or emp_id}) "
            f"[{getattr(track, 'matched_view', 'FRONT')}] | Sim: {sim:.4f} | "
            f"EventID: {event_id} | Time: {capture_iso}"
        )

    # ----- unknown captures ------------------------------------------------
    def _maybe_capture_unknown(self, track: Any, frame: np.ndarray, live_emb: Optional[np.ndarray]) -> None:
        if track.confirmed_employee_id or live_emb is None:
            return

        # Do not capture anyone who matches a registered employee.
        norm_live = live_emb / (np.linalg.norm(live_emb) + 1e-9)
        for emp_data in self.active_employees.values():
            refs = emp_data.get("embeddings") or [emp_data.get("embedding")]
            for ref in refs:
                if ref is None:
                    continue
                ref_n = ref / (np.linalg.norm(ref) + 1e-9)
                if float(np.dot(norm_live, ref_n)) >= 0.35:
                    return

        h, _w = frame.shape[:2]
        is_in_zone, _dist_m, _ = is_face_in_active_gate_zone(track.bbox, h)
        if not is_in_zone:
            return

        now_time = time.time()
        if (now_time - self.last_unknown_sent) < UNKNOWN_CAPTURE_COOLDOWN_SECONDS:
            return

        # Suppress repeated captures of the same unknown person
        self._recent_unknown_embeddings = [
            item for item in self._recent_unknown_embeddings if (now_time - item["time"]) < 120.0
        ]
        for item in self._recent_unknown_embeddings:
            cached_norm = item["emb"] / (np.linalg.norm(item["emb"]) + 1e-9)
            if float(np.dot(norm_live, cached_norm)) >= 0.45:
                return
        self._recent_unknown_embeddings.append({"emb": live_emb.copy(), "time": now_time})
        self.last_unknown_sent = now_time

        try:
            h, w = frame.shape[:2]
            bx, by, bw, bh = track.bbox
            pad = 20
            cy1, cy2 = max(0, by - pad), min(h, by + bh + pad)
            cx1, cx2 = max(0, bx - pad), min(w, bx + bw + pad)
            crop = frame[cy1:cy2, cx1:cx2]
            if crop.size == 0:
                return

            unknown_dir = _AI_SERVICES_DIR / "data" / "unknown"
            unknown_dir.mkdir(parents=True, exist_ok=True)
            fname = f"unknown_{self.camera_id}_trk{track.track_id}_{int(now_time * 1000)}.jpg"
            cv2.imwrite(str(unknown_dir / fname), crop)

            captured_iso = datetime.now(timezone.utc).isoformat()
            payload = {
                # Existing contract
                "image": fname,
                "visitCount": self.stats["unknown_tracks"],
                "cameraId": self.camera_id,
                "embedding": live_emb.tolist(),
                # Additional fields for the Phase 2 contract
                "camera_id": self.camera_id,
                "track_id": track.track_id,
                "captured_at": captured_iso,
                "best_score": float(track.similarity) if track.similarity is not None else None,
                "decision": "UNKNOWN",
            }
            threading.Thread(target=self._post_unknown_backend, args=(payload,), daemon=True).start()
        except Exception as ex:
            print(f"[{self.camera_id}] Unknown capture failed: {ex}")

    def _post_unknown_backend(self, payload: Dict[str, Any]) -> None:
        try:
            resp = requests.post(
                f"{BACKEND_API_URL}/face-enrollments/capture-unknown",
                json=payload,
                headers={
                    "Authorization": f"Bearer {INTERNAL_TOKEN}",
                    "Content-Type": "application/json",
                },
                timeout=2.0,
            )
            if resp.status_code >= 300:
                print(f"[{self.camera_id}] Unknown capture POST returned HTTP {resp.status_code}")
        except Exception as ex:
            print(f"[{self.camera_id}] Unknown capture POST failed: {ex}")


# ---------------------------------------------------------------------------
# Pipeline entry point
# ---------------------------------------------------------------------------
def run_dual_camera_recognition(
    duration: Optional[float] = None,
    no_gui: bool = False,
    headless: bool = False,
) -> None:
    gui_enabled = not (no_gui or headless)

    # 0. Remote backend guard
    if is_remote_url(BACKEND_API_URL) and not os.environ.get("ALLOW_REMOTE_BACKEND"):
        print(f"[ERROR] BACKEND_API_URL points to a remote server: {BACKEND_API_URL}")
        print("Set BACKEND_API_URL=http://127.0.0.1:3000/api, or ALLOW_REMOTE_BACKEND=1 to override.")
        return

    # 1. Single-instance lock (always released in finally below)
    data_dir = _AI_SERVICES_DIR / "data"
    data_dir.mkdir(parents=True, exist_ok=True)
    lock_file = data_dir / LOCK_FILE_NAME
    status_file = data_dir / STATUS_FILE_NAME

    acquired, blocking_pid = acquire_single_instance_lock(lock_file)
    if not acquired:
        print(f"[ERROR] Another dual-camera pipeline is already running (PID: {blocking_pid}).")
        print("Stop it first: kill {0}".format(blocking_pid))
        return

    configs = get_available_camera_configs()
    cam_ids = [cid for cid in ("CAM-01", "CAM-02") if cid in configs]

    print("=================================================================")
    print("CP PLUS DUAL-CAMERA PRODUCTION ATTENDANCE PIPELINE")
    print("=================================================================")
    for cid in ("CAM-01", "CAM-02"):
        if cid in configs:
            print(f"{cid} -> {'Exit (OUT)' if cid == 'CAM-01' else 'Entry (IN)'}  [{configs[cid].ip}]")
    print(f"Backend API URL        : {BACKEND_API_URL}")
    print(f"Frontal Threshold      : {RECOGNITION_THRESHOLD:.2f}")
    print(f"Profile Threshold      : {PROFILE_RECOGNITION_THRESHOLD:.2f}")
    print(f"Match Margin           : {MIN_MATCH_MARGIN:.2f}")
    print(f"YuNet Score Threshold  : {YUNET_SCORE_THRESHOLD:.2f}")
    print(f"Confirmation Frames    : {OBSERVATION_CONFIRMATION_FRAMES}")
    print(f"Cooldown Window        : {COOLDOWN_SECONDS:.0f}s per employee/event type")
    print(f"Max Processing FPS     : {MAX_PROCESS_FPS:.1f} per camera")
    print(f"Display Mode           : {'Headless (CLI Only)' if not gui_enabled else 'GUI Window Active'}")
    print("Controls               : Press 'q' or ESC (or Ctrl+C) to stop")
    print("=================================================================\n")

    start_iso = datetime.now(timezone.utc).isoformat()
    outbox: Optional[AttendanceOutbox] = None
    manager: Optional[MultiCameraManager] = None
    inference_workers: Dict[str, CameraInferenceWorker] = {}
    recovery_service: Optional[NVRRecoveryService] = None
    chosen_provider = "UNKNOWN"
    window_name = "Dual CP PLUS Attendance (CAM-01: OUT | CAM-02: IN)"
    gui_active = [gui_enabled]

    def _write_pipeline_status(state: str = "RUNNING") -> None:
        try:
            cam_states = {}
            for c_id in ("CAM-01", "CAM-02"):
                w = manager.get_worker(c_id) if manager else None
                cam_states[c_id] = {
                    "configured": c_id in configs,
                    "event_type": CAMERA_EVENT_MAPPING.get(c_id),
                    "connected": w.is_running() if w else False,
                    "ip": configs[c_id].ip if c_id in configs else None,
                    "fps": round(w.get_status().get("fps", 0.0), 1) if w else 0.0,
                }
            payload = {
                "pid": os.getpid(),
                "status": state,
                "updated_at": datetime.now(timezone.utc).isoformat(),
                "started_at": start_iso,
                "cameras": cam_states,
                "outbox": outbox.get_summary() if outbox else {},
            }
            tmp = status_file.with_suffix(".tmp")
            tmp.write_text(json.dumps(payload, indent=2), encoding="utf-8")
            tmp.replace(status_file)
        except Exception as ex:
            print(f"[Status] Could not write status file: {ex}")

    shutdown_requested = [False]

    def _sig_handler(sig, _frame):
        print("\n[Shutdown] Interrupt received. Stopping cleanly...")
        shutdown_requested[0] = True

    signal.signal(signal.SIGINT, _sig_handler)
    signal.signal(signal.SIGTERM, _sig_handler)

    try:
        # 2. Backend connectivity and outbox
        verify_backend_connectivity(BACKEND_API_URL)
        outbox = AttendanceOutbox(backend_url=BACKEND_API_URL, auth_token=INTERNAL_TOKEN)
        outbox.start()

        # 3. Registered employees
        active_employees = load_all_active_embeddings()
        print(f"Loaded {len(active_employees)} active registered employee embedding(s).")
        if not active_employees:
            print("[Warning] No active employee embeddings found. Enroll employees first.")

        # 4. Models
        if not YUNET_MODEL_PATH.exists() or not ARCFACE_MODEL_PATH.exists():
            print("[Error] Model files not found:")
            print(f"  YuNet   : {YUNET_MODEL_PATH} ({'FOUND' if YUNET_MODEL_PATH.exists() else 'MISSING'})")
            print(f"  ArcFace : {ARCFACE_MODEL_PATH} ({'FOUND' if ARCFACE_MODEL_PATH.exists() else 'MISSING'})")
            return

        print("Loading ArcFace model (w600k_r50)...")
        arcface, chosen_provider = load_arcface_model_auto(ARCFACE_MODEL_PATH)
        arcface_lock = threading.Lock()
        print(f"ArcFace model ready using: {chosen_provider}\n")

        # 5. Cameras
        if not cam_ids:
            print("[Error] Neither CAM-01 nor CAM-02 is configured in .env.")
            return

        manager = MultiCameraManager(camera_ids=cam_ids, auto_start=True)
        print(f"Started camera workers for: {cam_ids}")

        for cid in cam_ids:
            worker = manager.get_worker(cid)
            if not worker:
                print(f"[Warning] No camera worker for {cid}; skipping.")
                continue
            inf = CameraInferenceWorker(
                camera_id=cid,
                camera_worker=worker,
                event_type=CAMERA_EVENT_MAPPING[cid],
                active_employees=active_employees,
                arcface_model=arcface,
                arcface_lock=arcface_lock,
                outbox=outbox,
                recognition_threshold=RECOGNITION_THRESHOLD,
                profile_recognition_threshold=PROFILE_RECOGNITION_THRESHOLD,
                confirmation_frames=OBSERVATION_CONFIRMATION_FRAMES,
                cooldown_seconds=COOLDOWN_SECONDS,
                min_match_margin=MIN_MATCH_MARGIN,
                gui_enabled=gui_enabled,
            )
            inf.start()
            inference_workers[cid] = inf

        # 6. Optional NVR recovery
        if os.environ.get("NVR_RECOVERY_ENABLED", "false").lower() in ("true", "1", "yes"):
            try:
                recovery_service = NVRRecoveryService(outbox=outbox)
                recovery_service.start_background_worker(interval_seconds=600.0)
                print("[NVR Recovery] Background offline recovery worker active.")
            except Exception as ex:
                print(f"[NVR Recovery Warning] Could not start recovery service: {ex}")

        start_time = time.time()
        last_status_write = 0.0
        _write_pipeline_status("RUNNING")

        # 7. Main loop: preview and heartbeat only. Recognition runs in workers.
        while not shutdown_requested[0]:
            if gui_active[0]:
                try:
                    panels = [fit_panel(inference_workers[c].get_display_frame())
                              for c in ("CAM-01", "CAM-02") if c in inference_workers]
                    if len(panels) == 2:
                        combined = np.hstack((panels[0], panels[1]))
                    elif len(panels) == 1:
                        combined = panels[0]
                    else:
                        combined = np.zeros((DISPLAY_H, DISPLAY_W, 3), dtype=np.uint8)

                    cv2.imshow(window_name, combined)
                    key = cv2.waitKey(10) & 0xFF
                    if key in (ord("q"), ord("Q"), 27):
                        break
                except cv2.error as ex:
                    # No display available (e.g. SSH session): continue headless.
                    print(f"[Display] Preview disabled, continuing headless: {ex}")
                    gui_active[0] = False
            else:
                time.sleep(0.1)

            now_sec = time.time()
            if (now_sec - last_status_write) >= 3.0:
                last_status_write = now_sec
                _write_pipeline_status("RUNNING")

            # Restart any inference worker whose thread died.
            for cid, inf in list(inference_workers.items()):
                if not inf.is_alive() and not shutdown_requested[0]:
                    print(f"[Supervisor] Restarting inference worker for {cid}")
                    inf.start()

            if duration is not None and (time.time() - start_time) >= duration:
                break

    except Exception as ex:
        print(f"[FATAL] Pipeline error: {ex}")
        raise
    finally:
        print("\nStopping inference workers, camera streams and attendance outbox...")
        if recovery_service:
            try:
                recovery_service.stop_background_worker()
            except Exception:
                pass
        for inf_w in inference_workers.values():
            inf_w.stop()
        if manager:
            manager.stop_all()
        if outbox:
            outbox.stop()
        if gui_active[0]:
            try:
                cv2.destroyAllWindows()
            except cv2.error:
                pass

        _write_pipeline_status("STOPPED")
        try:
            if lock_file.exists():
                lock_file.unlink()
        except OSError:
            pass

        print("\n" + "=" * 70)
        print("DUAL-CAMERA ATTENDANCE TELEMETRY & AUDIT REPORT")
        print("=" * 70)
        for cid, inf_w in inference_workers.items():
            st = inf_w.get_stats()
            print(f"Camera ID                : {st.get('camera_id')} [{st.get('event_type')}]")
            print(f"  Connection Status      : {st.get('connection_status')}")
            print(f"  Frames Processed       : {st.get('frames_processed')}")
            print(f"  Faces Detected Total   : {st.get('faces_detected')}")
            print(f"  Employees Identified   : {st.get('registered_identified')}")
            print(f"  Distinct Unknown Tracks: {st.get('unknown_tracks')}")
            print(f"  Attendance Recorded    : {st.get('attendance_recorded')} ({st.get('event_type')} events)")
            print(f"  Duplicates Debounced   : {st.get('duplicates_prevented')}")
            print(f"  Average Frame Latency  : {st.get('avg_latency_ms'):.1f} ms")
            print(f"  Effective Processing   : {st.get('fps'):.1f} FPS")
            print("-" * 70)
        if outbox:
            print(f"Pending Outbox Events    : {outbox.get_depth()}")
        print(f"AI Execution Runtime     : {chosen_provider}")
        print("=" * 70)
        print("[INFO] Dual camera face recognition stopped cleanly.")


def main() -> None:
    parser = argparse.ArgumentParser(description="Production Dual-Camera Face Recognition Pipeline")
    parser.add_argument("--duration", type=float, default=None, help="Auto-close after N seconds")
    parser.add_argument("--no-gui", action="store_true", help="Run without the OpenCV preview window")
    parser.add_argument("--headless", action="store_true", help="Alias for --no-gui")
    args = parser.parse_args()

    run_dual_camera_recognition(
        duration=args.duration,
        no_gui=(args.no_gui or args.headless),
    )


if __name__ == "__main__":
    main()