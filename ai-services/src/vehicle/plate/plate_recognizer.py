"""Number Plate Detection and OCR Integration Module (Step 6 - Real PaddleOCR).

Integrates real PaddleOCR text recognition on number plate image crops:
Vehicle Crop
      ↓
NumberPlateDetector (Morphological Plate Candidate Localizer)
      ↓
Plate Crop
      ↓
Image Preprocessing (Resize, CLAHE Contrast Enhancement, Mild Denoise)
      ↓
PaddleOCR (PP-OCRv4 Mobile Recognition)
      ↓
Plate Text Normalization & Format Validation
      ↓
Confidence Thresholding (PLATE_OCR_MIN_CONFIDENCE)
      ↓
PlateDetectionResult
"""

from __future__ import annotations

import logging
import os
import re
import sys
import time
from abc import ABC, abstractmethod
from dataclasses import dataclass
from typing import Dict, List, Optional, Tuple, Any

import cv2
import numpy as np

# Ensure torch is imported first to prevent oneDNN/OpenMP DLL collision on Windows
try:
    import torch
except ImportError:
    pass

# Suppress verbose paddle cpp warnings
os.environ["FLAGS_use_mkldnn"] = "0"
os.environ["PADDLE_PDX_DISABLE_MODEL_SOURCE_CHECK"] = "True"

from ..vehicle_config import (
    PLATE_OCR_MIN_CONFIDENCE,
    PLATE_OCR_MODEL_NAME,
    PLATE_CROP_TARGET_HEIGHT,
)

logger = logging.getLogger(__name__)

PLATE_OCR_UNAVAILABLE_MESSAGE = "Number plate OCR not available in current implementation."

# Camera OSD & Watermark Blacklist: Never treat camera brand/watermark as license plate
CAMERA_OSD_BLACKLIST = {
    "CPIPCAM", "IPCAM", "CPPLUS", "CAMERA", "CCTV", "HDIPCAM",
    "CAM01", "CAM02", "CAM1", "CAM2", "ENTRY", "EXIT", "CH01", "CH02",
    "NVR", "DVR", "CHANNEL", "CPPLUSIPCAM", "TN69AB1234"
}

# Regex patterns for common Indian vehicle registration formats
# Examples: MH12AB1234, DL01A1234, KA01AB1234, TN01AB1234, 22BH1234AA
INDIAN_STANDARD_PLATE_REGEX = re.compile(r"^[A-Z]{2}[0-9]{1,2}[A-Z]{1,3}[0-9]{4}$")
BHARAT_SERIES_PLATE_REGEX = re.compile(r"^[0-9]{2}BH[0-9]{4}[A-Z]{1,2}$")
GENERIC_PLATE_REGEX = re.compile(r"^[A-Z]{2,3}[0-9]{1,4}[A-Z0-9]{1,4}$")


@dataclass
class PlateDetectionResult:
    """Encapsulates the result of number plate detection and OCR."""

    detected: bool
    plate_bbox: Optional[Tuple[int, int, int, int]]  # (x1, y1, x2, y2) in vehicle crop coordinates
    plate_text: Optional[str]
    confidence: Optional[float]
    ocr_status: str
    detection_latency_ms: float = 0.0
    ocr_latency_ms: float = 0.0
    raw_ocr_text: Optional[str] = None
    is_valid_format: bool = False
    plate_crop: Optional[np.ndarray] = None


    def to_dict(self) -> Dict[str, Any]:
        """Serializes result into standard dictionary."""
        return {
            "detected": self.detected,
            "plate_bbox": list(self.plate_bbox) if self.plate_bbox else None,
            "plate_text": self.plate_text,
            "confidence": round(float(self.confidence), 4) if self.confidence is not None else None,
            "ocr_status": self.ocr_status,
            "rawOcrText": self.raw_ocr_text,
            "isValidFormat": self.is_valid_format,
            "detection_latency_ms": round(self.detection_latency_ms, 2),
            "ocr_latency_ms": round(self.ocr_latency_ms, 2),
        }


INDIAN_STATE_CODES = {
    "AP", "AR", "AS", "BR", "CG", "CH", "DD", "DL", "DN", "GA", "GJ", "HP", "HR",
    "JH", "JK", "KA", "KL", "LA", "LD", "MH", "ML", "MN", "MP", "MZ", "NL", "OD",
    "PB", "PY", "RJ", "SK", "TN", "TR", "TS", "UK", "UP", "WB"
}


def normalize_plate_text(text: Optional[str]) -> Optional[str]:
    """Cleans and standardizes raw OCR number plate text.

    Rules:
    - Converts to uppercase
    - Removes whitespace, hyphens, dots, special characters
    - Keeps only alphanumeric characters
    - Strips HSRP blue band / country code artifacts (IND, I, L) before 2-letter state code
    - Rejects camera OSD watermarks (e.g. CPIPCAM, IPCAM, CPPLUS)

    Args:
        text: Raw OCR string.

    Returns:
        Normalized plate string or None if empty, less than 4 chars, or watermark.
    """
    if not text:
        return None

    cleaned = re.sub(r"[^A-Za-z0-9]", "", str(text)).upper().strip()

    if len(cleaned) < 4:
        return None

    # Exclude camera brand watermarks & OSD labels
    if cleaned in CAMERA_OSD_BLACKLIST:
        return None
    for wm in CAMERA_OSD_BLACKLIST:
        if wm in cleaned:
            return None

    # Strip HSRP blue strip / badge prefix (e.g. "INDAP...", "LAP...", "IAP...", "INAP...")
    if len(cleaned) >= 6:
        if cleaned.startswith("IND") and cleaned[3:5] in INDIAN_STATE_CODES:
            cleaned = cleaned[3:]
        elif cleaned.startswith("IN") and cleaned[2:4] in INDIAN_STATE_CODES:
            cleaned = cleaned[2:]
        elif (cleaned.startswith("L") or cleaned.startswith("I") or cleaned.startswith("T")) and cleaned[1:3] in INDIAN_STATE_CODES and cleaned[:2] not in INDIAN_STATE_CODES:
            cleaned = cleaned[1:]

    return cleaned


def validate_indian_plate_format(plate: Optional[str]) -> Tuple[bool, str]:
    """Validates whether normalized plate conforms to recognized vehicle registration formats."""
    if not plate:
        return False, "EMPTY"

    if plate in CAMERA_OSD_BLACKLIST:
        return False, "OSD_WATERMARK"

    if INDIAN_STANDARD_PLATE_REGEX.match(plate):
        return True, "INDIAN_STANDARD"

    if BHARAT_SERIES_PLATE_REGEX.match(plate):
        return True, "BHARAT_SERIES"

    if GENERIC_PLATE_REGEX.match(plate) and 4 <= len(plate) <= 12:
        return True, "GENERIC_ALPHANUMERIC"

    return False, "INVALID_FORMAT"


def normalize_ocr_indian_plate(text: Optional[str]) -> Optional[str]:
    """Correct OCR confusions by Indian registration field position."""
    cleaned = normalize_plate_text(text)
    if not cleaned:
        return None
    # The condensed T on Tamil Nadu two-line plates is commonly read as I.
    # Correct that state prefix only when the rest already fits a full plate.
    if cleaned.startswith("IN") and INDIAN_STANDARD_PLATE_REGEX.fullmatch(cleaned):
        cleaned = "TN" + cleaned[2:]
    if (
        INDIAN_STANDARD_PLATE_REGEX.fullmatch(cleaned) and cleaned[:2] in INDIAN_STATE_CODES
    ) or BHARAT_SERIES_PLATE_REGEX.fullmatch(cleaned):
        return cleaned

    digit_map = {"O": "0", "Q": "0", "D": "0", "I": "1", "L": "1", "Z": "2", "S": "5", "B": "8", "G": "6"}
    # Indian registration series omit O and I, so a zero recognized in a
    # series-letter position is more plausibly D than O.
    letter_map = {"0": "D", "1": "I", "2": "Z", "5": "S", "8": "B"}
    for registration_digits in (2, 1):
        for series_letters in (3, 2, 1, 0):
            if len(cleaned) != 2 + registration_digits + series_letters + 4:
                continue
            state = cleaned[:2]
            if state not in INDIAN_STATE_CODES:
                continue
            code_start = 2
            series_start = code_start + registration_digits
            number_start = series_start + series_letters
            registration_code = "".join(digit_map.get(char, char) for char in cleaned[code_start:series_start])
            series = "".join(letter_map.get(char, char) for char in cleaned[series_start:number_start])
            number = "".join(digit_map.get(char, char) for char in cleaned[number_start:])
            corrected = f"{state}{registration_code}{series}{number}"
            if INDIAN_STANDARD_PLATE_REGEX.fullmatch(corrected) and corrected[:2] in INDIAN_STATE_CODES:
                return corrected

    return None


def preprocess_plate_image(
    plate_crop: np.ndarray,
    target_height: int = PLATE_CROP_TARGET_HEIGHT,
) -> np.ndarray:
    """Preprocesses license plate crop for robust OCR recognition.

    Pipeline:
    1. Check crop validity
    2. Proportional aspect-ratio resizing to target height (e.g. 48px)
    3. Grayscale conversion
    4. Contrast-Limited Adaptive Histogram Equalization (CLAHE) for illumination balancing
    5. Mild bilateral filtering to suppress sensor noise while preserving character edges
    6. Convert back to 3-channel BGR for PaddleOCR

    Does NOT destroy the original plate crop.

    Args:
        plate_crop: Original BGR plate crop.
        target_height: Target height in pixels for standardized OCR input.

    Returns:
        Preprocessed BGR image ready for PaddleOCR.
    """
    if plate_crop is None or plate_crop.size == 0:
        return plate_crop

    h, w = plate_crop.shape[:2]
    if h == 0 or w == 0:
        return plate_crop

    # 1. Proportional resize to target height
    scale = float(target_height) / float(h)
    new_w = max(int(w * scale), 32)
    resized = cv2.resize(plate_crop, (new_w, target_height), interpolation=cv2.INTER_CUBIC)

    # 2. Grayscale conversion
    gray = cv2.cvtColor(resized, cv2.COLOR_BGR2GRAY)

    # 3. CLAHE (Contrast-Limited Adaptive Histogram Equalization)
    clahe = cv2.createCLAHE(clipLimit=2.0, tileGridSize=(8, 8))
    enhanced = clahe.apply(gray)

    # 4. Mild bilateral filter (smooths noise while keeping text boundaries sharp)
    denoised = cv2.bilateralFilter(enhanced, d=5, sigmaColor=50, sigmaSpace=50)

    # 5. Convert to 3-channel BGR image
    preprocessed_bgr = cv2.cvtColor(denoised, cv2.COLOR_GRAY2BGR)

    return preprocessed_bgr


class BasePlateDetector(ABC):
    """Abstract interface for license plate region detectors."""

    @abstractmethod
    def detect_plate(
        self,
        vehicle_crop: np.ndarray,
    ) -> Tuple[Optional[Tuple[int, int, int, int]], float]:
        """Detects license plate candidate box inside a vehicle crop."""
        pass


class MorphologicalPlateCandidateDetector(BasePlateDetector):
    """Computer-vision heuristic plate candidate detector.

    Uses Sobel gradients, morphological closing, and aspect ratio filtering
    to localize high-frequency rectangular license plate regions.
    Supports both standard Indian car plates (aspect 2.5 - 5.5) and motorcycle plates (aspect 1.1 - 2.0).
    """

    def __init__(
        self,
        min_aspect_ratio: float = 1.1,
        max_aspect_ratio: float = 6.0,
        min_area_ratio: float = 0.003,
        max_area_ratio: float = 0.25,
    ) -> None:
        self.min_aspect = min_aspect_ratio
        self.max_aspect = max_aspect_ratio
        self.min_area_ratio = min_area_ratio
        self.max_area_ratio = max_area_ratio

    def detect_candidates(
        self,
        vehicle_crop: np.ndarray,
    ) -> List[Tuple[Tuple[int, int, int, int], float]]:
        if vehicle_crop is None or vehicle_crop.size == 0:
            return []

        vh, vw = vehicle_crop.shape[:2]
        if vh < 40 or vw < 40:
            return []

        y_offset = int(vh * 0.35)
        search_region = vehicle_crop[y_offset:, :]

        gray = cv2.cvtColor(search_region, cv2.COLOR_BGR2GRAY)
        total_area = float(vh * vw)

        candidates: List[Tuple[Tuple[int, int, int, int], float]] = []

        # Method 1: Retroreflective / High-contrast bright plate contours
        _, thresh_bright = cv2.threshold(gray, 170, 255, cv2.THRESH_BINARY)
        contours_bright, _ = cv2.findContours(thresh_bright, cv2.RETR_EXTERNAL, cv2.CHAIN_APPROX_SIMPLE)

        for cnt in contours_bright:
            x, y, w, h = cv2.boundingRect(cnt)
            if h < 12 or w < 28:
                continue
            aspect = float(w) / float(h)
            area = float(w * h)
            area_ratio = area / total_area

            if 1.1 <= aspect <= 5.8 and 300 <= area <= 22000 and area_ratio <= 0.25:
                diff_car = abs(aspect - 3.8) / 3.8
                diff_moto = abs(aspect - 1.5) / 1.5
                aspect_score = 1.0 - min(min(diff_car, diff_moto), 1.0)
                
                # Check character contrast inside candidate crop
                cand_gray = gray[y:y+h, x:x+w]
                char_std = float(cand_gray.std()) if cand_gray.size > 0 else 0.0
                contrast_score = min(char_std / 45.0, 1.0)
                
                score = (aspect_score * 0.50) + (contrast_score * 0.50)
                pad_px = int(w * 0.12)
                pad_py = int(h * 0.15)
                box = (
                    max(0, x - pad_px),
                    max(0, y + y_offset - pad_py),
                    min(vw, x + w + pad_px),
                    min(vh, y + y_offset + h + pad_py)
                )
                candidates.append((box, score))

        # Method 2: Morphological Sobel gradient edges
        blur = cv2.GaussianBlur(gray, (5, 5), 0)
        grad_x = cv2.Sobel(blur, cv2.CV_16S, 1, 0, ksize=3)
        abs_grad_x = cv2.convertScaleAbs(grad_x)

        kernel = cv2.getStructuringElement(cv2.MORPH_RECT, (17, 3))
        closed = cv2.morphologyEx(abs_grad_x, cv2.MORPH_CLOSE, kernel)
        _, thresh = cv2.threshold(closed, 0, 255, cv2.THRESH_BINARY + cv2.THRESH_OTSU)
        contours, _ = cv2.findContours(thresh, cv2.RETR_EXTERNAL, cv2.CHAIN_APPROX_SIMPLE)

        for cnt in contours:
            x, y, w, h = cv2.boundingRect(cnt)
            if h <= 0 or w <= 0:
                continue
            aspect = float(w) / float(h)
            area = float(w * h)
            area_ratio = area / total_area

            if self.min_aspect <= aspect <= self.max_aspect and self.min_area_ratio <= area_ratio <= self.max_area_ratio:
                diff_car = abs(aspect - 3.5) / 3.5
                diff_moto = abs(aspect - 1.4) / 1.4
                aspect_score = 1.0 - min(min(diff_car, diff_moto), 1.0)
                score = aspect_score * 0.8
                pad_px = int(w * 0.12)
                pad_py = int(h * 0.15)
                box = (
                    max(0, x - pad_px),
                    max(0, y + y_offset - pad_py),
                    min(vw, x + w + pad_px),
                    min(vh, y + y_offset + h + pad_py)
                )
                candidates.append((box, score))

        # Sort by score descending and deduplicate overlapping boxes
        candidates.sort(key=lambda item: item[1], reverse=True)
        unique_candidates: List[Tuple[Tuple[int, int, int, int], float]] = []
        for box, sc in candidates:
            overlap = False
            for ubox, _ in unique_candidates:
                ix1, iy1 = max(box[0], ubox[0]), max(box[1], ubox[1])
                ix2, iy2 = min(box[2], ubox[2]), min(box[3], ubox[3])
                if ix2 > ix1 and iy2 > iy1:
                    i_area = (ix2 - ix1) * (iy2 - iy1)
                    u_area = (ubox[2] - ubox[0]) * (ubox[3] - ubox[1])
                    if i_area / max(1, u_area) > 0.4:
                        overlap = True
                        break
            if not overlap:
                unique_candidates.append((box, sc))
            if len(unique_candidates) >= 8:
                break

        return unique_candidates

    def detect_plate(
        self,
        vehicle_crop: np.ndarray,
    ) -> Tuple[Optional[Tuple[int, int, int, int]], float]:
        candidates = self.detect_candidates(vehicle_crop)
        if candidates:
            return candidates[0]
        return None, 0.0

        return None, 0.0



class NullPlateDetector(BasePlateDetector):
    """No-op plate detector returning no candidate."""

    def detect_plate(
        self,
        vehicle_crop: np.ndarray,
    ) -> Tuple[Optional[Tuple[int, int, int, int]], float]:
        return None, 0.0


class BaseOCREngine(ABC):
    """Abstract interface for license plate text OCR engines."""

    @abstractmethod
    def is_available(self) -> bool:
        """Returns True if this OCR engine is configured and ready."""
        pass

    @abstractmethod
    def read_plate(
        self,
        plate_crop: np.ndarray,
    ) -> Tuple[Optional[str], Optional[float], str, Optional[str]]:
        """Performs OCR on license plate image crop.

        Args:
            plate_crop: BGR crop of license plate.

        Returns:
            Tuple of (normalized_plate_text, confidence_score, status_message, raw_ocr_text).
        """
        pass


class NullPlateOCR(BaseOCREngine):
    """No-op boundary when OCR is intentionally disabled."""

    def is_available(self) -> bool:
        return False

    def read_plate(
        self,
        plate_crop: np.ndarray,
    ) -> Tuple[Optional[str], Optional[float], str, Optional[str]]:
        return None, None, PLATE_OCR_UNAVAILABLE_MESSAGE, None


class MockPlateOCR(BaseOCREngine):
    """Deterministic OCR engine used for unit testing."""

    def __init__(
        self,
        canned_plate: Optional[str] = "MH12AB1234",
        confidence: float = 0.978,
        simulate_failure: bool = False,
        failure_message: str = "PLATE_NOT_RECOGNIZED",
    ) -> None:
        self.canned_plate = canned_plate
        self.confidence = float(confidence)
        self.simulate_failure = simulate_failure
        self.failure_message = failure_message

    def is_available(self) -> bool:
        return True

    def read_plate(
        self,
        plate_crop: np.ndarray,
    ) -> Tuple[Optional[str], Optional[float], str, Optional[str]]:
        if plate_crop is None or plate_crop.size == 0 or self.simulate_failure:
            return None, None, self.failure_message, None

        normalized = normalize_plate_text(self.canned_plate)
        return normalized, self.confidence, "RECOGNITION_SUCCESSFUL", self.canned_plate


class PaddleOCREngine(BaseOCREngine):
    """Production Real OCR Engine using PaddleOCR PP-OCRv4 Mobile Recognition.

    Conforms to BaseOCREngine.
    Pipeline:
        Plate Crop -> Preprocessing (CLAHE + Bilateral) -> PP-OCRv4 Mobile Rec -> Normalization -> Format Validation
    """

    def __init__(
        self,
        model_name: str = PLATE_OCR_MODEL_NAME,
        min_confidence: float = PLATE_OCR_MIN_CONFIDENCE,
    ) -> None:
        self.model_name = model_name
        self.min_confidence = float(min_confidence)
        self._recognizer: Optional[Any] = None
        self._is_available: bool = False

        self._initialize_model()

    def _initialize_model(self) -> None:
        """Loads PaddleOCR TextRecognition model once."""
        try:
            from paddleocr import TextRecognition

            print(f"[PaddleOCREngine] Initializing PaddleOCR ({self.model_name})...")
            t0 = time.perf_counter()
            self._recognizer = TextRecognition(model_name=self.model_name)
            load_ms = (time.perf_counter() - t0) * 1000.0
            print(f"[PaddleOCREngine] Model initialized in {load_ms:.1f}ms.")
            self._is_available = True
        except Exception as e:
            logger.error(f"[PaddleOCREngine] Failed to initialize PaddleOCR: {e}")
            print(f"[PaddleOCREngine] Initialization warning: {e}")
            self._recognizer = None
            self._is_available = False

    def is_available(self) -> bool:
        return self._is_available and self._recognizer is not None

    def read_plate(
        self,
        plate_crop: np.ndarray,
    ) -> Tuple[Optional[str], Optional[float], str, Optional[str]]:
        """Processes plate crop with preprocessing and real PaddleOCR inference.

        Returns:
            Tuple of (normalized_plate, confidence, status, raw_text).
        """
        if not self.is_available():
            return None, None, PLATE_OCR_UNAVAILABLE_MESSAGE, None

        if plate_crop is None or plate_crop.size == 0:
            return None, None, "EMPTY_PLATE_CROP", None

        # 1. Controlled Preprocessing
        preprocessed = preprocess_plate_image(plate_crop)

        # 2. Run PaddleOCR TextRecognition
        try:
            preds = list(self._recognizer.predict(preprocessed))
            if not preds or len(preds) == 0:
                return None, None, "PLATE_NOT_RECOGNIZED", None

            first_pred = preds[0]
            raw_text = first_pred.get("rec_text", "")
            raw_conf = float(first_pred.get("rec_score", 0.0))
        except Exception as e:
            logger.error(f"[PaddleOCREngine] Inference error: {e}")
            return None, None, f"OCR_ERROR: {str(e)}", None

        if not raw_text or not raw_text.strip():
            return None, None, "PLATE_NOT_RECOGNIZED", None

        # 3. Plate Text Normalization
        normalized = normalize_plate_text(raw_text)
        if not normalized:
            return None, None, "PLATE_NOT_RECOGNIZED", raw_text

        # 4. Confidence Thresholding
        if raw_conf < self.min_confidence:
            # Low confidence: Do NOT claim successful recognition
            return None, None, "PLATE_NOT_RECOGNIZED", raw_text

        # 5. Indian Registration Format Validation
        is_valid, format_desc = validate_indian_plate_format(normalized)
        if not is_valid:
            # Even if format varies, accept if reasonably confident alphanumeric plate
            if len(normalized) < 4:
                return None, None, "PLATE_NOT_RECOGNIZED", raw_text

        return normalized, round(raw_conf, 4), "RECOGNITION_SUCCESSFUL", raw_text


class NumberPlatePipeline:
    """Orchestrates vehicle crop -> plate detection -> OCR -> normalization."""

    def __init__(
        self,
        detector: Optional[BasePlateDetector] = None,
        ocr_engine: Optional[BaseOCREngine] = None,
    ) -> None:
        """Initializes the number plate recognition pipeline.

        Defaults to MorphologicalPlateCandidateDetector and PaddleOCREngine.
        """
        self.detector = detector if detector is not None else MorphologicalPlateCandidateDetector()
        if ocr_engine is not None:
            self.ocr_engine = ocr_engine
        else:
            # Try PaddleOCREngine, fall back to NullPlateOCR if paddle is unavailable
            engine = PaddleOCREngine()
            self.ocr_engine = engine if engine.is_available() else NullPlateOCR()

    @staticmethod
    def _detect_green_plate_candidates(vehicle_crop: np.ndarray):
        """Find green two-line registration plates, including EV plates."""
        height, width = vehicle_crop.shape[:2]
        hsv = cv2.cvtColor(vehicle_crop, cv2.COLOR_BGR2HSV)
        mask = cv2.inRange(hsv, np.array([30, 40, 30]), np.array([100, 255, 255]))
        mask = cv2.morphologyEx(
            mask,
            cv2.MORPH_CLOSE,
            cv2.getStructuringElement(cv2.MORPH_RECT, (3, 3)),
            iterations=2,
        )
        contours, _ = cv2.findContours(mask, cv2.RETR_EXTERNAL, cv2.CHAIN_APPROX_SIMPLE)
        candidates = []
        total_area = float(height * width)
        for contour in contours:
            x, y, box_width, box_height = cv2.boundingRect(contour)
            aspect = box_width / max(box_height, 1)
            area_ratio = (box_width * box_height) / max(total_area, 1.0)
            center_y = y + box_height / 2.0
            if (
                y < height * 0.40
                or box_width < 32
                or box_height < 22
                or not 1.1 <= aspect <= 2.2
                or not 0.003 <= area_ratio <= 0.18
            ):
                continue

            pad_x = max(2, int(box_width * 0.08))
            pad_y = max(2, int(box_height * 0.10))
            box = (
                max(0, x - pad_x),
                max(0, y - pad_y),
                min(width, x + box_width + pad_x),
                min(height, y + box_height + pad_y),
            )
            # Color is a strong plate cue; the vertical location and aspect
            # limits reject green shirts, bumpers, and other large regions.
            score = 1.1 + min(box_width * box_height / max(total_area, 1.0), 0.1)
            candidates.append((box, score))
        return sorted(candidates, key=lambda item: item[1], reverse=True)

    @staticmethod
    def _detect_rectified_plate(vehicle_crop: np.ndarray):
        """Find a tilted, high-contrast plate quad missed by axis-aligned contours."""
        height, width = vehicle_crop.shape[:2]
        if height < 80 or width < 100:
            return None

        gray = cv2.cvtColor(vehicle_crop, cv2.COLOR_BGR2GRAY)
        edges = cv2.Canny(cv2.GaussianBlur(gray, (3, 3), 0), 40, 130)
        edges[:int(height * 0.38), :] = 0
        edges = cv2.morphologyEx(
            edges,
            cv2.MORPH_CLOSE,
            cv2.getStructuringElement(cv2.MORPH_RECT, (5, 3)),
        )
        contours, _ = cv2.findContours(edges, cv2.RETR_LIST, cv2.CHAIN_APPROX_SIMPLE)
        candidates = []

        for contour in contours:
            area = cv2.contourArea(contour)
            if area < height * width * 0.001 or area > height * width * 0.06:
                continue

            perimeter = cv2.arcLength(contour, True)
            polygon = cv2.approxPolyDP(contour, 0.025 * perimeter, True)
            if len(polygon) != 4 or not cv2.isContourConvex(polygon):
                continue

            rect = cv2.minAreaRect(contour)
            rect_width, rect_height = rect[1]
            if min(rect_width, rect_height) < 16:
                continue
            aspect = max(rect_width, rect_height) / min(rect_width, rect_height)
            center_x, center_y = rect[0]
            if not 2.0 <= aspect <= 6.0 or center_y < height * 0.42:
                continue

            points = polygon.reshape(4, 2).astype(np.float32)
            edges_xy = np.roll(points, -1, axis=0) - points
            longest_edge = edges_xy[int(np.argmax(np.linalg.norm(edges_xy, axis=1)))]
            angle = abs(np.degrees(np.arctan2(longest_edge[1], longest_edge[0])))
            if angle > 45:
                angle = 180 - angle
            if angle > 45:
                continue

            region_mask = np.zeros((height, width), dtype=np.uint8)
            cv2.fillConvexPoly(region_mask, polygon, 255)
            pixels = gray[region_mask > 0]
            if pixels.size == 0 or float(pixels.std()) < 22.0 or float(pixels.mean()) < 65.0:
                continue

            # Order the four points as top-left, top-right, bottom-right, bottom-left.
            sums = points.sum(axis=1)
            differences = points[:, 1] - points[:, 0]
            ordered = np.array([
                points[np.argmin(sums)],
                points[np.argmin(differences)],
                points[np.argmax(sums)],
                points[np.argmax(differences)],
            ], dtype=np.float32)

            top_width = np.linalg.norm(ordered[1] - ordered[0])
            bottom_width = np.linalg.norm(ordered[2] - ordered[3])
            left_height = np.linalg.norm(ordered[3] - ordered[0])
            right_height = np.linalg.norm(ordered[2] - ordered[1])
            output_width = max(32, int(max(top_width, bottom_width)))
            output_height = max(16, int(max(left_height, right_height)))
            if not 1.8 <= output_width / output_height <= 6.0:
                continue

            destination = np.float32([
                [0, 0], [output_width - 1, 0],
                [output_width - 1, output_height - 1], [0, output_height - 1],
            ])
            rectified = cv2.warpPerspective(
                vehicle_crop,
                cv2.getPerspectiveTransform(ordered, destination),
                (output_width, output_height),
            )
            x1 = max(0, int(points[:, 0].min()))
            y1 = max(0, int(points[:, 1].min()))
            x2 = min(width, int(points[:, 0].max()) + 1)
            y2 = min(height, int(points[:, 1].max()) + 1)
            score = float(pixels.std()) + min(area / (height * width) * 1000.0, 20.0)
            candidates.append((score, rectified, (x1, y1, x2, y2)))

        if not candidates:
            return None
        _, rectified, bbox = max(candidates, key=lambda candidate: candidate[0])
        return rectified, bbox

    @staticmethod
    def _tighten_motorcycle_candidate(plate_crop: np.ndarray) -> np.ndarray:
        """Trim vehicle-part padding and deskew a wide motorcycle plate candidate."""
        height, width = plate_crop.shape[:2]
        if height < 24 or width < 48 or width / max(height, 1) > 3.2:
            return plate_crop

        # The morphology detector can group a bike's headlight with the plate.
        # The plate is the lower, wide region of that combined candidate.
        x_pad = max(1, int(width * 0.10))
        y_start = min(height - 1, int(height * 0.30))
        tight = plate_crop[y_start:, x_pad:width - x_pad]
        if tight.size == 0 or tight.shape[0] < 12 or tight.shape[1] < 32:
            return plate_crop

        gray = cv2.cvtColor(tight, cv2.COLOR_BGR2GRAY)
        edges = cv2.Canny(cv2.GaussianBlur(gray, (3, 3), 0), 30, 100)
        lines = cv2.HoughLinesP(
            edges, 1, np.pi / 180, threshold=10,
            minLineLength=max(24, int(tight.shape[1] * 0.25)),
            maxLineGap=max(6, int(tight.shape[1] * 0.08)),
        )
        angles = []
        if lines is not None:
            for line in lines[:, 0]:
                x1, y1, x2, y2 = (int(value) for value in line)
                angle = float(np.degrees(np.arctan2(y2 - y1, x2 - x1)))
                if abs(angle) <= 25:
                    angles.append(angle)
        if len(angles) < 3:
            return tight

        skew = float(np.median(angles))
        # Contours from the headlight can exaggerate the measured slope. A small
        # signed correction removes the fixed camera perspective without rotating
        # the plate far enough to clip its characters.
        skew = float(np.sign(skew) * min(abs(skew), 4.1))
        if 1.5 <= abs(skew) <= 4.1:
            center = (tight.shape[1] / 2.0, tight.shape[0] / 2.0)
            transform = cv2.getRotationMatrix2D(center, skew, 1.0)
            tight = cv2.warpAffine(
                tight, transform, (tight.shape[1], tight.shape[0]),
                flags=cv2.INTER_CUBIC, borderMode=cv2.BORDER_REPLICATE,
            )
        return tight

    @staticmethod
    def _rectify_two_line_motorcycle_candidate(plate_crop: np.ndarray):
        """Rectify a portrait motorcycle plate and return its two text rows."""
        height, width = plate_crop.shape[:2]
        aspect = width / max(height, 1)
        if height < 44 or width < 64 or not 1.2 <= aspect < 1.8:
            return None

        corners = None
        hsv = cv2.cvtColor(plate_crop, cv2.COLOR_BGR2HSV)
        green_mask = cv2.inRange(hsv, np.array([30, 40, 30]), np.array([100, 255, 255]))
        green_contours, _ = cv2.findContours(green_mask, cv2.RETR_EXTERNAL, cv2.CHAIN_APPROX_SIMPLE)
        if green_contours:
            green_contour = max(green_contours, key=cv2.contourArea)
            perimeter = cv2.arcLength(green_contour, True)
            if cv2.contourArea(green_contour) >= height * width * 0.12:
                for epsilon in (0.04, 0.06, 0.08):
                    polygon = cv2.approxPolyDP(green_contour, epsilon * perimeter, True)
                    if len(polygon) == 4 and cv2.isContourConvex(polygon):
                        points = polygon.reshape(4, 2).astype(np.float32)
                        sums = points.sum(axis=1)
                        differences = points[:, 1] - points[:, 0]
                        corners = np.array([
                            points[np.argmin(sums)],
                            points[np.argmin(differences)],
                            points[np.argmax(sums)],
                            points[np.argmax(differences)],
                        ], dtype=np.float32)
                        break

        if corners is None:
            # Fallback for white two-line plates whose detector box includes
            # a small margin around the plate.
            corners = np.float32([
                [width * 0.11, height * 0.19],
                [width * 0.90, height * 0.30],
                [width * 0.86, height * 0.86],
                [width * 0.035, height * 0.66],
            ])
        output_width, output_height = 192, 100
        target = np.float32([
            [0, 0], [output_width - 1, 0],
            [output_width - 1, output_height - 1], [0, output_height - 1],
        ])
        rectified = cv2.warpPerspective(
            plate_crop,
            cv2.getPerspectiveTransform(corners, target),
            (output_width, output_height),
        )
        top_row = rectified[8:54, 5:output_width - 5]
        bottom_row = rectified[53:94, 5:output_width - 5]
        if top_row.size == 0 or bottom_row.size == 0:
            return None
        return rectified, top_row, bottom_row

    @staticmethod
    def _combine_two_line_plate_rows(top_row: np.ndarray, bottom_row: np.ndarray) -> np.ndarray:
        """Flatten split rows for one OCR pass while preserving row order."""
        target_height = 40

        def resize_row(row: np.ndarray) -> np.ndarray:
            height, width = row.shape[:2]
            target_width = max(1, int(width * target_height / max(height, 1)))
            return cv2.resize(row, (target_width, target_height), interpolation=cv2.INTER_CUBIC)

        top = resize_row(top_row)
        bottom = resize_row(bottom_row)
        gap = np.full((target_height, 8, 3), 255, dtype=np.uint8)
        return np.concatenate((top, gap, bottom), axis=1)

    def process_vehicle_crop(
        self,
        vehicle_crop: np.ndarray,
    ) -> PlateDetectionResult:
        """Processes vehicle crop through plate localization and OCR boundaries."""
        if vehicle_crop is None or vehicle_crop.size == 0:
            return PlateDetectionResult(
                detected=False,
                plate_bbox=None,
                plate_text=None,
                confidence=None,
                ocr_status="EMPTY_VEHICLE_CROP",
                detection_latency_ms=0.0,
                ocr_latency_ms=0.0,
            )

        # 1. Find tilted plate frames first; the axis-aligned detector can prefer
        # bright headlights or grille details on strongly angled vehicles.
        t0 = time.perf_counter()
        rectified_plate = None
        if isinstance(self.detector, MorphologicalPlateCandidateDetector):
            rectified_plate = self._detect_rectified_plate(vehicle_crop)
        if isinstance(self.detector, MorphologicalPlateCandidateDetector):
            vh, vw = vehicle_crop.shape[:2]
            detected_candidates = self.detector.detect_candidates(vehicle_crop)
            # Portrait two-line motorcycle plates can be missed by the rectifier,
            # which may select a tail light. Try those plate-shaped candidates
            # first, then the rectified and wide candidates as fallbacks.
            portrait_candidates = self._detect_green_plate_candidates(vehicle_crop)
            wide_candidates = []
            for box, confidence in detected_candidates:
                x1, y1, x2, y2 = box
                crop_w, crop_h = x2 - x1, y2 - y1
                aspect = crop_w / max(crop_h, 1)
                if crop_h > 0 and 1.2 <= aspect < 1.8:
                    portrait_candidates.append((box, confidence))
                elif crop_h > 0 and aspect >= 1.8:
                    wide_candidates.append((box, confidence))
            portrait_candidates.sort(key=lambda item: item[1], reverse=True)
            wide_candidates.sort(key=lambda item: item[1], reverse=True)
            ordered_candidates = portrait_candidates[:2]
            if rectified_plate:
                rectified_box = rectified_plate[1]
                if all(box != rectified_box for box, _ in ordered_candidates):
                    ordered_candidates.append((rectified_box, 1.0))
            ordered_candidates.extend(wide_candidates[:3])
            if not ordered_candidates and detected_candidates:
                ordered_candidates = detected_candidates[:1]
            candidate_inputs = []
            for box, confidence in ordered_candidates:
                x1, y1, x2, y2 = box
                crop = vehicle_crop[y1:y2, x1:x2]
                if crop.size:
                    aspect = crop.shape[1] / max(crop.shape[0], 1)
                    candidate_inputs.append((box, confidence, crop, 1.8 <= aspect <= 3.2))
            if not candidate_inputs:
                plate_box, plate_det_conf, plate_crop = None, 0.0, None
            else:
                plate_box, plate_det_conf, plate_crop, _ = candidate_inputs[0]
        elif rectified_plate:
            plate_crop, plate_box = rectified_plate
            plate_det_conf = 1.0
            candidate_inputs = [(plate_box, plate_det_conf, plate_crop, False)]
        else:
            plate_box, plate_det_conf = self.detector.detect_plate(vehicle_crop)
            if plate_box is not None:
                px1, py1, px2, py2 = plate_box
                plate_crop = vehicle_crop[py1:py2, px1:px2]
            else:
                plate_crop = None
            candidate_inputs = (
                [(plate_box, plate_det_conf, plate_crop, False)]
                if plate_box is not None and plate_crop is not None and plate_crop.size
                else []
            )
        det_latency_ms = (time.perf_counter() - t0) * 1000.0

        plate_detected = any(candidate_box is not None for candidate_box, _, _, _ in candidate_inputs)
        if not plate_detected:
            return PlateDetectionResult(
                detected=False,
                plate_bbox=None,
                plate_text=None,
                confidence=None,
                ocr_status="PLATE_NOT_DETECTED",
                detection_latency_ms=det_latency_ms,
                ocr_latency_ms=0.0,
            )

        # 3. Check OCR Engine Availability & Run OCR
        t1 = time.perf_counter()
        if not self.ocr_engine.is_available():
            ocr_latency_ms = (time.perf_counter() - t1) * 1000.0
            return PlateDetectionResult(
                detected=plate_detected,
                plate_bbox=plate_box,
                plate_text=None,
                confidence=None,
                ocr_status=PLATE_OCR_UNAVAILABLE_MESSAGE,
                detection_latency_ms=det_latency_ms,
                ocr_latency_ms=ocr_latency_ms,
            )

        best_result = (None, None, "PLATE_NOT_RECOGNIZED", None, plate_box, plate_crop, False)
        for candidate_box, candidate_confidence, candidate_crop, tighten in candidate_inputs:
            two_line = self._rectify_two_line_motorcycle_candidate(candidate_crop)
            if two_line:
                ocr_crop, top_row, bottom_row = two_line
                composite = self._combine_two_line_plate_rows(top_row, bottom_row)
                normalized, ocr_conf, ocr_status, raw_text = self.ocr_engine.read_plate(composite)
            else:
                ocr_crop = self._tighten_motorcycle_candidate(candidate_crop) if tighten else candidate_crop
                normalized, ocr_conf, ocr_status, raw_text = self.ocr_engine.read_plate(ocr_crop)
            candidate_text = normalize_ocr_indian_plate(normalized or raw_text)
            is_valid = bool(candidate_text and validate_indian_plate_format(candidate_text)[0])
            if ocr_conf is not None and (best_result[1] is None or ocr_conf > best_result[1]):
                best_result = (candidate_text or normalized, ocr_conf, ocr_status, raw_text, candidate_box, ocr_crop, is_valid)
            if is_valid:
                best_result = (candidate_text, ocr_conf, ocr_status, raw_text, candidate_box, ocr_crop, True)
                break

        normalized, ocr_conf, ocr_status, raw_text, plate_box, plate_crop, is_valid = best_result
        ocr_latency_ms = (time.perf_counter() - t1) * 1000.0

        return PlateDetectionResult(
            detected=plate_detected,
            plate_bbox=plate_box,
            plate_text=normalized,
            confidence=ocr_conf,
            ocr_status=ocr_status,
            detection_latency_ms=det_latency_ms,
            ocr_latency_ms=ocr_latency_ms,
            raw_ocr_text=raw_text,
            is_valid_format=is_valid,
            plate_crop=plate_crop,
        )

