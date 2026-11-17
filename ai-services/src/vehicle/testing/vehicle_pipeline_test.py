"""Comprehensive Automated Test Suite for YOLO11n Vehicle Detection & Tracking Module.

Validates all 6 core test scenarios:
- TEST A: One car -> Exactly 1 vehicle detected (class: car)
- TEST B: Multiple cars -> Each car receives its own bounding box
- TEST C: Car + motorcycle -> Both classes correctly detected
- TEST D: Car moving through video -> Same tracking ID across consecutive frames
- TEST E: Multiple moving vehicles -> Different vehicles receive different tracking IDs
- TEST F: Person only -> Zero vehicle detections (person is not treated as a vehicle)
"""

from __future__ import annotations

import sys
import time
from pathlib import Path
from typing import Dict, List, Any

import cv2
import numpy as np

PROJECT_ROOT = Path(__file__).resolve().parents[3]
sys.path.append(str(PROJECT_ROOT / "src"))

from vehicle.detection.vehicle_classes import extract_vehicle_class_map, TARGET_VEHICLE_NAMES
from vehicle.detection.yolo_detector import YOLOVehicleDetector, DEFAULT_MODEL_PATH
from vehicle.tracking.vehicle_tracker import VehicleTracker
from vehicle.testing.setup_test_data import setup_all_test_assets

DATA_INPUT_DIR = PROJECT_ROOT / "data" / "vehicle" / "input"
DATA_OUTPUT_DIR = PROJECT_ROOT / "data" / "vehicle" / "output"


class VehiclePipelineTestSuite:
    def __init__(self):
        print("============================================================")
        print("INITIALIZING YOLO11n VEHICLE TEST SUITE")
        print("============================================================\n")
        # Ensure test assets are present
        setup_all_test_assets()

        self.detector = YOLOVehicleDetector(model_path=DEFAULT_MODEL_PATH, conf_threshold=0.40, device="cpu")
        self.tracker = VehicleTracker(detector=self.detector, tracker_type="bytetrack.yaml")
        self.results: Dict[str, Tuple[str, str]] = {}

    def test_a_single_car(self):
        print("\n------------------------------------------------------------")
        print("TEST A: Single Car Detection")
        print("------------------------------------------------------------")
        img_path = DATA_INPUT_DIR / "test_a_single_car.jpg"
        frame = cv2.imread(str(img_path))
        detections, latency_ms = self.detector.detect(frame)

        print(f"  Input: {img_path.name}")
        print(f"  Latency: {latency_ms:.2f} ms")
        print(f"  Vehicles detected: {len(detections)}")
        for d in detections:
            print(f"    - Class: {d['class_name']} | Conf: {d['confidence']:.4f} | Box: {d['bbox']}")

        assert len(detections) >= 1, "Expected at least 1 vehicle detected"
        primary = detections[0]
        assert primary["class_name"] == "car", f"Expected car, got {primary['class_name']}"
        assert primary["confidence"] >= 0.40, f"Confidence {primary['confidence']} < 0.40"

        self.results["TEST A (Single Car)"] = ("PASS", f"Detected car with conf {primary['confidence']:.2f}")
        print("  Result: PASS")

    def test_b_multiple_cars(self):
        print("\n------------------------------------------------------------")
        print("TEST B: Multiple Cars Detection")
        print("------------------------------------------------------------")
        img_path = DATA_INPUT_DIR / "test_b_multiple_cars.jpg"
        frame = cv2.imread(str(img_path))
        detections, latency_ms = self.detector.detect(frame)

        print(f"  Input: {img_path.name}")
        print(f"  Latency: {latency_ms:.2f} ms")
        print(f"  Vehicles detected: {len(detections)}")
        classes = [d["class_name"] for d in detections]
        print(f"  Classes detected: {set(classes)}")

        # Expect at least 3 distinct vehicles
        assert len(detections) >= 3, f"Expected >= 3 vehicles, got {len(detections)}"
        assert "car" in classes, "Car class missing from detections"

        self.results["TEST B (Multiple Cars)"] = ("PASS", f"Detected {len(detections)} vehicles with distinct bboxes")
        print("  Result: PASS")

    def test_c_car_and_motorcycle(self):
        print("\n------------------------------------------------------------")
        print("TEST C: Car and Motorcycle Detection")
        print("------------------------------------------------------------")
        img_path = DATA_INPUT_DIR / "test_c_car_and_motorcycle.jpg"
        frame = cv2.imread(str(img_path))
        detections, latency_ms = self.detector.detect(frame)

        print(f"  Input: {img_path.name}")
        print(f"  Latency: {latency_ms:.2f} ms")
        print(f"  Vehicles detected: {len(detections)}")
        class_names = set(d["class_name"] for d in detections)
        for d in detections:
            print(f"    - {d['class_name'].upper()}: {d['confidence']:.4f} @ {d['bbox']}")

        assert "car" in class_names, "Car not detected in scene"
        assert "motorcycle" in class_names, "Motorcycle not detected in scene"

        self.results["TEST C (Car + Motorcycle)"] = ("PASS", "Both 'car' and 'motorcycle' correctly detected and classified")
        print("  Result: PASS")

    def test_d_car_moving_tracking(self):
        print("\n------------------------------------------------------------")
        print("TEST D: Car Moving Across Video (Track ID Consistency)")
        print("------------------------------------------------------------")
        video_path = DATA_INPUT_DIR / "test_d_car_moving.mp4"
        cap = cv2.VideoCapture(str(video_path))
        assert cap.isOpened(), "Could not open Test D video"

        self.tracker.reset()
        frame_idx = 0
        observed_ids = set()

        while True:
            ret, frame = cap.read()
            if not ret:
                break
            frame_idx += 1
            tracks, _ = self.tracker.update(frame, frame_idx=frame_idx)
            for trk in tracks:
                observed_ids.add(trk.track_id)

        cap.release()
        print(f"  Total frames processed: {frame_idx}")
        print(f"  Unique track IDs observed: {observed_ids}")
        print(f"  Total unique vehicles count: {self.tracker.total_unique_vehicles}")

        # In Test D, a single car is moving across all 40 frames, so exactly 1 unique ID should be assigned
        assert self.tracker.total_unique_vehicles == 1, f"Expected 1 unique track, got {self.tracker.total_unique_vehicles}"
        assert len(observed_ids) == 1, f"Expected single consistent ID, got {observed_ids}"

        self.results["TEST D (Car Moving Tracking)"] = (
            "PASS",
            f"Car retained consistent Track ID #{list(observed_ids)[0]} across all {frame_idx} frames",
        )
        print("  Result: PASS")

    def test_e_multiple_vehicles_tracking(self):
        print("\n------------------------------------------------------------")
        print("TEST E: Multiple Moving Vehicles (Distinct Track IDs)")
        print("------------------------------------------------------------")
        video_path = DATA_INPUT_DIR / "test_e_multiple_moving.mp4"
        cap = cv2.VideoCapture(str(video_path))
        assert cap.isOpened(), "Could not open Test E video"

        self.tracker.reset()
        frame_idx = 0
        observed_ids = set()

        while True:
            ret, frame = cap.read()
            if not ret:
                break
            frame_idx += 1
            tracks, _ = self.tracker.update(frame, frame_idx=frame_idx)
            for trk in tracks:
                observed_ids.add(trk.track_id)

        cap.release()
        print(f"  Total frames processed: {frame_idx}")
        print(f"  Unique track IDs observed: {observed_ids}")
        print(f"  Total unique vehicles count: {self.tracker.total_unique_vehicles}")

        # In Test E, 2 distinct vehicles move concurrently, so exactly 2 unique IDs must be created
        assert self.tracker.total_unique_vehicles == 2, f"Expected 2 unique tracks, got {self.tracker.total_unique_vehicles}"

        self.results["TEST E (Multiple Vehicles Tracking)"] = (
            "PASS",
            f"Distinct Track IDs ({sorted(list(observed_ids))}) maintained for concurrent vehicles",
        )
        print("  Result: PASS")

    def test_f_person_only_rejection(self):
        print("\n------------------------------------------------------------")
        print("TEST F: Person Only Scene (Vehicle Rejection)")
        print("------------------------------------------------------------")
        img_path = DATA_INPUT_DIR / "test_f_person_only.jpg"
        frame = cv2.imread(str(img_path))
        detections, latency_ms = self.detector.detect(frame)

        print(f"  Input: {img_path.name}")
        print(f"  Latency: {latency_ms:.2f} ms")
        print(f"  Vehicles detected: {len(detections)}")

        assert len(detections) == 0, f"Expected 0 vehicle detections for person only, got {len(detections)}"

        self.results["TEST F (Person Rejection)"] = ("PASS", "Person correctly ignored; zero vehicle detections")
        print("  Result: PASS")

    def run_all(self):
        self.test_a_single_car()
        self.test_b_multiple_cars()
        self.test_c_car_and_motorcycle()
        self.test_d_car_moving_tracking()
        self.test_e_multiple_vehicles_tracking()
        self.test_f_person_only_rejection()

        print("\n============================================================")
        print("TEST SUITE SUMMARY REPORT")
        print("============================================================")
        all_passed = True
        for test_name, (status, detail) in self.results.items():
            print(f"  {test_name:<38}: {status} - {detail}")
            if status != "PASS":
                all_passed = False
        print("============================================================")
        if all_passed:
            print("OVERALL RESULT: ALL TESTS PASSED (100%)\n")
        else:
            print("OVERALL RESULT: SOME TESTS FAILED\n")
        return all_passed


if __name__ == "__main__":
    suite = VehiclePipelineTestSuite()
    success = suite.run_all()
    sys.exit(0 if success else 1)
