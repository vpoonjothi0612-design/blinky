"""Configuration for the standalone vehicle plate reader."""

from pathlib import Path
import os


AI_SERVICES_DIR = Path(__file__).resolve().parents[3]
PLATE_MODEL_PATH = Path(os.environ.get("PLATE_MODEL_PATH", AI_SERVICES_DIR / "models" / "plate_best.pt"))
PLATE_DEBUG_DIR = AI_SERVICES_DIR / "debug" / "plates"
PLATE_LOG_PATH = AI_SERVICES_DIR / "debug" / "plate_log.csv"
CORRECTIONS_DIR = AI_SERVICES_DIR / "data" / "corrections"
VEHICLE_MEDIA_DIR = AI_SERVICES_DIR / "data" / "vehicle"

YOLO_PLATE_CONFIDENCE = float(os.environ.get("YOLO_PLATE_CONFIDENCE", "0.20"))
PLATE_MIN_CROP_WIDTH = int(os.environ.get("PLATE_MIN_CROP_WIDTH", "80"))
PLATE_CROP_PADDING_PX = int(os.environ.get("PLATE_CROP_PADDING_PX", "8"))
PLATE_UPSCALE_FACTOR = 3
PLATE_FRAME_STRIDE = max(1, int(os.environ.get("PLATE_FRAME_STRIDE", "3")))
PLATE_VOTE_WINDOW = max(3, min(10, int(os.environ.get("PLATE_VOTE_WINDOW", "8"))))
PLATE_VOTE_LOCK_COUNT = max(3, int(os.environ.get("PLATE_VOTE_LOCK_COUNT", "3")))
PLATE_MIN_VALID_CONFIDENCE = float(os.environ.get("PLATE_MIN_VALID_CONFIDENCE", "0.50"))
PLATE_MAX_CANDIDATES = max(1, int(os.environ.get("PLATE_MAX_CANDIDATES", "2")))
PLATE_CONTOUR_MIN_AREA_RATIO = float(os.environ.get("PLATE_CONTOUR_MIN_AREA_RATIO", "0.005"))
PLATE_CONTOUR_MAX_AREA_RATIO = float(os.environ.get("PLATE_CONTOUR_MAX_AREA_RATIO", "0.65"))
PLATE_CONTOUR_MIN_ASPECT = float(os.environ.get("PLATE_CONTOUR_MIN_ASPECT", "1.0"))
PLATE_CONTOUR_MAX_ASPECT = float(os.environ.get("PLATE_CONTOUR_MAX_ASPECT", "7.5"))
PLATE_CANDIDATE_IOU_MAX = float(os.environ.get("PLATE_CANDIDATE_IOU_MAX", "0.55"))
PLATE_CONTOUR_KERNEL_WIDTH = int(os.environ.get("PLATE_CONTOUR_KERNEL_WIDTH", "9"))
PLATE_CONTOUR_KERNEL_HEIGHT = int(os.environ.get("PLATE_CONTOUR_KERNEL_HEIGHT", "3"))
PLATE_ROI_WIDTH_FRACTIONS = (0.25, 0.30)
PLATE_ROI_CENTER_Y_FRACTIONS = (0.61, 0.66)
PLATE_ROI_ASPECT_RATIO = float(os.environ.get("PLATE_ROI_ASPECT_RATIO", "3.3"))
PLATE_CONTEXT_ROI_WIDTH_FRACTION = float(os.environ.get("PLATE_CONTEXT_ROI_WIDTH_FRACTION", "0.55"))
PLATE_CONTEXT_ROI_ASPECT_RATIO = float(os.environ.get("PLATE_CONTEXT_ROI_ASPECT_RATIO", "3.3"))
PLATE_CONTEXT_CENTER_X_FRACTIONS = (0.50, 0.72)
PLATE_CONTEXT_CENTER_Y_FRACTION = float(os.environ.get("PLATE_CONTEXT_CENTER_Y_FRACTION", "0.82"))
PLATE_EVIDENCE_MIN_ASPECT = float(os.environ.get("PLATE_EVIDENCE_MIN_ASPECT", "4.0"))
PLATE_MORPH_MIN_ASPECT = float(os.environ.get("PLATE_MORPH_MIN_ASPECT", "1.1"))
PLATE_MORPH_MAX_ASPECT = float(os.environ.get("PLATE_MORPH_MAX_ASPECT", "6.0"))
PLATE_MORPH_MIN_AREA_RATIO = float(os.environ.get("PLATE_MORPH_MIN_AREA_RATIO", "0.003"))
PLATE_MORPH_MAX_AREA_RATIO = float(os.environ.get("PLATE_MORPH_MAX_AREA_RATIO", "0.25"))
PLATE_MORPH_MIN_AREA_PX = int(os.environ.get("PLATE_MORPH_MIN_AREA_PX", "300"))
PLATE_MORPH_MAX_AREA_PX = int(os.environ.get("PLATE_MORPH_MAX_AREA_PX", "22000"))
PLATE_MORPH_KERNEL_WIDTH = int(os.environ.get("PLATE_MORPH_KERNEL_WIDTH", "17"))
PLATE_MORPH_KERNEL_HEIGHT = int(os.environ.get("PLATE_MORPH_KERNEL_HEIGHT", "3"))
PLATE_DEBUG_DRAW = os.environ.get("PLATE_DEBUG_DRAW", "false").lower() in {"1", "true", "yes"}
FAST_PLATE_OCR_MODEL = os.environ.get("FAST_PLATE_OCR_MODEL", "cct-s-v2-global-model")
PADDLE_RECOGNITION_MODEL = os.environ.get("PADDLE_RECOGNITION_MODEL", "PP-OCRv4_mobile_rec")

INDIAN_STATE_CODES = frozenset({
    "AP", "AR", "AS", "BR", "CG", "CH", "DD", "DL", "DN", "GA", "GJ", "HP", "HR",
    "JH", "JK", "KA", "KL", "LA", "LD", "MH", "ML", "MN", "MP", "MZ", "NL", "OD",
    "PB", "PY", "RJ", "SK", "TN", "TR", "TS", "UK", "UP", "WB",
})
