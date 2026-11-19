"""Unified Gate Object Classification, Tracking & Event Engine.

Classifies every tracked gate object as PERSON, VEHICLE, ANIMAL, or OTHER using YOLO11n.
Enforces:
- 10-frame majority vote for stable classification.
- Face detection ONLY inside PERSON bounding boxes.
- Number plate OCR ONLY inside VEHICLE bounding boxes.
- Animals logged as ANIMAL_DETECTED with species label, zero alarm, zero attendance.
- All timestamps formatted in IST (Asia/Kolkata, +05:30).
- Cooldowns: 60s employee, 30s plate, 30s animal, 15s unknown.
- Tripwire crossing detection from gate_zones.json.
"""

from __future__ import annotations

import json
import logging
import os
import re
import sys
import threading
import time
from collections import OrderedDict, deque
from dataclasses import dataclass, field
from datetime import datetime, timezone, timedelta
from pathlib import Path
from typing import Dict, List, Optional, Tuple, Any

import cv2
import numpy as np
import requests
from ultralytics import YOLO

_VIEW_CLASSIFICATION_DIR = Path(__file__).resolve().parents[1]
if str(_VIEW_CLASSIFICATION_DIR) not in sys.path:
    sys.path.insert(0, str(_VIEW_CLASSIFICATION_DIR))

from view_classification import (
    BestViewCaptureRegistry,
    HUMAN_CAPTURE_ORIENTATIONS,
    VEHICLE_CAPTURE_ANGLES,
    normalize_confidence,
    normalize_human_orientation,
    normalize_vehicle_angle,
)

try:
    from src.vehicle.plate.plate_reader import PlateVoter
    from src.vehicle.plate import plate_config
except ImportError:
    from vehicle.plate.plate_reader import PlateVoter
    from vehicle.plate import plate_config

# Timezone: Indian Standard Time (UTC + 5:30)
IST = timezone(timedelta(hours=5, minutes=30))

def get_ist_now_iso() -> str:
    """Returns ISO 8601 string with +05:30 IST offset."""
    return datetime.now(IST).isoformat()

# Directories
_CURRENT_DIR = Path(__file__).resolve().parent
_SRC_DIR = _CURRENT_DIR.parent
_AI_DIR = _SRC_DIR.parent
CONFIG_DIR = _AI_DIR / "config"
DATA_DIR = _AI_DIR / "data"

CAPTURES_DIR = DATA_DIR / "captures"
UNKNOWN_DIR = DATA_DIR / "unknown"
VEHICLE_DIR = DATA_DIR / "vehicle"
ANIMAL_DIR = DATA_DIR / "animal"
SNAPSHOTS_DIR = DATA_DIR / "snapshots"

for d in (CAPTURES_DIR, UNKNOWN_DIR, VEHICLE_DIR, ANIMAL_DIR, SNAPSHOTS_DIR):
    d.mkdir(parents=True, exist_ok=True)

# COCO Class mapping
# PERSON: 0
# VEHICLE: 2 (car), 3 (motorcycle), 5 (bus), 7 (truck)
# ANIMAL: 15 (cat), 16 (dog), 17 (horse), 18 (sheep), 19 (cow)
COCO_PERSON_IDS = {0}
COCO_VEHICLE_IDS = {2: "car", 3: "motorcycle", 5: "bus", 7: "truck"}
COCO_ANIMAL_IDS = {15: "cat", 16: "dog", 17: "horse", 18: "sheep", 19: "cow"}

ALL_TARGET_CLASS_IDS = list(COCO_PERSON_IDS | set(COCO_VEHICLE_IDS.keys()) | set(COCO_ANIMAL_IDS.keys()))

# Configuration options
YOLO_MODEL_PATH = _AI_DIR / "models" / "yolo" / "yolo11n.pt"
YOLO_CONF_THRESHOLD = float(os.environ.get("YOLO_CONF_THRESHOLD", "0.35"))
YOLO_FRAME_STRIDE = int(os.environ.get("YOLO_FRAME_STRIDE", "3"))
YOLO_MAX_DIM = int(os.environ.get("YOLO_MAX_DIM", "960"))
FACE_MIN_PX = int(os.environ.get("FACE_MIN_PX", "64"))
FACE_MIN_PX_BY_CAMERA = {
    "CAM-01": int(os.environ.get("FACE_MIN_PX_CAM_01", str(FACE_MIN_PX))),
    "CAM-02": int(os.environ.get("FACE_MIN_PX_CAM_02", str(FACE_MIN_PX))),
}
UPSCALE_PERSON_CROP = os.environ.get("UPSCALE_PERSON_CROP", "false").lower() in ("true", "1")
FACE_MIN_SHARPNESS = float(os.environ.get("FACE_MIN_SHARPNESS_LIVE", "6.0"))
FACE_MIN_BRIGHTNESS = float(os.environ.get("FACE_MIN_BRIGHTNESS", "45.0"))
FACE_MAX_BRIGHTNESS = float(os.environ.get("FACE_MAX_BRIGHTNESS", "220.0"))
FACE_MAX_YAW_DEG = float(os.environ.get("FACE_MAX_YAW_DEG", "65"))
FACE_FRONTAL_YAW_DEG = 12.0
FACE_PROFILE_YAW_DEG = 45.0
FACE_RECOGNITION_MIN_INTERVAL_SEC = max(0.0, float(os.environ.get("FACE_RECOGNITION_MIN_INTERVAL_SEC", "0.20")))
TRACK_DEBUG_SNAPSHOT_INTERVAL_SEC = max(0.1, float(os.environ.get("TRACK_DEBUG_SNAPSHOT_INTERVAL_SEC", "1.0")))
FACE_MIN_PITCH_DEG = float(os.environ.get("FACE_MIN_PITCH_DEG", "-20"))
FACE_MAX_PITCH_DEG = float(os.environ.get("FACE_MAX_PITCH_DEG", "25"))
FACE_EARLY_DECISION_SCORE = float(os.environ.get("FACE_EARLY_DECISION_SCORE", "0.86"))
BACKEND_API_URL = os.environ.get("BACKEND_API_URL", "http://127.0.0.1:3000/api")
INTERNAL_TOKEN = os.environ.get("AI_INTERNAL_TOKEN", "AI_SYSTEM_INTERNAL_TOKEN_V1")

# Cooldowns (in seconds)
COOLDOWN_EMPLOYEE_SEC = float(os.environ.get("ATTENDANCE_COOLDOWN_SEC", "120"))
COOLDOWN_PLATE_SEC = 30.0
COOLDOWN_ANIMAL_SEC = 30.0
COOLDOWN_UNKNOWN_SEC = 15.0

logger = logging.getLogger("gate_classifier")


def load_gate_zones() -> Dict[str, Any]:
    """Loads tripwire and active zone configuration from config/gate_zones.json."""
    zone_file = CONFIG_DIR / "gate_zones.json"
    if zone_file.exists():
        try:
            with open(zone_file, "r", encoding="utf-8") as f:
                return json.load(f).get("cameras", {})
        except Exception as e:
            logger.warning(f"Could not load gate_zones.json: {e}")
    return {
        "CAM-02": {"direction": "IN", "tripwire_y": 0.58},
        "CAM-01": {"direction": "OUT", "tripwire_y": 0.58},
    }


def compute_iou(boxA: Tuple[int, int, int, int], boxB: Tuple[int, int, int, int]) -> float:
    """Computes Intersection-over-Union between two (x1, y1, x2, y2) boxes."""
    xA = max(boxA[0], boxB[0])
    yA = max(boxA[1], boxB[1])
    xB = min(boxA[2], boxB[2])
    yB = min(boxA[3], boxB[3])

    interW = max(0, xB - xA)
    interH = max(0, yB - yA)
    interArea = interW * interH

    boxAArea = max(1, (boxA[2] - boxA[0]) * (boxA[3] - boxA[1]))
    boxBArea = max(1, (boxB[2] - boxB[0]) * (boxB[3] - boxB[1]))

    return float(interArea) / float(boxAArea + boxBArea - interArea)


def estimate_yunet_pose(landmarks: np.ndarray, face_height: int) -> Tuple[float, float]:
    """Estimate approximate yaw/pitch degrees from YuNet's five landmarks.

    YuNet does not expose a 3-D pose vector. These normalized landmark ratios
    are deliberately used as a pose estimate, with limits configurable per
    deployment; yaw separates frontal, diagonal, and profile views while pitch
    rejects faces angled too far up or down for reliable matching.
    """
    points = np.asarray(landmarks, dtype=np.float32).reshape(5, 2)
    eye_mid = (points[0] + points[1]) * 0.5
    eye_distance = max(float(np.linalg.norm(points[0] - points[1])), 1.0)
    yaw = float(np.degrees(np.arctan2(float(points[2, 0] - eye_mid[0]), eye_distance * 0.5)))
    nose_eye_ratio = float(points[2, 1] - eye_mid[1]) / max(float(face_height), 1.0)
    pitch = (nose_eye_ratio - 0.36) * 120.0
    return yaw, pitch


def classify_face_orientation(yaw_deg: float, max_yaw_deg: float = FACE_MAX_YAW_DEG) -> str:
    """Classify visible face direction from YuNet's signed yaw estimate."""
    if not np.isfinite(yaw_deg):
        return "UNKNOWN_ORIENTATION"
    yaw_magnitude = abs(float(yaw_deg))
    if yaw_magnitude > max_yaw_deg:
        return "UNKNOWN_ORIENTATION"
    if yaw_magnitude <= FACE_FRONTAL_YAW_DEG:
        return "FRONT"
    direction = "LEFT" if yaw_deg < 0 else "RIGHT"
    if yaw_magnitude >= FACE_PROFILE_YAW_DEG:
        return f"{direction}_PROFILE"
    return f"FRONT_{direction}"


def score_face_observation(
    width: int,
    height: int,
    sharpness: float,
    brightness: float,
    face_detector_score: float,
    yaw_deg: float,
    pitch_deg: float,
) -> float:
    """Return a bounded 0..1 observation score for best-frame selection."""
    size = min(max(min(width, height) / 224.0, 0.0), 1.0)
    pose = max(0.0, 1.0 - max(abs(yaw_deg) / max(FACE_MAX_YAW_DEG, 1.0), abs(pitch_deg) / max(abs(FACE_MIN_PITCH_DEG), FACE_MAX_PITCH_DEG, 1.0)))
    blur = min(1.0, max(0.0, np.log1p(max(sharpness, 0.0)) / np.log1p(100.0)))
    light = max(0.0, 1.0 - abs(brightness - 132.0) / 132.0)
    detector = min(max(face_detector_score, 0.0), 1.0)
    return float(0.35 * size + 0.25 * pose + 0.22 * blur + 0.13 * light + 0.05 * detector)


def score_vehicle_capture(image: Optional[np.ndarray]) -> Tuple[float, float, int]:
    if image is None or image.size == 0:
        return (0.0, 0.0, 0)
    gray = cv2.cvtColor(image, cv2.COLOR_BGR2GRAY) if image.ndim == 3 else image
    sharpness = float(cv2.Laplacian(gray, cv2.CV_64F).var())
    brightness = float(gray.mean())
    exposure_balance = min(brightness, 255.0 - brightness)
    return (sharpness, exposure_balance, int(image.shape[0] * image.shape[1]))


def crop_face_passport(frame: np.ndarray, face_bbox: Tuple[int, int, int, int]) -> Optional[np.ndarray]:
    """Crop a full-frame face box into a padded 3.5:4.5 head-and-shoulders portrait."""
    if frame is None or frame.size == 0:
        return None
    x, y, face_w, face_h = (int(value) for value in face_bbox)
    frame_h, frame_w = frame.shape[:2]
    if face_w <= 0 or face_h <= 0 or frame_w <= 0 or frame_h <= 0:
        return None

    ratio = 3.5 / 4.5
    # Expand 40% horizontally and 60% vertically on each side, then widen
    # the crop as needed to meet the passport aspect ratio without stretching.
    crop_w = max(1, int(np.ceil(face_w * 1.8)))
    crop_h = max(1, int(np.ceil(face_h * 2.2)))
    crop_w = max(crop_w, int(np.ceil(crop_h * ratio)))
    crop_h = max(crop_h, int(np.ceil(crop_w / ratio)))

    center_x = x + face_w / 2.0
    crop_x1 = int(round(center_x - crop_w / 2.0))
    crop_y1 = int(round(y - face_h * 0.25))
    crop_x2, crop_y2 = crop_x1 + crop_w, crop_y1 + crop_h

    source_x1, source_y1 = max(0, crop_x1), max(0, crop_y1)
    source_x2, source_y2 = min(frame_w, crop_x2), min(frame_h, crop_y2)
    if source_x2 <= source_x1 or source_y2 <= source_y1:
        return None
    source = frame[source_y1:source_y2, source_x1:source_x2]
    padded = cv2.copyMakeBorder(
        source,
        max(0, -crop_y1), max(0, crop_y2 - frame_h),
        max(0, -crop_x1), max(0, crop_x2 - frame_w),
        cv2.BORDER_REPLICATE,
    )
    if padded.size == 0:
        return None
    return padded


def map_yunet_face_to_frame(
    face: np.ndarray,
    origin: Tuple[int, int] = (0, 0),
    scale: float = 1.0,
) -> Tuple[Tuple[int, int, int, int], np.ndarray]:
    """Map YuNet xywh + five landmarks into full-resolution frame coordinates."""
    if scale <= 0:
        raise ValueError("scale must be positive")
    ox, oy = origin
    values = np.asarray(face, dtype=np.float32)
    x, y, width, height = (int(round(float(value) / scale)) for value in values[:4])
    landmarks = values[4:14].reshape((5, 2)).astype(np.float32) / scale
    landmarks[:, 0] += ox
    landmarks[:, 1] += oy
    return (ox + x, oy + y, width, height), landmarks


@dataclass
class FaceCandidate:
    crop: np.ndarray
    bbox: Tuple[int, int, int, int]
    landmarks: np.ndarray
    score: float
    sharpness: float
    overall_quality: float
    timestamp: float
    passport_crop: Optional[np.ndarray] = None
    brightness: float = 0.0
    yaw_deg: float = 0.0
    pitch_deg: float = 0.0
    evaluated: bool = False
    result: Optional[Dict[str, Any]] = None


class ObjectTrack:
    """Maintains consistent tracking, majority-voted category, and best crops."""

    def __init__(self, track_id: int, initial_box: Tuple[int, int, int, int], initial_class: str, sub_label: str):
        self.track_id: int = track_id
        self.bbox: Tuple[int, int, int, int] = initial_box
        self.sub_label: str = sub_label  # "car", "dog", "person", etc.
        self.class_history: deque[str] = deque(maxlen=10)
        self.class_history.append(initial_class)
        self.stable_class: str = initial_class

        self.centroids: deque[Tuple[int, int, float]] = deque(maxlen=30)  # (x, y, time)
        cx = (initial_box[0] + initial_box[2]) // 2
        cy = (initial_box[1] + initial_box[3]) // 2
        self.centroids.append((cx, cy, time.time()))

        self.missed_frames: int = 0
        self.event_triggered: bool = False
        self.first_seen: float = time.time()
        self.capture_id: str = f"{int(self.first_seen * 1000000)}_{track_id}"
        self.last_seen: float = time.time()

        # Face analysis cache (for PERSON)
        self.best_face_crops: List[FaceCandidate] = []
        # Keep one best detected-but-rejected face for manual review only.
        # It is never sent to ArcFace or used to make an identity decision.
        self.best_review_face: Optional[FaceCandidate] = None
        self.face_evaluated: bool = False
        self.face_evaluated_count: int = 0
        self.current_face_candidate: Optional[FaceCandidate] = None
        self.last_face_recognition_at: Optional[float] = None
        self.face_state: str = "PERSON_TRACKED"
        self.face_reason: str = "Body detected; awaiting a visible face"
        self.face_rejection_history: deque[Tuple[str, str]] = deque(maxlen=50)
        self.current_face_bbox: Optional[Tuple[int, int, int, int]] = None
        self.current_face_landmarks: Optional[np.ndarray] = None
        self.best_face_score: float = 0.0
        self.best_face_reason: Optional[str] = None
        self.face_size_samples: List[Tuple[int, int]] = []
        self.face_identity_votes: deque[Optional[str]] = deque(maxlen=5)
        self.last_face_vote_timestamp: Optional[float] = None
        self.registry_revision: Optional[float] = None
        self.ever_in_gate: bool = False
        self.outside_gate_frames: int = 0
        self.outside_gate_started: Optional[float] = None
        self.left_gate: bool = False
        self.last_body_crop: Optional[np.ndarray] = None
        self.last_body_crop_score: float = -1.0
        self.last_body_timestamp: Optional[str] = None
        self.unknown_reported: bool = False
        self.no_face_reported: bool = False
        self.person_event_type: Optional[str] = None
        self.employee_id: Optional[str] = None
        self.employee_name: Optional[str] = None
        self.department: Optional[str] = None
        self.similarity: Optional[float] = None
        self.last_saved_face_fname: Optional[str] = None
        self.last_saved_quality: float = 0.0
        self.human_orientation: str = "UNKNOWN_ORIENTATION"
        self.human_orientation_confidence: Optional[float] = None
        self.best_human_view_images = BestViewCaptureRegistry(HUMAN_CAPTURE_ORIENTATIONS)

        # Vehicle analysis cache (for VEHICLE)
        self.best_vehicle_crop: Optional[np.ndarray] = None
        self.best_vehicle_area: int = 0
        self.best_vehicle_quality: Tuple[float, float, int] = (0.0, 0.0, 0)
        self.vehicle_observation_frames: OrderedDict[int, np.ndarray] = OrderedDict()
        self.vehicle_snapshot_fname: Optional[str] = None
        self.original_frame_fname: Optional[str] = None
        self.plate_evaluated: bool = False
        self.plate_text: Optional[str] = None
        self.raw_plate_text: Optional[str] = None
        self.plate_status: str = "not_found"
        self.plate_confidence: Optional[float] = None
        self.last_plate_crop_source: Optional[str] = None
        self.last_plate_crop_score: float = -1.0
        self.last_saved_plate_fname: Optional[str] = None
        self.vehicle_angle: str = "UNKNOWN"
        self.vehicle_angle_confidence: Optional[float] = None
        self.best_vehicle_angle_images = BestViewCaptureRegistry(VEHICLE_CAPTURE_ANGLES)

        # Animal cache (for ANIMAL)
        self.species: str = sub_label if initial_class == "ANIMAL" else "animal"
        self.best_animal_crop: Optional[np.ndarray] = None
        self.animal_evaluated: bool = False

    def update_box(self, new_box: Tuple[int, int, int, int], raw_class: str, sub_label: str):
        self.bbox = new_box
        self.last_seen = time.time()
        self.missed_frames = 0
        self.class_history.append(raw_class)
        if sub_label:
            self.sub_label = sub_label

        # Majority vote across last 10 frames
        votes = {}
        for c in self.class_history:
            votes[c] = votes.get(c, 0) + 1
        self.stable_class = max(votes, key=votes.get)

        if self.stable_class == "ANIMAL":
            self.species = self.sub_label

        cx = (new_box[0] + new_box[2]) // 2
        cy = (new_box[1] + new_box[3]) // 2
        self.centroids.append((cx, cy, time.time()))

        area = (new_box[2] - new_box[0]) * (new_box[3] - new_box[1])
        if self.stable_class == "VEHICLE" and area > self.best_vehicle_area:
            self.best_vehicle_area = area

    def add_face_candidate(self, candidate: FaceCandidate):
        self.best_face_crops.append(candidate)
        # Retain the best observations across the complete track lifetime.
        self.best_face_crops.sort(key=lambda c: c.overall_quality, reverse=True)
        if len(self.best_face_crops) > 10:
            self.best_face_crops.pop()

    def note_face_rejection(self, state: str, reason: str) -> None:
        self.face_state = state
        self.face_reason = reason
        self.face_rejection_history.append((state, reason))

    def set_human_orientation(self, orientation: object, confidence: object = None) -> None:
        self.human_orientation = normalize_human_orientation(orientation)
        self.human_orientation_confidence = (
            normalize_confidence(confidence) if self.human_orientation != "UNKNOWN" else None
        )

    def consider_human_view_image(self, orientation: object, image_path: object, quality: object) -> bool:
        return self.best_human_view_images.consider(orientation, image_path, quality)

    def set_vehicle_angle(self, angle: object, confidence: object = None) -> None:
        self.vehicle_angle = normalize_vehicle_angle(angle)
        self.vehicle_angle_confidence = (
            normalize_confidence(confidence) if self.vehicle_angle != "UNKNOWN" else None
        )

    def consider_vehicle_angle_image(self, angle: object, image_path: object, quality: object) -> bool:
        return self.best_vehicle_angle_images.consider(angle, image_path, quality)

    def human_view_metadata(self) -> Dict[str, Any]:
        return {
            "humanOrientation": self.human_orientation,
            "humanOrientationConfidence": self.human_orientation_confidence,
            "humanAngleImages": self.best_human_view_images.paths(),
        }

    def vehicle_view_metadata(self) -> Dict[str, Any]:
        return {
            "vehicleAngle": self.vehicle_angle,
            "vehicleAngleConfidence": self.vehicle_angle_confidence,
            "vehicleAngleImages": self.best_vehicle_angle_images.paths(),
        }

    def check_tripwire_crossing(self, tripwire_y: float, frame_h: int, expected_dir: str) -> bool:
        """Determines if object centroid crossed tripwire line in expected direction."""
        if len(self.centroids) < 2:
            return False

        line_y = int(tripwire_y * frame_h) if tripwire_y <= 1.0 else int(tripwire_y)
        y_old = self.centroids[0][1]
        y_new = self.centroids[-1][1]

        if expected_dir == "IN":
            # Crossing from top (gate) downwards/forward: y_old <= line_y < y_new
            return y_old <= (line_y + 30) and y_new >= (line_y - 30)
        elif expected_dir == "OUT":
            # Crossing upwards/outside: y_old >= line_y > y_new
            return y_old >= (line_y - 30) and y_new <= (line_y + 30)
        else:
            # Any crossing
            return (y_old < line_y <= y_new) or (y_old > line_y >= y_new)


class GateObjectClassifierPipeline:
    """Unified detector & tracker for dual cameras."""

    def __init__(self, camera_id: str, zone_config: Dict[str, Any]):
        self.camera_id: str = camera_id
        self.zone_config = zone_config
        self.direction: str = zone_config.get("direction", "IN" if "02" in camera_id else "OUT")
        self.tripwire_y: float = zone_config.get("tripwire", {}).get("normalized_y", 0.58)
        min_px_env = "FACE_MIN_PX_CAM_01" if camera_id == "CAM-01" else "FACE_MIN_PX_CAM_02"
        self.face_min_px: int = int(os.environ.get(min_px_env, zone_config.get("face_min_px", FACE_MIN_PX_BY_CAMERA.get(camera_id, FACE_MIN_PX))))
        self.face_max_yaw_deg = float(zone_config.get("face_max_yaw_deg", FACE_MAX_YAW_DEG))
        self.face_min_pitch_deg = float(zone_config.get("face_min_pitch_deg", FACE_MIN_PITCH_DEG))
        self.face_max_pitch_deg = float(zone_config.get("face_max_pitch_deg", FACE_MAX_PITCH_DEG))
        self.face_recognition_min_interval_sec = FACE_RECOGNITION_MIN_INTERVAL_SEC

        # Active tracks
        self.tracks: Dict[int, ObjectTrack] = {}
        self.next_track_id: int = 1
        self.frame_count: int = 0

        # Shared deduplication / cooldown cache
        self.cooldown_cache: Dict[str, float] = {}
        self.face_size_history: deque[Tuple[int, int]] = deque(maxlen=200)
        self.face_size_observation_count = 0
        self._last_debug_snapshot_at = 0.0
        self.plate_voter = PlateVoter()
        self.debug_dir = DATA_DIR / "debug"
        self.debug_dir.mkdir(parents=True, exist_ok=True)

        # YOLO11n singleton wrapper
        self.yolo: Optional[YOLO] = None
        self._init_yolo()

    def _init_yolo(self):
        try:
            if YOLO_MODEL_PATH.exists():
                print(f"[{self.camera_id}] Loading YOLO11n weights from {YOLO_MODEL_PATH}...")
                self.yolo = YOLO(str(YOLO_MODEL_PATH))
                print(f"[{self.camera_id}] YOLO11n initialized successfully.")
            else:
                print(f"[{self.camera_id}] Warning: YOLO11n model not found at {YOLO_MODEL_PATH}")
        except Exception as e:
            print(f"[{self.camera_id}] Failed to initialize YOLO11n: {e}")

    def is_on_cooldown(self, key: str, cooldown_duration: float) -> bool:
        now = time.time()
        last = self.cooldown_cache.get(key, 0.0)
        if (now - last) < cooldown_duration:
            return True
        self.cooldown_cache[key] = now
        return False

    def _save_person_capture_bundle(
        self,
        track: ObjectTrack,
        timestamp_ms: int,
        frame: Optional[np.ndarray],
        candidate: Optional[FaceCandidate],
        decision: str,
    ) -> Dict[str, Any]:
        relative_dir = Path("captures") / self.camera_id / str(track.track_id) / str(timestamp_ms)
        capture_dir = DATA_DIR / relative_dir
        capture_dir.mkdir(parents=True, exist_ok=True)
        paths: Dict[str, Any] = {
            "face_passport_path": None,
            "face_aligned_path": None,
            "body_path": None,
            "frame_path": None,
            "face_quality_score": None,
            "decision": decision,
        }

        if candidate is not None:
            portrait = candidate.passport_crop
            if portrait is None:
                portrait = crop_face_passport(frame, candidate.bbox) if frame is not None else candidate.crop
            if portrait is not None and portrait.size:
                passport_file = capture_dir / "face_passport.jpg"
                self._save_passport_crop(portrait, passport_file)
                if passport_file.is_file() and passport_file.stat().st_size > 0:
                    paths["face_passport_path"] = (relative_dir / passport_file.name).as_posix()
            aligned = (candidate.result or {}).get("aligned_face")
            if aligned is not None and getattr(aligned, "size", 0):
                aligned_file = capture_dir / "face_aligned_112.jpg"
                self._save_jpeg(aligned, aligned_file)
                if aligned_file.is_file() and aligned_file.stat().st_size > 0:
                    paths["face_aligned_path"] = (relative_dir / aligned_file.name).as_posix()
            paths["face_quality_score"] = float(candidate.overall_quality)

        if track.last_body_crop is not None and track.last_body_crop.size:
            body_file = capture_dir / "body.jpg"
            self._save_jpeg(track.last_body_crop, body_file)
            if body_file.is_file() and body_file.stat().st_size > 0:
                paths["body_path"] = (relative_dir / body_file.name).as_posix()
        if frame is not None and frame.size:
            frame_file = capture_dir / "frame.jpg"
            self._save_jpeg(frame, frame_file)
            if frame_file.is_file() and frame_file.stat().st_size > 0:
                paths["frame_path"] = (relative_dir / frame_file.name).as_posix()
        return paths

    def _remember_rejected_face(
        self,
        track: ObjectTrack,
        frame: np.ndarray,
        face_box: Tuple[int, int, int, int],
        landmarks: np.ndarray,
        detector_score: float,
        yaw_deg: float,
        pitch_deg: float,
    ) -> None:
        """Retain the sharpest usable preview of a rejected face for review."""
        x, y, face_w, face_h = (int(value) for value in face_box)
        frame_h, frame_w = frame.shape[:2]
        x1, y1 = max(0, x), max(0, y)
        x2, y2 = min(frame_w, x + face_w), min(frame_h, y + face_h)
        if x2 <= x1 or y2 <= y1:
            return

        face_crop = frame[y1:y2, x1:x2]
        if face_crop.size == 0:
            return
        gray = cv2.cvtColor(face_crop, cv2.COLOR_BGR2GRAY)
        sharpness = float(cv2.Laplacian(gray, cv2.CV_64F).var())
        brightness = float(gray.mean())
        quality = score_face_observation(
            face_w, face_h, sharpness, brightness, detector_score, yaw_deg, pitch_deg
        )
        candidate = FaceCandidate(
            crop=face_crop.copy(),
            bbox=face_box,
            landmarks=np.asarray(landmarks, dtype=np.float32).copy(),
            score=detector_score,
            sharpness=sharpness,
            overall_quality=quality,
            timestamp=time.time(),
            passport_crop=crop_face_passport(frame, face_box),
            brightness=brightness,
            yaw_deg=yaw_deg,
            pitch_deg=pitch_deg,
        )
        if track.best_review_face is None or quality > track.best_review_face.overall_quality:
            track.best_review_face = candidate

    def _make_no_face_event(self, track: ObjectTrack, frame: Optional[np.ndarray] = None) -> Optional[Dict[str, Any]]:
        """Persist a no-face review decision and context crops after gate exit."""
        if track.no_face_reported or track.face_evaluated_count > 0 or track.last_body_crop is None:
            return None
        now_iso = track.last_body_timestamp or get_ist_now_iso()
        stamp = int(time.time() * 1000)
        rejection_priority = ("FACE_TURNED_AWAY", "FACE_TOO_SMALL", "FACE_QUALITY_LOW", "FACE_NOT_VISIBLE")
        reason_code = next(
            (state for state in rejection_priority if any(item[0] == state for item in track.face_rejection_history)),
            track.face_state if track.face_state in rejection_priority else "FACE_NOT_VISIBLE",
        )
        reason_text = next(
            (reason for state, reason in reversed(track.face_rejection_history) if state == reason_code),
            track.face_reason or "No face was visible before the person left the gate",
        )
        if reason_code == "FACE_TURNED_AWAY" and "pitch=" in reason_text.lower():
            try:
                pitch_value = float(reason_text.lower().split("pitch=", 1)[1].split("°", 1)[0])
                if pitch_value < -20:
                    reason_text = "Face turned away (looking down)"
            except (ValueError, IndexError):
                pass
        paths = self._save_person_capture_bundle(
            track, stamp, frame, track.best_review_face, "NO_FACE_CAPTURED"
        )
        event = {
            "trackId": track.track_id,
            "cameraId": self.camera_id,
            "camera_id": self.camera_id,
            "direction": self.direction,
            "eventType": "NO_FACE_CAPTURED",
            "event_type": "NO_FACE_CAPTURED",
            "timestamp": now_iso,
            "name": "Face not captured",
            "department": "Pedestrian",
            "imageFace": paths["face_passport_path"],
            "imageFrame": paths["frame_path"],
            "faceReason": reason_code,
            "metadata": {**paths, "faceStatus": "NO_FACE_CAPTURED", "reason": reason_text, **track.human_view_metadata()},
            "alarm": False,
        }
        track.no_face_reported = True
        track.event_triggered = True
        track.face_state = "NO_FACE_CAPTURED"
        track.face_reason = reason_text
        self._post_unknown_review_async(
            paths,
            now_iso,
            track,
            decision="NO_FACE_CAPTURED",
            face_reason=reason_code,
            embedding=None,
        )
        logger.info("[FaceDecision] camera=%s track=%s timestamp=%s state=NO_FACE_CAPTURED reason=%s", self.camera_id, track.track_id, now_iso, reason_code)
        return event

    def _make_unknown_event(self, track: ObjectTrack, frame: Optional[np.ndarray] = None) -> Optional[Dict[str, Any]]:
        """Finalize a track as unknown only after repeated evaluated failures."""
        if track.unknown_reported or len(track.face_identity_votes) < 3 or list(track.face_identity_votes).count("__UNKNOWN__") < 3:
            return None
        best = max((candidate for candidate in track.best_face_crops if candidate.evaluated and not str((candidate.result or {}).get("status", "")).startswith("RECOGNIZED")), key=lambda item: item.overall_quality, default=None)
        if best is None:
            return None
        stamp = int(time.time() * 1000)
        paths = self._save_person_capture_bundle(track, stamp, frame, best, "UNKNOWN")
        event = {
            "cameraId": self.camera_id, "camera_id": self.camera_id, "direction": self.direction,
            "eventType": f"PERSON_UNKNOWN_{self.direction}", "event_type": f"PERSON_UNKNOWN_{self.direction}",
            "timestamp": track.last_body_timestamp or get_ist_now_iso(), "name": "Unknown Person",
            "department": "Unregistered Visitor", "matchScore": float((best.result or {}).get("similarity") or 0.0),
            "imageFace": paths["face_passport_path"], "imageFrame": paths["frame_path"],
            "faceReason": "UNKNOWN", "metadata": {**paths, **track.human_view_metadata()}, "alarm": True,
        }
        track.unknown_reported = True
        track.event_triggered = True
        track.face_state = "UNKNOWN"
        track.face_reason = "At least 3 of the last 5 evaluated face observations did not match an employee"
        track.person_event_type = event["eventType"]
        self._post_unknown_review_async(
            paths,
            event["timestamp"],
            track,
            decision="UNKNOWN",
            face_reason="UNKNOWN",
            best_score=event["matchScore"],
            embedding=(best.result or {}).get("embedding"),
        )
        return event

    def _post_unknown_review_async(
        self,
        paths: Dict[str, Any],
        timestamp: str,
        track: ObjectTrack,
        *,
        decision: str,
        face_reason: Optional[str],
        best_score: Optional[float] = None,
        embedding: Optional[List[float]] = None,
    ) -> None:
        """Persist separate face/context paths in review and publish the camera event."""
        def _post():
            try:
                response = requests.post(
                    f"{BACKEND_API_URL}/face-enrollments/capture-unknown",
                    json={
                        "face_path": paths.get("face_passport_path"),
                        "face_aligned_path": paths.get("face_aligned_path"),
                        "body_path": paths.get("body_path"),
                        "frame_path": paths.get("frame_path"),
                        "face_quality_score": paths.get("face_quality_score"),
                        "decision": decision,
                        "face_reason": face_reason,
                        "visitCount": 1,
                        "cameraId": self.camera_id,
                        "embedding": embedding,
                        "metadata": {
                            "timestamp": timestamp,
                            "trackId": track.track_id,
                            "camera": self.camera_id,
                            "direction": self.direction,
                            "bestScore": best_score,
                            "reason": track.face_reason,
                            **track.human_view_metadata(),
                        },
                    },
                    headers={"Authorization": f"Bearer {INTERNAL_TOKEN}", "Content-Type": "application/json"},
                    timeout=10.0,
                )
                response.raise_for_status()
            except Exception as ex:
                logger.warning("Unknown review capture post failed for %s track %s: %s", self.camera_id, track.track_id, ex)
        threading.Thread(target=_post, daemon=True).start()

    def _write_track_debug_snapshot(self) -> None:
        now = time.monotonic()
        if now - self._last_debug_snapshot_at < TRACK_DEBUG_SNAPSHOT_INTERVAL_SEC:
            return
        self._last_debug_snapshot_at = now
        path = self.debug_dir / f"face_tracks_{self.camera_id}.json"
        payload = {
            "camera_id": self.camera_id,
            "updated_at": get_ist_now_iso(),
            "tracks": [
                {
                    "track_id": track.track_id,
                    "class": track.stable_class,
                    "bbox": list(track.bbox),
                    "state": track.face_state,
                    "reason": track.face_reason,
                    "best_face_score": round(float(track.best_face_score), 4),
                    "best_face_bbox": list(track.best_face_crops[0].bbox) if track.best_face_crops else None,
                    "face_observations": len(track.face_size_samples),
                    "evaluated_observations": track.face_evaluated_count,
                    "human_orientation": track.human_orientation,
                }
                for track in self.tracks.values()
                if track.stable_class == "PERSON"
            ],
        }
        temporary = path.with_suffix(".json.tmp")
        try:
            temporary.write_text(json.dumps(payload), encoding="utf-8")
            temporary.replace(path)
        except OSError as ex:
            logger.warning("Could not write face track debug snapshot: %s", ex)

    def process_frame(
        self,
        frame: np.ndarray,
        yunet_detector_fn: Any,
        arcface_recognizer_fn: Any,
        plate_pipeline_fn: Any,
    ) -> Tuple[List[Dict[str, Any]], List[Dict[str, Any]]]:
        """Runs unified detection & tracking on the camera frame.

        Returns:
            Tuple of (tracks_hud_list, generated_events_list).
        """
        self.frame_count += 1
        h, w = frame.shape[:2]
        generated_events: List[Dict[str, Any]] = []

        # 1. Run YOLO detection every YOLO_FRAME_STRIDE frames
        raw_detections: List[Dict[str, Any]] = []
        yolo_frame_processed = False
        if self.yolo is not None and (self.frame_count % YOLO_FRAME_STRIDE == 0 or len(self.tracks) == 0):
            try:
                yolo_scale = min(1.0, float(YOLO_MAX_DIM) / max(w, h)) if YOLO_MAX_DIM > 0 else 1.0
                yolo_frame = frame
                if yolo_scale < 1.0:
                    yolo_frame = cv2.resize(frame, (int(w * yolo_scale), int(h * yolo_scale)), interpolation=cv2.INTER_AREA)
                results = self.yolo.predict(
                    source=yolo_frame,
                    classes=ALL_TARGET_CLASS_IDS,
                    conf=YOLO_CONF_THRESHOLD,
                    device="cpu",
                    verbose=False,
                )
                yolo_frame_processed = True
                if results and len(results) > 0:
                    boxes = results[0].boxes
                    if boxes is not None and len(boxes) > 0:
                        xyxy = boxes.xyxy.cpu().numpy()
                        confs = boxes.conf.cpu().numpy()
                        cls_ids = boxes.cls.cpu().numpy().astype(int)

                        for box, conf, cid in zip(xyxy, confs, cls_ids):
                            x1, y1, x2, y2 = (int(round(float(value) / yolo_scale)) for value in box)
                            # Clamp to frame
                            x1, y1 = max(0, x1), max(0, y1)
                            x2, y2 = min(w, x2), min(h, y2)

                            if cid in COCO_PERSON_IDS:
                                cat = "PERSON"
                                sub = "person"
                            elif cid in COCO_VEHICLE_IDS:
                                cat = "VEHICLE"
                                sub = COCO_VEHICLE_IDS[cid]
                            elif cid in COCO_ANIMAL_IDS:
                                cat = "ANIMAL"
                                sub = COCO_ANIMAL_IDS[cid]
                            else:
                                cat = "OTHER"
                                sub = "other"

                            if cat != "OTHER":
                                raw_detections.append({
                                    "bbox": (x1, y1, x2, y2),
                                    "conf": float(conf),
                                    "cat": cat,
                                    "sub": sub,
                                })
            except Exception as e:
                logger.error(f"[{self.camera_id}] YOLO detection error: {e}")

        # 2. Associate detections with existing tracks via IoU
        matched_track_ids = set()
        for det in raw_detections:
            best_iou = 0.0
            best_tid = None
            box = det["bbox"]

            for tid, track in self.tracks.items():
                if tid in matched_track_ids:
                    continue
                # A person box must never inherit a nearby vehicle/animal track
                # (or let that other object's crop become a person review image).
                if track.stable_class != det["cat"]:
                    continue
                iou = compute_iou(box, track.bbox)
                if iou > best_iou:
                    best_iou = iou
                    best_tid = tid

            if best_tid is not None and best_iou >= 0.25:
                # Update existing track
                self.tracks[best_tid].update_box(box, det["cat"], det["sub"])
                matched_track_ids.add(best_tid)
            else:
                # New track
                new_tid = self.next_track_id
                self.next_track_id += 1
                new_track = ObjectTrack(new_tid, box, det["cat"], det["sub"])
                self.tracks[new_tid] = new_track
                matched_track_ids.add(new_tid)

        # 3. Handle missed tracks
        for tid in list(self.tracks.keys()):
            # Frames between YOLO passes are not misses. Only age a track after
            # a completed detection pass actually failed to match it.
            if yolo_frame_processed and tid not in matched_track_ids:
                self.tracks[tid].missed_frames += 1
                if self.tracks[tid].missed_frames > 25:
                    # Prune stale tracks
                    stale_track = self.tracks[tid]
                    if stale_track.stable_class == "PERSON" and stale_track.ever_in_gate:
                        finalized = self._make_unknown_event(stale_track, frame) or self._make_no_face_event(stale_track, frame)
                        if finalized:
                            generated_events.append(finalized)
                    self.plate_voter.remove(tid)
                    del self.tracks[tid]

        # 4. Process categorized tracks according to rules
        frame_faces_checked = False
        frame_faces_cache: Optional[np.ndarray] = None
        for tid, track in list(self.tracks.items()):
            # Do not crop the current background through a stale person box.
            # Keep the last image from a real detection and wait for the next
            # successful association before updating capture or face state.
            if track.missed_frames > 0:
                continue

            x1, y1, x2, y2 = track.bbox
            bw = x2 - x1
            bh = y2 - y1
            if bw <= 10 or bh <= 10:
                continue

            # Check if track crossed tripwire or entered active zone
            crossed = track.check_tripwire_crossing(self.tripwire_y, h, self.direction)
            is_in_gate = crossed or (track.centroids[-1][1] > int(self.tripwire_y * h * 0.75))

            # -----------------------------------------------------------
            # CASE A: person body tracking is separate from face evaluation.
            # -----------------------------------------------------------
            if track.stable_class == "PERSON":
                pad_x, pad_y = int(bw * 0.30), int(bh * 0.30)
                px1, py1 = max(0, x1 - pad_x), max(0, y1 - pad_y)
                px2, py2 = min(w, x2 + pad_x), min(h, y2 + pad_y)
                person_crop = frame[py1:py2, px1:px2]
                body_crop = frame[y1:y2, x1:x2]
                if body_crop.size and yolo_frame_processed and tid in matched_track_ids:
                    # Retain the clearest full-person observation from the walk.
                    # A box clipped by the image edge is less useful than an
                    # earlier complete body crop and must not replace it.
                    touches_edge = x1 <= 1 or y1 <= 1 or x2 >= w - 1 or y2 >= h - 1
                    crop_score = float(bw * bh) * (0.35 if touches_edge else 1.0)
                    if crop_score > track.last_body_crop_score:
                        track.last_body_crop = body_crop.copy()
                        track.last_body_crop_score = crop_score
                        track.last_body_timestamp = get_ist_now_iso()

                if track.face_state not in {"CONFIRMED", "UNKNOWN", "NO_FACE_CAPTURED"}:
                    track.face_state = "PERSON_TRACKED"
                    track.face_reason = "Body detected; checking for a usable face"
                track.current_face_bbox = None
                track.current_face_landmarks = None
                track.current_face_candidate = None
                track.set_human_orientation("UNKNOWN_ORIENTATION")

                if person_crop.size > 0 and yunet_detector_fn is not None:
                    # Prefer native high-resolution camera pixels; upscaling is only an
                    # opt-in fallback for low-resolution streams.
                    scale = 1.0
                    if UPSCALE_PERSON_CROP:
                        person_crop = cv2.resize(person_crop, (person_crop.shape[1] * 2, person_crop.shape[0] * 2), interpolation=cv2.INTER_CUBIC)
                        scale = 0.5
                    faces = yunet_detector_fn(person_crop)
                    # If a tight/shifted body box hides the face, run YuNet once on
                    # the native full frame and keep only faces inside this person crop.
                    if faces is None or len(faces) == 0:
                        if not frame_faces_checked:
                            frame_faces_cache = yunet_detector_fn(frame)
                            frame_faces_checked = True
                        frame_faces = frame_faces_cache
                        if frame_faces is not None and len(frame_faces) > 0:
                            local_faces = []
                            for frame_face in frame_faces:
                                center_x = float(frame_face[0]) + float(frame_face[2]) * 0.5
                                center_y = float(frame_face[1]) + float(frame_face[3]) * 0.5
                                if px1 <= center_x <= px2 and py1 <= center_y <= py2:
                                    local_face = frame_face.copy()
                                    local_face[0] -= px1
                                    local_face[1] -= py1
                                    local_landmarks = local_face[4:14].reshape((5, 2))
                                    local_landmarks[:, 0] -= px1
                                    local_landmarks[:, 1] -= py1
                                    local_faces.append(local_face)
                            if local_faces:
                                faces = np.asarray(local_faces)
                                scale = 1.0
                    if faces is None or len(faces) == 0:
                        if track.face_state not in {"CONFIRMED", "UNKNOWN", "NO_FACE_CAPTURED"}:
                            track.note_face_rejection("FACE_NOT_VISIBLE", "No face visible in the person crop")
                    else:
                        if track.face_state not in {"CONFIRMED", "UNKNOWN", "NO_FACE_CAPTURED"}:
                            track.face_state = "FACE_NOT_VISIBLE"
                            track.face_reason = "Detected face did not pass quality checks"
                        for face in faces:
                            fx, fy, fw, fh = map(int, face[:4])
                            local_landmarks = face[4:14].reshape((5, 2)).astype(np.float32)
                            face_box, global_landmarks = map_yunet_face_to_frame(face, (px1, py1), scale)
                            ffx, ffy, fw, fh = face_box
                            face_center_x = ffx + fw * 0.5
                            face_center_y = ffy + fh * 0.5
                            if not (x1 <= face_center_x <= x2 and y1 <= face_center_y <= y2):
                                continue
                            yaw_deg, pitch_deg = estimate_yunet_pose(local_landmarks, int(face[3]))
                            orientation = classify_face_orientation(yaw_deg, self.face_max_yaw_deg)
                            track.set_human_orientation(orientation)
                            track.current_face_bbox = face_box
                            track.current_face_landmarks = global_landmarks
                            track.face_size_samples.append((fw, fh))
                            if len(track.face_size_samples) > 100:
                                track.face_size_samples.pop(0)
                            self.face_size_history.append((fw, fh))
                            self.face_size_observation_count += 1
                            if self.face_size_observation_count % 20 == 0:
                                widths = [size[0] for size in self.face_size_history]
                                heights = [size[1] for size in self.face_size_history]
                                logger.info(
                                    "[FaceSizeDistribution] camera=%s n=%d width_px(p10/median/p90)=%.1f/%.1f/%.1f height_px(p10/median/p90)=%.1f/%.1f/%.1f minimum=%d",
                                    self.camera_id, len(self.face_size_history),
                                    *np.percentile(widths, [10, 50, 90]), *np.percentile(heights, [10, 50, 90]), self.face_min_px,
                                )

                            if fw < self.face_min_px or fh < self.face_min_px:
                                if not track.employee_id and not track.unknown_reported:
                                    track.note_face_rejection("FACE_TOO_SMALL", f"Face is {fw}x{fh}px; camera minimum is {self.face_min_px}px (move closer)")
                                    detector_score = float(face[-1]) if len(face) >= 15 else 0.8
                                    self._remember_rejected_face(track, frame, face_box, global_landmarks, detector_score, yaw_deg, pitch_deg)
                                logger.info("[FaceDecision] camera=%s track=%s state=FACE_TOO_SMALL face_size=%dx%d minimum=%d", self.camera_id, tid, fw, fh, self.face_min_px)
                                continue

                            if ffx < 0 or ffy < 0 or ffx + fw > w or ffy + fh > h:
                                if not track.employee_id and not track.unknown_reported:
                                    track.note_face_rejection("FACE_QUALITY_LOW", "Face extends beyond the camera frame")
                                logger.info("[FaceDecision] camera=%s track=%s state=FACE_QUALITY_LOW reason=FACE_CLIPPED bbox=%s", self.camera_id, tid, face_box)
                                continue

                            pitch_tolerance = max(0.0, abs(yaw_deg) - FACE_FRONTAL_YAW_DEG) * 0.20
                            min_pitch = self.face_min_pitch_deg - pitch_tolerance
                            max_pitch = self.face_max_pitch_deg + pitch_tolerance
                            if abs(yaw_deg) > self.face_max_yaw_deg or pitch_deg < min_pitch or pitch_deg > max_pitch:
                                if not track.employee_id and not track.unknown_reported:
                                    track.note_face_rejection("FACE_TURNED_AWAY", f"Face turned away (yaw={yaw_deg:.1f}°, pitch={pitch_deg:.1f}°)")
                                    detector_score = float(face[-1]) if len(face) >= 15 else 0.8
                                    self._remember_rejected_face(track, frame, face_box, global_landmarks, detector_score, yaw_deg, pitch_deg)
                                logger.info("[FaceDecision] camera=%s track=%s state=FACE_TURNED_AWAY yaw=%.1f pitch=%.1f limits=%.1f/%.1f..%.1f", self.camera_id, tid, yaw_deg, pitch_deg, self.face_max_yaw_deg, min_pitch, max_pitch)
                                continue

                            face_crop_img = frame[max(0, ffy):min(h, ffy + fh), max(0, ffx):min(w, ffx + fw)]
                            if face_crop_img.size == 0:
                                continue
                            gray_face = cv2.cvtColor(face_crop_img, cv2.COLOR_BGR2GRAY)
                            sharpness = float(cv2.Laplacian(gray_face, cv2.CV_64F).var())
                            brightness = float(gray_face.mean())
                            low_quality_reason = None
                            if sharpness < FACE_MIN_SHARPNESS:
                                low_quality_reason = f"Face is blurry (sharpness {sharpness:.1f})"
                            elif brightness < FACE_MIN_BRIGHTNESS:
                                low_quality_reason = f"Face is too dark (brightness {brightness:.1f})"
                            elif brightness > FACE_MAX_BRIGHTNESS:
                                low_quality_reason = f"Face is too bright (brightness {brightness:.1f})"
                            if low_quality_reason:
                                if not track.employee_id and not track.unknown_reported:
                                    track.note_face_rejection("FACE_QUALITY_LOW", low_quality_reason)
                                    detector_score = float(face[-1]) if len(face) >= 15 else 0.8
                                    self._remember_rejected_face(track, frame, face_box, global_landmarks, detector_score, yaw_deg, pitch_deg)
                                logger.info("[FaceDecision] camera=%s track=%s state=FACE_QUALITY_LOW reason=%s", self.camera_id, tid, low_quality_reason)
                                continue

                            detector_score = float(face[-1]) if len(face) >= 5 else 0.8
                            quality = score_face_observation(fw, fh, sharpness, brightness, detector_score, yaw_deg, pitch_deg)
                            passport_crop_img = crop_face_passport(frame, face_box)
                            candidate = FaceCandidate(
                                crop=face_crop_img.copy(), bbox=face_box, landmarks=global_landmarks.copy(),
                                score=detector_score, sharpness=sharpness, overall_quality=quality,
                                timestamp=time.time(), passport_crop=passport_crop_img.copy() if passport_crop_img is not None else face_crop_img.copy(),
                                brightness=brightness, yaw_deg=yaw_deg, pitch_deg=pitch_deg,
                            )
                            track.add_face_candidate(candidate)
                            if (
                                track.current_face_candidate is None
                                or candidate.overall_quality > track.current_face_candidate.overall_quality
                            ):
                                track.current_face_candidate = candidate
                            track.best_face_score = max(track.best_face_score, quality)
                            track.best_face_reason = f"quality={quality:.3f}, yaw={yaw_deg:.1f}°, pitch={pitch_deg:.1f}°"
                            if track.face_state not in {"CONFIRMED", "UNKNOWN"}:
                                track.face_state = "FACE_EVALUATED"
                                track.face_reason = "Face quality passed; collecting recognition observations"

                if track.last_saved_face_fname and track.best_face_crops:
                    best_saved = track.best_face_crops[0]
                    if best_saved.overall_quality > (track.last_saved_quality * 1.25):
                        track.last_saved_quality = best_saved.overall_quality
                        crop_to_save = best_saved.passport_crop if best_saved.passport_crop is not None else best_saved.crop
                        self._save_passport_crop(crop_to_save, UNKNOWN_DIR / track.last_saved_face_fname)
                        self._save_passport_crop(crop_to_save, CAPTURES_DIR / track.last_saved_face_fname)

                if is_in_gate:
                    track.ever_in_gate = True
                    track.outside_gate_frames = 0
                    track.outside_gate_started = None
                elif track.ever_in_gate and not track.left_gate:
                    track.outside_gate_frames += 1
                    if track.outside_gate_started is None:
                        track.outside_gate_started = time.time()
                    elif time.time() - track.outside_gate_started >= 5.0:
                        track.left_gate = True
                        track.outside_gate_started = None
                    else:
                        if track.face_state not in {"CONFIRMED", "UNKNOWN", "NO_FACE_CAPTURED"}:
                            track.face_state = "EXIT_TRACKING"
                            track.face_reason = "Temporarily outside the gate; exit confirmed after 5 seconds"

                # Embed each retained high-scoring observation at most once. This
                # keeps each inference aligned to the candidate's source frame.
                candidate = track.current_face_candidate
                recognition_now = time.monotonic()
                recognition_interval_elapsed = (
                    track.last_face_recognition_at is None
                    or recognition_now - track.last_face_recognition_at >= self.face_recognition_min_interval_sec
                )
                if (
                    arcface_recognizer_fn is not None
                    and candidate is not None
                    and not candidate.evaluated
                    and recognition_interval_elapsed
                ):
                    track.last_face_recognition_at = recognition_now
                    try:
                        result = arcface_recognizer_fn(candidate.crop, candidate.landmarks, frame, candidate.bbox, tid) or {}
                    except Exception as ex:
                        logger.error("[FaceDecision] camera=%s track=%s recognition inference failed: %s", self.camera_id, tid, ex)
                        result = {"status": "RECOGNITION_ERROR", "error": str(ex)}
                    candidate.evaluated = True
                    candidate.result = result
                    track.face_evaluated_count += 1
                    track.face_evaluated = True
                    registry_revision = result.get("registry_revision")
                    if registry_revision is not None:
                        if track.registry_revision is not None and registry_revision != track.registry_revision:
                            # Votes and labels from the previous registry can
                            # refer to a different best match after enrollment.
                            track.face_identity_votes.clear()
                            track.employee_id = None
                            track.employee_name = None
                            track.department = None
                            track.similarity = None
                            track.face_state = "FACE_EVALUATED"
                            track.face_reason = "Enrollment registry changed; rechecking identity"
                            logger.info(
                                "[FaceDecision] camera=%s track=%s registry changed; cleared stale identity votes",
                                self.camera_id, tid,
                            )
                        track.registry_revision = registry_revision
                    employee_id = result.get("employee_id") if str(result.get("status", "")).startswith("RECOGNIZED") else None
                    vote_status = str(result.get("status", "")).upper()
                    if employee_id:
                        vote = employee_id
                    elif vote_status == "AMBIGUOUS":
                        vote = "__AMBIGUOUS__"
                    elif vote_status == "UNKNOWN":
                        vote = "__UNKNOWN__"
                    else:
                        vote = "__DEFERRED__"
                    track.face_identity_votes.append(vote)
                    if vote_status == "RECOGNITION_ERROR" and not track.employee_id:
                        track.face_state = "RECOGNITION_ERROR"
                        track.face_reason = result.get("error") or "Face recognition inference failed"
                    elif track.face_state not in {"CONFIRMED", "UNKNOWN"}:
                        track.face_state = "FACE_EVALUATED"
                    similarity = float(result.get("similarity") or 0.0)
                    logger.info(
                        "[FaceDecision] camera=%s track=%s best=%.4f second=%s threshold=%s state=%s face_score=%.3f top3=%s",
                        self.camera_id, tid, similarity, result.get("second_similarity"), result.get("threshold"),
                        result.get("status", "UNKNOWN"), candidate.overall_quality, result.get("rankings", [])[:3],
                    )

                identity_counts: Dict[str, int] = {}
                for vote in track.face_identity_votes:
                    if vote:
                        identity_counts[vote] = identity_counts.get(vote, 0) + 1
                employee_vote_counts = {
                    vote: count
                    for vote, count in identity_counts.items()
                    if vote and not str(vote).startswith("__")
                }
                confirmed_id = max(employee_vote_counts, key=employee_vote_counts.get) if employee_vote_counts else None
                confirmed = bool(confirmed_id and identity_counts[confirmed_id] >= 3)
                unknown_confirmed = len(track.face_identity_votes) >= 3 and list(track.face_identity_votes).count("__UNKNOWN__") >= 3
                should_finalize_unknown = track.left_gate or track.best_face_score >= FACE_EARLY_DECISION_SCORE
                latest_candidate = next((candidate for candidate in track.best_face_crops if candidate.evaluated and candidate.result and candidate.result.get("employee_id") == confirmed_id), None) if confirmed_id else None
                if latest_candidate is None:
                    latest_candidate = max((candidate for candidate in track.best_face_crops if candidate.evaluated and candidate.result), key=lambda item: item.timestamp, default=None)
                rec_res = latest_candidate.result if latest_candidate else {}
                now_iso = get_ist_now_iso()
                ts_ms = int(time.time() * 1000)

                if confirmed:
                    track.employee_id = confirmed_id
                    track.employee_name = rec_res.get("name", confirmed_id)
                    track.department = rec_res.get("department", "Operations")
                    track.similarity = float(rec_res.get("similarity") or 0.0)
                    track.face_state = "CONFIRMED"
                    track.face_reason = f"Identity confirmed by {identity_counts[confirmed_id]} of the last 5 face observations"
                    if not track.event_triggered and (track.ever_in_gate or is_in_gate):
                        cd_key = f"EMP_{confirmed_id}_{self.camera_id}_{self.direction}"
                        if not self.is_on_cooldown(cd_key, COOLDOWN_EMPLOYEE_SEC):
                            event_type = f"PERSON_{self.direction}"
                            best_cand = max(track.best_face_crops, key=lambda item: item.overall_quality)
                            paths = self._save_person_capture_bundle(track, ts_ms, frame, best_cand, "CONFIRMED")
                            event_dict = {
                                "cameraId": self.camera_id, "camera_id": self.camera_id, "direction": self.direction,
                                "eventType": event_type, "event_type": event_type, "timestamp": now_iso,
                                "employeeId": confirmed_id, "employee_id": confirmed_id, "employeeCode": confirmed_id,
                                "name": track.employee_name, "department": track.department,
                                "matchScore": track.similarity, "match_score": track.similarity,
                                "imageFace": paths["face_passport_path"], "imageFrame": paths["frame_path"],
                                "metadata": {**paths, "decision": "CONFIRMED", "trackId": str(tid), **track.human_view_metadata()}, "alarm": False,
                            }
                            generated_events.append(event_dict)
                            self._post_event_async(event_dict)
                            track.event_triggered = True
                            track.person_event_type = event_type

                elif unknown_confirmed and should_finalize_unknown and not track.unknown_reported and (track.ever_in_gate or is_in_gate):
                    best_cand = max((c for c in track.best_face_crops if c.evaluated and not str((c.result or {}).get("status", "")).startswith("RECOGNIZED")), key=lambda item: item.overall_quality, default=None)
                    if best_cand is not None:
                        cd_key = f"UNKNOWN_{self.camera_id}_trk{tid}"
                        if not self.is_on_cooldown(cd_key, COOLDOWN_UNKNOWN_SEC):
                            event_type = f"PERSON_UNKNOWN_{self.direction}"
                            paths = self._save_person_capture_bundle(track, ts_ms, frame, best_cand, "UNKNOWN")
                            track.similarity = float((best_cand.result or {}).get("similarity") or 0.0)
                            event_dict = {
                                "cameraId": self.camera_id, "camera_id": self.camera_id, "direction": self.direction,
                                "eventType": event_type, "event_type": event_type, "timestamp": now_iso,
                                "name": "Unknown Person", "department": "Unregistered Visitor",
                                "matchScore": track.similarity,
                                "imageFace": paths["face_passport_path"], "imageFrame": paths["frame_path"],
                                "metadata": {**paths, "decision": "UNKNOWN", "trackId": str(tid), **track.human_view_metadata()}, "alarm": True,
                            }
                            generated_events.append(event_dict)
                            self._post_unknown_review_async(
                                paths,
                                now_iso,
                                track,
                                decision="UNKNOWN",
                                face_reason="UNKNOWN",
                                best_score=event_dict["matchScore"],
                                embedding=(best_cand.result or {}).get("embedding"),
                            )
                            track.unknown_reported = True
                            track.event_triggered = True
                            track.face_state = "UNKNOWN"
                            track.face_reason = "At least 3 of the last 5 evaluated face observations did not match an employee"
                            track.person_event_type = event_type

                if track.left_gate and not track.event_triggered:
                    no_face_event = self._make_no_face_event(track, frame)
                    if no_face_event:
                        generated_events.append(no_face_event)

            # -----------------------------------------------------------
            # CASE B: VEHICLE TRACK -> Number Plate OCR
            # -----------------------------------------------------------
            elif track.stable_class == "VEHICLE":
                vehicle_crop = frame[y1:y2, x1:x2]
                if is_in_gate and (time.time() - track.first_seen) >= 0.3:
                    event_type = f"VEHICLE_{self.direction}"

                    # Extract framed vehicle crop for clean card view
                    v_pad_x = int((x2 - x1) * 0.12)
                    v_pad_y = int((y2 - y1) * 0.12)
                    vy1 = max(0, y1 - v_pad_y)
                    vy2 = min(h, y2 + v_pad_y)
                    vx1 = max(0, x1 - v_pad_x)
                    vx2 = min(w, x2 + v_pad_x)
                    vehicle_framed = frame[vy1:vy2, vx1:vx2]
                    if vehicle_framed.size > 0:
                        quality = score_vehicle_capture(vehicle_framed)
                        if quality > track.best_vehicle_quality:
                            track.best_vehicle_crop = vehicle_framed.copy()
                            track.best_vehicle_quality = quality

                    if plate_pipeline_fn is not None and vehicle_crop.size > 0 and self.plate_voter.should_process(tid):
                        try:
                            track.vehicle_observation_frames[self.frame_count] = vehicle_framed.copy()
                            while len(track.vehicle_observation_frames) > plate_config.PLATE_VOTE_WINDOW:
                                track.vehicle_observation_frames.popitem(last=False)
                            try:
                                plate_observation = plate_pipeline_fn(
                                    vehicle_crop,
                                    track_id=tid,
                                    evidence_crop=vehicle_framed if vehicle_framed.size > 0 else vehicle_crop,
                                )
                            except TypeError:
                                try:
                                    plate_observation = plate_pipeline_fn(vehicle_crop, track_id=tid)
                                except TypeError:
                                    plate_observation = plate_pipeline_fn(vehicle_crop)
                            if isinstance(plate_observation, dict):
                                plate_observation["_frame_token"] = self.frame_count
                                self.plate_voter.add(tid, plate_observation)
                        except Exception as p_err:
                            logger.warning(f"Plate OCR notice: {p_err}")
                    plate_res = self.plate_voter.get_final(tid)

                    new_plate_found = False
                    evidence_frame_token = None
                    event_vehicle_crop = (
                        track.best_vehicle_crop
                        if track.best_vehicle_crop is not None
                        else vehicle_framed
                    )
                    if plate_res:
                        p_txt = str(plate_res.get("plate_text") or "").strip().upper()
                        p_status = str(plate_res.get("status") or "not_found")
                        if p_txt in {"CPIPCAM", "IPCAM", "CPPLUS", "CAMERA", "CCTV", "HDIPCAM"}:
                            p_txt = ""
                            p_status = "not_found"
                        if (track.plate_text, track.plate_status) != (p_txt or None, p_status):
                            track.plate_text = p_txt or None
                            track.raw_plate_text = str(plate_res.get("raw_text") or p_txt or "") or None
                            track.plate_status = p_status
                            track.plate_confidence = float(plate_res.get("confidence") or 0.0)
                            new_plate_found = True

                        evidence_frame_token = plate_res.get("_frame_token")
                        if evidence_frame_token is not None:
                            matching_vehicle_crop = track.vehicle_observation_frames.get(int(evidence_frame_token))
                            if matching_vehicle_crop is not None:
                                event_vehicle_crop = matching_vehicle_crop

                        plate_crop = plate_res.get("_plate_crop")
                        crop_score = float(plate_res.get("_sharpness") or 0.0)
                        if isinstance(plate_crop, np.ndarray) and plate_crop.size > 0 and (
                            not track.last_saved_plate_fname
                            or new_plate_found
                            or crop_score > track.last_plate_crop_score
                        ):
                            try:
                                plate_fname = f"plate_{self.camera_id}_track{track.capture_id}.jpg"
                                destination = VEHICLE_DIR / plate_fname
                                if self._save_jpeg(plate_crop, destination):
                                    track.last_saved_plate_fname = plate_fname
                                    track.last_plate_crop_source = str(evidence_frame_token) if evidence_frame_token is not None else None
                                    track.last_plate_crop_score = crop_score
                                    new_plate_found = True
                            except (OSError, ValueError) as crop_err:
                                logger.debug("Could not publish plate crop for %s track %s: %s", self.camera_id, tid, crop_err)

                        if plate_config.PLATE_DEBUG_DRAW and plate_res.get("_plate_bbox"):
                            px1, py1, px2, py2 = (int(value) for value in plate_res["_plate_bbox"])
                            cv2.rectangle(frame, (x1 + px1, y1 + py1), (x1 + px2, y1 + py2), (0, 220, 255), 2)
                            cv2.putText(frame, p_txt or p_status, (x1 + px1, max(18, y1 + py1 - 6)), cv2.FONT_HERSHEY_SIMPLEX, 0.55, (0, 220, 255), 2)

                    if not track.event_triggered:
                        plate_id = track.plate_text or f"VEH_{track.sub_label.upper()}_{tid}"
                        cd_key = f"VEH_{plate_id}_{self.direction}"

                        if not self.is_on_cooldown(cd_key, COOLDOWN_PLATE_SEC):
                            frame_ref, vehicle_ref = self._save_vehicle_event_media(
                                track,
                                event_vehicle_crop,
                                frame,
                            )

                            event_dict = {
                                "trackId": tid,
                                "vehicleType": track.sub_label.title() if track.sub_label in {"car", "motorcycle", "bus", "truck"} else "Unknown",
                                "plateConfidence": track.plate_confidence,
                                "plateStatus": track.plate_status,
                                "cameraId": self.camera_id,
                                "camera_id": self.camera_id,
                                "direction": self.direction,
                                "eventType": event_type,
                                "event_type": event_type,
                                "timestamp": get_ist_now_iso(),
                                "name": track.plate_text or f"{track.sub_label.title()}",
                                "plateText": track.plate_text,
                                "plate_text": track.plate_text,
                                "rawPlateText": track.raw_plate_text,
                                "raw_plate_text": track.raw_plate_text,
                                "department": f"{track.sub_label.title()} Vehicle",
                                "vehicleImagePath": vehicle_ref,
                                "imagePlate": getattr(track, 'last_saved_plate_fname', None),
                                "image_plate_url": f"/vehicle-images/{track.last_saved_plate_fname}" if getattr(track, 'last_saved_plate_fname', None) else None,
                                "imageFrame": frame_ref,
                                "image_frame_url": f"/snapshot-images/{frame_ref}" if frame_ref else None,
                                "metadata": {
                                    **track.vehicle_view_metadata(),
                                    "vehicleCaptureId": track.capture_id,
                                    "plateEvidenceFrame": evidence_frame_token,
                                    "plateCropSharpness": track.last_plate_crop_score,
                                },
                                "alarm": False,
                            }
                            generated_events.append(event_dict)
                            self._post_event_async(event_dict)
                            track.event_triggered = True
                    elif new_plate_found:
                        frame_ref, vehicle_ref = self._save_vehicle_event_media(
                            track,
                            event_vehicle_crop,
                            frame,
                        )
                        event_dict = {
                            "trackId": tid,
                            "vehicleType": track.sub_label.title() if track.sub_label in {"car", "motorcycle", "bus", "truck"} else "Unknown",
                            "plateConfidence": track.plate_confidence,
                            "plateStatus": track.plate_status,
                            "cameraId": self.camera_id,
                            "camera_id": self.camera_id,
                            "direction": self.direction,
                            "eventType": event_type,
                            "event_type": event_type,
                            "timestamp": get_ist_now_iso(),
                            "name": track.plate_text,
                            "plateText": track.plate_text,
                            "plate_text": track.plate_text,
                            "rawPlateText": track.raw_plate_text,
                            "raw_plate_text": track.raw_plate_text,
                            "department": f"{track.sub_label.title()} Vehicle",
                            "vehicleImagePath": vehicle_ref,
                            "imagePlate": getattr(track, 'last_saved_plate_fname', None),
                            "image_plate_url": f"/vehicle-images/{track.last_saved_plate_fname}" if getattr(track, 'last_saved_plate_fname', None) else None,
                            "imageFrame": frame_ref,
                            "image_frame_url": f"/snapshot-images/{frame_ref}" if frame_ref else None,
                            "metadata": {
                                **track.vehicle_view_metadata(),
                                "vehicleCaptureId": track.capture_id,
                                "plateEvidenceFrame": evidence_frame_token,
                                "plateCropSharpness": track.last_plate_crop_score,
                            },
                            "alarm": False,
                        }
                        generated_events.append(event_dict)
                        self._post_event_async(event_dict)

            # -----------------------------------------------------------
            # CASE C: ANIMAL TRACK -> Animal Logging (Dog, Cow, Cat)
            # -----------------------------------------------------------
            elif track.stable_class == "ANIMAL":
                if is_in_gate and not track.event_triggered and (time.time() - track.first_seen) >= 0.4:
                    species = track.species or "animal"
                    cd_key = f"ANIMAL_{species}_{self.camera_id}_trk{tid}"

                    if not self.is_on_cooldown(cd_key, COOLDOWN_ANIMAL_SEC):
                        ts_ms = int(time.time() * 1000)
                        anim_fname = f"animal_{self.camera_id}_{species}_{ts_ms}.jpg"
                        frame_fname = f"snap_anim_{self.camera_id}_{ts_ms}.jpg"

                        animal_crop = frame[y1:y2, x1:x2]
                        if animal_crop.size > 0:
                            self._save_jpeg(animal_crop, ANIMAL_DIR / anim_fname)
                        self._save_jpeg(frame, SNAPSHOTS_DIR / frame_fname)

                        event_dict = {
                            "cameraId": self.camera_id,
                            "camera_id": self.camera_id,
                            "direction": self.direction,
                            "eventType": "ANIMAL_DETECTED",
                            "event_type": "ANIMAL_DETECTED",
                            "timestamp": get_ist_now_iso(),
                            "name": species.title(),
                            "species": species,
                            "department": "Wildlife / Domestic",
                            "imageFace": anim_fname,  # Displayed in card photo slot
                            "image_face_url": f"/animal-images/{anim_fname}",
                            "imageFrame": frame_fname,
                            "image_frame_url": f"/snapshot-images/{frame_fname}",
                            "alarm": False,  # No alarm for animals
                        }
                        generated_events.append(event_dict)
                        self._post_event_async(event_dict)
                        track.event_triggered = True

        # 5. Format HUD telemetry for video stream rendering
        tracks_hud_info = []
        for tid, track in self.tracks.items():
            if track.stable_class == "PERSON":
                display_name = track.employee_name if track.face_state == "CONFIRMED" else ("Unknown" if track.face_state == "UNKNOWN" else "Person")
                if track.face_state == "CONFIRMED":
                    recognition_status = "REGISTERED"
                elif track.face_state == "UNKNOWN":
                    recognition_status = "UNKNOWN_PERSON"
                elif track.face_state == "RECOGNITION_ERROR":
                    recognition_status = "RECOGNITION_ERROR"
                elif track.face_state in {"FACE_TOO_SMALL", "FACE_QUALITY_LOW", "FACE_TURNED_AWAY"}:
                    recognition_status = "LOW_FACE_QUALITY"
                elif track.face_state in {"FACE_NOT_VISIBLE", "NO_FACE_CAPTURED", "PERSON_TRACKED", "EXIT_TRACKING"}:
                    recognition_status = "FACE_NOT_VISIBLE"
                else:
                    recognition_status = "RECOGNITION_PENDING"
            else:
                display_name = track.plate_text or (track.species.title() if track.stable_class == "ANIMAL" else "")
                recognition_status = None
            tracks_hud_info.append({
                "track_id": tid,
                "bbox": track.bbox,
                "class": track.stable_class,
                "sub_label": track.sub_label,
                "name": display_name,
                "event_type": track.person_event_type,
                "missed": track.missed_frames,
                "face_state": track.face_state if track.stable_class == "PERSON" else None,
                "recognition_status": recognition_status,
                "face_reason": track.face_reason if track.stable_class == "PERSON" else None,
                "face_bbox": track.current_face_bbox if track.stable_class == "PERSON" else None,
                "face_landmarks": track.current_face_landmarks.tolist() if track.stable_class == "PERSON" and track.current_face_landmarks is not None else None,
                "best_face_score": round(float(track.best_face_score), 4) if track.stable_class == "PERSON" else None,
                "similarity": track.similarity if track.stable_class == "PERSON" else None,
                "human_orientation": track.human_orientation if track.stable_class == "PERSON" else None,
                "human_orientation_confidence": track.human_orientation_confidence if track.stable_class == "PERSON" else None,
                "vehicle_angle": track.vehicle_angle if track.stable_class == "VEHICLE" else None,
                "vehicle_angle_confidence": track.vehicle_angle_confidence if track.stable_class == "VEHICLE" else None,
            })

        self._write_track_debug_snapshot()
        return tracks_hud_info, generated_events

    def _save_vehicle_event_media(
        self,
        track: ObjectTrack,
        vehicle_crop: Optional[np.ndarray],
        original_frame: np.ndarray,
    ) -> Tuple[Optional[str], Optional[str]]:
        original_name = track.original_frame_fname or f"frame_{self.camera_id}_track{track.capture_id}.jpg"
        original_path = SNAPSHOTS_DIR / original_name
        if not original_path.is_file():
            self._save_jpeg(original_frame, original_path)
        track.original_frame_fname = original_name if original_path.is_file() else None

        vehicle_name = track.vehicle_snapshot_fname or f"vehicle_{self.camera_id}_track{track.capture_id}.jpg"
        vehicle_path = SNAPSHOTS_DIR / vehicle_name
        vehicle_saved = (
            vehicle_crop is not None
            and vehicle_crop.size > 0
            and self._save_jpeg(vehicle_crop, vehicle_path)
        )
        track.vehicle_snapshot_fname = vehicle_name if vehicle_saved or vehicle_path.is_file() else None
        return track.original_frame_fname, track.vehicle_snapshot_fname

    def _save_jpeg(self, img: np.ndarray, path: Path) -> bool:
        try:
            if img is None or img.size == 0:
                return False
            path.parent.mkdir(parents=True, exist_ok=True)
            return bool(cv2.imwrite(str(path), img, [int(cv2.IMWRITE_JPEG_QUALITY), 95]))
        except Exception as e:
            logger.warning(f"Could not save JPEG {path}: {e}")
            return False

    def _save_passport_crop(self, crop: np.ndarray, path: Path):
        try:
            if crop is None or crop.size == 0:
                return
            h_c, w_c = crop.shape[:2]
            if h_c < 12 or w_c < 12:
                return

            # Standardize to passport 3.5:4.5 aspect ratio without stretching.
            target_ratio = 3.5 / 4.5
            current_ratio = float(w_c) / float(h_c)
            if current_ratio > target_ratio:
                # Too wide -> center crop horizontally
                new_w = max(1, int(h_c * target_ratio))
                x_start = max(0, (w_c - new_w) // 2)
                crop_fitted = crop[:, x_start:x_start + new_w]
            else:
                # Too tall -> crop from bottom, preserving top head/hair
                new_h = max(1, int(w_c / target_ratio))
                y_start = max(0, (h_c - new_h) // 3)
                crop_fitted = crop[y_start:y_start + new_h, :]

            # 2. Resize with Lanczos4 to clear passport size (360x450)
            target_w, target_h = 360, 450
            resized = cv2.resize(crop_fitted, (target_w, target_h), interpolation=cv2.INTER_LANCZOS4)

            # 3. Enhance clarity and illumination using adaptive shadow lift & LAB CLAHE
            lab = cv2.cvtColor(resized, cv2.COLOR_BGR2LAB)
            l_channel, a_channel, b_channel = cv2.split(lab)
            
            # Lift underexposed shadows / backlight
            mean_l = float(np.mean(l_channel))
            if mean_l < 115.0:
                gamma = max(0.55, mean_l / 120.0)
                inv_gamma = 1.0 / gamma
                lut = np.array([((i / 255.0) ** inv_gamma) * 255 for i in np.arange(0, 256)]).astype("uint8")
                l_channel = cv2.LUT(l_channel, lut)

            clahe = cv2.createCLAHE(clipLimit=2.2, tileGridSize=(8, 8))
            cl = clahe.apply(l_channel)
            enhanced_lab = cv2.merge((cl, a_channel, b_channel))
            enhanced_bgr = cv2.cvtColor(enhanced_lab, cv2.COLOR_LAB2BGR)

            # 4. Unsharp mask for high-definition facial features
            gaussian = cv2.GaussianBlur(enhanced_bgr, (0, 0), 1.5)
            sharpened = cv2.addWeighted(enhanced_bgr, 1.4, gaussian, -0.4, 0)

            cv2.imwrite(str(path), sharpened, [int(cv2.IMWRITE_JPEG_QUALITY), 98])
        except Exception as e:
            logger.warning(f"Could not save passport crop {path}: {e}")

    def _post_event_async(self, event_dict: Dict[str, Any]):
        def _post():
            try:
                requests.post(
                    f"{BACKEND_API_URL}/events",
                    json=event_dict,
                    headers={
                        "Authorization": f"Bearer {INTERNAL_TOKEN}",
                        "Content-Type": "application/json",
                    },
                    timeout=2.0,
                )
            except Exception as e:
                logger.warning(f"Backend event post notice: {e}")

        threading.Thread(target=_post, daemon=True).start()
