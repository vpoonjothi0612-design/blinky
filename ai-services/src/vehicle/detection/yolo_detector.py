"""YOLO11n Vehicle Detector Module.

Encapsulates YOLO11n inference for road vehicle detection (car, motorcycle, bus, truck).
Loads model strictly once and provides clean bounding-box output with telemetry.
"""

from __future__ import annotations

import time
from pathlib import Path
from typing import Dict, List, Optional, Tuple, Any

import cv2
import numpy as np
from ultralytics import YOLO

from .vehicle_classes import extract_vehicle_class_map, TARGET_VEHICLE_NAMES

DEFAULT_MODEL_PATH = (
    Path(__file__).resolve().parents[3]
    / "models"
    / "yolo"
    / "yolo11n.pt"
)

# Visual styling per vehicle class
CLASS_COLORS: Dict[str, Tuple[int, int, int]] = {
    "car": (0, 200, 0),         # Green
    "motorcycle": (255, 165, 0), # Orange
    "bus": (255, 0, 128),       # Purple / Magenta
    "truck": (0, 165, 255),     # Yellow / Gold
}
DEFAULT_COLOR: Tuple[int, int, int] = (0, 255, 255)


class YOLOVehicleDetector:
    """Production YOLO11n Vehicle Detector wrapper."""

    def __init__(
        self,
        model_path: Optional[Path | str] = None,
        conf_threshold: float = 0.40,
        device: str = "cpu",
    ) -> None:
        """Initializes the YOLO11n vehicle detector once.

        Args:
            model_path: Path to yolo11n.pt model weights.
            conf_threshold: Minimum confidence threshold (default: 0.40).
            device: Compute device ('cpu' or 'cuda').
        """
        self.model_path = Path(model_path) if model_path else DEFAULT_MODEL_PATH
        if not self.model_path.exists():
            raise FileNotFoundError(f"YOLO11n model weights not found at: {self.model_path}")

        self.conf_threshold = float(conf_threshold)
        self.device = device

        print(f"[YOLOVehicleDetector] Loading YOLO11n from {self.model_path} on {self.device}...")
        t0 = time.perf_counter()
        self.model = YOLO(str(self.model_path))
        load_ms = (time.perf_counter() - t0) * 1000.0
        print(f"[YOLOVehicleDetector] Model loaded in {load_ms:.1f} ms.")

        # Dynamically discover vehicle class IDs
        self.vehicle_map = extract_vehicle_class_map(self.model)
        self.vehicle_class_ids = sorted(list(self.vehicle_map.keys()))
        print(f"[YOLOVehicleDetector] Configured vehicle classes: {self.vehicle_map}")

    def detect(
        self,
        frame: np.ndarray,
        conf_threshold: Optional[float] = None,
    ) -> Tuple[List[Dict[str, Any]], float]:
        """Runs vehicle detection on an input BGR frame.

        Args:
            frame: OpenCV BGR image (H, W, 3).
            conf_threshold: Optional override for confidence threshold.

        Returns:
            Tuple of (list of vehicle detections, inference_time_ms).
        """
        if frame is None or frame.size == 0:
            return [], 0.0

        conf = conf_threshold if conf_threshold is not None else self.conf_threshold

        t0 = time.perf_counter()
        # Ultralytics model call with class filter and confidence threshold
        results = self.model.predict(
            source=frame,
            classes=self.vehicle_class_ids,
            conf=conf,
            device=self.device,
            verbose=False,
        )
        inference_time_ms = (time.perf_counter() - t0) * 1000.0

        detections: List[Dict[str, Any]] = []
        if results and len(results) > 0:
            boxes = results[0].boxes
            if boxes is not None and len(boxes) > 0:
                xyxy = boxes.xyxy.cpu().numpy()
                confs = boxes.conf.cpu().numpy()
                cls_ids = boxes.cls.cpu().numpy().astype(int)

                for box, score, cid in zip(xyxy, confs, cls_ids):
                    class_name = self.vehicle_map.get(cid, "vehicle")
                    x1, y1, x2, y2 = map(int, box)
                    detections.append({
                        "bbox": (x1, y1, x2, y2),
                        "confidence": float(score),
                        "class_id": int(cid),
                        "class_name": class_name,
                    })

        return detections, inference_time_ms

    def draw_detections(
        self,
        frame: np.ndarray,
        detections: List[Dict[str, Any]],
        show_conf: bool = True,
    ) -> np.ndarray:
        """Draws bounding boxes and labels on a copy of the frame."""
        annotated = frame.copy()

        for idx, det in enumerate(detections, start=1):
            x1, y1, x2, y2 = det["bbox"]
            conf = det["confidence"]
            cname = det["class_name"].upper()
            color = CLASS_COLORS.get(det["class_name"], DEFAULT_COLOR)

            # Draw bounding box
            cv2.rectangle(annotated, (x1, y1), (x2, y2), color, 2)

            # Label text
            label = f"{cname} {conf:.2f}" if show_conf else cname

            (tw, th), baseline = cv2.getTextSize(label, cv2.FONT_HERSHEY_SIMPLEX, 0.55, 1)
            y_label = max(y1 - 6, th + 4)
            cv2.rectangle(
                annotated,
                (x1, y_label - th - 4),
                (x1 + tw + 6, y_label + baseline),
                color,
                -1,
            )
            cv2.putText(
                annotated,
                label,
                (x1 + 3, y_label - 2),
                cv2.FONT_HERSHEY_SIMPLEX,
                0.55,
                (0, 0, 0),
                1,
                cv2.LINE_AA,
            )

        return annotated
