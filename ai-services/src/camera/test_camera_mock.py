"""Mocked Unit & Integration Tests for Camera Integration.

CLEAR DISTINCTION:
These tests use MOCKED OpenCV VideoCapture objects and simulated network conditions.
They test RTSP URL encoding, credential masking, timeout detection, exponential backoff
reconnection, and multi-camera fault isolation WITHOUT contacting the physical CP PLUS cameras.
"""

from __future__ import annotations

import os
import sys
import time
import unittest
from pathlib import Path
from unittest.mock import MagicMock, patch

import numpy as np

# Setup paths
_CAMERA_DIR = Path(__file__).resolve().parent
_SRC_DIR = _CAMERA_DIR.parent
_AI_SERVICES_DIR = _SRC_DIR.parent

for p in (str(_SRC_DIR), str(_AI_SERVICES_DIR)):
    if p not in sys.path:
        sys.path.insert(0, p)

from camera.camera_config import (
    CameraConfig,
    sanitize_rtsp_url,
    load_camera_config_from_env,
)
from camera.camera_worker import CameraWorker, ConnectionState
from camera.camera_manager import MultiCameraManager


class TestCameraConfigAndUrlSafety(unittest.TestCase):
    """Verifies URL encoding, credential sanitization, and configuration."""

    def test_special_characters_password_encoding(self):
        """Ensures passwords containing '@', ':', '/' are properly URL-encoded."""
        cfg = CameraConfig(
            camera_id="CAM-01",
            name="Test Cam",
            ip="192.168.9.207",
            port=554,
            username="operator",
            password="mock@password",
            channel=1,
            subtype=1,
            scheme="rtsp",
            custom_path="/cam/realmonitor?channel=1&subtype=1",
        )

        raw_url = cfg.get_rtsp_url(sanitize=False, encode_credentials=True)
        # '@' in password must be encoded to '%40' so parser does not confuse it with host delimiter
        self.assertIn("mock%40password", raw_url)
        self.assertEqual(raw_url, "rtsp://operator:mock%40password@192.168.9.207:554/cam/realmonitor?channel=1&subtype=1")

    def test_sanitized_url_masks_password(self):
        """Verifies passwords are never exposed in sanitized URLs."""
        cfg = CameraConfig(
            camera_id="CAM-01",
            name="Test Cam",
            ip="192.168.9.207",
            port=554,
            username="operator",
            password="mock@password",
        )

        sanitized = cfg.sanitized_url
        self.assertNotIn("mock@password", sanitized)
        self.assertNotIn("mock%40password", sanitized)
        self.assertIn("operator:***@192.168.9.207", sanitized)

    def test_sanitize_rtsp_url_utility(self):
        """Checks generic URL string sanitization."""
        url = "rtsp://camera-user:example-password@192.168.9.208:554/cam/realmonitor?channel=1&subtype=1"
        safe = sanitize_rtsp_url(url)
        self.assertEqual(
            safe,
            "rtsp://camera-user:***@192.168.9.208:554/cam/realmonitor?channel=1&subtype=1",
        )
        self.assertNotIn("example-password", safe)

    def test_env_loader_mapping(self):
        """Verifies loading CameraConfig from environment variables."""
        with patch.dict(os.environ, {
            "CAMERA_1_IP": "192.168.9.207",
            "CAMERA_1_USERNAME": "operator",
            "CAMERA_1_PASSWORD": "mock@password",
            "CAMERA_1_RTSP_PORT": "554",
            "CAMERA_1_STREAM_SUBTYPE": "1",
            "CAMERA_1_CHANNEL": "1",
        }):
            cfg = load_camera_config_from_env(1)
            self.assertIsNotNone(cfg)
            self.assertEqual(cfg.camera_id, "CAM-01")
            self.assertEqual(cfg.ip, "192.168.9.207")
            self.assertEqual(cfg.username, "operator")
            self.assertEqual(cfg.password, "mock@password")
            self.assertEqual(cfg.port, 554)
            self.assertEqual(cfg.subtype, 1)


class TestCameraWorkerMockedLifecycle(unittest.TestCase):
    """Mocks OpenCV VideoCapture to verify CameraWorker state machine & resilience."""

    def setUp(self):
        self.mock_frame = np.zeros((480, 640, 3), dtype=np.uint8)

    @patch("camera.camera_worker.cv2.VideoCapture")
    def test_successful_capture_and_frame_retrieval(self, mock_cv2_capture):
        """Tests standard connection and frame acquisition."""
        mock_cap_instance = MagicMock()
        mock_cap_instance.isOpened.return_value = True
        mock_cap_instance.read.return_value = (True, self.mock_frame.copy())
        mock_cv2_capture.return_value = mock_cap_instance

        cfg = CameraConfig(
            camera_id="CAM-01",
            name="Mock Cam",
            ip="192.168.9.207",
            password="test",
        )

        worker = CameraWorker(config=cfg, auto_start=True)
        try:
            # Wait briefly for background thread to initialize
            time.sleep(0.3)
            self.assertTrue(worker.is_connected())
            self.assertEqual(worker.state, ConnectionState.CONNECTED)

            has_frame, frame, ts, f_idx = worker.get_latest_frame()
            self.assertTrue(has_frame)
            self.assertIsNotNone(frame)
            self.assertEqual(frame.shape, (480, 640, 3))
            self.assertGreater(f_idx, 0)
        finally:
            worker.stop()
            self.assertEqual(worker.state, ConnectionState.STOPPED)

    def test_connection_probe_reports_decoded_frame_metrics(self):
        cfg = CameraConfig(camera_id="CAM-01", name="Mock Cam", ip="192.168.9.207", password="mock-password")
        worker = CameraWorker(config=cfg)
        capture = MagicMock()
        capture.read.return_value = (True, self.mock_frame.copy())
        capture.get.return_value = 25.0

        with patch.object(worker, "_open_capture", return_value=capture):
            result = worker.test_connection(sample_duration_sec=0)

        self.assertTrue(result["success"])
        self.assertEqual(result["state"], "CONNECTED")
        self.assertEqual(result["decode_status"], "PASS")
        self.assertEqual(result["resolution"], "640x480")
        self.assertEqual(result["frames_decoded"], 1)
        self.assertEqual(result["reported_fps"], 25.0)
        self.assertNotIn("mock-password", str(result))
        self.assertNotIn("password", result)
        capture.release.assert_called_once()

    def test_connection_probe_fails_when_stream_does_not_decode(self):
        cfg = CameraConfig(camera_id="CAM-01", name="Mock Cam", ip="192.168.9.207")
        worker = CameraWorker(config=cfg)
        capture = MagicMock()
        capture.read.return_value = (False, None)

        with patch.object(worker, "_open_capture", return_value=capture):
            result = worker.test_connection(sample_duration_sec=0)

        self.assertFalse(result["success"])
        self.assertEqual(result["state"], "ERROR")
        self.assertEqual(result["decode_status"], "FAIL")
        capture.release.assert_called_once()

    def test_camera_config_does_not_default_to_a_login(self):
        cfg = CameraConfig(camera_id="CAM-01", name="Mock Cam", ip="192.168.9.207")

        self.assertEqual(cfg.username, "")
        self.assertNotIn("@", cfg.get_rtsp_url())

    @patch("camera.camera_worker.cv2.VideoCapture")
    def test_reconnection_on_read_failure(self, mock_cv2_capture):
        """Tests that read timeouts trigger reconnection with backoff."""
        mock_cap_instance = MagicMock()
        mock_cap_instance.isOpened.return_value = True
        # First read succeeds (probe), subsequent reads return (False, None)
        call_count = [0]
        def mock_read():
            call_count[0] += 1
            if call_count[0] == 1:
                return (True, self.mock_frame.copy())
            return (False, None)

        mock_cap_instance.read.side_effect = mock_read
        mock_cv2_capture.return_value = mock_cap_instance

        cfg = CameraConfig(
            camera_id="CAM-01",
            name="Mock Cam",
            ip="192.168.9.207",
            password="test",
            read_timeout_sec=0.2,       # Fast timeout for test
            reconnect_initial_delay=0.1,
            reconnect_backoff_factor=1.5,
        )

        worker = CameraWorker(config=cfg, auto_start=True)
        try:
            time.sleep(0.5)
            # Reconnection should have been triggered
            self.assertGreater(worker.reconnect_count, 0)
        finally:
            worker.stop()
            self.assertEqual(worker.state, ConnectionState.STOPPED)


class TestMultiCameraManagerMockedIsolation(unittest.TestCase):
    """Verifies that failure in one camera stream does not affect other camera streams."""

    @patch("camera.camera_worker.cv2.VideoCapture")
    def test_camera_fault_isolation(self, mock_cv2_capture):
        """CAM-01 succeeds while CAM-02 fails; CAM-01 remains fully operational."""
        dummy_frame = np.zeros((360, 640, 3), dtype=np.uint8)

        def mock_capture_factory(source, *args, **kwargs):
            mock_cap = MagicMock()
            if "192.168.9.207" in str(source):
                # CAM-01 is healthy
                mock_cap.isOpened.return_value = True
                mock_cap.read.return_value = (True, dummy_frame)
            else:
                # CAM-02 fails connection
                mock_cap.isOpened.return_value = False
                mock_cap.read.return_value = (False, None)
            return mock_cap

        mock_cv2_capture.side_effect = mock_capture_factory

        cfg1 = CameraConfig(camera_id="CAM-01", name="Exit", ip="192.168.9.207")
        cfg2 = CameraConfig(camera_id="CAM-02", name="Entrance", ip="192.168.9.208")

        with patch("camera.camera_manager.get_available_camera_configs", return_value={"CAM-01": cfg1, "CAM-02": cfg2}):
            manager = MultiCameraManager(["CAM-01", "CAM-02"], auto_start=True)
            try:
                time.sleep(0.4)

                w1 = manager.get_worker("CAM-01")
                w2 = manager.get_worker("CAM-02")

                self.assertIsNotNone(w1)
                self.assertIsNotNone(w2)

                # CAM-01 must be CONNECTED
                self.assertTrue(w1.is_connected())
                has_frame, frame, _, _ = w1.get_latest_frame()
                self.assertTrue(has_frame)

                # CAM-02 must be attempting reconnection without crashing CAM-01
                self.assertFalse(w2.is_connected())

                # Operational camera list isolates the healthy camera
                operational = manager.get_operational_cameras()
                self.assertIn("CAM-01", operational)
                self.assertNotIn("CAM-02", operational)

            finally:
                manager.stop_all()


if __name__ == "__main__":
    print("\n=======================================================")
    print("RUNNING MOCKED UNIT & INTEGRATION TESTS (CAMERA MODULE)")
    print("=======================================================\n")
    unittest.main(verbosity=2)
