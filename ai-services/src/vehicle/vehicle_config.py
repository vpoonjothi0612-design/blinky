"""Centralized Configuration for Vehicle Detection & Tracking Pipeline.

Defines default paths, processing rate controls, camera buffering parameters,
detection thresholds, and virtual counting line coordinates.
"""

from __future__ import annotations

from pathlib import Path
from typing import Tuple

# Base Directories (Relative Path Resolution)
VEHICLE_MODULE_DIR = Path(__file__).resolve().parent
AI_SERVICES_DIR = VEHICLE_MODULE_DIR.parent.parent

VEHICLE_DATA_DIR = AI_SERVICES_DIR / "data" / "vehicle"
VEHICLE_MODELS_DIR = AI_SERVICES_DIR / "models"
VEHICLE_INPUT_DIR = VEHICLE_DATA_DIR / "input"
VEHICLE_OUTPUT_DIR = VEHICLE_DATA_DIR / "output"
VEHICLE_EVENTS_DIR = VEHICLE_DATA_DIR / "events"
DEFAULT_EVENT_STORE_PATH = VEHICLE_EVENTS_DIR / "vehicle_events.json"

# YOLO11n Model Path
DEFAULT_YOLO_MODEL_PATH = VEHICLE_MODELS_DIR / "yolo" / "yolo11n.pt"

# -----------------------------------------------------------------------------
# Step 5: Image Upload & Recognition Configurations
# -----------------------------------------------------------------------------
ALLOWED_IMAGE_EXTENSIONS = {".jpg", ".jpeg", ".png"}
MAX_IMAGE_UPLOAD_BYTES = 20 * 1024 * 1024  # 20 MB ceiling
MAX_IMAGE_DIMENSION = 4096                 # Maximum image dimension safety bound
TIMESTAMP_FORMAT = "%Y-%m-%d %H:%M:%S"

# -----------------------------------------------------------------------------
# Step 6: Number Plate OCR Configurations (PaddleOCR)
# -----------------------------------------------------------------------------
PLATE_OCR_MIN_CONFIDENCE: float = 0.40
PLATE_OCR_MODEL_NAME: str = "PP-OCRv4_mobile_rec"
PLATE_CROP_TARGET_HEIGHT: int = 48


# -----------------------------------------------------------------------------
# Video Upload & Video Analysis Configurations
# -----------------------------------------------------------------------------
TEST_DATA_DIR = AI_SERVICES_DIR / "test-data"
TEST_DATA_OUTPUT_DIR = TEST_DATA_DIR / "output"
ALLOWED_VIDEO_EXTENSIONS = {".mp4", ".avi", ".mov", ".mkv"}
MAX_VIDEO_UPLOAD_BYTES = 250 * 1024 * 1024  # 250 MB ceiling for video uploads
DEFAULT_VIDEO_PROCESSING_FPS = 2.0           # 2.0 frames/sec for smooth tracking of all vehicles



# Conservative development baseline for AI processing throughput on CPU.
# Decouples AI inference rate (e.g. 5.0 FPS) from Camera capture rate (e.g. 25-30 FPS).
VEHICLE_PROCESSING_FPS: float = 5.0

# Bounded frame buffer capacity (1 = latest-frame-only to prevent stale frame latency).
CAMERA_BUFFER_MAX_SIZE: int = 1

# Maximum frame read timeout in seconds before logging warning or aborting
CAMERA_READ_TIMEOUT_SEC: float = 2.0

# Retry delay in seconds when capture stream temporarily stutters
CAMERA_RETRY_DELAY_SEC: float = 0.5

# -----------------------------------------------------------------------------
# Detection & Tracking Defaults
# -----------------------------------------------------------------------------

DEFAULT_CONF_THRESHOLD: float = 0.35
DEFAULT_DEVICE: str = "cpu"
DEFAULT_TRACKER_TYPE: str = "bytetrack.yaml"
DEFAULT_MAX_LOST_FRAMES: int = 30

# -----------------------------------------------------------------------------
# Default Virtual Line Crossing Coordinates
# -----------------------------------------------------------------------------

DEFAULT_LINE_START: Tuple[int, int] = (100, 240)
DEFAULT_LINE_END: Tuple[int, int] = (540, 240)
DEFAULT_ENTRY_SIDE: str = "negative_to_positive"

# -----------------------------------------------------------------------------
# RTSP Stream Ingestion & Connection Resilience (Step 5)
# -----------------------------------------------------------------------------

# Preferred transport layer protocol for RTSP streaming ('tcp' or 'udp').
# TCP is strongly recommended for IP surveillance cameras to prevent UDP packet loss.
RTSP_TRANSPORT: str = "tcp"

# Connection attempt timeout in seconds before marking connection attempt failed.
RTSP_CONNECT_TIMEOUT_SEC: float = 5.0

# Maximum duration in seconds without receiving a valid frame before flagging stream timeout.
RTSP_READ_TIMEOUT_SEC: float = 3.0

# Whether automatic reconnection is enabled for live network streams.
RTSP_RECONNECT_ENABLED: bool = True

# Initial reconnect backoff delay in seconds.
RTSP_RECONNECT_INITIAL_DELAY_SEC: float = 1.0

# Exponential backoff multiplier applied on consecutive connection failures.
RTSP_RECONNECT_BACKOFF_FACTOR: float = 2.0

# Maximum upper bound ceiling for reconnect delay in seconds.
RTSP_RECONNECT_MAX_DELAY_SEC: float = 30.0

# Number of consecutive read failures before triggering full stream reconnect.
RTSP_MAX_CONSECUTIVE_READ_FAILURES: int = 3


def sanitize_rtsp_url(url: str | int) -> str:
    """Masks user credentials in RTSP URLs to prevent sensitive credential exposure in logs.

    Example:
        'rtsp://camera-user:example-password@camera.example:554/stream'
        -> 'rtsp://***:***@camera.example:554/stream'

    Args:
        url: RTSP URL string or camera index.

    Returns:
        Sanitized string safe for logging and diagnostics.
    """
    import re

    if not isinstance(url, str):
        return str(url)

    pattern = r"^(rtsp[s]?://)([^:@]+)(?::([^@]+))?@(.+)$"
    match = re.match(pattern, url, re.IGNORECASE)
    if match:
        scheme, user, password, rest = match.groups()
        if password is not None:
            return f"{scheme}***:***@{rest}"
        return f"{scheme}***@{rest}"

    return url

