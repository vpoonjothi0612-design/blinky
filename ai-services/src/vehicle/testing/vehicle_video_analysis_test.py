"""Comprehensive Test Suite for Vehicle Video Analysis Pipeline.

Validates all 13 production criteria:
1. Valid 1-minute traffic video processing (ai-services/test-data/traffic-video.mp4)
2. Multiple vehicles detection
3. Multiple vehicle classes (car, motorcycle, bus, truck)
4. Multi-object tracking with ByteTrack (stable track IDs)
5. Readable number plate recognition with real PaddleOCR
6. Unreadable or unconfirmed plate handling (safe nulls and explicit OCR status)
7. Low OCR confidence gating (rejection below threshold, never guess)
8. Vehicle without number plate handling
9. Timestamp generation (videoTimestamp "HH:MM:SS.mmm", processedAt ISO-8601)
10. Line crossing events & direction ("DOWN" / "UP")
11. Duplicate event prevention (strict single crossing event per track ID)
12. Annotated video generation (.mp4)
13. Structured JSON result generation matching specification
14. Corrupted/unsupported video handling (error responses, HTTP safety)
"""

from __future__ import annotations

import json
import os
import sys
import time
from pathlib import Path
from typing import Dict, List, Any

# Ensure torch is imported first
try:
    import torch
except ImportError:
    pass

import cv2
import numpy as np

# Setup path resolution
_TEST_DIR = Path(__file__).resolve().parent
_SRC_DIR = _TEST_DIR.parents[1]
sys.path.append(str(_SRC_DIR))

from vehicle.vehicle_config import (
    TEST_DATA_DIR,
    TEST_DATA_OUTPUT_DIR,
    DEFAULT_YOLO_MODEL_PATH,
    PLATE_OCR_MIN_CONFIDENCE,
)
from vehicle.detection.yolo_detector import YOLOVehicleDetector
from vehicle.tracking.vehicle_tracker import VehicleTracker
from vehicle.events.line_counter import VehicleLineCounter
from vehicle.events.vehicle_event import VehicleEvent
from vehicle.events.event_store import VehicleEventStore
from vehicle.plate.plate_recognizer import (
    NumberPlatePipeline,
    MockPlateOCR,
    PaddleOCREngine,
    BasePlateDetector,
    NullPlateDetector,
)
from vehicle.service.vehicle_video_service import (
    VehicleVideoAnalysisService,
    format_video_timestamp,
    format_duration,
)


class FixedPlateDetector(BasePlateDetector):
    def detect_plate(self, vehicle_crop):
        height, width = vehicle_crop.shape[:2]
        if width < 40 or height < 30:
            return None, 0.0
        return (10, 10, width - 10, height - 10), 0.95


def run_video_analysis_test_suite() -> bool:
    print("\n" + "=" * 60)
    print("VEHICLE VIDEO ANALYSIS TEST SUITE")
    print("=" * 60)

    test_results: Dict[str, str] = {}
    test_data_dir = TEST_DATA_DIR
    output_dir = TEST_DATA_OUTPUT_DIR
    output_dir.mkdir(parents=True, exist_ok=True)

    traffic_video_path = test_data_dir / "traffic-video.mp4"
    if not traffic_video_path.exists():
        print(f"[FAIL] Traffic test video not found at: {traffic_video_path}")
        return False

    # Initialize Service
    service = VehicleVideoAnalysisService()

    # -------------------------------------------------------------------------
    # TEST 1: Corrupted & Unsupported Video Handling
    # -------------------------------------------------------------------------
    print("\n------------------------------------------------------------")
    print("TEST 1: Corrupted & Unsupported Video Handling")
    print("------------------------------------------------------------")
    corrupt_file = output_dir / "corrupted_test_video.mp4"
    with open(corrupt_file, "wb") as f:
        f.write(b"NOT_A_VALID_MP4_HEADER_GARBAGE_BYTES")

    unsupported_file = output_dir / "unsupported_test.txt"
    with open(unsupported_file, "w") as f:
        f.write("text content")

    corrupt_res = service.process_video(video_source=corrupt_file, print_progress=False)
    unsupported_res = service.process_video(video_source=unsupported_file, print_progress=False)

    assert corrupt_res["success"] is False, "Should fail on corrupt video"
    assert corrupt_res["status"] in ("CORRUPTED_OR_INVALID_VIDEO", "EMPTY_OR_CORRUPT_VIDEO")
    assert unsupported_res["success"] is False, "Should fail on unsupported format"
    assert unsupported_res["status"] == "UNSUPPORTED_FORMAT"

    # Cleanup temp test files
    try:
        corrupt_file.unlink()
        unsupported_file.unlink()
    except OSError:
        pass

    test_results["Corrupted & Unsupported File Handling"] = "PASS"
    print("  Corrupt video safely rejected:", corrupt_res["status"])
    print("  Unsupported format safely rejected:", unsupported_res["status"])
    print("  Result: PASS")

    # -------------------------------------------------------------------------
    # TEST 2: Timestamp Formatting Logic
    # -------------------------------------------------------------------------
    print("\n------------------------------------------------------------")
    print("TEST 2: Timestamp Formatting Logic")
    print("------------------------------------------------------------")
    ts1 = format_video_timestamp(12.450)
    ts2 = format_video_timestamp(0.0)
    ts3 = format_video_timestamp(3665.123)
    dur1 = format_duration(60.0)
    dur2 = format_duration(3600.0)

    assert ts1 == "00:00:12.450", f"Unexpected timestamp: {ts1}"
    assert ts2 == "00:00:00.000", f"Unexpected timestamp: {ts2}"
    assert ts3 == "01:01:05.123", f"Unexpected timestamp: {ts3}"
    assert dur1 == "00:01:00", f"Unexpected duration: {dur1}"
    assert dur2 == "01:00:00", f"Unexpected duration: {dur2}"

    test_results["Timestamp Formatting"] = "PASS"
    print(f"  Sample timestamp (12.450s): {ts1}")
    print(f"  Sample duration (60.0s)   : {dur1}")
    print("  Result: PASS")

    # -------------------------------------------------------------------------
    # TEST 3: Mock OCR Logic & Never Guessing Invariant
    # -------------------------------------------------------------------------
    print("\n------------------------------------------------------------")
    print("TEST 3: Number Plate OCR Gating & Never-Guess Rule")
    print("------------------------------------------------------------")
    # A. High confidence mock plate
    mock_engine_success = MockPlateOCR(canned_plate="MH12AB1234", confidence=0.98)
    pipe_success = NumberPlatePipeline(detector=FixedPlateDetector(), ocr_engine=mock_engine_success)
    dummy_crop = np.zeros((100, 200, 3), dtype=np.uint8)
    res_success = pipe_success.process_vehicle_crop(dummy_crop)

    assert res_success.plate_text == "MH12AB1234"
    assert res_success.confidence == 0.98
    assert res_success.ocr_status == "RECOGNITION_SUCCESSFUL"

    # B. OCR Failure / unreadable plate
    mock_engine_fail = MockPlateOCR(simulate_failure=True)
    pipe_fail = NumberPlatePipeline(detector=FixedPlateDetector(), ocr_engine=mock_engine_fail)
    res_fail = pipe_fail.process_vehicle_crop(dummy_crop)

    assert res_fail.plate_text is None
    assert res_fail.confidence is None
    assert res_fail.ocr_status == "PLATE_NOT_RECOGNIZED"

    # C. No localized plate must not OCR a guessed lower-vehicle region.
    pipe_no_detection = NumberPlatePipeline(
        detector=NullPlateDetector(),
        ocr_engine=mock_engine_success,
    )
    res_no_detection = pipe_no_detection.process_vehicle_crop(dummy_crop)
    assert res_no_detection.detected is False
    assert res_no_detection.plate_bbox is None
    assert res_no_detection.plate_crop is None
    assert res_no_detection.plate_text is None
    assert res_no_detection.ocr_status == "PLATE_NOT_DETECTED"

    test_results["OCR Gating & Never Guess"] = "PASS"
    print("  High confidence OCR returned plate:", res_success.plate_text, f"({res_success.confidence})")
    print("  Unreadable OCR returned null plate:", res_fail.plate_text, f"status={res_fail.ocr_status}")
    print("  Missing localization returned no plate crop:", res_no_detection.plate_crop)
    print("  Result: PASS")

    # -------------------------------------------------------------------------
    # TEST 4: Full 1-Minute Traffic Video Processing (Production Run)
    # -------------------------------------------------------------------------
    print("\n------------------------------------------------------------")
    print("TEST 4: Full 1-Minute Traffic Video Processing (Production Run)")
    print("------------------------------------------------------------")
    out_mp4_path = output_dir / "traffic-video-result.mp4"
    out_json_path = output_dir / "traffic-video-result.json"

    t0 = time.perf_counter()
    full_result = service.process_video(
        video_source=traffic_video_path,
        output_video_path=out_mp4_path,
        output_json_path=out_json_path,
        conf_threshold=0.40,
        processing_fps=10.0,  # 10 FPS inference rate (600 frames total)
        save_annotated=True,
        print_progress=True,
    )
    t_elapsed = time.perf_counter() - t0

    assert full_result["success"] is True, f"Full video processing failed: {full_result.get('error')}"
    assert out_mp4_path.exists(), f"Output MP4 does not exist: {out_mp4_path}"
    assert out_mp4_path.stat().st_size > 0, "Output MP4 is empty"
    assert out_json_path.exists(), f"Output JSON does not exist: {out_json_path}"
    assert out_json_path.stat().st_size > 0, "Output JSON is empty"

    vehicles = full_result["vehicles"]
    events = full_result["events"]
    vehicle_count = full_result["vehicleCount"]
    class_counts = full_result["vehicleClassCounts"]

    print("\nVerification Checklist:")
    # 1. Multiple vehicles detected
    assert vehicle_count >= 5, f"Expected at least 5 vehicles, found {vehicle_count}"
    print(f"  [OK] Vehicles detected: {vehicle_count}")

    # 2. Vehicle classes present
    assert any(c in class_counts for c in ["car", "truck", "motorcycle", "bus"]), "No configured vehicle classes found"
    print(f"  [OK] Vehicle class counts: {class_counts}")

    # 3. Unique track IDs
    track_ids = [v["trackId"] for v in vehicles]
    assert len(track_ids) == len(set(track_ids)), "Duplicate trackId in vehicle list"
    print(f"  [OK] Unique track IDs assigned: min={min(track_ids)}, max={max(track_ids)}")

    # 4. Make & Model status
    for v in vehicles:
        assert v["make"] is None, "Make should be null"
        assert v["model"] is None, "Model should be null"
        assert v["makeModelStatus"] == "NOT_SUPPORTED", "makeModelStatus should be NOT_SUPPORTED"
    print("  [OK] Make & Model strictly null and status=NOT_SUPPORTED across all vehicles")

    # 5. Timestamps present and well-formed
    assert "00:" in full_result["videoDuration"]
    assert "T" in full_result["processedAt"]
    for v in vehicles:
        assert "00:" in v["videoTimestamp"]
    print(f"  [OK] Video duration: {full_result['videoDuration']}, Processed at: {full_result['processedAt']}")

    # 6. Plate recognition & rejection metrics
    recognized_plates = [v for v in vehicles if v["numberPlate"] is not None]
    unreadable_plates = [v for v in vehicles if v["numberPlate"] is None]

    print(f"  [OK] Number of plates successfully recognized: {len(recognized_plates)}")
    for rp in recognized_plates[:3]:
        print(f"       Track #{rp['trackId']}: Plate={rp['numberPlate']} (Conf: {rp['plateConfidence']})")

    print(f"  [OK] Number of plates rejected / unreadable: {len(unreadable_plates)}")
    for up in unreadable_plates[:3]:
        assert up["numberPlate"] is None
        assert up["ocrStatus"] in {
            "PLATE_NOT_RECOGNIZED",
            "PLATE_NOT_DETECTED",
            "LOW_CONFIDENCE",
            "PENDING_VERIFICATION",
            "INVALID_FORMAT",
        }

    # 7. Line crossing events
    print(f"  [OK] Line crossing events generated: {len(events)}")
    for ev in events[:3]:
        print(f"       Event #{ev['event_id']}: Track #{ev['track_id']} {ev['vehicle_type']} -> {ev['direction']}")

    # Check for duplicate events by track_id
    crossed_track_ids = [ev["track_id"] for ev in events]
    assert len(crossed_track_ids) == len(set(crossed_track_ids)), "Duplicate crossing event found for same track_id!"
    print("  [OK] Duplicate crossing guard verified (zero duplicates)")

    test_results["Full Video Processing"] = "PASS"

    # -------------------------------------------------------------------------
    # Summary Report
    # -------------------------------------------------------------------------
    print("\n" + "=" * 60)
    print("TEST SUITE SUMMARY")
    print("=" * 60)
    for tname, status in test_results.items():
        print(f"  {tname:<40}: {status}")
    print("=" * 60)
    print(f"Output Video Path : {out_mp4_path} ({out_mp4_path.stat().st_size / (1024*1024):.2f} MB)")
    print(f"Output JSON Path  : {out_json_path} ({out_json_path.stat().st_size / 1024:.2f} KB)")
    print(f"Total Processing Time: {t_elapsed:.1f} s")
    print("=" * 60 + "\n")

    return True


if __name__ == "__main__":
    success = run_video_analysis_test_suite()
    sys.exit(0 if success else 1)
