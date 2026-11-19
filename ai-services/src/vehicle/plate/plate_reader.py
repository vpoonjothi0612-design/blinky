"""Standalone plate detection, OCR and per-track voting.

The vehicle detector/tracker remains responsible for finding the vehicle and
its track.  This module only receives that vehicle crop and returns plate OCR.
All heavy models are initialized lazily so a missing optional plate model or OCR
package can never prevent the camera service from starting.
"""

from __future__ import annotations

import csv
import logging
import re
import threading
import time
from collections import Counter, defaultdict, deque
from datetime import datetime
from pathlib import Path
from typing import Any, Dict, Iterable, List, Optional, Tuple

import cv2
import numpy as np

from . import plate_config as config

logger = logging.getLogger("plate_reader")

_MODEL_LOCK = threading.Lock()
_OCR_LOCK = threading.Lock()
_PADDLE: Any = None
_PADDLE_TEXT_RECOGNITION: Any = None
_FAST_PLATE: Any = None
_YOLO: Any = None
_MODEL_INITIALIZED = False
_PADDLE_INITIALIZED = False
_PADDLE_TEXT_INITIALIZED = False
_FAST_INITIALIZED = False

_TO_DIGIT = {"O": "0", "Q": "0", "D": "0", "I": "1", "L": "1", "Z": "2", "S": "5", "B": "8", "G": "6"}
_TO_LETTER = {"0": "O", "1": "I", "2": "Z", "5": "S", "8": "B"}
_INDIAN_STANDARD = re.compile(r"^[A-Z]{2}\d{2}[A-Z]{1,3}\d{4}$")
_BH_SERIES = re.compile(r"^\d{2}BH\d{4}[A-Z]{1,2}$")


def _empty_result(status: str = "not_found", raw_text: str = "") -> Dict[str, Any]:
    return {
        "plate_text": "",
        "confidence": 0.0,
        "status": status,
        "plate_crop_path": None,
        "_plate_crop": None,
        "_frame_token": None,
        "raw_text": raw_text,
        "_sharpness": 0.0,
        "_variant": "none",
        "_plate_bbox": None,
    }


def _clean_text(text: Any) -> str:
    return re.sub(r"[^A-Z0-9]", "", str(text or "").upper())


def _correct_positionally(text: str) -> str:
    """Apply OCR substitutions only where the Indian format expects a class."""
    raw = _clean_text(text)
    if _BH_SERIES.fullmatch(raw):
        return raw
    # Candidate formats vary in the number of series letters, so only process
    # lengths which can fit AA00[A-Z]{1,3}0000.
    for series_len in (3, 2, 1):
        if len(raw) != 2 + 2 + series_len + 4:
            continue
        state = raw[:2]
        registration = raw[2:4].translate(str.maketrans(_TO_DIGIT))
        series = raw[4:4 + series_len].translate(str.maketrans(_TO_LETTER))
        number = raw[4 + series_len:].translate(str.maketrans(_TO_DIGIT))
        corrected = f"{state}{registration}{series}{number}"
        if _INDIAN_STANDARD.fullmatch(corrected) and corrected[:2] in config.INDIAN_STATE_CODES:
            return corrected
    # A few common state-prefix OCR confusions are recoverable when all later
    # positions form a standard registration.  Do not otherwise guess a state.
    if raw.startswith("IN"):
        candidate = "TN" + raw[2:]
        if _INDIAN_STANDARD.fullmatch(candidate) and candidate[:2] in config.INDIAN_STATE_CODES:
            return candidate
    return raw


def _validate(text: str) -> bool:
    if _BH_SERIES.fullmatch(text):
        return True
    return bool(_INDIAN_STANDARD.fullmatch(text) and text[:2] in config.INDIAN_STATE_CODES)


def _initialize_yolo() -> Any:
    global _YOLO, _MODEL_INITIALIZED
    if _MODEL_INITIALIZED:
        return _YOLO
    with _MODEL_LOCK:
        if _MODEL_INITIALIZED:
            return _YOLO
        _MODEL_INITIALIZED = True
        if not config.PLATE_MODEL_PATH.is_file():
            logger.info("Separate plate model not found at %s; using OpenCV candidate search", config.PLATE_MODEL_PATH)
            return None
        try:
            from ultralytics import YOLO
            _YOLO = YOLO(str(config.PLATE_MODEL_PATH))
        except Exception:
            logger.exception("Could not load optional plate YOLO model; using OpenCV fallback")
            _YOLO = None
    return _YOLO


def _initialize_paddle() -> Any:
    global _PADDLE, _PADDLE_INITIALIZED
    if _PADDLE_INITIALIZED:
        return _PADDLE
    with _OCR_LOCK:
        if _PADDLE_INITIALIZED:
            return _PADDLE
        _PADDLE_INITIALIZED = True
        try:
            from importlib.metadata import version
            paddle_major = int(version("paddleocr").split(".", 1)[0])
            if paddle_major >= 3:
                # PaddleOCR 3 exposes recognition as its own pipeline; plate
                # crops are already localized and this avoids a second text
                # detector on every small crop.
                from paddleocr import TextRecognition
                _PADDLE = TextRecognition(model_name=config.PADDLE_RECOGNITION_MODEL)
            else:
                from paddleocr import PaddleOCR
                _PADDLE = PaddleOCR(use_angle_cls=True, lang="en")
        except Exception:
            logger.exception("PaddleOCR is not available")
            _PADDLE = None
    return _PADDLE


def _initialize_fast_plate() -> Any:
    global _FAST_PLATE, _FAST_INITIALIZED
    if _FAST_INITIALIZED:
        return _FAST_PLATE
    with _OCR_LOCK:
        if _FAST_INITIALIZED:
            return _FAST_PLATE
        _FAST_INITIALIZED = True
        try:
            from fast_plate_ocr import LicensePlateRecognizer
            _FAST_PLATE = LicensePlateRecognizer(config.FAST_PLATE_OCR_MODEL)
        except Exception:
            logger.debug("fast-plate-ocr is not installed or failed to initialize", exc_info=True)
            _FAST_PLATE = None
    return _FAST_PLATE


def _clamp_box(box: Tuple[int, int, int, int], width: int, height: int) -> Tuple[int, int, int, int]:
    pad = config.PLATE_CROP_PADDING_PX
    x1, y1, x2, y2 = box
    return max(0, x1 - pad), max(0, y1 - pad), min(width, x2 + pad), min(height, y2 + pad)


def _opencv_candidates(image: np.ndarray) -> List[Tuple[int, int, int, int]]:
    """Find plausible rectangular plate regions in the vehicle crop's lower half."""
    height, width = image.shape[:2]
    y_offset = height // 2
    lower = image[y_offset:, :]
    if lower.size == 0:
        return []
    gray = cv2.cvtColor(lower, cv2.COLOR_BGR2GRAY)
    gray = cv2.GaussianBlur(gray, (5, 5), 0)
    edges = cv2.Canny(gray, 50, 160)
    kernel = cv2.getStructuringElement(cv2.MORPH_RECT, (config.PLATE_CONTOUR_KERNEL_WIDTH, config.PLATE_CONTOUR_KERNEL_HEIGHT))
    edges = cv2.morphologyEx(edges, cv2.MORPH_CLOSE, kernel, iterations=2)
    contours, _ = cv2.findContours(edges, cv2.RETR_LIST, cv2.CHAIN_APPROX_SIMPLE)

    candidates: List[Tuple[float, Tuple[int, int, int, int]]] = []
    lower_area = max(1, lower.shape[0] * lower.shape[1])
    for contour in contours:
        x, y, w, h = cv2.boundingRect(contour)
        area_ratio = (w * h) / lower_area
        ratio = w / max(h, 1)
        # Standard single row and vertically mounted two-row motorcycle plates.
        if not (config.PLATE_CONTOUR_MIN_AREA_RATIO <= area_ratio <= config.PLATE_CONTOUR_MAX_AREA_RATIO and config.PLATE_CONTOUR_MIN_ASPECT <= ratio <= config.PLATE_CONTOUR_MAX_ASPECT):
            continue
        if w + 2 * config.PLATE_CROP_PADDING_PX < config.PLATE_MIN_CROP_WIDTH:
            continue
        # Favor wide, compact candidates low in the vehicle crop, while keeping
        # portrait two-line plates eligible.
        shape_score = 1.0 - min(abs(ratio - 3.0) / 4.5, 0.8)
        size_score = min(area_ratio / 0.12, 1.0)
        lower_position_score = 0.45 + 0.55 * (y / max(lower.shape[0], 1))
        score = 0.5 * shape_score + 0.3 * size_score + 0.2 * lower_position_score
        candidates.append((score, (x, y + y_offset, x + w, y + h + y_offset)))

    # Bright/reflective plates can be merged with bumper edges by Canny. Add
    # their own contour proposals so the OCR also sees a tighter plate crop.
    bright_offset = int(height * 0.35)
    bright_region = image[bright_offset:, :]
    bright_gray = cv2.cvtColor(bright_region, cv2.COLOR_BGR2GRAY)
    _, bright_mask = cv2.threshold(bright_gray, 170, 255, cv2.THRESH_BINARY)
    bright_contours, _ = cv2.findContours(bright_mask, cv2.RETR_EXTERNAL, cv2.CHAIN_APPROX_SIMPLE)
    for contour in bright_contours:
        x, y, box_width, box_height = cv2.boundingRect(contour)
        if box_height < 12 or box_width < 28:
            continue
        aspect = box_width / max(box_height, 1)
        area = box_width * box_height
        area_ratio = area / max(height * width, 1)
        if not (1.1 <= aspect <= 5.8 and 300 <= area <= 22000 and area_ratio <= 0.25):
            continue
        candidate_gray = bright_gray[y:y + box_height, x:x + box_width]
        contrast = min(float(candidate_gray.std()) / 45.0, 1.0) if candidate_gray.size else 0.0
        aspect_score = 1.0 - min(min(abs(aspect - 3.8) / 3.8, abs(aspect - 1.5) / 1.5), 1.0)
        box = (x, y + bright_offset, x + box_width, y + bright_offset + box_height)
        candidates.append((0.90 + 0.08 * (aspect_score * 0.5 + contrast * 0.5), box))

    # Sobel and horizontal closing make a stronger whole-plate proposal when a
    # reflective plate is visually joined to nearby bodywork.
    morph_offset = int(height * 0.35)
    morph_region = image[morph_offset:, :]
    morph_gray = cv2.cvtColor(morph_region, cv2.COLOR_BGR2GRAY)
    morph_blur = cv2.GaussianBlur(morph_gray, (5, 5), 0)
    grad_x = cv2.convertScaleAbs(cv2.Sobel(morph_blur, cv2.CV_16S, 1, 0, ksize=3))
    morph_kernel = cv2.getStructuringElement(cv2.MORPH_RECT, (config.PLATE_MORPH_KERNEL_WIDTH, config.PLATE_MORPH_KERNEL_HEIGHT))
    closed = cv2.morphologyEx(grad_x, cv2.MORPH_CLOSE, morph_kernel)
    _, morph_mask = cv2.threshold(closed, 0, 255, cv2.THRESH_BINARY + cv2.THRESH_OTSU)
    morph_contours, _ = cv2.findContours(morph_mask, cv2.RETR_EXTERNAL, cv2.CHAIN_APPROX_SIMPLE)
    for contour in morph_contours:
        x, y, box_width, box_height = cv2.boundingRect(contour)
        area = box_width * box_height
        aspect = box_width / max(box_height, 1)
        area_ratio = area / max(height * width, 1)
        if not (
            config.PLATE_MORPH_MIN_ASPECT <= aspect <= config.PLATE_MORPH_MAX_ASPECT
            and config.PLATE_MORPH_MIN_AREA_PX <= area <= config.PLATE_MORPH_MAX_AREA_PX
            and config.PLATE_MORPH_MIN_AREA_RATIO <= area_ratio <= config.PLATE_MORPH_MAX_AREA_RATIO
        ):
            continue
        local = morph_gray[y:y + box_height, x:x + box_width]
        contrast = min(float(local.std()) / 45.0, 1.0) if local.size else 0.0
        aspect_score = 1.0 - min(min(abs(aspect - 3.5) / 3.5, abs(aspect - 1.4) / 1.4), 1.0)
        box = (x, y + morph_offset, x + box_width, y + morph_offset + box_height)
        candidates.append((1.10 + 0.10 * (aspect_score * 0.5 + contrast * 0.5), box))

    # The compact plate border can touch a bumper or tail-light, making the
    # edge contour too large or splitting the actual plate into two pieces.
    # Add a small set of vehicle-relative lower-center windows as fallbacks;
    # OCR selects the plate-looking crop from these alongside contour proposals.
    for width_fraction in config.PLATE_ROI_WIDTH_FRACTIONS:
        roi_width = min(width - 2 * config.PLATE_CROP_PADDING_PX, max(config.PLATE_MIN_CROP_WIDTH - 2 * config.PLATE_CROP_PADDING_PX, int(width * width_fraction)))
        roi_height = max(20, int(roi_width / max(config.PLATE_ROI_ASPECT_RATIO, 1.0)))
        center_x = width // 2
        for center_y_fraction in config.PLATE_ROI_CENTER_Y_FRACTIONS:
            center_y = int(height * center_y_fraction)
            x1 = max(0, center_x - roi_width // 2)
            x2 = min(width, x1 + roi_width)
            y1 = max(0, min(height - 1, center_y - roi_height // 2))
            y2 = min(height, y1 + roi_height)
            roi = image[y1:y2, x1:x2]
            if roi.size == 0 or roi.shape[1] + 2 * config.PLATE_CROP_PADDING_PX < config.PLATE_MIN_CROP_WIDTH:
                continue
            roi_gray = cv2.cvtColor(roi, cv2.COLOR_BGR2GRAY)
            edge_density = float(cv2.Canny(roi_gray, 50, 150).mean()) / 255.0
            candidates.append((1.30 + min(edge_density, 0.12), (x1, y1, x2, y2)))

    candidates.sort(key=lambda item: item[0], reverse=True)
    boxes: List[Tuple[int, int, int, int]] = []
    for _, box in candidates:
        if any(_box_iou(box, old) > config.PLATE_CANDIDATE_IOU_MAX for old in boxes):
            continue
        boxes.append(_clamp_box(box, width, height))
        if len(boxes) >= config.PLATE_MAX_CANDIDATES:
            break
    return boxes


def _box_iou(a: Tuple[int, int, int, int], b: Tuple[int, int, int, int]) -> float:
    ix1, iy1 = max(a[0], b[0]), max(a[1], b[1])
    ix2, iy2 = min(a[2], b[2]), min(a[3], b[3])
    inter = max(0, ix2 - ix1) * max(0, iy2 - iy1)
    area_a = max(1, a[2] - a[0]) * max(1, a[3] - a[1])
    area_b = max(1, b[2] - b[0]) * max(1, b[3] - b[1])
    return inter / max(area_a + area_b - inter, 1)


def _detect_candidates(image: np.ndarray) -> List[Tuple[int, int, int, int]]:
    model = _initialize_yolo()
    if model is not None:
        try:
            result = model.predict(image, conf=config.YOLO_PLATE_CONFIDENCE, verbose=False, device="cpu")[0]
            names = getattr(result, "names", {}) or getattr(model, "names", {}) or {}
            boxes_obj = getattr(result, "boxes", None)
            found = []
            if boxes_obj is not None:
                for box, cls_id in zip(boxes_obj.xyxy.cpu().numpy(), boxes_obj.cls.cpu().numpy().astype(int)):
                    class_name = str(names.get(int(cls_id), "license_plate")).lower()
                    if "plate" not in class_name and len(names) > 1:
                        continue
                    found.append(_clamp_box(tuple(int(value) for value in box), image.shape[1], image.shape[0]))
            if found:
                return found[:config.PLATE_MAX_CANDIDATES]
        except Exception:
            logger.exception("Separate plate model inference failed; using OpenCV fallback")
    return _opencv_candidates(image)


def _perspective_crop(crop: np.ndarray) -> np.ndarray:
    """Rectify a clear four-corner plate border when OpenCV can find one."""
    if crop.size == 0:
        return crop
    gray = cv2.cvtColor(crop, cv2.COLOR_BGR2GRAY)
    edges = cv2.Canny(cv2.GaussianBlur(gray, (3, 3), 0), 40, 140)
    contours, _ = cv2.findContours(edges, cv2.RETR_LIST, cv2.CHAIN_APPROX_SIMPLE)
    for contour in sorted(contours, key=cv2.contourArea, reverse=True)[:12]:
        perimeter = cv2.arcLength(contour, True)
        polygon = cv2.approxPolyDP(contour, 0.035 * perimeter, True)
        if len(polygon) != 4 or cv2.contourArea(polygon) < 0.25 * crop.shape[0] * crop.shape[1]:
            continue
        points = polygon.reshape(4, 2).astype(np.float32)
        ordered = np.zeros((4, 2), dtype=np.float32)
        sums, diffs = points.sum(axis=1), np.diff(points, axis=1).reshape(-1)
        ordered[0], ordered[2] = points[np.argmin(sums)], points[np.argmax(sums)]
        ordered[1], ordered[3] = points[np.argmin(diffs)], points[np.argmax(diffs)]
        width = int(max(np.linalg.norm(ordered[1] - ordered[0]), np.linalg.norm(ordered[2] - ordered[3])))
        height = int(max(np.linalg.norm(ordered[3] - ordered[0]), np.linalg.norm(ordered[2] - ordered[1])))
        if width < config.PLATE_MIN_CROP_WIDTH or height < 12:
            continue
        target = np.array([[0, 0], [width - 1, 0], [width - 1, height - 1], [0, height - 1]], dtype=np.float32)
        return cv2.warpPerspective(crop, cv2.getPerspectiveTransform(ordered, target), (width, height))
    return crop


def _preprocess_variants(crop: np.ndarray) -> List[Tuple[str, np.ndarray]]:
    enlarged = cv2.resize(crop, None, fx=config.PLATE_UPSCALE_FACTOR, fy=config.PLATE_UPSCALE_FACTOR, interpolation=cv2.INTER_CUBIC)
    rectified = _perspective_crop(enlarged)
    gray = cv2.cvtColor(rectified, cv2.COLOR_BGR2GRAY) if rectified.ndim == 3 else rectified
    clahe = cv2.createCLAHE(clipLimit=2.0, tileGridSize=(8, 8)).apply(gray)
    smooth = cv2.bilateralFilter(clahe, 7, 45, 45)
    _, otsu = cv2.threshold(smooth, 0, 255, cv2.THRESH_BINARY + cv2.THRESH_OTSU)
    variants = [
        ("normal", smooth),
        ("inverted", cv2.bitwise_not(smooth)),
        ("otsu", otsu),
        ("inverted_otsu", cv2.bitwise_not(otsu)),
    ]
    if smooth.shape[1] / max(smooth.shape[0], 1) < 2.5 and smooth.shape[0] >= 32:
        middle = smooth.shape[0] // 2
        top, bottom = smooth[:middle], smooth[middle:]
        inv_top, inv_bottom = cv2.bitwise_not(top), cv2.bitwise_not(bottom)
        # OCR each row, then join: this is more reliable than treating the
        # portrait-oriented motorcycle plate as one long text line.
        variants.extend([("two_line_split", np.vstack([top, bottom])), ("two_line_split_inverted", np.vstack([inv_top, inv_bottom]))])
    return variants


def _paddle_parse(result: Any) -> List[Tuple[str, float]]:
    parsed: List[Tuple[str, float]] = []
    if result is None:
        return parsed
    if isinstance(result, dict):
        if "rec_text" in result:
            return [(str(result.get("rec_text") or ""), float(result.get("rec_score") or 0.0))]
        texts = result.get("rec_texts") or result.get("texts") or []
        scores = result.get("rec_scores") or result.get("scores") or []
        return [(str(text), float(scores[index]) if index < len(scores) else 0.0) for index, text in enumerate(texts)]
    if hasattr(result, "rec_texts"):
        texts = getattr(result, "rec_texts", []) or []
        scores = getattr(result, "rec_scores", []) or []
        return [(str(text), float(scores[index]) if index < len(scores) else 0.0) for index, text in enumerate(texts)]
    if hasattr(result, "json"):
        try:
            json_result = result.json
            if isinstance(json_result, str):
                import json
                json_result = json.loads(json_result)
            return _paddle_parse(json_result)
        except Exception:
            pass
    if isinstance(result, (list, tuple)):
        # PaddleOCR 2.x commonly nests line results inside image results.
        for item in result:
            if isinstance(item, (list, tuple)) and len(item) >= 2:
                if isinstance(item[1], (list, tuple)) and item[1] and isinstance(item[1][0], (str, bytes)):
                    parsed.append((str(item[1][0]), float(item[1][1]) if len(item[1]) > 1 else 0.0))
                else:
                    parsed.extend(_paddle_parse(item))
            elif isinstance(item, dict) or hasattr(item, "rec_texts"):
                parsed.extend(_paddle_parse(item))
    return parsed


def _run_paddle_text_recognition(image: np.ndarray) -> Tuple[str, float]:
    """Recognition-only PaddleOCR fallback for plate crops and PaddleOCR 3.x."""
    global _PADDLE_TEXT_RECOGNITION, _PADDLE_TEXT_INITIALIZED
    if not _PADDLE_TEXT_INITIALIZED:
        with _OCR_LOCK:
            if not _PADDLE_TEXT_INITIALIZED:
                _PADDLE_TEXT_INITIALIZED = True
                try:
                    from paddleocr import TextRecognition
                    _PADDLE_TEXT_RECOGNITION = TextRecognition(model_name=config.PADDLE_RECOGNITION_MODEL)
                except Exception:
                    logger.exception("PaddleOCR text-recognition model is unavailable")
                    _PADDLE_TEXT_RECOGNITION = None
    if _PADDLE_TEXT_RECOGNITION is None:
        return "", 0.0
    try:
        source = cv2.cvtColor(image, cv2.COLOR_GRAY2BGR) if image.ndim == 2 else image
        with _OCR_LOCK:
            output = list(_PADDLE_TEXT_RECOGNITION.predict(source))
        if not output:
            return "", 0.0
        first = output[0]
        if hasattr(first, "json"):
            first = first.json
        if isinstance(first, dict):
            if isinstance(first.get("res"), dict):
                first = first["res"]
            return str(first.get("rec_text") or ""), float(first.get("rec_score") or 0.0)
        parsed = _paddle_parse(first)
        return parsed[0] if parsed else ("", 0.0)
    except Exception:
        logger.debug("PaddleOCR recognition-only inference failed", exc_info=True)
        return "", 0.0


def _run_paddle(image: np.ndarray) -> Tuple[str, float]:
    engine = _initialize_paddle()
    if engine is None:
        return _run_paddle_text_recognition(image)
    source = cv2.cvtColor(image, cv2.COLOR_GRAY2BGR) if image.ndim == 2 else image
    try:
        with _OCR_LOCK:
            if hasattr(engine, "ocr"):
                try:
                    raw = engine.ocr(source, cls=True)
                except TypeError:
                    raw = engine.ocr(source)
            else:
                raw = engine.predict(source)
        lines = _paddle_parse(raw)
        if not lines:
            return _run_paddle_text_recognition(image)
        # Two-line plate recognitions arrive as two line objects. Preserve their
        # order; punctuation and whitespace are removed by the common cleaner.
        return "".join(text for text, _ in lines), float(np.mean([score for _, score in lines]))
    except Exception:
        logger.debug("PaddleOCR call failed", exc_info=True)
        return _run_paddle_text_recognition(image)


def _run_fast_plate(image: np.ndarray) -> Tuple[str, float]:
    engine = _initialize_fast_plate()
    if engine is None:
        return "", 0.0
    try:
        with _OCR_LOCK:
            output = engine.run(cv2.cvtColor(image, cv2.COLOR_GRAY2RGB), return_confidence=True)
        if isinstance(output, (list, tuple)) and output:
            output = output[0]
        text = getattr(output, "plate", None) or getattr(output, "text", None)
        confidence = getattr(output, "confidence", None)
        char_probs = getattr(output, "char_probs", None)
        if isinstance(output, dict):
            text = text or output.get("plate") or output.get("text")
            confidence = confidence if confidence is not None else output.get("confidence")
            char_probs = char_probs if char_probs is not None else output.get("char_probs")
        if confidence is None and char_probs is not None:
            confidence = float(np.mean(np.asarray(char_probs, dtype=np.float32)))
        return str(text or ""), float(confidence or 0.0)
    except Exception:
        logger.debug("fast-plate-ocr call failed", exc_info=True)
        return "", 0.0


def _log_result(track_id: Any, raw: str, cleaned: str, confidence: float, variant: str) -> None:
    try:
        config.PLATE_LOG_PATH.parent.mkdir(parents=True, exist_ok=True)
        exists = config.PLATE_LOG_PATH.exists()
        with config.PLATE_LOG_PATH.open("a", newline="", encoding="utf-8") as stream:
            writer = csv.writer(stream)
            if not exists:
                writer.writerow(["timestamp", "track_id", "raw_text", "cleaned_text", "confidence", "variant"])
            writer.writerow([datetime.now().isoformat(timespec="milliseconds"), track_id or "", raw, cleaned, f"{confidence:.4f}", variant])
    except OSError:
        logger.debug("Could not append plate OCR CSV log", exc_info=True)


def _expand_evidence_box(image: np.ndarray, box: Tuple[int, int, int, int]) -> np.ndarray:
    """Keep the complete horizontal plate visible when a contour is tight."""
    height, width = image.shape[:2]
    x1, y1, x2, y2 = box
    box_width, box_height = x2 - x1, y2 - y1
    if box_height <= 0 or box_width / box_height < 1.5:
        return image[y1:y2, x1:x2]
    target_width = min(width, max(box_width, int(np.ceil(box_height * config.PLATE_EVIDENCE_MIN_ASPECT))))
    extra = max(0, target_width - box_width)
    left = min(x1, extra // 2)
    right = min(width - x2, extra - left)
    left += min(x1 - left, extra - left - right)
    return image[y1:y2, x1 - left:x2 + right]


def _find_context_plate_box(image: np.ndarray) -> Optional[Tuple[int, int, int, int]]:
    """Find the complete lower plate rectangle for evidence, independent of OCR."""
    height, width = image.shape[:2]
    window_width = min(width, max(config.PLATE_MIN_CROP_WIDTH, int(width * config.PLATE_CONTEXT_ROI_WIDTH_FRACTION)))
    window_height = max(20, int(window_width / max(config.PLATE_CONTEXT_ROI_ASPECT_RATIO, 1.0)))
    center_y = int(height * config.PLATE_CONTEXT_CENTER_Y_FRACTION)
    proposals: List[Tuple[float, Tuple[int, int, int, int]]] = []

    for center_x_fraction in config.PLATE_CONTEXT_CENTER_X_FRACTIONS:
        center_x = int(width * center_x_fraction)
        rx1 = max(0, min(width - window_width, center_x - window_width // 2))
        rx2 = rx1 + window_width
        ry1 = max(0, min(height - window_height, center_y - window_height // 2))
        ry2 = ry1 + window_height
        region = image[ry1:ry2, rx1:rx2]
        if region.size == 0:
            continue

        gray = cv2.cvtColor(region, cv2.COLOR_BGR2GRAY)
        edges = cv2.Canny(cv2.GaussianBlur(gray, (3, 3), 0), 30, 120)
        contours, _ = cv2.findContours(edges, cv2.RETR_LIST, cv2.CHAIN_APPROX_SIMPLE)
        for contour in contours:
            bx, by, box_width, box_height = cv2.boundingRect(contour)
            aspect = box_width / max(box_height, 1)
            box_area = box_width * box_height
            contour_area = cv2.contourArea(contour)
            center_y_fraction = (ry1 + by + box_height / 2) / max(height, 1)
            if not (
                box_width >= max(config.PLATE_MIN_CROP_WIDTH, int(region.shape[1] * 0.18))
                and box_height >= 16
                and 2.0 <= aspect <= 6.5
                and 0.01 <= box_area / max(region.shape[0] * region.shape[1], 1) <= 0.65
                and contour_area >= max(100.0, box_area * 0.02)
                and center_y_fraction >= 0.70
            ):
                continue
            local_edges = edges[by:by + box_height, bx:bx + box_width]
            edge_density = float(local_edges.mean()) / 255.0 if local_edges.size else 0.0
            fill = contour_area / max(box_area, 1)
            ratio_score = 1.0 - min(abs(aspect - 4.0) / 4.0, 1.0)
            score = 1.65 + 0.35 * center_y_fraction + 0.15 * fill + 0.05 * ratio_score + 0.05 * edge_density
            proposals.append((score, (rx1 + bx, ry1 + by, rx1 + bx + box_width, ry1 + by + box_height)))

    if not proposals:
        return None
    proposals.sort(key=lambda item: item[0], reverse=True)
    return _clamp_box(proposals[0][1], width, height)


def recognize_plate(vehicle_crop: np.ndarray, track_id: Any = None, evidence_crop: Optional[np.ndarray] = None) -> Dict[str, Any]:
    """Recognize a localized plate and retain its crop in memory for track voting."""
    try:
        if vehicle_crop is None or not isinstance(vehicle_crop, np.ndarray) or vehicle_crop.size == 0:
            return _empty_result()
        if vehicle_crop.ndim == 2:
            image = cv2.cvtColor(vehicle_crop, cv2.COLOR_GRAY2BGR)
        elif vehicle_crop.shape[2] == 4:
            image = cv2.cvtColor(vehicle_crop, cv2.COLOR_BGRA2BGR)
        else:
            image = vehicle_crop
        evidence_image = image
        if isinstance(evidence_crop, np.ndarray) and evidence_crop.size > 0:
            if evidence_crop.ndim == 2:
                evidence_image = cv2.cvtColor(evidence_crop, cv2.COLOR_GRAY2BGR)
            elif evidence_crop.shape[2] == 4:
                evidence_image = cv2.cvtColor(evidence_crop, cv2.COLOR_BGRA2BGR)
            else:
                evidence_image = evidence_crop
        context_box = _find_context_plate_box(evidence_image)
        context_evidence = _expand_evidence_box(evidence_image, context_box) if context_box else None
        context_sharpness = 0.0
        if context_evidence is not None and context_evidence.size:
            context_sharpness = float(cv2.Laplacian(cv2.cvtColor(context_evidence, cv2.COLOR_BGR2GRAY), cv2.CV_64F).var())
        boxes = _detect_candidates(image)
        if not boxes:
            if context_evidence is not None and context_evidence.size:
                return {
                    **_empty_result(), "_plate_crop": context_evidence, "_plate_bbox": list(context_box),
                    "_sharpness": context_sharpness,
                }
            return _empty_result()

        observations: List[Dict[str, Any]] = []
        best_fallback: Optional[Dict[str, Any]] = None
        for box in boxes[:config.PLATE_MAX_CANDIDATES]:
            # YOLO and OpenCV candidates already include the configured padding.
            x1, y1, x2, y2 = tuple(int(value) for value in box)
            x1, y1 = max(0, x1), max(0, y1)
            x2, y2 = min(image.shape[1], x2), min(image.shape[0], y2)
            crop = image[y1:y2, x1:x2]
            if crop.size == 0:
                continue
            pad = config.PLATE_CROP_PADDING_PX
            ocr_crop = crop
            if crop.shape[0] > 2 * pad and crop.shape[1] > 2 * pad:
                # Detection boxes already include the configured padding. Keep
                # that padded version as evidence, but OCR the original tight
                # rectangle so bumper/road pixels do not swamp plate characters.
                ocr_crop = crop[pad:-pad, pad:-pad]
            if ocr_crop.shape[1] < config.PLATE_MIN_CROP_WIDTH:
                continue
            sharpness = float(cv2.Laplacian(cv2.cvtColor(ocr_crop, cv2.COLOR_BGR2GRAY), cv2.CV_64F).var())
            evidence_crop_candidate = (
                context_evidence if context_evidence is not None and context_evidence.size
                else _expand_evidence_box(image, (x1, y1, x2, y2))
            )
            evidence_sharpness = context_sharpness if context_evidence is not None else sharpness
            if best_fallback is None or evidence_sharpness > best_fallback["_sharpness"]:
                best_fallback = {
                    **_empty_result(), "_plate_crop": evidence_crop_candidate, "_sharpness": evidence_sharpness,
                    "_plate_bbox": [x1, y1, x2, y2],
                }
            for variant_name, variant in _preprocess_variants(ocr_crop):
                if variant_name.startswith("two_line_split"):
                    middle = variant.shape[0] // 2
                    row_results = []
                    for row in (variant[:middle], variant[middle:]):
                        row_text, row_conf = _run_paddle(row)
                        row_valid = _validate(_correct_positionally(row_text))
                        row_fast_text, row_fast_conf = _run_fast_plate(row) if row_conf < config.PLATE_MIN_VALID_CONFIDENCE or not row_valid else ("", 0.0)
                        row_results.append((row_fast_text, row_fast_conf) if row_fast_conf > row_conf else (row_text, row_conf))
                    raw = "".join(text for text, _ in row_results)
                    confidence = float(np.mean([score for _, score in row_results])) if row_results else 0.0
                else:
                    paddle_text, paddle_conf = _run_paddle(variant)
                    paddle_valid = _validate(_correct_positionally(paddle_text))
                    fast_text, fast_conf = _run_fast_plate(variant) if paddle_conf < config.PLATE_MIN_VALID_CONFIDENCE or not paddle_valid else ("", 0.0)
                    raw, confidence = (fast_text, fast_conf) if fast_conf > paddle_conf else (paddle_text, paddle_conf)
                cleaned = _correct_positionally(raw)
                _log_result(track_id, raw, cleaned, confidence, variant_name)
                if not cleaned:
                    continue
                valid = _validate(cleaned)
                if valid:
                    raw_cleaned = _clean_text(raw)
                    if cleaned != raw_cleaned:
                        status = "pending_verification"
                    else:
                        status = "ok" if confidence >= config.PLATE_MIN_VALID_CONFIDENCE else "low_confidence"
                    plate_text = cleaned
                else:
                    status = "invalid_format"
                    plate_text = cleaned
                # Valid text/confidence dominates; for equivalent text prefer
                # the sharper crop so evidence quality is retained.
                rank = (int(valid), confidence, np.log1p(max(sharpness, 0.0)))
                observations.append({
                    "plate_text": plate_text,
                    "confidence": float(min(max(confidence, 0.0), 1.0)),
                    "status": status,
                    "plate_crop_path": None,
                    "_plate_crop": evidence_crop_candidate,
                    "raw_text": raw,
                    "_sharpness": evidence_sharpness,
                    "_variant": variant_name,
                    "_plate_bbox": [x1, y1, x2, y2],
                    "_rank": rank,
                })

        if not observations:
            return best_fallback or _empty_result()
        observations.sort(key=lambda item: item["_rank"], reverse=True)
        best = observations[0]
        best.pop("_rank", None)
        return best
    except Exception:
        logger.exception("Plate recognition failed for track %s", track_id)
        return _empty_result()


class PlateVoter:
    """Bounded temporal plate voting keyed by the existing vehicle track ID."""

    def __init__(self, window: int = config.PLATE_VOTE_WINDOW, stride: int = config.PLATE_FRAME_STRIDE, lock_count: int = config.PLATE_VOTE_LOCK_COUNT):
        self.window = max(3, min(10, int(window)))
        self.stride = max(1, int(stride))
        self.lock_count = max(3, int(lock_count))
        self._results: Dict[Any, deque] = defaultdict(lambda: deque(maxlen=self.window))
        self._frame_counts: Counter = Counter()
        self._locked: Dict[Any, Dict[str, Any]] = {}
        self._lock = threading.Lock()

    def should_process(self, track_id: Any) -> bool:
        """Return true on the first and every Nth frame until three votes win."""
        with self._lock:
            if track_id in self._locked:
                return False
            self._frame_counts[track_id] += 1
            return (self._frame_counts[track_id] - 1) % self.stride == 0

    def add(self, track_id: Any, result: Dict[str, Any]) -> Optional[Dict[str, Any]]:
        if track_id is None or not isinstance(result, dict):
            return None
        with self._lock:
            if track_id in self._locked:
                return dict(self._locked[track_id])
            self._results[track_id].append(dict(result))
            final = self._select(track_id)
            if final and final.get("_confirmed"):
                self._locked[track_id] = dict(final)
            return final

    def _select(self, track_id: Any) -> Optional[Dict[str, Any]]:
        rows = list(self._results.get(track_id, ()))
        if not rows:
            return None
        text_rows = [row for row in rows if row.get("plate_text")]
        if not text_rows:
            final = dict(max(rows, key=lambda row: float(row.get("_sharpness", 0.0))))
            final["_confirmed"] = False
            return final

        qualified_rows = [
            row for row in text_rows
            if row.get("status") == "ok"
            and float(row.get("confidence", 0.0)) >= config.PLATE_MIN_VALID_CONFIDENCE
            and row.get("_plate_bbox") is not None
            and _validate(_clean_text(row.get("plate_text")))
        ]
        vote_rows = qualified_rows or text_rows
        counts = Counter(row.get("plate_text") for row in vote_rows)
        winning_text = max(
            counts,
            key=lambda text: (
                counts[text],
                max(float(row.get("confidence", 0.0)) for row in vote_rows if row.get("plate_text") == text),
            ),
        )
        winning_rows = [row for row in vote_rows if row.get("plate_text") == winning_text]
        best_read = max(winning_rows, key=lambda row: (float(row.get("confidence", 0.0)), float(row.get("_sharpness", 0.0))))
        sharpest = max(winning_rows, key=lambda row: float(row.get("_sharpness", 0.0)))
        final = dict(best_read)
        final["plate_crop_path"] = None
        final["_plate_crop"] = sharpest.get("_plate_crop")
        final["_frame_token"] = sharpest.get("_frame_token")
        final["_sharpness"] = float(sharpest.get("_sharpness", 0.0))
        winner_count = sum(1 for row in qualified_rows if row.get("plate_text") == winning_text)
        confirmed = bool(
            qualified_rows
            and winner_count >= self.lock_count
            and final.get("status") == "ok"
            and float(final.get("confidence", 0.0)) >= config.PLATE_MIN_VALID_CONFIDENCE
        )
        if not confirmed and final.get("status") == "ok":
            final["status"] = "pending_verification"
        final["_confirmed"] = confirmed
        return final

    def get_final(self, track_id: Any) -> Optional[Dict[str, Any]]:
        with self._lock:
            result = self._locked.get(track_id) or self._select(track_id)
            return dict(result) if result else None

    def remove(self, track_id: Any) -> None:
        """Release voter state when the existing vehicle tracker prunes a track."""
        with self._lock:
            self._results.pop(track_id, None)
            self._frame_counts.pop(track_id, None)
            self._locked.pop(track_id, None)


__all__ = ["recognize_plate", "PlateVoter"]
