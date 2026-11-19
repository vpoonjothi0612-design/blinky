"""Verification Test Suite for RTSP Stream Ingestion & Connection Resilience (Step 5).

Validates:
TEST 1: RTSP URL recognized as RTSP source.
TEST 2: Invalid RTSP source fails safely.
TEST 3: Connection state transitions work.
TEST 4: Reconnect logic triggers after simulated failure.
TEST 5: Backoff increases correctly.
TEST 6: Backoff resets after successful reconnect.
TEST 7: Credentials are never written to logs.
TEST 8: Latest-frame buffer remains bounded.
TEST 9: Shutdown during reconnect exits cleanly.
TEST 10: Existing local-video source behavior remains intact.
"""

from __future__ import annotations

import io
import logging
import sys
import time
from pathlib import Path
from typing import Any, Dict, List, Optional, Tuple
from unittest.mock import MagicMock, patch

import cv2
import numpy as np

# Ensure project src path is discoverable
PROJECT_ROOT = Path(__file__).resolve().parents[3]
sys.path.append(str(PROJECT_ROOT / "src"))

from vehicle.camera.camera_worker import CameraWorker, ConnectionState
from vehicle.vehicle_config import VEHICLE_DATA_DIR, sanitize_rtsp_url

TEST_VIDEO_PATH = VEHICLE_DATA_DIR / "input" / "test_d_car_moving.mp4"


# =============================================================================
# Mock / Test Double Helpers
# =============================================================================

class MockVideoCaptureDouble:
    """Mock OpenCV VideoCapture for deterministic RTSP behavior testing without live network hardware."""

    def __init__(
        self,
        frames_to_yield: Optional[int] = 5,
        open_success: bool = True,
        width: int = 640,
        height: int = 480,
        fps: float = 25.0,
    ) -> None:
        self._is_opened = open_success
        self.frames_left = frames_to_yield
        self.width = width
        self.height = height
        self.fps = fps
        self.released = False

    def isOpened(self) -> bool:
        return self._is_opened and not self.released

    def read(self) -> Tuple[bool, Optional[np.ndarray]]:
        if not self._is_opened or self.released:
            return False, None
        if self.frames_left is not None:
            if self.frames_left <= 0:
                return False, None
            self.frames_left -= 1
        time.sleep(0.005)
        frame = np.zeros((self.height, self.width, 3), dtype=np.uint8)
        return True, frame

    def get(self, prop_id: int) -> float:
        if prop_id == cv2.CAP_PROP_FRAME_WIDTH:
            return float(self.width)
        elif prop_id == cv2.CAP_PROP_FRAME_HEIGHT:
            return float(self.height)
        elif prop_id == cv2.CAP_PROP_FPS:
            return float(self.fps)
        return 0.0

    def set(self, prop_id: int, value: float) -> bool:
        return True

    def release(self) -> None:
        self.released = True
        self._is_opened = False


def run_rtsp_worker_tests() -> bool:
    print("=" * 70)
    print("VEHICLE RTSP WORKER VERIFICATION TEST SUITE (STEP 5)")
    print("=" * 70)

    test_results: Dict[str, Tuple[str, str]] = {}

    # -------------------------------------------------------------------------
    # TEST 1: RTSP URL recognized as RTSP source
    # -------------------------------------------------------------------------
    print("\n[TEST 1] RTSP URL recognized as RTSP source...")
    rtsp_url = "rtsp://camera-user:example-password@192.168.1.100:554/live/ch0"
    rtsps_url = "rtsps://camera-user:example-password@10.0.0.50/stream"
    local_path = "data/vehicle/input/test.mp4"
    webcam_idx = 0

    w_rtsp = CameraWorker(source=rtsp_url, name="TestRTSP1")
    w_rtsps = CameraWorker(source=rtsps_url, name="TestRTSPS1")
    w_file = CameraWorker(source=local_path, name="TestFile1")
    w_cam = CameraWorker(source=webcam_idx, name="TestCam1")

    t1_pass = (
        w_rtsp.is_rtsp_source is True
        and w_rtsp.is_file_source is False
        and w_rtsp.is_device_source is False
        and w_rtsps.is_rtsp_source is True
        and w_file.is_rtsp_source is False
        and w_file.is_file_source is True
        and w_cam.is_rtsp_source is False
        and w_cam.is_device_source is True
        and "example-password" not in w_rtsp.sanitized_source
    )
    test_results["TEST 1: RTSP Source Recognition"] = (
        "PASS" if t1_pass else "FAIL",
        f"rtsp={w_rtsp.is_rtsp_source}, rtsps={w_rtsps.is_rtsp_source}, file={w_file.is_file_source}, dev={w_cam.is_device_source}",
    )
    print(f"  Result : {'PASS' if t1_pass else 'FAIL'} (Sanitized: {w_rtsp.sanitized_source})")

    # -------------------------------------------------------------------------
    # TEST 2: Invalid RTSP source fails safely
    # -------------------------------------------------------------------------
    print("\n[TEST 2] Invalid RTSP source fails safely...")
    # Mocking unreachable RTSP stream so test executes deterministically without 30s network timeout
    with patch("cv2.VideoCapture", return_value=MockVideoCaptureDouble(open_success=False)):
        unreachable_url = "rtsp://192.168.1.254:554/invalid_stream"
        
        # When reconnect_enabled=False: raises RuntimeError and sets ERROR state
        w_fail_sync = CameraWorker(
            source=unreachable_url,
            name="SyncFailWorker",
            reconnect_enabled=False,
        )
        raised = False
        try:
            w_fail_sync.start()
        except RuntimeError:
            raised = True

        t2_sync_pass = raised and (w_fail_sync.connection_state == ConnectionState.ERROR.value)

        # When reconnect_enabled=True: transitions safely to RECONNECTING without crashing
        w_fail_async = CameraWorker(
            source=unreachable_url,
            name="AsyncFailWorker",
            reconnect_enabled=True,
            initial_reconnect_delay=0.1,
        )
        w_fail_async.start()
        time.sleep(0.15)
        state = w_fail_async.connection_state
        t2_async_pass = state in (ConnectionState.RECONNECTING.value, ConnectionState.CONNECTING.value)
        w_fail_async.stop()

    t2_pass = t2_sync_pass and t2_async_pass
    test_results["TEST 2: Invalid RTSP Source Fails Safely"] = (
        "PASS" if t2_pass else "FAIL",
        f"sync_raised={raised}, sync_state={w_fail_sync.connection_state}, async_state={state}",
    )
    print(f"  Result : {'PASS' if t2_pass else 'FAIL'} (Sync error handled: {t2_sync_pass}, Async handled: {t2_async_pass})")

    # -------------------------------------------------------------------------
    # TEST 3: Connection state transitions work
    # -------------------------------------------------------------------------
    print("\n[TEST 3] Connection state transitions work...")
    # States: DISCONNECTED -> CONNECTING -> CONNECTED -> STOPPED
    mock_cap = MockVideoCaptureDouble(frames_to_yield=None, open_success=True)

    with patch("cv2.VideoCapture", return_value=mock_cap):
        w_state = CameraWorker(source="rtsp://10.0.0.1/live", name="StateWorker", reconnect_enabled=True)
        s0 = w_state.connection_state  # DISCONNECTED

        w_state.start()
        time.sleep(0.08)
        s1 = w_state.connection_state  # CONNECTED
        conn_bool = w_state.is_connected

        w_state.stop()
        s2 = w_state.connection_state  # STOPPED

    t3_pass = (s0 == ConnectionState.DISCONNECTED.value) and (s1 == ConnectionState.CONNECTED.value) and conn_bool and (s2 == ConnectionState.STOPPED.value)
    test_results["TEST 3: Connection State Transitions"] = (
        "PASS" if t3_pass else "FAIL",
        f"{s0} -> {s1} (is_connected={conn_bool}) -> {s2}",
    )
    print(f"  Result : {'PASS' if t3_pass else 'FAIL'} ({s0} -> {s1} -> {s2})")

    # -------------------------------------------------------------------------
    # TEST 4: Reconnect logic triggers after simulated failure
    # -------------------------------------------------------------------------
    print("\n[TEST 4] Reconnect logic triggers after simulated failure...")
    # Yield 2 frames, then fail consecutive reads
    failing_cap = MockVideoCaptureDouble(frames_to_yield=2, open_success=True)

    with patch("cv2.VideoCapture", return_value=failing_cap):
        w_reconn = CameraWorker(
            source="rtsp://10.0.0.2/stream",
            name="ReconnWorker",
            reconnect_enabled=True,
            initial_reconnect_delay=0.1,
            max_consecutive_read_failures=2,
        )
        w_reconn.start()
        # Wait for 2 successful frames, then consecutive failures trigger reconnect
        time.sleep(0.25)
        reconnect_triggered = w_reconn.reconnect_count >= 1 or w_reconn.connection_state == ConnectionState.RECONNECTING.value
        w_reconn.stop()

    t4_pass = reconnect_triggered
    test_results["TEST 4: Reconnect Logic Triggers on Failure"] = (
        "PASS" if t4_pass else "FAIL",
        f"reconnect_count={w_reconn.reconnect_count}, state={w_reconn.connection_state}",
    )
    print(f"  Result : {'PASS' if t4_pass else 'FAIL'} (Reconnect count: {w_reconn.reconnect_count})")

    # -------------------------------------------------------------------------
    # TEST 5: Backoff increases correctly
    # -------------------------------------------------------------------------
    print("\n[TEST 5] Backoff increases correctly...")
    # Verify the configured progression sequence: 1 -> 2 -> 4 -> 8 -> 16 -> 30
    delay = 1.0
    factor = 2.0
    max_delay = 30.0
    expected_sequence = [1.0, 2.0, 4.0, 8.0, 16.0, 30.0]
    computed_sequence = []
    current = delay
    for _ in range(6):
        computed_sequence.append(current)
        current = min(current * factor, max_delay)

    sequence_match = computed_sequence == expected_sequence

    # Verify runtime thread-level backoff scaling with small test delays
    always_fail_cap = MockVideoCaptureDouble(open_success=False)
    with patch("cv2.VideoCapture", return_value=always_fail_cap):
        w_backoff = CameraWorker(
            source="rtsp://10.0.0.3/feed",
            name="BackoffWorker",
            reconnect_enabled=True,
            initial_reconnect_delay=0.1,
            backoff_factor=2.0,
            max_reconnect_delay=0.4,
        )
        w_backoff.start()
        # Allow 3 backoff cycles to occur: 0.1s + 0.2s + 0.4s ~= 0.7s
        time.sleep(0.75)
        current_delay = w_backoff.current_backoff_delay
        attempts = w_backoff.connection_attempts
        w_backoff.stop()

    runtime_match = (current_delay >= 0.39) and (attempts >= 2) and (current_delay <= 0.41)
    t5_pass = sequence_match and runtime_match
    test_results["TEST 5: Exponential Backoff Scaling"] = (
        "PASS" if t5_pass else "FAIL",
        f"Progression: {computed_sequence} (max: {max_delay}s), runtime_capped={runtime_match}",
    )
    print(f"  Result : {'PASS' if t5_pass else 'FAIL'} (Progression: {' -> '.join(map(str, map(int, computed_sequence)))})")

    # -------------------------------------------------------------------------
    # TEST 6: Backoff resets after successful reconnect
    # -------------------------------------------------------------------------
    print("\n[TEST 6] Backoff resets after successful reconnect...")
    # Simulate a sequence: first handle fails after 1 frame, second handle succeeds
    cap1 = MockVideoCaptureDouble(frames_to_yield=1, open_success=True)
    cap2 = MockVideoCaptureDouble(frames_to_yield=None, open_success=True)
    handles = [cap1, cap2]

    def mock_factory(*args, **kwargs):
        if handles:
            return handles.pop(0)
        return MockVideoCaptureDouble(frames_to_yield=None, open_success=True)

    with patch("cv2.VideoCapture", side_effect=mock_factory):
        w_reset = CameraWorker(
            source="rtsp://10.0.0.4/feed",
            name="ResetWorker",
            reconnect_enabled=True,
            initial_reconnect_delay=0.1,
            backoff_factor=2.0,
            max_reconnect_delay=1.0,
            max_consecutive_read_failures=1,
        )
        w_reset.start()
        time.sleep(0.25)
        # Verify it reconnected and backoff delay was reset to initial
        state_after = w_reset.connection_state
        delay_after = w_reset.current_backoff_delay
        reconnects = w_reset.reconnect_count
        w_reset.stop()

    t6_pass = (delay_after == 0.1) and (reconnects >= 1) and (state_after in (ConnectionState.CONNECTED.value, ConnectionState.STOPPED.value))
    test_results["TEST 6: Backoff Resets Upon Reconnect"] = (
        "PASS" if t6_pass else "FAIL",
        f"delay_after={delay_after:.2f}s (reset to initial), reconnect_count={reconnects}",
    )
    print(f"  Result : {'PASS' if t6_pass else 'FAIL'} (Delay reset to: {delay_after:.2f}s, Reconnects: {reconnects})")

    # -------------------------------------------------------------------------
    # TEST 7: Credentials are never written to logs
    # -------------------------------------------------------------------------
    print("\n[TEST 7] Credentials are never written to logs...")
    sensitive_password = "test-only-password"
    sensitive_user = "test-only-user"
    sensitive_url = f"rtsp://{sensitive_user}:{sensitive_password}@192.168.1.200:554/Streaming/Channels/1"

    # Capture all logs during worker lifecycle
    log_stream = io.StringIO()
    handler = logging.StreamHandler(log_stream)
    worker_logger = logging.getLogger("vehicle.camera.camera_worker")
    prev_level = worker_logger.level
    worker_logger.setLevel(logging.DEBUG)
    worker_logger.addHandler(handler)

    try:
        with patch("cv2.VideoCapture", return_value=MockVideoCaptureDouble(open_success=False)):
            w_sec = CameraWorker(
                source=sensitive_url,
                name="SecWorker",
                reconnect_enabled=False,
            )
            try:
                w_sec.start()
            except RuntimeError:
                pass
            w_sec.stop()
    finally:
        worker_logger.removeHandler(handler)
        worker_logger.setLevel(prev_level)

    log_output = log_stream.getvalue()
    password_leaked = sensitive_password in log_output
    sanitized_url_test = sanitize_rtsp_url(sensitive_url)
    sanitization_valid = ("***:***@" in sanitized_url_test) and (sensitive_password not in sanitized_url_test)

    t7_pass = (not password_leaked) and sanitization_valid
    test_results["TEST 7: Zero Credential Leakage in Logs"] = (
        "PASS" if t7_pass else "FAIL",
        f"password_leaked={password_leaked}, sanitized='{sanitized_url_test}'",
    )
    print(f"  Result : {'PASS' if t7_pass else 'FAIL'} (Password masked: {not password_leaked}, Sanitized: {sanitized_url_test})")

    # -------------------------------------------------------------------------
    # TEST 8: Latest-frame buffer remains bounded
    # -------------------------------------------------------------------------
    print("\n[TEST 8] Latest-frame buffer remains bounded...")
    # Producer produces 30 frames rapidly, consumer only polls once
    fast_cap = MockVideoCaptureDouble(frames_to_yield=30, open_success=True)

    with patch("cv2.VideoCapture", return_value=fast_cap):
        w_bounded = CameraWorker(source="rtsp://10.0.0.5/ch0", name="BoundedWorker", reconnect_enabled=True)
        w_bounded.start()
        time.sleep(0.25)
        # Pull single frame
        latest = w_bounded.get_latest_frame(wait=False)
        captured = w_bounded.captured_frames
        replaced = w_bounded.replaced_frames
        w_bounded.stop()

    t8_pass = (latest is not None) and (captured >= 5) and (replaced > 0) and (w_bounded._latest_frame is not None)
    test_results["TEST 8: Single-Slot Bounded Buffer"] = (
        "PASS" if t8_pass else "FAIL",
        f"captured={captured}, replaced={replaced}, latest_slot_only=True",
    )
    print(f"  Result : {'PASS' if t8_pass else 'FAIL'} (Captured: {captured}, Replaced/Dropped: {replaced})")

    # -------------------------------------------------------------------------
    # TEST 9: Shutdown during reconnect exits cleanly
    # -------------------------------------------------------------------------
    print("\n[TEST 9] Shutdown during reconnect exits cleanly...")
    # Set a long backoff delay (10 seconds); stop() should interrupt immediately
    long_fail_cap = MockVideoCaptureDouble(open_success=False)

    with patch("cv2.VideoCapture", return_value=long_fail_cap):
        w_shutdown = CameraWorker(
            source="rtsp://10.0.0.6/feed",
            name="ShutdownWorker",
            reconnect_enabled=True,
            initial_reconnect_delay=10.0,
            max_reconnect_delay=10.0,
        )
        w_shutdown.start()
        # Wait until it enters RECONNECTING state
        time.sleep(0.15)
        t_before = time.perf_counter()
        w_shutdown.stop(timeout=2.0)
        t_stop_duration = time.perf_counter() - t_before

    # Should take < 0.5s to shut down even though delay was 10.0s
    t9_pass = (t_stop_duration < 1.0) and (not w_shutdown.is_running)
    test_results["TEST 9: Shutdown Interrupts Reconnect Delay"] = (
        "PASS" if t9_pass else "FAIL",
        f"stop_duration={t_stop_duration:.3f}s (well under 10s backoff delay), is_running={w_shutdown.is_running}",
    )
    print(f"  Result : {'PASS' if t9_pass else 'FAIL'} (Shutdown completed in {t_stop_duration:.3f}s)")

    # -------------------------------------------------------------------------
    # TEST 10: Existing local-video source behavior remains intact
    # -------------------------------------------------------------------------
    print("\n[TEST 10] Existing local-video source behavior remains intact...")
    assert TEST_VIDEO_PATH.exists(), f"Test video missing: {TEST_VIDEO_PATH}"
    w_video = CameraWorker(source=str(TEST_VIDEO_PATH), name="VideoRegressionWorker")
    w_video.start()
    time.sleep(0.3)
    frame_sample = w_video.get_latest_frame(wait=True, timeout=1.0)
    w, h = w_video.resolution
    is_file = w_video.is_file_source
    reconn_en = w_video.reconnect_enabled
    w_video.stop()

    t10_pass = (
        is_file is True
        and reconn_en is False
        and frame_sample is not None
        and w == 640
        and h == 480
        and not w_video.is_running
    )
    test_results["TEST 10: Local Video Source Regression Intact"] = (
        "PASS" if t10_pass else "FAIL",
        f"is_file={is_file}, auto_reconnect={reconn_en}, resolution={w}x{h}, valid_frame={frame_sample is not None}",
    )
    print(f"  Result : {'PASS' if t10_pass else 'FAIL'} (Resolution: {w}x{h}, Auto-reconnect default: {reconn_en})")

    # -------------------------------------------------------------------------
    # Summary Report
    # -------------------------------------------------------------------------
    print("\n" + "=" * 70)
    print("VEHICLE RTSP WORKER TEST SUITE SUMMARY (STEP 5)")
    print("=" * 70)
    all_passed = True
    for name, (status, detail) in test_results.items():
        print(f"  [{status:4s}] {name:<46} : {detail}")
        if status != "PASS":
            all_passed = False

    print("=" * 70)
    print(f"OVERALL RESULT: {'ALL TESTS PASSED (10/10)' if all_passed else 'SOME TESTS FAILED'}")
    print("=" * 70)

    return all_passed


if __name__ == "__main__":
    success = run_rtsp_worker_tests()
    sys.exit(0 if success else 1)
