"""Verification Test Suite for CameraWorker (Step 4).

Validates:
TEST 1: CameraWorker starts successfully.
TEST 2: CameraWorker captures frames.
TEST 3: CameraWorker stops cleanly.
TEST 4: Latest-frame behavior works.
TEST 5: Buffer does not grow without limit (single-slot latest-frame replacement).
TEST 12: Capture failure is handled safely (invalid source).
"""

from __future__ import annotations

import sys
import time
from pathlib import Path
from typing import Dict, Tuple

import cv2
import numpy as np

# Ensure project src path is discoverable
PROJECT_ROOT = Path(__file__).resolve().parents[3]
sys.path.append(str(PROJECT_ROOT / "src"))

from vehicle.camera.camera_worker import CameraWorker
from vehicle.vehicle_config import VEHICLE_DATA_DIR

TEST_VIDEO_PATH = VEHICLE_DATA_DIR / "input" / "test_d_car_moving.mp4"


def run_camera_worker_tests() -> bool:
    print("=" * 65)
    print("CAMERA WORKER VERIFICATION TEST SUITE (STEP 4)")
    print("=" * 65)

    test_results: Dict[str, Tuple[str, str]] = {}
    assert TEST_VIDEO_PATH.exists(), f"Test video not found: {TEST_VIDEO_PATH}"

    # -------------------------------------------------------------------------
    # TEST 1: CameraWorker starts successfully
    # -------------------------------------------------------------------------
    print("\n[TEST 1] CameraWorker starts successfully...")
    worker = CameraWorker(source=str(TEST_VIDEO_PATH), name="TestWorker1")
    worker.start()
    t1_running = worker.is_running
    w, h = worker.resolution
    t1_pass = t1_running and w > 0 and h > 0
    test_results["TEST 1: Worker Starts Successfully"] = (
        "PASS" if t1_pass else "FAIL",
        f"is_running={t1_running}, stream={w}x{h} @ {worker.stream_fps:.1f} FPS",
    )
    print(f"  Result : {'PASS' if t1_pass else 'FAIL'} (Running: {t1_running}, Stream: {w}x{h})")

    # -------------------------------------------------------------------------
    # TEST 2: CameraWorker captures frames
    # -------------------------------------------------------------------------
    print("\n[TEST 2] CameraWorker captures frames...")
    # Wait for frames to accumulate in background thread
    time.sleep(0.3)
    frame_data = worker.get_latest_frame(wait=True, timeout=1.0)
    t2_pass = False
    if frame_data is not None:
        frame, f_idx, ts = frame_data
        t2_pass = (
            frame is not None
            and isinstance(frame, np.ndarray)
            and frame.shape == (h, w, 3)
            and f_idx > 0
            and ts > 0
        )
    test_results["TEST 2: Captures Valid Frames"] = (
        "PASS" if t2_pass else "FAIL",
        f"captured_frames={worker.captured_frames}, frame_idx={frame_data[1] if frame_data else None}",
    )
    print(f"  Result : {'PASS' if t2_pass else 'FAIL'} (Captured: {worker.captured_frames} frames)")

    # -------------------------------------------------------------------------
    # TEST 4: Latest-frame behavior works
    # -------------------------------------------------------------------------
    print("\n[TEST 4] Latest-frame behavior works...")
    # Sleep to allow several frames to be captured
    time.sleep(0.2)
    sample_1 = worker.get_latest_frame(wait=False)
    time.sleep(0.2)
    sample_2 = worker.get_latest_frame(wait=False)

    t4_pass = (
        sample_1 is not None
        and sample_2 is not None
        and sample_2[1] > sample_1[1]  # Frame index monotonically advances
        and sample_2[2] >= sample_1[2]  # Timestamp advances
    )
    test_results["TEST 4: Latest-Frame Behavior"] = (
        "PASS" if t4_pass else "FAIL",
        f"Frame {sample_1[1] if sample_1 else None} -> Frame {sample_2[1] if sample_2 else None}",
    )
    print(f"  Result : {'PASS' if t4_pass else 'FAIL'} (Frame {sample_1[1] if sample_1 else None} -> Frame {sample_2[1] if sample_2 else None})")

    # -------------------------------------------------------------------------
    # TEST 5: Buffer does not grow without limit (single-slot replacement)
    # -------------------------------------------------------------------------
    print("\n[TEST 5] Buffer does not grow without limit...")
    # Leave consumer idle for 0.4s while camera thread continuously captures
    idle_sleep = 0.4
    time.sleep(idle_sleep)
    # Check that replaced/dropped frames incremented because consumer didn't pull
    replaced_count = worker.replaced_frames
    t5_pass = replaced_count > 0 and worker.captured_frames >= replaced_count
    test_results["TEST 5: Buffer Does Not Grow Unbounded"] = (
        "PASS" if t5_pass else "FAIL",
        f"Replaced frames: {replaced_count} / {worker.captured_frames} total (Single-slot memory maintained)",
    )
    print(f"  Result : {'PASS' if t5_pass else 'FAIL'} (Replaced frames: {replaced_count}, Captured: {worker.captured_frames})")

    # -------------------------------------------------------------------------
    # TEST 3: CameraWorker stops cleanly
    # -------------------------------------------------------------------------
    print("\n[TEST 3] CameraWorker stops cleanly...")
    worker.stop()
    t3_pass = (not worker.is_running) and (worker._cap is None)
    test_results["TEST 3: Clean Shutdown"] = (
        "PASS" if t3_pass else "FAIL",
        f"is_running={worker.is_running}, capture_handle_released={worker._cap is None}",
    )
    print(f"  Result : {'PASS' if t3_pass else 'FAIL'} (is_running: {worker.is_running}, handle released: {worker._cap is None})")

    # -------------------------------------------------------------------------
    # TEST 12: Capture failure handled safely
    # -------------------------------------------------------------------------
    print("\n[TEST 12] Capture failure is handled safely...")
    non_existent_source = "data/vehicle/input/non_existent_stream_xyz.mp4"
    faulty_worker = CameraWorker(source=non_existent_source, name="FaultyWorker")
    raised_expected = False
    try:
        faulty_worker.start()
    except RuntimeError:
        raised_expected = True

    t12_pass = raised_expected and not faulty_worker.is_running
    test_results["TEST 12: Capture Failure Handled Safely"] = (
        "PASS" if t12_pass else "FAIL",
        f"RuntimeError caught properly, is_running={faulty_worker.is_running}",
    )
    print(f"  Result : {'PASS' if t12_pass else 'FAIL'} (RuntimeError caught on invalid source, is_running: {faulty_worker.is_running})")

    # -------------------------------------------------------------------------
    # Summary Report
    # -------------------------------------------------------------------------
    print("\n" + "=" * 65)
    print("CAMERA WORKER TEST SUITE SUMMARY")
    print("=" * 65)
    all_passed = True
    for name, (status, detail) in test_results.items():
        print(f"  [{status:4s}] {name:<42} : {detail}")
        if status != "PASS":
            all_passed = False

    print("=" * 65)
    print(f"OVERALL RESULT: {'ALL TESTS PASSED (6/6)' if all_passed else 'SOME TESTS FAILED'}")
    print("=" * 65)

    return all_passed


if __name__ == "__main__":
    success = run_camera_worker_tests()
    sys.exit(0 if success else 1)
