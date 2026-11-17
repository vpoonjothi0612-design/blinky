"""Vehicle Image Recognition Service.

Step 5 — Image Upload based Vehicle Recognition Workflow:
Uploaded Image
      ↓
Safety / Format Validation
      ↓
YOLO11n Vehicle Detection
      ↓
Vehicle Type & Confidence
      ↓
Vehicle Crop
      ↓
Number Plate Detection Boundary
      ↓
Number Plate OCR Boundary
      ↓
Validation / Normalization
      ↓
Timestamp & Performance Telemetry
      ↓
Annotated Output Image Generation
      ↓
Structured JSON Result
"""

from __future__ import annotations

import os
import re
import sys
import time
from dataclasses import dataclass, field
from datetime import datetime
from pathlib import Path
from typing import Dict, List, Optional, Tuple, Union, Any

import cv2
import numpy as np

# Ensure project paths are discoverable
_SERVICE_DIR = Path(__file__).resolve().parent
_VEHICLE_DIR = _SERVICE_DIR.parent
_SRC_DIR = _VEHICLE_DIR.parent
if str(_SRC_DIR) not in sys.path:
    sys.path.append(str(_SRC_DIR))

from vehicle.vehicle_config import (
    DEFAULT_YOLO_MODEL_PATH,
    DEFAULT_CONF_THRESHOLD,
    DEFAULT_DEVICE,
    VEHICLE_OUTPUT_DIR,
    ALLOWED_IMAGE_EXTENSIONS,
    MAX_IMAGE_UPLOAD_BYTES,
    MAX_IMAGE_DIMENSION,
    TIMESTAMP_FORMAT,
)
from vehicle.detection.vehicle_classes import TARGET_VEHICLE_NAMES
from vehicle.detection.yolo_detector import YOLOVehicleDetector, CLASS_COLORS, DEFAULT_COLOR
from vehicle.plate.plate_recognizer import (
    NumberPlatePipeline,
    PlateDetectionResult,
    BasePlateDetector,
    BaseOCREngine,
    NullPlateOCR,
    PLATE_OCR_UNAVAILABLE_MESSAGE,
)


@dataclass
class VehicleRecognitionItem:
    """Individual recognized vehicle telemetry item."""

    vehicle_detected: bool
    vehicle_class: str
    confidence: float
    bbox: List[int]  # [x1, y1, x2, y2]
    number_plate_detected: bool
    number_plate: Optional[str]
    plate_confidence: Optional[float]
    plate_bbox: Optional[List[int]] = None  # [px1, py1, px2, py2] in full frame coordinates
    ocr_status: str = "PLATE_NOT_RECOGNIZED"
    raw_ocr_text: Optional[str] = None
    is_valid_format: bool = False
    make: Optional[str] = None
    model: Optional[str] = None

    def to_dict(self) -> Dict[str, Any]:
        """Formats item matching the exact Step 5 and Step 6 specification."""
        return {
            "class": self.vehicle_class,
            "confidence": round(float(self.confidence), 4),
            "numberPlate": self.number_plate,
            "plateConfidence": round(float(self.plate_confidence), 4) if self.plate_confidence is not None else None,
            "make": self.make,
            "model": self.model,
            "numberPlateDetected": self.number_plate_detected,
            "ocrStatus": self.ocr_status,
            "rawOcrText": self.raw_ocr_text,
            "isValidFormat": self.is_valid_format,
            "bbox": self.bbox,
            "plateBbox": self.plate_bbox,
        }



@dataclass
class PerformanceBreakdown:
    """Diagnostic timing breakdown across pipeline stages."""

    image_loading_ms: float = 0.0
    yolo_inference_ms: float = 0.0
    plate_detection_ms: float = 0.0
    ocr_reading_ms: float = 0.0
    total_processing_ms: float = 0.0

    def to_dict(self) -> Dict[str, float]:
        return {
            "imageLoadingMs": round(self.image_loading_ms, 2),
            "yoloMs": round(self.yolo_inference_ms, 2),
            "plateMs": round(self.plate_detection_ms, 2),
            "ocrMs": round(self.ocr_reading_ms, 2),
            "totalMs": round(self.total_processing_ms, 2),
        }

    def print_summary(self) -> None:
        """Prints the standardized performance telemetry summary."""
        print("\nImage Processing")
        print("----------------")
        print(f"YOLO          : {self.yolo_inference_ms:6.1f} ms")
        print(f"Plate         : {self.plate_detection_ms:6.1f} ms")
        print(f"OCR           : {self.ocr_reading_ms:6.1f} ms")
        print(f"Total         : {self.total_processing_ms:6.1f} ms\n")


def sanitize_filename(filename: str) -> str:
    """Strips directory traversal, illegal chars, and limits length."""
    base = Path(filename).name
    cleaned = re.sub(r"[^\w\.\-]", "_", base)
    return cleaned[:100] if len(cleaned) > 100 else cleaned


class VehicleImageRecognitionService:
    """Production headless service for vehicle detection and plate recognition from uploaded images."""

    def __init__(
        self,
        yolo_detector: Optional[YOLOVehicleDetector] = None,
        plate_pipeline: Optional[NumberPlatePipeline] = None,
        plate_detector: Optional[BasePlateDetector] = None,
        ocr_engine: Optional[BaseOCREngine] = None,
        output_dir: Optional[Union[str, Path]] = None,
        conf_threshold: float = DEFAULT_CONF_THRESHOLD,
    ) -> None:
        """Initializes the vehicle image recognition service.

        Loads YOLO11n weights once and configures plate recognition boundaries.
        """
        self.conf_threshold = conf_threshold
        self.output_dir = Path(output_dir) if output_dir else VEHICLE_OUTPUT_DIR
        self.output_dir.mkdir(parents=True, exist_ok=True)

        # 1. Initialize YOLO11n Detector once
        self.detector = yolo_detector or YOLOVehicleDetector(
            model_path=DEFAULT_YOLO_MODEL_PATH,
            conf_threshold=self.conf_threshold,
            device=DEFAULT_DEVICE,
        )

        # 2. Initialize Plate Pipeline Boundary (Defaults to PaddleOCREngine)
        if plate_pipeline is not None:
            self.plate_pipeline = plate_pipeline
        else:
            self.plate_pipeline = NumberPlatePipeline(
                detector=plate_detector,
                ocr_engine=ocr_engine,
            )


    def process_image(
        self,
        image_input: Union[str, Path, bytes, np.ndarray],
        filename: Optional[str] = None,
        conf_threshold: Optional[float] = None,
        save_annotated: bool = True,
        print_telemetry: bool = True,
    ) -> Dict[str, Any]:
        """Processes an uploaded vehicle image and returns structured recognition telemetry.

        Args:
            image_input: File path, raw bytes, or numpy BGR frame.
            filename: Original filename (used for extension checking and output naming).
            conf_threshold: Detection confidence threshold override.
            save_annotated: Whether to generate and save the annotated output image.
            print_telemetry: Whether to print performance summary to console.

        Returns:
            Dictionary matching the Step 5 JSON specification.
        """
        t_start = time.perf_counter()
        perf = PerformanceBreakdown()

        # 1. Server-side timestamp (System time formatted as YYYY-MM-DD HH:mm:ss)
        current_time_dt = datetime.now()
        timestamp_str = current_time_dt.strftime(TIMESTAMP_FORMAT)

        # Determine reference name for validation & logging
        ref_name = "upload.jpg"
        if isinstance(image_input, (str, Path)):
            ref_name = Path(image_input).name
        elif filename:
            ref_name = filename
        clean_ref_name = sanitize_filename(ref_name)

        # 2. Security & Format Validation
        ext = Path(clean_ref_name).suffix.lower()
        if not ext:
            ext = ".jpg"

        if ext not in ALLOWED_IMAGE_EXTENSIONS:
            total_ms = (time.perf_counter() - t_start) * 1000.0
            perf.total_processing_ms = total_ms
            return {
                "success": False,
                "timestamp": timestamp_str,
                "processingTimeMs": round(total_ms, 2),
                "vehicles": [],
                "annotatedImage": None,
                "status": "INVALID_IMAGE_FORMAT",
                "error": f"Unsupported image format '{ext}'. Allowed formats: {', '.join(sorted(ALLOWED_IMAGE_EXTENSIONS))}",
            }

        # 3. Load & Decode Image Safely
        t_load_start = time.perf_counter()
        frame, decode_error = self._load_frame(image_input)
        perf.image_loading_ms = (time.perf_counter() - t_load_start) * 1000.0

        if frame is None or decode_error:
            total_ms = (time.perf_counter() - t_start) * 1000.0
            perf.total_processing_ms = total_ms
            return {
                "success": False,
                "timestamp": timestamp_str,
                "processingTimeMs": round(total_ms, 2),
                "vehicles": [],
                "annotatedImage": None,
                "status": "CORRUPTED_OR_INVALID_IMAGE",
                "error": decode_error or "Could not decode valid image.",
            }

        orig_h, orig_w = frame.shape[:2]

        # 4. Large Image Handling & Safety Scaling
        if orig_w > MAX_IMAGE_DIMENSION or orig_h > MAX_IMAGE_DIMENSION:
            scale = MAX_IMAGE_DIMENSION / max(orig_w, orig_h)
            new_w = int(orig_w * scale)
            new_h = int(orig_h * scale)
            frame = cv2.resize(frame, (new_w, new_h), interpolation=cv2.INTER_AREA)

        h, w = frame.shape[:2]

        # 5. Run YOLO11n Vehicle Detection
        conf = conf_threshold if conf_threshold is not None else self.conf_threshold
        t_yolo_start = time.perf_counter()
        detections, yolo_ms = self.detector.detect(frame, conf_threshold=conf)
        perf.yolo_inference_ms = yolo_ms

        vehicles_list: List[VehicleRecognitionItem] = []
        total_plate_det_ms = 0.0
        total_ocr_ms = 0.0

        # 6. Process Detected Vehicles
        for det in detections:
            cname = det["class_name"].lower()
            if cname not in TARGET_VEHICLE_NAMES:
                continue

            x1, y1, x2, y2 = det["bbox"]
            x1_clamped = max(0, min(w - 1, x1))
            y1_clamped = max(0, min(h - 1, y1))
            x2_clamped = max(x1_clamped + 1, min(w, x2))
            y2_clamped = max(y1_clamped + 1, min(h, y2))

            vehicle_crop = frame[y1_clamped:y2_clamped, x1_clamped:x2_clamped]

            # Run Number Plate & OCR pipeline boundary
            plate_res: PlateDetectionResult = self.plate_pipeline.process_vehicle_crop(vehicle_crop)

            total_plate_det_ms += plate_res.detection_latency_ms
            total_ocr_ms += plate_res.ocr_latency_ms

            # Convert plate bbox to full-image coordinate space if present
            full_plate_bbox = None
            if plate_res.plate_bbox is not None:
                px1, py1, px2, py2 = plate_res.plate_bbox
                full_plate_bbox = [
                    x1_clamped + px1,
                    y1_clamped + py1,
                    x1_clamped + px2,
                    y1_clamped + py2,
                ]

            # Explicit Make & Model Handling: DO NOT FAKE make or model
            item = VehicleRecognitionItem(
                vehicle_detected=True,
                vehicle_class=cname,
                confidence=det["confidence"],
                bbox=[x1_clamped, y1_clamped, x2_clamped, y2_clamped],
                number_plate_detected=plate_res.detected,
                number_plate=plate_res.plate_text,
                plate_confidence=plate_res.confidence,
                plate_bbox=full_plate_bbox,
                ocr_status=plate_res.ocr_status,
                raw_ocr_text=plate_res.raw_ocr_text,
                is_valid_format=plate_res.is_valid_format,
                make=None,   # Explicitly null: project does not include vehicle make model
                model=None,  # Explicitly null: project does not include vehicle model classifier
            )
            vehicles_list.append(item)


        perf.plate_detection_ms = total_plate_det_ms
        perf.ocr_reading_ms = total_ocr_ms

        # 7. Determine Recognition Status
        has_vehicles = len(vehicles_list) > 0
        success = has_vehicles

        if not has_vehicles:
            status = "NO_VEHICLE_DETECTED"
        else:
            # Check if any plate was successfully recognized
            any_plate_recognized = any(v.number_plate is not None for v in vehicles_list)
            if any_plate_recognized:
                status = "RECOGNITION_SUCCESSFUL"
            else:
                status = "VEHICLE_DETECTED_PLATE_NOT_RECOGNIZED"

        # 8. Generate Professional Annotated Output Image
        annotated_path_str: Optional[str] = None
        if save_annotated:
            annotated_frame = self._render_annotated_image(
                frame=frame,
                vehicles=vehicles_list,
                status=status,
                timestamp=timestamp_str,
                perf=perf,
            )
            stem = Path(clean_ref_name).stem
            time_tag = current_time_dt.strftime("%Y%m%d_%H%M%S_%f")[:19]
            out_filename = f"detected_{stem}_{time_tag}.jpg"
            out_filepath = self.output_dir / out_filename
            cv2.imwrite(str(out_filepath), annotated_frame)
            annotated_path_str = str(out_filepath)

        total_proc_ms = (time.perf_counter() - t_start) * 1000.0
        perf.total_processing_ms = total_proc_ms

        if print_telemetry:
            perf.print_summary()

        # 9. Build Structured JSON Response
        serialized_vehicles = [v.to_dict() for v in vehicles_list]

        result: Dict[str, Any] = {
            "success": success,
            "timestamp": timestamp_str,
            "processingTimeMs": round(total_proc_ms, 2),
            "vehicles": serialized_vehicles,
            "annotatedImage": annotated_path_str,
            "status": status,
            "performance": perf.to_dict(),
        }

        # Include clear notification if OCR is unavailable in current implementation
        if not self.plate_pipeline.ocr_engine.is_available():
            result["ocrMessage"] = PLATE_OCR_UNAVAILABLE_MESSAGE

        return result

    def _load_frame(
        self,
        image_input: Union[str, Path, bytes, np.ndarray],
    ) -> Tuple[Optional[np.ndarray], Optional[str]]:
        """Loads and safely decodes image input."""
        try:
            if isinstance(image_input, np.ndarray):
                if image_input.size == 0 or len(image_input.shape) < 2:
                    return None, "Empty or invalid numpy array"
                if len(image_input.shape) == 2:
                    return cv2.cvtColor(image_input, cv2.COLOR_GRAY2BGR), None
                return image_input.copy(), None

            elif isinstance(image_input, bytes):
                if len(image_input) == 0:
                    return None, "Uploaded byte payload is empty (0 bytes)"
                if len(image_input) > MAX_IMAGE_UPLOAD_BYTES:
                    return None, f"Image payload exceeds maximum limit of {MAX_IMAGE_UPLOAD_BYTES // (1024 * 1024)}MB"
                np_arr = np.frombuffer(image_input, np.uint8)
                frame = cv2.imdecode(np_arr, cv2.IMREAD_COLOR)
                if frame is None:
                    return None, "Corrupted image data: OpenCV imdecode failed"
                return frame, None

            elif isinstance(image_input, (str, Path)):
                p = Path(image_input)
                if not p.exists() or not p.is_file():
                    return None, f"File does not exist: {p}"
                if p.stat().st_size == 0:
                    return None, f"Input image file is empty: {p}"
                if p.stat().st_size > MAX_IMAGE_UPLOAD_BYTES:
                    return None, f"Input image file exceeds {MAX_IMAGE_UPLOAD_BYTES // (1024 * 1024)}MB"

                frame = cv2.imread(str(p))
                if frame is None:
                    return None, f"OpenCV could not decode image at: {p}"
                return frame, None

            return None, f"Unsupported image_input type: {type(image_input)}"
        except Exception as e:
            return None, f"Error decoding image: {str(e)}"

    def _render_annotated_image(
        self,
        frame: np.ndarray,
        vehicles: List[VehicleRecognitionItem],
        status: str,
        timestamp: str,
        perf: PerformanceBreakdown,
    ) -> np.ndarray:
        """Renders professional bounding boxes, plate tags, and overlay header/footer banners."""
        annotated = frame.copy()
        h, w = annotated.shape[:2]

        # 1. Draw vehicle boxes and labels
        for idx, v in enumerate(vehicles, start=1):
            x1, y1, x2, y2 = v.bbox
            color = CLASS_COLORS.get(v.vehicle_class, DEFAULT_COLOR)

            # Draw vehicle bounding box with rounded aesthetic thickness
            cv2.rectangle(annotated, (x1, y1), (x2, y2), color, 2)

            # Vehicle Label (e.g. "Car 0.93")
            v_label = f"{v.vehicle_class.upper()} {v.confidence:.2f}"
            (tw, th), baseline = cv2.getTextSize(v_label, cv2.FONT_HERSHEY_SIMPLEX, 0.55, 1)
            y_badge = max(y1 - 6, th + 6)
            cv2.rectangle(
                annotated,
                (x1, y_badge - th - 4),
                (x1 + tw + 6, y_badge + baseline),
                color,
                -1,
            )
            cv2.putText(
                annotated,
                v_label,
                (x1 + 3, y_badge - 2),
                cv2.FONT_HERSHEY_SIMPLEX,
                0.55,
                (0, 0, 0),
                1,
                cv2.LINE_AA,
            )

            # Number Plate Bounding Box & Label
            if v.plate_bbox is not None:
                px1, py1, px2, py2 = v.plate_bbox
                plate_color = (0, 255, 255)  # Bright Yellow

                # Draw plate bounding box inside vehicle
                cv2.rectangle(annotated, (px1, py1), (px2, py2), plate_color, 2)

                if v.number_plate is not None:
                    if v.plate_confidence is not None:
                        plate_lbl = f"{v.number_plate} (OCR: {v.plate_confidence * 100:.1f}%)"
                    else:
                        plate_lbl = v.number_plate
                else:
                    plate_lbl = "PLATE NOT RECOGNIZED"


                (ptw, pth), pbase = cv2.getTextSize(plate_lbl, cv2.FONT_HERSHEY_SIMPLEX, 0.5, 1)
                py_badge = max(py1 - 4, pth + 4)
                cv2.rectangle(
                    annotated,
                    (px1, py_badge - pth - 3),
                    (px1 + ptw + 6, py_badge + pbase),
                    (0, 0, 0),
                    -1,
                )
                cv2.rectangle(
                    annotated,
                    (px1, py_badge - pth - 3),
                    (px1 + ptw + 6, py_badge + pbase),
                    plate_color,
                    1,
                )
                cv2.putText(
                    annotated,
                    plate_lbl,
                    (px1 + 3, py_badge - 1),
                    cv2.FONT_HERSHEY_SIMPLEX,
                    0.5,
                    plate_color,
                    1,
                    cv2.LINE_AA,
                )

        # 2. Draw Top Semi-Transparent Telemetry Banner
        banner_h = 44
        overlay = annotated.copy()
        cv2.rectangle(overlay, (0, 0), (w, banner_h), (25, 25, 25), -1)
        cv2.addWeighted(overlay, 0.85, annotated, 0.15, 0, annotated)

        # Header Title & Status
        status_color = (0, 255, 0) if status == "RECOGNITION_SUCCESSFUL" else (
            (0, 165, 255) if status == "VEHICLE_DETECTED_PLATE_NOT_RECOGNIZED" else (0, 0, 255)
        )
        title_text = f"VEHICLE DETECTION | {status}"
        cv2.putText(annotated, title_text, (12, 18), cv2.FONT_HERSHEY_SIMPLEX, 0.52, status_color, 1, cv2.LINE_AA)

        # Timestamp & Latency
        meta_text = f"Timestamp: {timestamp} | Latency: {perf.total_processing_ms:.1f}ms | Count: {len(vehicles)}"
        cv2.putText(annotated, meta_text, (12, 36), cv2.FONT_HERSHEY_SIMPLEX, 0.45, (220, 220, 220), 1, cv2.LINE_AA)

        # 3. Bottom Information Banner
        footer_h = 32
        overlay_foot = annotated.copy()
        cv2.rectangle(overlay_foot, (0, h - footer_h), (w, h), (20, 20, 20), -1)
        cv2.addWeighted(overlay_foot, 0.85, annotated, 0.15, 0, annotated)

        if len(vehicles) > 0:
            first_v = vehicles[0]
            if first_v.number_plate:
                conf_pct = f"{first_v.plate_confidence * 100:.1f}%" if first_v.plate_confidence else "N/A"
                plate_display = f"{first_v.number_plate} (OCR: {conf_pct})"
            else:
                plate_display = "PLATE NOT RECOGNIZED"

            foot_text = (
                f"Type: {first_v.vehicle_class.capitalize()} ({first_v.confidence:.2f})  |  "
                f"Plate: {plate_display}  |  "
                f"Make/Model: Not available"
            )
        else:
            foot_text = "No vehicle detected in scene. Camera 0 awaiting vehicle input."


        cv2.putText(annotated, foot_text, (12, h - 10), cv2.FONT_HERSHEY_SIMPLEX, 0.44, (200, 200, 200), 1, cv2.LINE_AA)

        return annotated
