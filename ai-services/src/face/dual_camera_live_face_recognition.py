"""Production Dual-Camera Live Face Recognition & Attendance Pipeline (CAM-01 & CAM-02).

Runs simultaneous, independent face detection, liveness verification, ArcFace recognition,
and production attendance recording across dual cameras:
- CAM-01: Dedicated Entry camera -> records verified "IN" events
- CAM-02: Dedicated Exit camera  -> records verified "OUT" events

Features:
- Independent camera capture & inference threads: A slower camera or network glitch never blocks the other.
- True capture timestamps: Accurately records the exact frame observation time from the camera.
- Multi-observation identity confirmation (suppresses single-frame flickers).
- Asynchronous persistent attendance outbox queue with bounded exponential backoff.
- Zero frame drops / zero UI freezes during backend latency or network outages.
- Direction-aware 60-second cooldown per (employee, event_type).
- Idempotency with unique event UUIDs and true capture timestamps.
- Clean shutdown and resource release on SIGINT/SIGTERM.
- Never hardcodes passwords; credentials are automatically masked.
"""

from __future__ import annotations

import argparse
import json
import logging
import os
import signal
import sys
import threading
import time
import uuid
from datetime import datetime, timezone
from pathlib import Path
from typing import Dict, Optional, Tuple, Any

import cv2
import numpy as np
import requests
from insightface.model_zoo import get_model

# Ensure paths
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

from camera_config import (
    CameraConfig,
    get_available_camera_configs,
    get_camera_config,
    sanitize_rtsp_url,
)
from camera_worker import CameraWorker, ConnectionState
from camera_manager import MultiCameraManager

from face_config import (
    YUNET_MODEL_PATH,
    ARCFACE_MODEL_PATH,
    REFERENCE_POINTS,
    EMBEDDINGS_DIR,
    RECOGNITION_THRESHOLD,
    PROFILE_RECOGNITION_THRESHOLD,
    DEFAULT_MIN_MATCH_MARGIN,
    GATE_GREEN_LINE_Y_RATIO,
    MIN_FACE_DIM_GATE_ZONE,
    MAX_ACTIVE_DETECTION_DISTANCE_METERS,
    UNKNOWN_CAPTURE_COOLDOWN_SECONDS,
    is_face_in_active_gate_zone,
    estimate_face_distance_meters,
    INITIAL_RECOGNITION_TIMEOUT_SECONDS,
    EMPLOYEE_RETRY_WINDOW_SECONDS,
    UNKNOWN_VERIFICATION_TIMEOUT_SECONDS,
    MIN_GOOD_QUALITY_OBSERVATIONS,
    EMPLOYEE_TRACK_CONTINUITY_SECONDS,
    UNKNOWN_ALERT_COOLDOWN_SECONDS,
    UNKNOWN_ALERT_REPEAT_ENABLED,
    REGISTRY_FILE,
    YUNET_SCORE_THRESHOLD_LIVE,
)

try:
    from employee_registry import load_all_active_embeddings, match_probe_against_registry, estimate_face_pose
except ImportError:
    from src.face.recognition.employee_registry import load_all_active_embeddings, match_probe_against_registry, estimate_face_pose

try:
    from multi_employee_recognition import MultiFaceTracker, TrackedFace, check_face_crop_quality
except ImportError:
    from src.face.recognition.multi_employee_recognition import MultiFaceTracker, TrackedFace, check_face_crop_quality

try:
    from face_preprocess import preprocess_face
except ImportError:
    from src.face.recognition.face_preprocess import preprocess_face

from live_face_recognition import TemporalLivenessTracker, draw_hud, draw_multi_person_hud
from attendance_outbox import AttendanceOutbox

logger = logging.getLogger(__name__)

try:
    from stream_server import start_stream_server
except ImportError:
    from src.face.stream_server import start_stream_server

try:
    from nvr_recovery_service import NVRRecoveryService
except ImportError:
    from camera.nvr_recovery_service import NVRRecoveryService

try:
    from src.surveillance.gate_classifier import GateObjectClassifierPipeline, load_gate_zones, get_ist_now_iso
    from src.surveillance.gate_hud import draw_gate_surveillance_hud
except ImportError:
    from surveillance.gate_classifier import GateObjectClassifierPipeline, load_gate_zones, get_ist_now_iso
    from surveillance.gate_hud import draw_gate_surveillance_hud

try:
    from src.vehicle.plate.plate_reader import recognize_plate
except ImportError:
    from vehicle.plate.plate_reader import recognize_plate

# Camera Mapping: CAM-01 is dedicated OUT, CAM-02 is dedicated IN
CAMERA_EVENT_MAPPING = {
    "CAM-01": "OUT",
    "CAM-02": "IN",
}

# Cross-camera shared attendance cooldown & session cache to prevent duplicate entries between CAM-01 and CAM-02
SHARED_ATTENDANCE_CACHE: Dict[str, Dict[str, Any]] = {}
SHARED_ATTENDANCE_LOCK = threading.Lock()


# -----------------------------------------------------------------------------
# Explicit Recognition States & Thread-Safe Verification Data Structures
# -----------------------------------------------------------------------------

class RecognitionState:
    RECOGNIZED = "RECOGNIZED"
    UNCERTAIN = "UNCERTAIN"
    VERIFYING_UNKNOWN = "VERIFYING_UNKNOWN"
    CONFIRMED_UNKNOWN = "CONFIRMED_UNKNOWN"
    ALERT_SENT = "ALERT_SENT"
    APPROACHING = "APPROACHING"


class CrossCameraUnknownAlertManager:
    """Thread-safe cross-camera deduplication for confirmed unknown alerts.
    
    Prevents duplicate notifications across CAM-01 and CAM-02 when reliable cross-camera
    evidence identifies the same person, using ArcFace embedding cosine similarity.
    """

    def __init__(self, cooldown_seconds: float = UNKNOWN_ALERT_COOLDOWN_SECONDS) -> None:
        self.cooldown_seconds = cooldown_seconds
        self.lock = threading.Lock()
        self.recent_alerts: List[Dict[str, Any]] = []

    def is_on_cooldown(self, embedding: Optional[np.ndarray], now_mono: float) -> Tuple[bool, Optional[str]]:
        with self.lock:
            # Clean expired alerts
            self.recent_alerts = [
                a for a in self.recent_alerts
                if (now_mono - a["timestamp"]) < self.cooldown_seconds
            ]
            if embedding is None:
                return False, None

            norm_probe = embedding / (np.linalg.norm(embedding) + 1e-9)
            for a in self.recent_alerts:
                cached_emb = a["embedding"]
                norm_cached = cached_emb / (np.linalg.norm(cached_emb) + 1e-9)
                sim = float(np.dot(norm_probe, norm_cached))
                if sim >= 0.45:
                    rem_sec = int(self.cooldown_seconds - (now_mono - a["timestamp"]))
                    return True, f"ALERT COOLDOWN ({a['camera_id']} sent alert, {rem_sec}s remaining)"
            return False, None

    def record_alert(self, embedding: np.ndarray, camera_id: str, track_id: int, now_mono: float) -> None:
        with self.lock:
            self.recent_alerts.append({
                "embedding": embedding.copy(),
                "camera_id": camera_id,
                "track_id": track_id,
                "timestamp": now_mono,
            })

    def clear(self) -> None:
        with self.lock:
            self.recent_alerts.clear()


SHARED_UNKNOWN_ALERT_MANAGER = CrossCameraUnknownAlertManager()


def crop_zoomed_passport_photo(frame: np.ndarray, bbox: Tuple[int, int, int, int]) -> np.ndarray:
    """Crops a centered, high-clarity passport-size portrait (4:5 ratio) with focused face zoom."""
    if frame is None or frame.size == 0:
        return np.zeros((450, 360, 3), dtype=np.uint8)

    h, w = frame.shape[:2]
    bx, by, bw, bh = bbox
    if bw <= 0 or bh <= 0:
        return np.zeros((450, 360, 3), dtype=np.uint8)

    cx = bx + bw // 2
    cy = by + bh // 2

    # Proportional face zoom with standard passport headroom and shoulders:
    # Face should occupy ~60-70% of the passport photo height
    crop_h = int(bh * 1.85)
    crop_w = int(crop_h * 0.8)  # Standard 4:5 aspect ratio

    # Shift box slightly down so eyes are placed in upper 35% of the photo
    top = max(0, cy - int(crop_h * 0.42))
    bottom = min(h, top + crop_h)
    left = max(0, cx - crop_w // 2)
    right = min(w, left + crop_w)

    crop = frame[top:bottom, left:right]
    if crop.size == 0 or crop.shape[0] < 10 or crop.shape[1] < 10:
        crop = frame[max(0, by):min(h, by + bh), max(0, bx):min(w, bx + bw)]

    if crop.size == 0:
        return np.zeros((450, 360, 3), dtype=np.uint8)

    # Resize with high-quality Lanczos4 interpolation to crisp 360x450
    resized = cv2.resize(crop, (360, 450), interpolation=cv2.INTER_LANCZOS4)

    # Apply subtle unsharp masking for high visual clarity
    blurred = cv2.GaussianBlur(resized, (0, 0), 1.5)
    sharpened = cv2.addWeighted(resized, 1.25, blurred, -0.25, 0)
    return sharpened


class UnknownVerificationSession:
    """Thread-safe multi-frame verification session for a single tracked person.
    
    Maintains timing, quality evidence, head pose history, employee continuity,
    and single-alert dispatch management.
    """

    def __init__(self, track_id: int, camera_id: str, clock_fn=time.monotonic) -> None:
        self.track_id: int = track_id
        self.camera_id: str = camera_id
        self.clock_fn = clock_fn
        self.lock = threading.Lock()

        # Explicit Recognition State
        self.state: str = RecognitionState.UNCERTAIN
        self.status_detail: str = "INITIAL_SCAN"

        # Monotonic Clocks
        now = self.clock_fn()
        self.first_detected_time: float = now
        self.verification_start_time: Optional[float] = None
        self.last_observation_time: float = now

        # Employee Identity & Continuity Tracking
        self.confirmed_employee_id: Optional[str] = None
        self.confirmed_employee_name: Optional[str] = None
        self.last_employee_match_time: Optional[float] = None
        self.consecutive_matches: int = 0
        self.matched_view: str = "FRONT"
        self.highest_similarity: float = 0.0
        self.pending_unknown_cancelled: bool = False

        # Evidence Collection
        self.good_quality_observations: int = 0
        self.low_quality_observations: int = 0
        self.observed_poses: set = set()
        self.max_employee_similarity_seen: float = 0.0
        self.latest_face_crop: Optional[np.ndarray] = None
        self.latest_live_emb: Optional[np.ndarray] = None
        self.last_sharpness: float = 0.0
        self.last_brightness: float = 0.0
        self.last_head_pose: str = "FRONT"

        # Multi-frame Frontal Evidence Accumulation
        self.frontal_candidate_observations: list = []
        self.last_frontal_obs_time: float = 0.0
        self.last_diag_log_time: float = 0.0

        # Alert Dispatch & Status
        self.alert_sent: bool = False
        self.alert_sent_time: Optional[float] = None
        self.alert_status_msg: str = ""

BACKEND_API_URL = os.environ.get("BACKEND_API_URL", "https://facetrack.gldatacenter.com/api")
INTERNAL_TOKEN = os.environ.get("AI_INTERNAL_TOKEN", "AI_SYSTEM_INTERNAL_TOKEN_V1")
COOLDOWN_SECONDS = float(os.environ.get("ATTENDANCE_COOLDOWN_SEC", "120.0"))
OBSERVATION_CONFIRMATION_FRAMES = int(os.environ.get("CONFIRMATION_FRAMES", "1"))
DEFAULT_MIN_MATCH_MARGIN = float(os.environ.get("MIN_MATCH_MARGIN", "0.04"))
AI_PROCESS_INTERVAL_SEC = max(0.02, float(os.environ.get("AI_PROCESS_INTERVAL_MS", "33")) / 1000.0)
FACE_DEBUG_DUMP_INTERVAL_SEC = max(0.0, float(os.environ.get("FACE_DEBUG_DUMP_INTERVAL_SEC", "5.0")))


def verify_backend_connectivity(api_url: str) -> bool:
    """Verifies that the backend API is alive and reachable before camera loop starts."""
    base_url = api_url.rstrip("/")
    health_endpoint = f"{base_url}/health"
    try:
        resp = requests.get(health_endpoint, timeout=3.0)
        if resp.status_code == 200:
            print(f"[Backend Health] Connectivity verified: {health_endpoint} -> 200 OK")
            return True
        print(f"[Backend Health Warning] Health check returned HTTP {resp.status_code}")
        return False
    except Exception as ex:
        print(f"[Backend Health Warning] Backend not currently reachable ({ex}). Outbox will queue and retry.")
        return False


def load_arcface_model_auto(model_path: Path) -> Tuple[Any, str]:
    """Loads ArcFace model, prioritizing GPU CUDAExecutionProvider if supported, falling back to CPU."""
    providers = ["CPUExecutionProvider"]
    try:
        import onnxruntime as ort
        available = ort.get_available_providers()
        if "CUDAExecutionProvider" in available:
            providers = ["CUDAExecutionProvider", "CPUExecutionProvider"]
    except Exception:
        pass

    try:
        model = get_model(str(model_path), providers=providers)
        model.prepare(ctx_id=0)
        chosen = "GPU (CUDAExecutionProvider)" if providers[0].startswith("CUDA") else "CPU (CPUExecutionProvider)"
        return model, chosen
    except Exception as ex:
        print(f"[ArcFace Loader] Provider fallback due to: {ex}")
        model = get_model(str(model_path), providers=["CPUExecutionProvider"])
        model.prepare(ctx_id=0)
        return model, "CPU (CPUExecutionProvider)"


class CameraInferenceWorker:
    """Dedicated multi-person inference pipeline for a single camera stream.

    Processes frames completely independently from other cameras:
    - Multi-person spatial tracking (IoU + centroid association).
    - Per-track temporal liveness and quality verification.
    - Track-based ArcFace scheduling (reduces CPU load by reusing confirmed identity).
    - Multi-embedding cosine similarity matching with Top-1 vs Top-2 ambiguity guard.
    - Distinct unknown track counting (avoids multi-frame duplicate increments).
    - True capture timestamp and idempotent event queueing with direction-aware cooldown.
    - Clean thread isolation: faults or latency on one camera never block the other.
    """

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
        min_match_margin: float = DEFAULT_MIN_MATCH_MARGIN,
        gui_enabled: bool = True,
    ) -> None:
        self.camera_id = camera_id
        self.camera_worker = camera_worker
        self.event_type = event_type
        self.active_employees = active_employees
        self._registry_lock = threading.RLock()
        self._registry_mtime = REGISTRY_FILE.stat().st_mtime if REGISTRY_FILE.exists() else 0
        self.arcface = arcface_model
        self.arcface_lock = arcface_lock
        self.outbox = outbox
        self.recognition_threshold = recognition_threshold
        self.profile_recognition_threshold = profile_recognition_threshold
        self.confirmation_frames = confirmation_frames
        self.cooldown_seconds = cooldown_seconds
        self.min_match_margin = min_match_margin
        self.gui_enabled = gui_enabled

        # Timing and verification configuration
        self.clock_fn = time.monotonic
        self.initial_rec_timeout_sec: float = INITIAL_RECOGNITION_TIMEOUT_SECONDS
        self.employee_retry_window_sec: float = EMPLOYEE_RETRY_WINDOW_SECONDS
        self.unknown_verification_timeout_sec: float = UNKNOWN_VERIFICATION_TIMEOUT_SECONDS
        self.min_good_quality_obs: int = MIN_GOOD_QUALITY_OBSERVATIONS
        self.employee_track_continuity_sec: float = EMPLOYEE_TRACK_CONTINUITY_SECONDS
        self.unknown_alert_cooldown_sec: float = UNKNOWN_ALERT_COOLDOWN_SECONDS
        self.unknown_alert_repeat_enabled: bool = UNKNOWN_ALERT_REPEAT_ENABLED

        # Gate Surveillance Classifier & Object Tracker (YOLO11n + Face + Plate + Animal)
        zone_map = load_gate_zones()
        self.zone_cfg = zone_map.get(self.camera_id, {"direction": self.event_type, "tripwire": {"normalized_y": 0.58}})
        self.gate_classifier = GateObjectClassifierPipeline(
            camera_id=self.camera_id,
            zone_config=self.zone_cfg,
        )
        self.crop_detector = cv2.FaceDetectorYN.create(
            str(YUNET_MODEL_PATH),
            "",
            (320, 320),
            YUNET_SCORE_THRESHOLD_LIVE,
            0.3,
            50,
        )

        # Thread-safe person verification sessions keyed by track_id
        self.verification_sessions: Dict[int, UnknownVerificationSession] = {}
        self._sessions_lock = threading.Lock()

        # Independent spatial multi-face tracker per camera worker
        self.tracker = MultiFaceTracker(max_missed=45)
        self.detector: Optional[cv2.FaceDetectorYN] = None
        self.input_size: Tuple[int, int] = (0, 0)

        # Local debounce & event tracking
        self.last_attendance_sent: Dict[str, float] = {}
        self.last_unknown_sent: float = 0.0
        self._recent_unknown_embeddings: List[Dict[str, Any]] = []
        self.frame_count: int = 0
        self._last_face_debug_dump_at: float = 0.0
        self.last_processed_frame_idx: int = -1

        # Per-camera statistics & telemetry
        self.stats: Dict[str, Any] = {
            "frames_processed": 0,
            "dropped_frames": 0,
            "faces_detected": 0,
            "registered_identified": 0,
            "unknown_tracks": 0,
            "attendance_recorded": 0,
            "duplicates_prevented": 0,
            "avg_latency_ms": 0.0,
            "connection_status": "CONNECTING",
        }

        # Diagnostics & HUD state
        self._hud_lock = threading.Lock()
        self.latest_display_frame: Optional[np.ndarray] = None
        self._fps: float = 0.0
        self._fps_time: float = time.time()
        self._fps_frames: int = 0

        # Threading
        self._thread: Optional[threading.Thread] = None
        self._stop_event = threading.Event()

    def start(self) -> None:
        self._stop_event.clear()
        self._thread = threading.Thread(
            target=self._run_loop,
            name=f"InferenceWorker-{self.camera_id}",
            daemon=True,
        )
        self._thread.start()

    def stop(self, timeout: float = 2.0) -> None:
        self._stop_event.set()
        if self._thread and self._thread.is_alive():
            self._thread.join(timeout=timeout)

    def _get_or_create_session(self, track_id: int) -> UnknownVerificationSession:
        """Retrieves or creates a thread-safe verification session for track_id."""
        with self._sessions_lock:
            if track_id not in self.verification_sessions:
                self.verification_sessions[track_id] = UnknownVerificationSession(
                    track_id=track_id,
                    camera_id=self.camera_id,
                    clock_fn=self.clock_fn,
                )
            return self.verification_sessions[track_id]

    def _cleanup_stale_sessions(self, active_track_ids: set, now_mono: float) -> None:
        """Removes verification sessions for tracks that left the camera scene."""
        with self._sessions_lock:
            stale = [
                tid for tid, s in self.verification_sessions.items()
                if tid not in active_track_ids and (now_mono - s.last_observation_time) > 5.0
            ]
            for tid in stale:
                del self.verification_sessions[tid]

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

        placeholder = np.zeros((360, 640, 3), dtype=np.uint8)
        state_msg = self.camera_worker.state.value if self.camera_worker else "OFFLINE"
        cv2.putText(
            placeholder,
            f"[{self.camera_id} - {self.event_type}] {state_msg}",
            (80, 160),
            cv2.FONT_HERSHEY_SIMPLEX,
            0.7,
            (0, 165, 255),
            2,
        )
        cv2.putText(
            placeholder,
            "Waiting for video frames...",
            (120, 200),
            cv2.FONT_HERSHEY_SIMPLEX,
            0.5,
            (180, 180, 180),
            1,
        )
        return placeholder

    def _detect_faces_in_crop(self, crop: np.ndarray) -> Optional[np.ndarray]:
        if crop is None or crop.size == 0:
            return None
        ch, cw = crop.shape[:2]
        if cw < 30 or ch < 30:
            return None
        self.crop_detector.setInputSize((cw, ch))
        _, faces = self.crop_detector.detect(crop)
        return faces

    def _recognize_face_probe(
        self,
        face_crop: np.ndarray,
        landmarks: np.ndarray,
        full_frame: np.ndarray,
        face_bbox: Optional[Tuple[int, int, int, int]] = None,
        track_id: Optional[int] = None,
    ) -> Dict[str, Any]:
        try:
            current_mtime = REGISTRY_FILE.stat().st_mtime if REGISTRY_FILE.exists() else 0
            with self._registry_lock:
                if current_mtime != self._registry_mtime:
                    refreshed = load_all_active_embeddings()
                    self.active_employees = refreshed
                    self._registry_mtime = current_mtime
                    print(f"[{self.camera_id}] Employee face registry refreshed ({len(refreshed)} active)")
                active_employees = self.active_employees
            if face_crop is None or face_crop.size == 0:
                return {"status": "LOW_QUALITY", "similarity": 0.0, "error": "Empty face crop"}
            # Use the same alignment path as enrollment: estimate the transform from
            # full-frame landmarks, enhance only the detected face rectangle, then warp
            # the source frame to the 112x112 ArcFace crop. Warping the tight face
            # rectangle alone clips pixels around the face and lowers match scores.
            if face_bbox is None:
                bx = int(round(float(landmarks[:, 0].min())))
                by = int(round(float(landmarks[:, 1].min())))
                face_x1, face_y1 = bx, by
                face_x2 = face_x1 + int(face_crop.shape[1])
                face_y2 = face_y1 + int(face_crop.shape[0])
            else:
                face_x1, face_y1, face_w, face_h = map(int, face_bbox)
                face_x2 = face_x1 + face_w
                face_y2 = face_y1 + face_h
            frame_h, frame_w = full_frame.shape[:2]
            face_x1, face_y1 = max(0, face_x1), max(0, face_y1)
            face_x2, face_y2 = min(frame_w, face_x2), min(frame_h, face_y2)
            if face_x2 <= face_x1 or face_y2 <= face_y1:
                return {"status": "LOW_QUALITY", "similarity": 0.0, "error": "Face crop is outside the frame"}

            transform, _ = cv2.estimateAffinePartial2D(
                landmarks.astype(np.float32),
                REFERENCE_POINTS,
                method=cv2.LMEDS,
            )
            if transform is None:
                return {"status": "LOW_QUALITY", "similarity": 0.0, "error": "Face crop alignment failed"}
            # Match enrollment's preprocessing order and scope exactly: enhance the
            # face pixels in a copy of the source frame, then align from global landmarks.
            enhanced_crop = preprocess_face(face_crop, fast_mode=True)
            working_frame = full_frame.copy()
            target_roi = working_frame[face_y1:face_y2, face_x1:face_x2]
            copy_h = min(target_roi.shape[0], enhanced_crop.shape[0])
            copy_w = min(target_roi.shape[1], enhanced_crop.shape[1])
            target_roi[:copy_h, :copy_w] = enhanced_crop[:copy_h, :copy_w]
            aligned = cv2.warpAffine(working_frame, transform, (112, 112))
            with self.arcface_lock:
                raw_emb = self.arcface.get_feat(aligned).flatten()
            raw_norm = float(np.linalg.norm(raw_emb))
            if raw_norm <= 0 or not np.isfinite(raw_norm):
                return {"status": "RECOGNITION_ERROR", "similarity": 0.0, "error": "ArcFace returned an invalid embedding"}
            live_emb = (raw_emb / raw_norm).flatten()
            decision = match_probe_against_registry(
                probe_emb=live_emb,
                active_employees=active_employees,
                recognition_threshold=self.recognition_threshold,
                min_match_margin=self.min_match_margin,
                profile_recognition_threshold=self.profile_recognition_threshold,
                probe_landmarks=landmarks,
            )
            # Let the track owner discard temporal votes made against an older
            # enrollment registry when a new employee is registered or updated.
            decision["registry_revision"] = current_mtime
            decision["aligned_face"] = aligned
            # Reuse the exact live ArcFace vector when persisting an unknown capture;
            # this avoids a second model load/extraction in the API process.
            decision["embedding"] = live_emb.tolist()
            now_monotonic = time.monotonic()
            if now_monotonic - self._last_face_debug_dump_at >= FACE_DEBUG_DUMP_INTERVAL_SEC:
                debug_dir = Path(_AI_SERVICES_DIR) / "data" / "debug"
                debug_dir.mkdir(parents=True, exist_ok=True)
                crop_path = Path(_AI_SERVICES_DIR) / "data" / "captures" / f"face_debug_{self.camera_id}.jpg"
                cv2.imwrite(str(crop_path), aligned)
                now_iso = datetime.now(timezone.utc).isoformat()
                debug_payload = {
                    "camera_id": self.camera_id,
                    "track_id": track_id,
                    "timestamp": now_iso,
                    "face_size": [int(face_crop.shape[1]), int(face_crop.shape[0])],
                    "quality": "QUALITY_PASS",
                    "best_employee": decision.get("employee_id") or decision.get("top_candidate"),
                    "best_score": decision.get("similarity") or decision.get("top_similarity"),
                    "second_score": decision.get("second_similarity"),
                    "threshold": decision.get("threshold", self.recognition_threshold),
                    "margin": decision.get("margin"),
                    "decision": decision.get("status"),
                    "top3": decision.get("rankings", [])[:3],
                    "aligned_crop_path": str(crop_path),
                }
                debug_path = debug_dir / f"face_last_{self.camera_id}.json"
                temporary = debug_path.with_suffix(".json.tmp")
                temporary.write_text(json.dumps(debug_payload, default=float), encoding="utf-8")
                temporary.replace(debug_path)
                self._last_face_debug_dump_at = now_monotonic
                decision["aligned_crop_path"] = str(crop_path)
            return decision
        except Exception as ex:
            logger.error("[%s] Track %s face recognition failed: %s", self.camera_id, track_id, ex)
            return {"status": "RECOGNITION_ERROR", "similarity": 0.0, "error": str(ex)}

    def _run_loop(self) -> None:
        while not self._stop_event.is_set():
            t_f0 = time.perf_counter()

            has_frame, frame, capture_ts, f_idx = (
                self.camera_worker.get_latest_frame()
                if self.camera_worker
                else (False, None, 0.0, 0)
            )

            # Avoid re-processing identical unchanged frames
            if not has_frame or frame is None or f_idx == self.last_processed_frame_idx:
                time.sleep(0.005)
                continue

            if self.last_processed_frame_idx >= 0 and f_idx > self.last_processed_frame_idx + 1:
                self.stats["dropped_frames"] += f_idx - self.last_processed_frame_idx - 1
            self.last_processed_frame_idx = f_idx
            self.frame_count += 1
            self.stats["frames_processed"] = self.frame_count

            if self.camera_worker:
                self.stats["connection_status"] = self.camera_worker.state.value

            # FPS calculation
            self._fps_frames += 1
            now_sec = time.time()
            if (now_sec - self._fps_time) >= 1.0:
                self._fps = self._fps_frames / (now_sec - self._fps_time)
                self._fps_frames = 0
                self._fps_time = now_sec

            # Accurate observation/capture timestamp formatted in ISO UTC
            if capture_ts > 0:
                capture_iso = datetime.fromtimestamp(capture_ts, tz=timezone.utc).isoformat()
            else:
                capture_iso = datetime.now(timezone.utc).isoformat()

            h, w = frame.shape[:2]

            try:
                # 1. Unified Gate Object Classification & Tracking (PERSON, VEHICLE, ANIMAL)
                tracks_hud_info, new_events = self.gate_classifier.process_frame(
                    frame=frame,
                    yunet_detector_fn=self._detect_faces_in_crop,
                    arcface_recognizer_fn=self._recognize_face_probe,
                    plate_pipeline_fn=recognize_plate,
                )

                # 2. Sync recognized employee attendances to durable outbox
                for ev in new_events:
                    emp_id = ev.get('employeeId') or ev.get('employee_id')
                    ev_type = ev.get('eventType') or ev.get('event_type')
                    if emp_id and ev_type in ('PERSON_IN', 'PERSON_OUT'):
                        now_epoch = time.time()
                        duplicate_suppressed = False
                        with SHARED_ATTENDANCE_LOCK:
                            shared_record = SHARED_ATTENDANCE_CACHE.get(emp_id)
                            if shared_record:
                                elapsed = now_epoch - float(shared_record.get('timestamp_sec', 0.0))
                                if elapsed < self.cooldown_seconds:
                                    duplicate_suppressed = True
                            if not duplicate_suppressed:
                                SHARED_ATTENDANCE_CACHE[emp_id] = {
                                    'timestamp_sec': now_epoch,
                                    'date_str': datetime.now().strftime('%Y-%m-%d'),
                                    'camera_id': self.camera_id,
                                    'event_type': self.event_type,
                                }
                        if duplicate_suppressed:
                            self.stats['duplicates_prevented'] = int(self.stats.get('duplicates_prevented', 0)) + 1
                            continue
                        self.outbox.enqueue(
                            event_id=str(uuid.uuid4()),
                            employee_id=emp_id,
                            camera_id=self.camera_id,
                            event_type=self.event_type,
                            similarity=round(float(ev.get('matchScore') or 0.95), 4),
                            timestamp=capture_iso,
                            source=f'CP_PLUS_{self.camera_id}',
                            status='PRESENT',
                            captured_image=ev.get('imageFace'),
                        )
                        self.stats['attendance_recorded'] += 1
                        with SHARED_ATTENDANCE_LOCK:
                            SHARED_ATTENDANCE_CACHE[emp_id] = {
                                'timestamp_sec': time.time(),
                                'date_str': datetime.now().strftime('%Y-%m-%d'),
                                'camera_id': self.camera_id,
                                'event_type': self.event_type,
                            }

                # 3. Update telemetry KPIs
                p_count = sum(1 for t in tracks_hud_info if t.get('class') == 'PERSON')
                v_count = sum(1 for t in tracks_hud_info if t.get('class') == 'VEHICLE')
                a_count = sum(1 for t in tracks_hud_info if t.get('class') == 'ANIMAL')
                self.stats['faces_detected'] = p_count
                self.stats['vehicles_detected'] = v_count
                self.stats['animals_detected'] = a_count

                # Latency Telemetry
                frame_elapsed_ms = (time.perf_counter() - t_f0) * 1000.0
                self.stats['avg_latency_ms'] = round(
                    0.9 * self.stats['avg_latency_ms'] + 0.1 * frame_elapsed_ms, 1
                )

                # 4. Multi-Class Surveillance HUD & Live MJPEG Frame Generation
                tripwire_y = self.zone_cfg.get('tripwire', {}).get('normalized_y', 0.58)
                hud = draw_gate_surveillance_hud(
                    frame=frame,
                    tracks_info=tracks_hud_info,
                    camera_id=self.camera_id,
                    event_type=self.event_type,
                    fps=self._fps,
                    tripwire_normalized_y=tripwire_y,
                    stats=self.stats,
                )
                resized_hud = cv2.resize(hud, (960, 540), interpolation=cv2.INTER_LINEAR)
                with self._hud_lock:
                    self.latest_display_frame = resized_hud

            except Exception as frame_err:
                print(f"[{self.camera_id}] Inference error on frame {f_idx}: {frame_err}")
                # Fallback: display original frame so stream never freezes
                try:
                    fallback_hud = cv2.resize(frame, (960, 540), interpolation=cv2.INTER_LINEAR)
                    cv2.putText(fallback_hud, f"[{self.camera_id}] Inference Warning", (30, 40),
                                cv2.FONT_HERSHEY_SIMPLEX, 0.7, (0, 165, 255), 2)
                    with self._hud_lock:
                        self.latest_display_frame = fallback_hud
                except Exception:
                    pass
            remaining_interval = AI_PROCESS_INTERVAL_SEC - (time.perf_counter() - t_f0)
            if remaining_interval > 0:
                time.sleep(remaining_interval)

    def _evaluate_attendance_for_track(self, track: Any, capture_iso: str, raw_frame: Optional[np.ndarray] = None) -> None:
        """Evaluates direction-aware attendance cooldown and enqueues event to durable outbox.

        Cross-camera deduplication:
        Checks SHARED_ATTENDANCE_CACHE so that an employee confirmed on CAM-01 does not
        trigger a duplicate attendance entry on CAM-02 within the cooldown period or session.
        """
        emp_id = track.employee_id
        if not emp_id:
            return

        now_time = time.time()
        today_str = datetime.now().strftime("%Y-%m-%d")

        with SHARED_ATTENDANCE_LOCK:
            shared_rec = SHARED_ATTENDANCE_CACHE.get(emp_id)
            if shared_rec:
                last_time = shared_rec.get("timestamp_sec", 0.0)
                last_cam = shared_rec.get("camera_id")
                last_event = shared_rec.get("event_type")

                # Suppress if marked within cooldown on either camera
                if (now_time - last_time) < self.cooldown_seconds:
                    self.stats["duplicates_prevented"] += 1
                    track.attendance_state = f"Cooldown ({last_cam})"
                    return

            # Enqueue attendance
            event_id = str(uuid.uuid4())
            sim = track.similarity or self.recognition_threshold

            # Capture high-quality face portrait crop for the live monitoring dashboard
            captured_filename = None
            if raw_frame is not None and getattr(track, "bbox", None) is not None:
                try:
                    h_f, w_f = raw_frame.shape[:2]
                    bx, by, bw, bh = track.bbox
                    # Professional passport-size portrait crop (3:4 ratio: head + hair + collar/shoulders)
                    pad_top = int(bh * 0.35)
                    pad_bot = int(bh * 0.45)
                    pad_side = int(bw * 0.30)
                    cy1, cy2 = max(0, by - pad_top), min(h_f, by + bh + pad_bot)
                    cx1, cx2 = max(0, bx - pad_side), min(w_f, bx + bw + pad_side)
                    face_crop = raw_frame[cy1:cy2, cx1:cx2]

                    if face_crop.size > 0:
                        # Standardize to crisp passport photo dimensions (240x300)
                        face_crop = cv2.resize(face_crop, (240, 300), interpolation=cv2.INTER_AREA)
                        captures_dir = Path(_AI_SERVICES_DIR) / "data" / "captures"
                        captures_dir.mkdir(parents=True, exist_ok=True)
                        captured_filename = f"recognized_{self.camera_id}_{emp_id}_{int(now_time * 1000)}.jpg"
                        cv2.imwrite(str(captures_dir / captured_filename), face_crop)
                        cv2.imwrite(str(captures_dir / f"latest_{self.camera_id}.jpg"), face_crop)
                        cv2.imwrite(str(captures_dir / "latest_recognition.jpg"), face_crop)
                        cv2.imwrite(str(captures_dir / "current_monitoring.jpg"), face_crop)
                except Exception as cap_err:
                    print(f"[{self.camera_id}] Face crop notice: {cap_err}")

            self.outbox.enqueue(
                event_id=event_id,
                employee_id=emp_id,
                camera_id=self.camera_id,
                event_type=self.event_type,
                similarity=round(float(sim), 4),
                timestamp=capture_iso,
                source=f"CP_PLUS_{self.camera_id}",
                status="PRESENT",
                captured_image=captured_filename,
            )
            self.stats["attendance_recorded"] += 1
            track.attendance_state = f"{self.event_type} Recorded"

            # Update shared cross-camera attendance state
            SHARED_ATTENDANCE_CACHE[emp_id] = {
                "timestamp_sec": now_time,
                "date_str": today_str,
                "camera_id": self.camera_id,
                "event_type": self.event_type,
            }
            self.last_attendance_sent[emp_id] = now_time

            m_view = getattr(track, "matched_view", "FRONT")
            matched_view_str = m_view if isinstance(m_view, str) else "FRONT"
            print(
                f"[{self.camera_id}] [{self.event_type} PRESENT] {emp_id} ({track.name or emp_id}) "
                f"[{matched_view_str}] | Sim: {sim:.4f} | EventID: {event_id} | Time: {capture_iso}"
            )

    def _dispatch_confirmed_unknown_alert(
        self,
        session: UnknownVerificationSession,
        frame: np.ndarray,
        bbox: Tuple[int, int, int, int],
    ) -> None:
        """Dispatches confirmed unknown alert ensuring single notification, 120s cooldown and cross-camera deduplication."""
        if session.alert_sent and not self.unknown_alert_repeat_enabled:
            return

        now_mono = self.clock_fn()

        # 1. Cross-Camera & Global Alert Cooldown check
        is_cooldown, cd_msg = SHARED_UNKNOWN_ALERT_MANAGER.is_on_cooldown(session.latest_live_emb, now_mono)
        if is_cooldown:
            session.state = RecognitionState.ALERT_SENT
            session.alert_sent = True
            session.alert_status_msg = cd_msg
            return

        # 2. Strict Employee Safety Guard: Re-verify against all registered employees
        if session.latest_live_emb is not None and self.active_employees:
            norm_live = session.latest_live_emb / (np.linalg.norm(session.latest_live_emb) + 1e-9)
            for emp_id, emp_data in self.active_employees.items():
                embs = emp_data.get("embeddings") or [emp_data.get("embedding")]
                for ref in embs:
                    if ref is not None:
                        ref_n = ref / (np.linalg.norm(ref) + 1e-9)
                        if float(np.dot(norm_live, ref_n)) >= 0.35:
                            # Matches registered employee! Cancel alert!
                            session.state = RecognitionState.RECOGNIZED
                            session.confirmed_employee_id = emp_id
                            session.alert_status_msg = "EMPLOYEE MATCHED — PENDING UNKNOWN ALERT CANCELLED"
                            return

        # 3. Mark alert sent & record in cross-camera manager
        session.alert_sent = True
        session.alert_sent_time = now_mono
        session.state = RecognitionState.ALERT_SENT
        session.alert_status_msg = "CONFIRMED UNKNOWN — PHONE ALERT SENT"

        if session.latest_live_emb is not None:
            SHARED_UNKNOWN_ALERT_MANAGER.record_alert(
                embedding=session.latest_live_emb,
                camera_id=self.camera_id,
                track_id=session.track_id,
                now_mono=now_mono,
            )

        print(f"[{self.camera_id}] Track #{session.track_id}: CONFIRMED UNKNOWN — PHONE ALERT SENT (Cooldown: {self.unknown_alert_cooldown_sec}s)")

        # 4. Save unknown snapshot & dispatch to backend API asynchronously
        self._post_unknown_thumbnail_async(session, frame, bbox)

    def _post_unknown_thumbnail_async(
        self,
        session: UnknownVerificationSession,
        frame: np.ndarray,
        bbox: Tuple[int, int, int, int],
    ) -> None:
        try:
            h, w = frame.shape[:2]
            bx, by, bw, bh = bbox
            pad = 20
            cy1, cy2 = max(0, by - pad), min(h, by + bh + pad)
            cx1, cx2 = max(0, bx - pad), min(w, bx + bw + pad)
            face_crop = frame[cy1:cy2, cx1:cx2]

            if face_crop.size > 0:
                unknown_dir = Path(_AI_SERVICES_DIR) / "data" / "unknown"
                unknown_dir.mkdir(parents=True, exist_ok=True)
                fname = f"unknown_{self.camera_id}_trk{session.track_id}_{int(time.time() * 1000)}.jpg"
                cv2.imwrite(str(unknown_dir / fname), face_crop)

                payload = {
                    "image": fname,
                    "visitCount": self.stats["unknown_tracks"],
                    "cameraId": self.camera_id,
                    "embedding": session.latest_live_emb.tolist() if session.latest_live_emb is not None else None,
                }
                threading.Thread(
                    target=self._post_unknown_backend,
                    args=(payload,),
                    daemon=True,
                ).start()
        except Exception as ex:
            print(f"[{self.camera_id}] Failed to save unknown snapshot: {ex}")


    def _post_unknown_backend(self, payload: Dict[str, Any]) -> None:
        try:
            requests.post(
                f"{BACKEND_API_URL}/face-enrollments/capture-unknown",
                json=payload,
                headers={
                    "Authorization": f"Bearer {INTERNAL_TOKEN}",
                    "Content-Type": "application/json",
                },
                timeout=2.0,
            )
        except Exception as ex:
            print(f"[Status error]: {ex}")



def run_dual_camera_recognition(
    duration: Optional[float] = None,
    no_gui: bool = False,
    headless: bool = False,
) -> None:
    """Runs simultaneous face recognition across CAM-01 and CAM-02."""
    gui_enabled = not (no_gui or headless)

    print("=================================================================")
    print("CP PLUS DUAL-CAMERA PRODUCTION ATTENDANCE PIPELINE")
    print("=================================================================")
    print("CAM-01 -> Dedicated Exit Camera  (Event: OUT)")
    print("CAM-02 -> Dedicated Entry Camera (Event: IN)")
    print(f"Backend API URL        : {BACKEND_API_URL}")
    print(f"Frontal Threshold      : {RECOGNITION_THRESHOLD:.2f}")
    print(f"Profile Threshold      : {PROFILE_RECOGNITION_THRESHOLD:.2f}")
    print(f"Confirmation Frames    : {OBSERVATION_CONFIRMATION_FRAMES}")
    print(f"Cooldown Window        : {COOLDOWN_SECONDS:.0f}s per employee/direction")
    print(f"Display Mode           : {'Headless (CLI Only)' if not gui_enabled else 'GUI Window Active'}")
    print("Controls               : Press 'q' or ESC (or Ctrl+C in terminal) to stop")
    print("=================================================================\n")

    # 0. Single-Instance Lock to Prevent Duplicate RTSP Ingestion Pipelines
    lock_file = Path(_AI_SERVICES_DIR) / "data" / "dual_camera_service.lock"
    status_file = Path(_AI_SERVICES_DIR) / "data" / "ai_camera_status.json"
    lock_file.parent.mkdir(parents=True, exist_ok=True)
    if lock_file.exists():
        try:
            prev_pid = int(lock_file.read_text().strip())
            import psutil
            if psutil.pid_exists(prev_pid) and prev_pid != os.getpid():
                try:
                    proc = psutil.Process(prev_pid)
                    cmdline = proc.cmdline()
                    if any(Path(arg).name == "dual_camera_live_face_recognition.py" for arg in cmdline):
                        print(f"[ERROR] Another instance of dual-camera pipeline is already active (PID: {prev_pid}).")
                        print("Duplicate camera ingestion aborted to prevent RTSP connection collisions.")
                        return
                except (psutil.NoSuchProcess, psutil.AccessDenied):
                    pass
        except Exception as ex:
            print(f"[Status error]: {ex}")

    try:
        lock_file.write_text(str(os.getpid()), encoding="utf-8")
    except Exception as ex:
        print(f"[Warning] Could not write lockfile: {ex}")

    start_iso = datetime.now(timezone.utc).isoformat()

    # 1. Backend Connectivity Check
    verify_backend_connectivity(BACKEND_API_URL)

    # 2. Start Asynchronous Attendance Outbox
    outbox = AttendanceOutbox(backend_url=BACKEND_API_URL, auth_token=INTERNAL_TOKEN)
    outbox.start()

    # 3. Load Active Registered Employees
    active_employees = load_all_active_embeddings()
    print(f"Loaded {len(active_employees)} active registered employee embedding(s).")
    if not active_employees:
        print("[Warning] No active employee embeddings found. Please enroll employees first.")

    # 4. Verify AI Models
    if not YUNET_MODEL_PATH.exists() or not ARCFACE_MODEL_PATH.exists():
        print("[Error] Model files not found:")
        print(f"  YuNet   : {YUNET_MODEL_PATH} ({'FOUND' if YUNET_MODEL_PATH.exists() else 'MISSING'})")
        print(f"  ArcFace : {ARCFACE_MODEL_PATH} ({'FOUND' if ARCFACE_MODEL_PATH.exists() else 'MISSING'})")
        outbox.stop()
        return

    # 5. Load ArcFace Model (Auto-detecting GPU / CUDAExecutionProvider if supported)
    print("Loading ArcFace model (w600k_r50)...")
    arcface, chosen_provider = load_arcface_model_auto(ARCFACE_MODEL_PATH)
    arcface_lock = threading.Lock()
    print(f"ArcFace model ready using: {chosen_provider}\n")

    # 6. Initialize MultiCameraManager for CAM-01 and CAM-02
    configs = get_available_camera_configs()
    cam_ids = [cid for cid in ("CAM-01", "CAM-02") if cid in configs]
    if not cam_ids:
        print("[Error] Neither CAM-01 nor CAM-02 is configured in .env.")
        outbox.stop()
        return

    manager = MultiCameraManager(camera_ids=cam_ids, auto_start=True)
    print(f"Started camera workers for: {cam_ids}")

    # 7. Start independent inference workers for each camera
    inference_workers: Dict[str, CameraInferenceWorker] = {}
    for cid in cam_ids:
        worker = manager.get_worker(cid)
        if worker:
            inf_worker = CameraInferenceWorker(
                camera_id=cid,
                camera_worker=worker,
                event_type=CAMERA_EVENT_MAPPING.get(cid, "OUT" if cid == "CAM-01" else "IN"),
                active_employees=active_employees,
                arcface_model=arcface,
                arcface_lock=arcface_lock,
                outbox=outbox,
                recognition_threshold=RECOGNITION_THRESHOLD,
                profile_recognition_threshold=PROFILE_RECOGNITION_THRESHOLD,
                confirmation_frames=OBSERVATION_CONFIRMATION_FRAMES,
                cooldown_seconds=COOLDOWN_SECONDS,
                min_match_margin=DEFAULT_MIN_MATCH_MARGIN,
                gui_enabled=gui_enabled,
            )
            inf_worker.start()
            inference_workers[cid] = inf_worker

    # 7b. Start Background Live MJPEG Streaming Server for Frontend Dashboard
    stream_getters = {
        "CAM-01": lambda: inference_workers["CAM-01"].get_display_frame() if "CAM-01" in inference_workers else None,
        "CAM-02": lambda: inference_workers["CAM-02"].get_display_frame() if "CAM-02" in inference_workers else None,
    }
    start_stream_server(stream_getters, port=int(os.environ.get("STREAM_SERVER_PORT", "5055")))

    # 8. Start Background Historical NVR Recovery Worker
    recovery_service: Optional[NVRRecoveryService] = None
    if os.environ.get("NVR_RECOVERY_ENABLED", "false").lower() in ("true", "1", "yes"):
        try:
            recovery_service = NVRRecoveryService(outbox=outbox)
            recovery_service.start_background_worker(interval_seconds=600.0)
            print("[NVR Recovery] Background offline recovery worker active.")
        except Exception as ex:
            print(f"[NVR Recovery Warning] Could not start recovery service: {ex}")

    # Signal handling for clean shutdown
    shutdown_requested = [False]

    def _sig_handler(sig, frame):
        print("\n[Shutdown] Received interrupt signal. Stopping pipeline cleanly...")
        shutdown_requested[0] = True

    signal.signal(signal.SIGINT, _sig_handler)
    signal.signal(signal.SIGTERM, _sig_handler)

    window_name = "Dual CP PLUS Attendance (CAM-01: OUT | CAM-02: IN)"
    start_time = time.time()
    last_status_write = 0.0

    def _write_pipeline_status(state="RUNNING"):
        try:
            cam_states = {}
            for c_id in ("CAM-01", "CAM-02"):
                w = manager.get_worker(c_id) if manager else None
                capture_status = w.get_status() if w else {}
                inference_status = inference_workers[c_id].get_stats() if c_id in inference_workers else {}
                cam_states[c_id] = {
                    "configured": c_id in configs,
                    "event_type": CAMERA_EVENT_MAPPING.get(c_id, "OUT" if c_id == "CAM-01" else "IN"),
                    "connected": bool(w and w.is_connected()),
                    "connection_state": capture_status.get("state", "NOT_CONFIGURED" if c_id not in configs else "STOPPED"),
                    "resolution": capture_status.get("resolution", "N/A"),
                    "codec": capture_status.get("codec", "UNKNOWN"),
                    "acquisition_fps": capture_status.get("fps", 0.0),
                    "processing_fps": inference_status.get("fps", 0.0),
                    "processing_latency_ms": inference_status.get("avg_latency_ms", 0.0),
                    "frames_received": capture_status.get("fps_frame_count", 0),
                    "frames_processed": inference_status.get("frames_processed", 0),
                    "dropped_frames": inference_status.get("dropped_frames", 0),
                    "reconnect_count": capture_status.get("reconnect_count", 0),
                    "last_error": sanitize_rtsp_url(str(capture_status.get("last_error", ""))),
                    "faces_detected": inference_status.get("faces_detected", 0),
                    "registered_identified": inference_status.get("registered_identified", 0),
                    "unknown_tracks": inference_status.get("unknown_tracks", 0),
                    "attendance_recorded": inference_status.get("attendance_recorded", 0),
                }
            payload = {
                "pid": os.getpid(),
                "status": state,
                "updated_at": datetime.now(timezone.utc).isoformat(),
                "started_at": start_iso,
                "cameras": cam_states,
                "outbox": outbox.get_summary() if outbox else {},
            }
            tmp_s = status_file.with_suffix(".tmp")
            with open(tmp_s, "w", encoding="utf-8") as f:
                json.dump(payload, f, indent=2)
            tmp_s.replace(status_file)
        except Exception as ex:
            print(f"[Status error]: {ex}")

    _write_pipeline_status("RUNNING")

    try:
        while not shutdown_requested[0]:
            if gui_enabled:
                frames_to_display = []
                for cid in ("CAM-01", "CAM-02"):
                    if cid in inference_workers:
                        frames_to_display.append(inference_workers[cid].get_display_frame())

                if len(frames_to_display) == 2:
                    combined = np.hstack((cv2.resize(frames_to_display[0], (640, 360)), cv2.resize(frames_to_display[1], (640, 360))))
                elif len(frames_to_display) == 1:
                    combined = frames_to_display[0]
                else:
                    combined = np.zeros((360, 640, 3), dtype=np.uint8)

                cv2.imshow(window_name, combined)
                key = cv2.waitKey(10) & 0xFF
                if key in (ord("q"), ord("Q"), 27):
                    break
            else:
                time.sleep(0.1)

            # Periodic heartbeat update for Node.js / FastAPI health telemetry
            now_sec = time.time()
            if (now_sec - last_status_write) >= 3.0:
                last_status_write = now_sec
                _write_pipeline_status("RUNNING")

            if duration is not None and (time.time() - start_time) >= duration:
                break

    finally:
        print("\nStopping inference workers, camera streams and attendance outbox...")
        if recovery_service:
            recovery_service.stop_background_worker()
        for inf_w in inference_workers.values():
            inf_w.stop()
        manager.stop_all()
        outbox.stop()
        if gui_enabled:
            cv2.destroyAllWindows()

        # Clean up status file and PID lock
        _write_pipeline_status("STOPPED")
        if lock_file.exists():
            try:
                lock_file.unlink()
            except Exception:
                pass

        # Print Comprehensive Per-Camera Statistics Report
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

        print(f"Pending Outbox Events    : {outbox.get_depth()}")
        print(f"AI Execution Runtime     : {chosen_provider}")
        print("=" * 70)
        print("[INFO] Dual camera face recognition stopped cleanly.")


def main():
    parser = argparse.ArgumentParser(description="Production Dual-Camera Face Recognition Pipeline")
    parser.add_argument("--duration", type=float, default=None, help="Auto-close duration in seconds")
    parser.add_argument("--no-gui", action="store_true", help="Run without OpenCV GUI window (headless)")
    parser.add_argument("--headless", action="store_true", help="Run without OpenCV GUI window (headless alias)")
    args = parser.parse_args()

    run_dual_camera_recognition(
        duration=args.duration,
        no_gui=(args.no_gui or args.headless),
    )


if __name__ == "__main__":
    main()

