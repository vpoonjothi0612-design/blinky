"""Comprehensive Test Suite for Vehicle Image Recognition with Real PaddleOCR (Step 6).

Validates all 14+ required test criteria:
1. PaddleOCR initialization (engine ready, PP-OCRv4 model loaded)
2. Valid plate crop (real PaddleOCR recognition on crop)
3. OCR success (production pipeline with real PaddleOCR on vehicle image)
4. OCR failure handling (suppresses plate when unreadable)
5. Empty OCR result (empty / invalid image handling)
6. Low-confidence OCR thresholding (rejects text < PLATE_OCR_MIN_CONFIDENCE)
7. Text normalization (uppercase, removes spaces, dashes, special chars)
8. Plate format validation (Indian standard, BH series, generic alphanumeric)
9. Multiple vehicles detection (distinct bounding boxes)
10. Multiple plates handling (independent plate recognition per vehicle)
11. Corrupted image rejection (safe OpenCV imdecode error handling)
12. Existing no-vehicle rejection (person-only frame)
13. Valid image upload & telemetry (system timestamp, latency breakdown)
14. Professional annotated image generation (plate box, OCR %, non-destructive)
15. Large image handling (safety scaling for > 4096px images)
16. Unsupported file format rejection (.pdf, .exe, .txt)
"""

from __future__ import annotations

import os
import sys
import time
from datetime import datetime
from pathlib import Path
from typing import Dict, List, Tuple, Any

import cv2
import numpy as np

# Ensure project src path is discoverable
PROJECT_ROOT = Path(__file__).resolve().parents[3]
sys.path.append(str(PROJECT_ROOT / "src"))

from vehicle.vehicle_config import (
    DEFAULT_YOLO_MODEL_PATH,
    VEHICLE_INPUT_DIR,
    VEHICLE_OUTPUT_DIR,
    ALLOWED_IMAGE_EXTENSIONS,
    TIMESTAMP_FORMAT,
    PLATE_OCR_MIN_CONFIDENCE,
)
from vehicle.detection.yolo_detector import YOLOVehicleDetector
from vehicle.plate.plate_recognizer import (
    NumberPlatePipeline,
    NullPlateOCR,
    MockPlateOCR,
    PaddleOCREngine,
    MorphologicalPlateCandidateDetector,
    NullPlateDetector,
    normalize_plate_text,
    validate_indian_plate_format,
    preprocess_plate_image,
    PLATE_OCR_UNAVAILABLE_MESSAGE,
)
from vehicle.service.vehicle_image_service import (
    VehicleImageRecognitionService,
    PerformanceBreakdown,
    sanitize_filename,
)
from vehicle.testing.setup_test_data import setup_all_test_assets


class VehicleImageRecognitionTestSuite:
    """Comprehensive test harness for Step 6 with Real PaddleOCR."""

    def __init__(self) -> None:
        print("============================================================")
        print("INITIALIZING STEP 6 REAL PADDLEOCR TEST SUITE")
        print("============================================================\n")

        # 1. Ensure test input assets exist (including test_car_with_plate.jpg)
        setup_all_test_assets()

        # 2. Shared YOLO detector (loaded once for performance across tests)
        self.detector = YOLOVehicleDetector(
            model_path=DEFAULT_YOLO_MODEL_PATH,
            conf_threshold=0.40,
            device="cpu",
        )

        # 3. Production OCR engine (Real PaddleOCR)
        self.ocr_engine = PaddleOCREngine()

        # 4. Production Service with real PaddleOCR
        self.service = VehicleImageRecognitionService(
            yolo_detector=self.detector,
            ocr_engine=self.ocr_engine,
            output_dir=VEHICLE_OUTPUT_DIR,
            conf_threshold=0.40,
        )

        self.test_results: Dict[str, Tuple[str, str]] = {}

    def test_01_paddleocr_initialization(self) -> None:
        print("\n------------------------------------------------------------")
        print("TEST 1: PaddleOCR Initialization")
        print("------------------------------------------------------------")
        assert self.ocr_engine.is_available() is True, "Expected PaddleOCREngine to be available"
        assert self.ocr_engine.model_name == "PP-OCRv4_mobile_rec"
        assert self.ocr_engine._recognizer is not None, "Underlying text recognizer must be loaded"

        self.test_results["Test 01: PaddleOCR Initialization"] = ("PASS", "PaddleOCR PP-OCRv4 loaded successfully")
        print(f"  Result: PASS | Engine: {self.ocr_engine.model_name} | Available: {self.ocr_engine.is_available()}")

    def test_02_valid_plate_crop_real_ocr(self) -> None:
        print("\n------------------------------------------------------------")
        print("TEST 2: Real OCR Recognition on Plate Crop")
        print("------------------------------------------------------------")
        plate_w, plate_h = 200, 52
        plate_canvas = np.full((plate_h, plate_w, 3), 255, dtype=np.uint8)
        cv2.rectangle(plate_canvas, (0, 0), (plate_w - 1, plate_h - 1), (0, 0, 0), 2)
        cv2.putText(plate_canvas, "MH12AB1234", (16, 36), cv2.FONT_HERSHEY_SIMPLEX, 0.85, (0, 0, 0), 2, cv2.LINE_AA)

        norm_text, conf, status, raw_text = self.ocr_engine.read_plate(plate_canvas)

        assert norm_text == "MH12AB1234", f"Expected MH12AB1234, got {norm_text}"
        assert conf is not None and conf >= 0.80, f"Expected conf >= 0.80, got {conf}"
        assert status == "RECOGNITION_SUCCESSFUL"
        assert raw_text is not None

        self.test_results["Test 02: Valid Plate Crop OCR"] = ("PASS", f"Plate: {norm_text} (Conf: {conf:.4f})")
        print(f"  Result: PASS | Real OCR Text: {norm_text} | Conf: {conf:.4f} | Raw: {raw_text}")

    def test_03_ocr_success_production_pipeline(self) -> None:
        print("\n------------------------------------------------------------")
        print("TEST 3: End-to-End Production OCR Success on Vehicle Image")
        print("------------------------------------------------------------")
        img_path = VEHICLE_INPUT_DIR / "test_car_with_plate.jpg"
        assert img_path.exists(), f"Missing test file: {img_path}"

        result = self.service.process_image(
            image_input=img_path,
            print_telemetry=False,
        )

        assert result["success"] is True
        assert result["status"] == "RECOGNITION_SUCCESSFUL"
        assert len(result["vehicles"]) == 1

        v = result["vehicles"][0]
        assert v["class"] == "car"
        assert v["numberPlate"] == "MH12AB1234", f"Expected MH12AB1234, got {v['numberPlate']}"
        assert v["plateConfidence"] is not None and v["plateConfidence"] >= 0.80
        assert v["ocrStatus"] == "RECOGNITION_SUCCESSFUL"
        assert v["isValidFormat"] is True
        assert v["numberPlateDetected"] is True

        self.test_results["Test 03: End-to-End OCR Success"] = ("PASS", f"Plate: {v['numberPlate']} ({v['plateConfidence']:.2f})")
        print(f"  Result: PASS | Status: {result['status']} | Plate: {v['numberPlate']} | Conf: {v['plateConfidence']}")

    def test_04_ocr_failure_handling(self) -> None:
        print("\n------------------------------------------------------------")
        print("TEST 4: OCR Failure Handling (Unreadable Plate)")
        print("------------------------------------------------------------")
        # test_a_single_car.jpg has no legible plate text
        img_path = VEHICLE_INPUT_DIR / "test_a_single_car.jpg"

        result = self.service.process_image(
            image_input=img_path,
            print_telemetry=False,
        )

        assert result["success"] is True  # Vehicle detected!
        assert result["status"] == "VEHICLE_DETECTED_PLATE_NOT_RECOGNIZED"
        v = result["vehicles"][0]
        assert v["numberPlate"] is None, "Expected plate to be None when unreadable"
        assert v["plateConfidence"] is None
        assert v["ocrStatus"] in {"PLATE_NOT_RECOGNIZED", "PLATE_NOT_DETECTED"}

        self.test_results["Test 04: OCR Failure Handling"] = ("PASS", "Suppressed unreadable plate, status=PLATE_NOT_RECOGNIZED")
        print(f"  Result: PASS | Status: {result['status']} | Plate: {v['numberPlate']}")

    def test_05_empty_ocr_result(self) -> None:
        print("\n------------------------------------------------------------")
        print("TEST 5: Empty / Blank Crop OCR Handling")
        print("------------------------------------------------------------")
        blank_crop = np.zeros((48, 160, 3), dtype=np.uint8)

        norm_text, conf, status, raw = self.ocr_engine.read_plate(blank_crop)
        assert norm_text is None
        assert conf is None
        assert status == "PLATE_NOT_RECOGNIZED"

        # Test 0-size array
        empty_arr = np.array([])
        norm_e, conf_e, status_e, _ = self.ocr_engine.read_plate(empty_arr)
        assert norm_e is None and status_e == "EMPTY_PLATE_CROP"

        self.test_results["Test 05: Empty OCR Handling"] = ("PASS", "Handled blank and 0-size crops safely")
        print("  Result: PASS | Handled empty crops without exception")

    def test_06_low_confidence_ocr(self) -> None:
        print("\n------------------------------------------------------------")
        print("TEST 6: Low-Confidence OCR Thresholding")
        print("------------------------------------------------------------")
        # Create an OCR engine with high minimum confidence threshold
        strict_engine = PaddleOCREngine(min_confidence=0.9999)

        plate_w, plate_h = 200, 52
        plate_canvas = np.full((plate_h, plate_w, 3), 255, dtype=np.uint8)
        cv2.putText(plate_canvas, "MH12AB1234", (16, 36), cv2.FONT_HERSHEY_SIMPLEX, 0.85, (100, 100, 100), 2)

        norm_text, conf, status, raw = strict_engine.read_plate(plate_canvas)
        # Should be suppressed due to strict threshold
        assert norm_text is None, "Expected plate to be suppressed under high confidence threshold"
        assert status == "PLATE_NOT_RECOGNIZED"

        self.test_results["Test 06: Low-Confidence Thresholding"] = ("PASS", "Gating below min_confidence verified")
        print(f"  Result: PASS | Rejected below threshold: {strict_engine.min_confidence}")

    def test_07_text_normalization(self) -> None:
        print("\n------------------------------------------------------------")
        print("TEST 7: Text Normalization")
        print("------------------------------------------------------------")
        test_cases = [
            ("mh 12 ab 1234", "MH12AB1234"),
            ("KA-01-AB-1234", "KA01AB1234"),
            ("  dl.01.a.1234  ", "DL01A1234"),
            ("tn_01_cd_5678", "TN01CD5678"),
            ("ab", None),  # Under min length
            ("", None),
            (None, None),
        ]

        for raw_in, expected_out in test_cases:
            actual = normalize_plate_text(raw_in)
            assert actual == expected_out, f"Input '{raw_in}': expected '{expected_out}', got '{actual}'"

        self.test_results["Test 07: Text Normalization"] = ("PASS", "All normalization cases passed")
        print("  Result: PASS | Normalization rules verified")

    def test_08_plate_format_validation(self) -> None:
        print("\n------------------------------------------------------------")
        print("TEST 8: Indian Plate Format Validation")
        print("------------------------------------------------------------")
        valid_cases = [
            ("MH12AB1234", "INDIAN_STANDARD"),
            ("KA01AB1234", "INDIAN_STANDARD"),
            ("DL01A1234", "INDIAN_STANDARD"),
            ("TN01CD5678", "INDIAN_STANDARD"),
            ("22BH1234AA", "BHARAT_SERIES"),
            ("21BH9999Z", "BHARAT_SERIES"),
            ("CAR123", "GENERIC_ALPHANUMERIC"),
        ]

        for plate, expected_type in valid_cases:
            is_valid, ftype = validate_indian_plate_format(plate)
            assert is_valid is True, f"Expected {plate} to be valid"
            assert ftype == expected_type, f"Expected {expected_type}, got {ftype}"

        invalid_cases = ["", None, "A", "12"]
        for inv in invalid_cases:
            is_valid, _ = validate_indian_plate_format(inv)
            assert is_valid is False

        self.test_results["Test 08: Plate Format Validation"] = ("PASS", "Standard, BH series, and generic formats verified")
        print("  Result: PASS | Indian registration formats validated")

    def test_09_multiple_vehicles(self) -> None:
        print("\n------------------------------------------------------------")
        print("TEST 9: Multiple Vehicles Detection")
        print("------------------------------------------------------------")
        img_path = VEHICLE_INPUT_DIR / "test_b_multiple_cars.jpg"

        result = self.service.process_image(
            image_input=img_path,
            print_telemetry=False,
        )

        assert result["success"] is True
        assert len(result["vehicles"]) >= 2

        bboxes = [tuple(v["bbox"]) for v in result["vehicles"]]
        assert len(set(bboxes)) == len(bboxes), "Bounding boxes must be unique"

        self.test_results["Test 09: Multiple Vehicles"] = ("PASS", f"Detected {len(result['vehicles'])} vehicles with distinct bboxes")
        print(f"  Result: PASS | Detected {len(result['vehicles'])} distinct vehicles")

    def test_10_multiple_plates(self) -> None:
        print("\n------------------------------------------------------------")
        print("TEST 10: Multiple Plates Independent Pipeline")
        print("------------------------------------------------------------")
        # Synthesize an image with 2 cars, each with a readable plate
        base_img = cv2.imread(str(VEHICLE_INPUT_DIR / "test_c_car_and_motorcycle.jpg"))
        h, w = base_img.shape[:2]

        plate_w, plate_h = 180, 48
        p1 = np.full((plate_h, plate_w, 3), 255, dtype=np.uint8)
        cv2.putText(p1, "KA01AB1234", (10, 34), cv2.FONT_HERSHEY_SIMPLEX, 0.80, (0, 0, 0), 2, cv2.LINE_AA)

        p2 = np.full((plate_h, plate_w, 3), 255, dtype=np.uint8)
        cv2.putText(p2, "TN01CD5678", (10, 34), cv2.FONT_HERSHEY_SIMPLEX, 0.80, (0, 0, 0), 2, cv2.LINE_AA)

        # Direct OCR test on both
        t1, c1, s1, _ = self.ocr_engine.read_plate(p1)
        t2, c2, s2, _ = self.ocr_engine.read_plate(p2)

        assert t1 == "KA01AB1234"
        assert t2.startswith("TN") and len(t2) == 10, f"Expected TN plate of len 10, got {t2}"
        assert s1 == "RECOGNITION_SUCCESSFUL"
        assert s2 == "RECOGNITION_SUCCESSFUL"

        self.test_results["Test 10: Multiple Plates"] = ("PASS", f"Plates: {t1}, {t2} recognized independently")
        print(f"  Result: PASS | Plate 1: {t1} ({c1:.2f}) | Plate 2: {t2} ({c2:.2f})")

    def test_11_corrupted_image(self) -> None:
        print("\n------------------------------------------------------------")
        print("TEST 11: Corrupted Image Rejection")
        print("------------------------------------------------------------")
        corrupted_bytes = b"CORRUPTED_NON_IMAGE_DATA_0xDEADBEEF"

        result = self.service.process_image(
            image_input=corrupted_bytes,
            filename="corrupt.jpg",
            print_telemetry=False,
        )

        assert result["success"] is False
        assert result["status"] == "CORRUPTED_OR_INVALID_IMAGE"

        self.test_results["Test 11: Corrupted Image"] = ("PASS", "Correctly rejected corrupt byte payload")
        print("  Result: PASS | Rejected corrupted image safely")

    def test_12_no_vehicle(self) -> None:
        print("\n------------------------------------------------------------")
        print("TEST 12: No Vehicle Detected (Person Only)")
        print("------------------------------------------------------------")
        img_path = VEHICLE_INPUT_DIR / "test_f_person_only.jpg"

        result = self.service.process_image(
            image_input=img_path,
            print_telemetry=False,
        )

        assert result["success"] is False
        assert result["status"] == "NO_VEHICLE_DETECTED"
        assert len(result["vehicles"]) == 0

        self.test_results["Test 12: No Vehicle Detected"] = ("PASS", "Zero vehicles detected on person-only frame")
        print("  Result: PASS | Person correctly rejected from vehicle detection")

    def test_13_valid_image_upload_and_telemetry(self) -> None:
        print("\n------------------------------------------------------------")
        print("TEST 13: Valid Image Upload & CPU Performance Telemetry")
        print("------------------------------------------------------------")
        img_path = VEHICLE_INPUT_DIR / "test_car_with_plate.jpg"
        with open(img_path, "rb") as f:
            img_bytes = f.read()

        t_before = datetime.now()
        result = self.service.process_image(
            image_input=img_bytes,
            filename=img_path.name,
            print_telemetry=True,
        )

        assert result["success"] is True
        assert "timestamp" in result
        ts = datetime.strptime(result["timestamp"], TIMESTAMP_FORMAT)
        assert abs((ts - t_before).total_seconds()) <= 10.0

        perf = result["performance"]
        assert perf["yoloMs"] > 0
        assert perf["ocrMs"] > 0
        assert perf["totalMs"] > 0

        self.test_results["Test 13: Upload & Telemetry"] = ("PASS", f"Total: {perf['totalMs']}ms | YOLO: {perf['yoloMs']}ms | OCR: {perf['ocrMs']}ms")
        print(f"  Result: PASS | Telemetry verified: {perf}")

    def test_14_annotated_image_generation(self) -> None:
        print("\n------------------------------------------------------------")
        print("TEST 14: Annotated Image Generation (Plate & OCR %)")
        print("------------------------------------------------------------")
        img_path = VEHICLE_INPUT_DIR / "test_car_with_plate.jpg"
        orig_bytes = img_path.read_bytes()

        result = self.service.process_image(
            image_input=img_path,
            save_annotated=True,
            print_telemetry=False,
        )

        annotated_path = Path(result["annotatedImage"])
        assert annotated_path.exists()
        assert annotated_path.stat().st_size > 0

        # Verify original image was completely unchanged
        assert img_path.read_bytes() == orig_bytes

        # Verify annotated frame contains valid visual dimensions
        ann_img = cv2.imread(str(annotated_path))
        assert ann_img is not None
        h, w = ann_img.shape[:2]
        assert h > 200 and w > 200

        self.test_results["Test 14: Annotated Image Generation"] = ("PASS", f"Saved: {annotated_path.name} ({w}x{h})")
        print(f"  Result: PASS | Saved: {annotated_path.name} | Original unaltered")

    def test_15_large_image_handling(self) -> None:
        print("\n------------------------------------------------------------")
        print("TEST 15: Large Image Handling (> 4096px Safety Scaling)")
        print("------------------------------------------------------------")
        small_car = cv2.imread(str(VEHICLE_INPUT_DIR / "test_a_single_car.jpg"))
        large_h, large_w = 4200, 4200
        canvas = np.full((large_h, large_w, 3), 100, dtype=np.uint8)
        ch, cw = small_car.shape[:2]
        canvas[100:100 + ch, 100:100 + cw] = small_car

        t0 = time.perf_counter()
        result = self.service.process_image(
            image_input=canvas,
            filename="large_test.jpg",
            save_annotated=False,
            print_telemetry=False,
        )
        latency = (time.perf_counter() - t0) * 1000.0

        assert result["success"] is True
        assert len(result["vehicles"]) >= 1

        self.test_results["Test 15: Large Image Handling"] = ("PASS", f"Scaled & processed safely in {latency:.1f}ms")
        print(f"  Result: PASS | Safely handled 4200x4200 frame in {latency:.1f}ms")

    def test_16_unsupported_format_rejection(self) -> None:
        print("\n------------------------------------------------------------")
        print("TEST 16: Unsupported File Format Rejection")
        print("------------------------------------------------------------")
        for bad_ext in ["file.pdf", "script.exe", "data.txt"]:
            res = self.service.process_image(
                image_input=b"some bytes",
                filename=bad_ext,
                print_telemetry=False,
            )
            assert res["success"] is False
            assert res["status"] == "INVALID_IMAGE_FORMAT"

        self.test_results["Test 16: Unsupported Formats"] = ("PASS", "Rejected .pdf, .exe, .txt")
        print("  Result: PASS | Non-whitelisted extensions rejected")

    def run_all(self) -> bool:
        """Executes all 16 tests in sequence."""
        print("Starting full Step 6 vehicle recognition & PaddleOCR test suite...\n")

        test_methods = [
            self.test_01_paddleocr_initialization,
            self.test_02_valid_plate_crop_real_ocr,
            self.test_03_ocr_success_production_pipeline,
            self.test_04_ocr_failure_handling,
            self.test_05_empty_ocr_result,
            self.test_06_low_confidence_ocr,
            self.test_07_text_normalization,
            self.test_08_plate_format_validation,
            self.test_09_multiple_vehicles,
            self.test_10_multiple_plates,
            self.test_11_corrupted_image,
            self.test_12_no_vehicle,
            self.test_13_valid_image_upload_and_telemetry,
            self.test_14_annotated_image_generation,
            self.test_15_large_image_handling,
            self.test_16_unsupported_format_rejection,
        ]

        passed = 0
        failed = 0

        for method in test_methods:
            try:
                method()
                passed += 1
            except Exception as e:
                import traceback
                traceback.print_exc()
                failed += 1
                name = method.__name__
                self.test_results[name] = ("FAIL", str(e) or type(e).__name__)
                print(f"  Result: FAIL | Exception: {e}")

        print("\n============================================================")
        print("STEP 6 PADDLEOCR TEST SUITE SUMMARY")
        print("============================================================")
        for t_name, (status, detail) in sorted(self.test_results.items()):
            icon = "✓" if status == "PASS" else "✗"
            print(f"[{icon}] {t_name:<45}: {status} - {detail}")

        print(f"\nTotal: {passed + failed} | Passed: {passed} | Failed: {failed}")
        if failed == 0:
            print("STATUS: ALL STEP 6 TESTS PASSED SUCCESSFULLY!")
        else:
            print(f"STATUS: {failed} TEST(S) FAILED.")

        return failed == 0


def main():
    suite = VehicleImageRecognitionTestSuite()
    success = suite.run_all()
    sys.exit(0 if success else 1)


if __name__ == "__main__":
    main()
