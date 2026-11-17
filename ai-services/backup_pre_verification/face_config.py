"""Centralized Face Recognition & Detection Configuration Module.

All constants, model paths, quality thresholds, matching hyperparameters,
and directory structures for the AI face recognition pipeline are centralized here.
"""

from __future__ import annotations

import os
from pathlib import Path
from typing import Tuple
import numpy as np

# -----------------------------------------------------------------------------
# Base Directories (Relative Path Resolution)
# -----------------------------------------------------------------------------

# ai-services root: src/face/face_config.py -> .parents[2] == ai-services
FACE_MODULE_DIR = Path(__file__).resolve().parent
AI_SERVICES_DIR = FACE_MODULE_DIR.parent.parent

# Primary data directories
DATA_DIR = AI_SERVICES_DIR / "data"
MODELS_DIR = AI_SERVICES_DIR / "models"
REGISTRY_FILE = DATA_DIR / "employees.json"
EMBEDDINGS_DIR = DATA_DIR / "face_embeddings"
ENROLLMENT_BASE_DIR = DATA_DIR / "enrollment"
CALIBRATION_DIR = DATA_DIR / "calibration"

# -----------------------------------------------------------------------------
# Model Paths & Resolvers
# -----------------------------------------------------------------------------

# YuNet 2023mar ONNX Model
YUNET_MODEL_PATH = MODELS_DIR / "yunet" / "face_detection_yunet_2023mar.onnx"

def resolve_arcface_model_path() -> Path:
    """Resolves the ArcFace ONNX model path using a prioritized fallback strategy.

    Priority:
    1. ai-services/models/arcface/w600k_r50.onnx (Repository-local models directory)
    2. ~/.insightface/models/buffalo_l/w600k_r50.onnx (InsightFace cache directory)

    Returns:
        Path to existing w600k_r50.onnx file.

    Raises:
        FileNotFoundError: If neither path contains the model file.
    """
    primary_path = MODELS_DIR / "arcface" / "w600k_r50.onnx"
    fallback_path = (
        Path.home()
        / ".insightface"
        / "models"
        / "buffalo_l"
        / "w600k_r50.onnx"
    )

    if primary_path.exists():
        return primary_path

    if fallback_path.exists():
        return fallback_path

    raise FileNotFoundError(
        f"ArcFace ONNX model (w600k_r50.onnx) could not be found.\n"
        f"  Checked primary path  : {primary_path}\n"
        f"  Checked fallback path : {fallback_path}\n"
        f"Please verify that the model file exists in one of the locations above."
    )

ARCFACE_MODEL_PATH = resolve_arcface_model_path()

# -----------------------------------------------------------------------------
# Face Geometry & 5-Point Alignment
# -----------------------------------------------------------------------------

# Standard ArcFace Canonical Target Size
ALIGNMENT_SIZE: Tuple[int, int] = (112, 112)

# Canonical 5-point facial reference landmarks (112x112 coordinate space)
# Landmark order: Left Eye, Right Eye, Nose Tip, Left Mouth Corner, Right Mouth Corner
REFERENCE_POINTS = np.array(
    [
        [38.2946, 51.6963],  # Left eye
        [73.5318, 51.5014],  # Right eye
        [56.0252, 71.7366],  # Nose tip
        [41.5493, 92.3655],  # Left mouth corner
        [70.7299, 92.2041],  # Right mouth corner
    ],
    dtype=np.float32,
)

# -----------------------------------------------------------------------------
# Face Detection Hyperparameters (YuNet)
# -----------------------------------------------------------------------------

YUNET_SCORE_THRESHOLD_STATIC: float = 0.6
YUNET_SCORE_THRESHOLD_LIVE: float = 0.5
YUNET_NMS_THRESHOLD: float = 0.3
YUNET_TOP_K: int = 5000

# -----------------------------------------------------------------------------
# Face Quality Thresholds (Preserving Working Parameters)
# -----------------------------------------------------------------------------

# Enrollment quality gates
MIN_FACE_DIM_ENROLL: int = 100
MIN_SHARPNESS_ENROLL: float = 50.0

# Live recognition quality gates
MIN_FACE_DIM_LIVE: int = 75
MIN_SHARPNESS_LIVE: float = 25.0
MIN_SHARPNESS_LIVE_RELAXED: float = 10.0

# Common exposure & boundary parameters
MIN_BRIGHTNESS: float = 60.0
MAX_BRIGHTNESS: float = 200.0
BOUNDARY_MARGIN_PX: int = 2

# -----------------------------------------------------------------------------
# Recognition & Matching Hyperparameters
# -----------------------------------------------------------------------------

# Feature vector specification
EMBEDDING_DIM: int = 512

# Operational decision threshold for cosine similarity
# Note: 0.65 is the baseline for frontal face views, configurable via env.
RECOGNITION_THRESHOLD: float = float(os.environ.get("RECOGNITION_THRESHOLD", "0.65"))

# Operational decision threshold for side profile face views (Left / Right views)
# Profiles naturally exhibit 0.50 - 0.70 similarity while strangers score <= 0.12.
PROFILE_RECOGNITION_THRESHOLD: float = float(os.environ.get("PROFILE_RECOGNITION_THRESHOLD", "0.50"))

# Top-1 vs Top-2 candidate ambiguity guard margin
DEFAULT_MIN_MATCH_MARGIN: float = 0.08

# Duplicate face enrollment warning threshold
DUPLICATE_REGISTRATION_THRESHOLD: float = 0.75

# Permanently protected system employee IDs
PROTECTED_EMPLOYEE_IDS = frozenset(["EMP001"])

# -----------------------------------------------------------------------------
# Temporal Liveness Configuration
# -----------------------------------------------------------------------------

LIVENESS_HISTORY_WINDOW: int = 30
LIVENESS_MIN_FRAMES_FOR_DECISION: int = 25
LIVENESS_MIN_MOTION_THRESHOLD: float = 0.003
LIVENESS_MAX_MOTION_THRESHOLD: float = 0.25
LIVENESS_MIN_RATIO_VARIANCE: float = 0.00015
LIVENESS_MIN_EYE_VARIANCE: float = 2.5
LIVENESS_CONSECUTIVE_LIVE_FRAMES: int = 6

# -----------------------------------------------------------------------------
# Track-Based Recognition Policy Configuration (Step 4A)
# -----------------------------------------------------------------------------

# Number of frames between periodic identity revalidations for a confirmed track.
# At 30 FPS, 30 frames corresponds to ~1.0 second revalidation interval.
# Conservative development value: prevents drift while drastically reducing ArcFace CPU load.
TRACK_REVALIDATION_INTERVAL_FRAMES: int = 30

# Number of frames before retrying recognition on an unconfirmed (UNKNOWN/AMBIGUOUS) track.
# At 30 FPS, 10 frames corresponds to ~0.33 seconds backoff interval.
# Gives the tracked face opportunity to achieve a better angle/lighting without continuous ArcFace calls.
TRACK_UNKNOWN_RETRY_INTERVAL_FRAMES: int = 10

# Maximum consecutive frames a tracked face can be missing before its recognition state is pruned.
TRACK_MAX_MISSED_FRAMES: int = 15

# Maximum consecutive low-quality frames before a confirmed identity is invalidated for safety.
TRACK_MAX_CONSECUTIVE_LOW_QUALITY: int = 10


# -----------------------------------------------------------------------------
# Distance & Car Reverse Style Gate Entry Boundary Configuration
# -----------------------------------------------------------------------------

# Vertical ratio of the frame where the Car Reverse style "Green Line" is positioned.
# 0.40 means the green boundary line is at 40% height of the camera frame.
# Faces above/beyond this line (in the background) are treated as DISTANT / APPROACHING.
# Faces that cross into/below this line enter the ACTIVE GATE DETECTION ZONE.
GATE_GREEN_LINE_Y_RATIO: float = float(os.environ.get("GATE_GREEN_LINE_Y_RATIO", "0.40"))

# Active gate detection zone maximum distance: 4.0 meters
# Inside 4 meters (<= 4.0m): Calculate attendance & face recognition!
# 4 meters away (> 4.0m): Distant background -> APPROACHING tag only, never mark as unknown face!
MAX_ACTIVE_DETECTION_DISTANCE_METERS: float = float(os.environ.get("MAX_ACTIVE_DETECTION_DISTANCE", "4.0"))

# Minimum face bounding box width in pixels for valid face calculation inside 4m
MIN_FACE_DIM_GATE_ZONE: int = int(os.environ.get("MIN_FACE_DIM_GATE_ZONE", "20"))

# Calibration constants for metric distance estimation (in meters)
FOCAL_LENGTH_PX: float = 600.0
AVERAGE_FACE_WIDTH_METERS: float = 0.14

# Cooldown between capturing unknown alerts for the same physical person (in seconds)
UNKNOWN_CAPTURE_COOLDOWN_SECONDS: float = 45.0


def estimate_face_distance_meters(bw: int) -> float:
    """Estimates distance from camera in meters based on face bounding box width."""
    if bw <= 0:
        return 9.9
    dist = (FOCAL_LENGTH_PX * AVERAGE_FACE_WIDTH_METERS) / max(bw, 1)
    return round(float(dist), 1)


def is_face_in_active_gate_zone(
    bbox: Tuple[int, int, int, int], frame_h: int
) -> Tuple[bool, float, str]:
    """Evaluates whether face is within 4 meters for active recognition and attendance.

    Inside 4.0 meters (dist <= 4.0m):
        Active calculation zone -> Evaluates attendance & recognizes employee or unknown face.
    4 meters away (dist > 4.0m):
        Distant background -> Shows APPROACHING tag only. Never flags as unknown face.

    Returns:
        (is_in_zone: bool, distance_meters: float, status_label: str)
    """
    bx, by, bw, bh = bbox
    dist = estimate_face_distance_meters(bw)

    # 4 meters away in the background (or face too distant):
    if dist > MAX_ACTIVE_DETECTION_DISTANCE_METERS or bw < MIN_FACE_DIM_GATE_ZONE:
        return False, dist, "APPROACHING"

    return True, dist, "IN_ZONE"
