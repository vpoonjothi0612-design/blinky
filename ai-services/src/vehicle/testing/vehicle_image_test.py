"""YOLO11n Vehicle Image Detection Test Script.

Validates vehicle detection on static images:
1. Loads YOLO11n once.
2. Filters COCO vehicle classes (car, motorcycle, bus, truck).
3. Outputs per-vehicle detection telemetry in terminal.
4. Saves annotated output image.
"""

from __future__ import annotations

import argparse
import sys
import time
from pathlib import Path
from typing import Dict, List, Optional, Any

import cv2
import numpy as np

# Ensure project src path is discoverable
PROJECT_ROOT = Path(__file__).resolve().parents[3]
sys.path.append(str(PROJECT_ROOT / "src"))

from vehicle.detection.yolo_detector import YOLOVehicleDetector, DEFAULT_MODEL_PATH

DEFAULT_INPUT_DIR = PROJECT_ROOT / "data" / "vehicle" / "input"
DEFAULT_OUTPUT_DIR = PROJECT_ROOT / "data" / "vehicle" / "output"


def run_image_detection(
    image_path: Path,
    detector: YOLOVehicleDetector,
    conf_threshold: float = 0.40,
    output_dir: Optional[Path] = None,
    save_output: bool = True,
) -> Dict[str, Any]:
    """Runs vehicle detection on a single image and prints telemetry."""
    if not image_path.exists():
        raise FileNotFoundError(f"Input image not found: {image_path}")

    frame = cv2.imread(str(image_path))
    if frame is None:
        raise ValueError(f"Could not decode image at: {image_path}")

    h, w = frame.shape[:2]
    print(f"\nProcessing Image: {image_path.name} ({w} x {h})")
    print(f"Confidence Threshold: {conf_threshold:.2f}")

    detections, inference_ms = detector.detect(frame, conf_threshold=conf_threshold)

    print(f"Inference Latency: {inference_ms:.2f} ms")
    print(f"Vehicles Detected: {len(detections)}")

    if len(detections) == 0:
        print("No vehicles detected (under threshold or no vehicle in image).")
    else:
        for idx, det in enumerate(detections, start=1):
            x1, y1, x2, y2 = det["bbox"]
            print(f"Vehicle {idx}:")
            print(f"  Class: {det['class_name']}")
            print(f"  Confidence: {det['confidence']:.4f}")
            print(f"  BBox: {x1},{y1},{x2},{y2}")

    output_path = None
    if save_output:
        out_dir = output_dir if output_dir is not None else DEFAULT_OUTPUT_DIR
        out_dir.mkdir(parents=True, exist_ok=True)
        annotated = detector.draw_detections(frame, detections)

        # Telemetry header on image
        header_text = f"YOLO11n | Vehicles: {len(detections)} | Conf: {conf_threshold:.2f} | {inference_ms:.1f}ms"
        cv2.putText(annotated, header_text, (15, 30), cv2.FONT_HERSHEY_SIMPLEX, 0.7, (0, 255, 255), 2, cv2.LINE_AA)

        output_path = out_dir / f"detected_{image_path.name}"
        cv2.imwrite(str(output_path), annotated)
        print(f"Annotated result saved to: {output_path}")

    return {
        "image": str(image_path),
        "detections": detections,
        "inference_ms": inference_ms,
        "output_path": str(output_path) if output_path else None,
    }


def main():
    parser = argparse.ArgumentParser(description="YOLO11n Vehicle Image Detection Tester")
    parser.add_argument("--input", type=str, default=None, help="Path to input image file or directory")
    parser.add_argument("--conf", type=float, default=0.40, help="Confidence threshold (default: 0.40)")
    parser.add_argument("--output", type=str, default=None, help="Directory to save annotated images")
    parser.add_argument("--model", type=str, default=str(DEFAULT_MODEL_PATH), help="Path to yolo11n.pt")
    parser.add_argument("--device", type=str, default="cpu", help="Compute device ('cpu' or 'cuda')")
    args = parser.parse_args()

    detector = YOLOVehicleDetector(model_path=args.model, conf_threshold=args.conf, device=args.device)

    target_input = Path(args.input) if args.input else (DEFAULT_INPUT_DIR / "sample_traffic.jpg")
    output_dir = Path(args.output) if args.output else DEFAULT_OUTPUT_DIR

    if target_input.is_dir():
        image_files = sorted(list(target_input.glob("*.jpg")) + list(target_input.glob("*.png")))
        print(f"Found {len(image_files)} image(s) in {target_input}")
        for img_p in image_files:
            run_image_detection(img_p, detector, conf_threshold=args.conf, output_dir=output_dir)
    elif target_input.exists():
        run_image_detection(target_input, detector, conf_threshold=args.conf, output_dir=output_dir)
    else:
        print(f"Error: Target input does not exist: {target_input}")
        sys.exit(1)


if __name__ == "__main__":
    main()
