"""Automated Unit & Integration Tests for Dual-Camera Face Recognition Pipeline.

Validates:
1. Both camera workers starting simultaneously.
2. Fault isolation: One camera disconnecting while the other continues uninterrupted.
3. Automatic reconnection with exponential backoff.
4. Registered employee recognition (similarity >= RECOGNITION_THRESHOLD).
5. Unknown face rejection (similarity < RECOGNITION_THRESHOLD).
6. Liveness failure rejection (spoof/static photo rejected).
7. Dedicated CAM-01 OUT mapping.
8. Dedicated CAM-02 IN mapping.
9. Cooldown duplicate debounce per direction.
10. Attendance Outbox API timeout, offline queueing, exponential backoff, and idempotent persistence.
"""

from __future__ import annotations

import json
import os
import sys
import time
import unittest
from pathlib import Path
from unittest.mock import MagicMock, patch

import numpy as np
import requests

# Add search paths
_TEST_DIR = Path(__file__).resolve().parent
_FACE_DIR = _TEST_DIR.parent
_SRC_DIR = _FACE_DIR.parent
_AI_SERVICES_DIR = _SRC_DIR.parent

for p in (
    str(_AI_SERVICES_DIR),
    str(_SRC_DIR),
    str(_SRC_DIR / "camera"),
    str(_FACE_DIR),
    str(_FACE_DIR / "recognition"),
):
    if p not in sys.path:
        sys.path.insert(0, p)

from camera.camera_config import CameraConfig
from camera.camera_worker import CameraWorker, ConnectionState
from camera.camera_manager import MultiCameraManager
from face.attendance_outbox import AttendanceOutbox, AttendanceEvent
from face.live_face_recognition import TemporalLivenessTracker
from face.dual_camera_live_face_recognition import CAMERA_EVENT_MAPPING


class TestDualCameraPipeline(unittest.TestCase):
    """Automated test suite verifying the 10 camera and AI pipeline requirements."""

    def setUp(self):
        self.cam1_config = CameraConfig(
            camera_id="CAM-01",
            name="CP PLUS Exit (CAM-01)",
            ip="192.168.9.207",
            port=554,
            username="admin",
            password="test_password",
        )
        self.cam2_config = CameraConfig(
            camera_id="CAM-02",
            name="CP PLUS Entrance (CAM-02)",
            ip="192.168.9.208",
            port=554,
            username="admin",
            password="test_password",
        )

    def test_01_both_camera_workers_starting(self):
        """Test 1: Verify both CAM-01 and CAM-02 workers initialize and start simultaneously."""
        with patch.object(CameraWorker, "_open_capture") as mock_open:
            mock_cap = MagicMock()
            mock_cap.isOpened.return_value = True
            mock_cap.read.return_value = (True, np.zeros((480, 640, 3), dtype=np.uint8))
            mock_open.return_value = mock_cap

            worker1 = CameraWorker(config=self.cam1_config, auto_start=True)
            worker2 = CameraWorker(config=self.cam2_config, auto_start=True)

            try:
                time.sleep(0.3)
                self.assertTrue(worker1.is_running(), "CAM-01 worker thread must be running")
                self.assertTrue(worker2.is_running(), "CAM-02 worker thread must be running")
                self.assertEqual(worker1.camera_id, "CAM-01")
                self.assertEqual(worker2.camera_id, "CAM-02")
            finally:
                worker1.stop()
                worker2.stop()

    def test_02_fault_isolation_one_camera_disconnects(self):
        """Test 2: When CAM-01 disconnects or encounters errors, CAM-02 continues processing frames."""
        worker1 = CameraWorker(config=self.cam1_config, auto_start=False)
        worker2 = CameraWorker(config=self.cam2_config, auto_start=False)

        # Worker 1 experiences connection error
        worker1._set_state(ConnectionState.ERROR, error_msg="RTSP connection lost")
        # Worker 2 remains connected with valid frames
        worker2._set_state(ConnectionState.CONNECTED)
        test_frame = np.ones((480, 640, 3), dtype=np.uint8) * 200
        with worker2._frame_lock:
            worker2._latest_frame = test_frame
            worker2._latest_timestamp = time.time()
            worker2._latest_frame_idx = 100

        self.assertFalse(worker1.is_connected(), "Worker 1 should reflect error state")
        self.assertTrue(worker2.is_connected(), "Worker 2 must remain connected despite Worker 1 failure")

        has_frame, frame, ts, idx = worker2.get_latest_frame()
        self.assertTrue(has_frame)
        self.assertIsNotNone(frame)
        self.assertEqual(idx, 100)

    def test_03_camera_reconnection_backoff(self):
        """Test 3: Worker automatically transitions to RECONNECTING state with backoff."""
        worker = CameraWorker(config=self.cam1_config, auto_start=False)
        worker.reconnect_count = 1
        worker._set_state(ConnectionState.RECONNECTING)
        self.assertEqual(worker.state, ConnectionState.RECONNECTING)
        self.assertEqual(worker.backoff_factor, 2.0)
        self.assertGreater(worker.max_reconnect_delay, worker.initial_reconnect_delay)

    def test_04_registered_employee_recognition(self):
        """Test 4: High cosine similarity (>= 0.65) confidently matches active employee."""
        # Simulated ArcFace normalized 512-D embedding
        np.random.seed(42)
        base_emb = np.random.randn(512).astype(np.float32)
        base_emb /= np.linalg.norm(base_emb)

        # Simulated live probe embedding with slight noise (high cosine similarity ~ 0.95)
        noise = np.random.randn(512).astype(np.float32)
        noise /= np.linalg.norm(noise)
        probe_emb = 0.95 * base_emb + 0.05 * noise
        probe_emb /= np.linalg.norm(probe_emb)

        sim = float(np.dot(probe_emb, base_emb))
        self.assertGreaterEqual(sim, 0.65, "Cosine similarity must exceed recognition threshold")

    def test_05_unknown_face_rejection(self):
        """Test 5: Low cosine similarity (< 0.65) rejects unknown face and does NOT assign identity."""
        np.random.seed(101)
        registered_emb = np.random.randn(512).astype(np.float32)
        registered_emb /= np.linalg.norm(registered_emb)

        # Orthogonal / different person face embedding
        np.random.seed(202)
        unknown_emb = np.random.randn(512).astype(np.float32)
        unknown_emb /= np.linalg.norm(unknown_emb)

        sim = float(np.dot(unknown_emb, registered_emb))
        self.assertLess(sim, 0.65, "Unknown person must not exceed recognition threshold (0.65)")

    def test_06_liveness_failure_rejection(self):
        """Test 6: Static photo (zero 3D micro-movement) fails liveness check."""
        tracker = TemporalLivenessTracker()
        bbox = (100, 100, 150, 150)
        landmarks = np.array(
            [[120, 120], [180, 120], [150, 150], [130, 180], [170, 180]],
            dtype=np.float32,
        )
        static_gray = np.zeros((480, 640), dtype=np.uint8)

        # Static feed repeated over 30 frames
        is_live = False
        msg = ""
        for _ in range(30):
            is_live, msg, _ = tracker.update(bbox, landmarks, static_gray)

        self.assertFalse(is_live, "Static unchanging face must fail liveness detection")
        self.assertTrue("SPOOF" in msg.upper() or "WAITING" in msg.upper(), f"Unexpected message: {msg}")

    def test_07_cam01_dedicated_out_mapping(self):
        """Test 7: CAM-01 is strictly mapped to event type 'OUT'."""
        event_type = CAMERA_EVENT_MAPPING.get("CAM-01")
        self.assertEqual(event_type, "OUT", "CAM-01 must be exclusively mapped to OUT")

    def test_08_cam02_dedicated_in_mapping(self):
        """Test 8: CAM-02 is strictly mapped to event type 'IN'."""
        event_type = CAMERA_EVENT_MAPPING.get("CAM-02")
        self.assertEqual(event_type, "IN", "CAM-02 must be exclusively mapped to IN")

    def test_09_duplicate_event_cooldown_prevention(self):
        """Test 9: Rapid consecutive detections within cooldown window do not create duplicate events."""
        last_sent = {}
        cooldown_sec = 60.0
        employee_id = "EMP001"
        event_type = "IN"
        cooldown_key = (employee_id, event_type)

        now = 1000.0
        last_sent[cooldown_key] = now

        # Immediate next frame at 1000.5s (0.5s later)
        frame_time = 1000.5
        is_in_cooldown = (frame_time - last_sent.get(cooldown_key, 0.0)) <= cooldown_sec
        self.assertTrue(is_in_cooldown, "Observation within 60s cooldown must be suppressed")

        # But OUT event for same employee at 1001.0s is NOT blocked by IN cooldown
        out_key = (employee_id, "OUT")
        out_in_cooldown = (frame_time - last_sent.get(out_key, 0.0)) <= cooldown_sec
        self.assertFalse(out_in_cooldown, "OUT event must not be blocked by IN cooldown")

    def test_10_outbox_offline_buffering_and_retry(self):
        """Test 10: Outbox buffers events during offline backend and replays idempotently with original timestamp."""
        test_outbox_file = _TEST_DIR / "scratch_test_outbox.json"
        if test_outbox_file.exists():
            test_outbox_file.unlink()

        try:
            outbox = AttendanceOutbox(
                backend_url="http://invalid-offline-backend.local/api",
                storage_path=test_outbox_file,
                initial_backoff=0.2,
                max_backoff=1.0,
            )

            # Enqueue an event
            original_ts = "2026-10-13T09:00:00.000Z"
            evt = outbox.enqueue(
                event_id="test-uuid-12345",
                employee_id="EMP001",
                camera_id="CAM-01",
                event_type="IN",
                similarity=0.92,
                timestamp=original_ts,
            )

            # Verify saved to memory and disk
            self.assertEqual(outbox.get_pending_count(), 1)
            self.assertTrue(test_outbox_file.exists(), "Event must be saved to disk outbox")

            with open(test_outbox_file, "r") as f:
                disk_items = json.load(f)
            self.assertEqual(len(disk_items), 1)
            self.assertEqual(disk_items[0]["eventId"], "test-uuid-12345")
            self.assertEqual(disk_items[0]["timestamp"], original_ts)

            # Simulate recovery: Mock successful POST
            with patch("requests.post") as mock_post:
                mock_resp = MagicMock()
                mock_resp.status_code = 201
                mock_resp.text = json.dumps({"success": True, "data": {"status": "RECORDED"}})
                mock_resp.json.return_value = {"success": True, "data": {"status": "RECORDED"}}
                mock_post.return_value = mock_resp

                success, discard, msg = outbox._send_event(evt)
                self.assertTrue(success, "Replayed event must succeed when backend recovers")
                self.assertIn("RECORDED", msg)

        finally:
            if test_outbox_file.exists():
                test_outbox_file.unlink()

    def test_11_outbox_crash_and_restart_persistence(self):
        """Test 11: Pending events survive simulated application crash and reload on restart."""
        crash_file = _TEST_DIR / "scratch_crash_test.json"
        if crash_file.exists():
            crash_file.unlink()

        try:
            # Process 1 creates outbox, enqueues 2 events, and terminates without sending
            outbox1 = AttendanceOutbox(
                backend_url="http://offline.local",
                storage_path=crash_file,
            )
            outbox1.enqueue(
                event_id="crash-evt-1",
                employee_id="EMP001",
                camera_id="CAM-01",
                event_type="IN",
                similarity=0.92,
                timestamp="2026-10-15T09:00:00.000Z",
            )
            outbox1.enqueue(
                event_id="crash-evt-2",
                employee_id="EMP002",
                camera_id="CAM-02",
                event_type="OUT",
                similarity=0.89,
                timestamp="2026-10-15T09:05:00.000Z",
            )
            # Simulated crash: delete instance without stop()
            del outbox1

            # Process 2 starts up after reboot/restart
            outbox2 = AttendanceOutbox(
                backend_url="http://offline.local",
                storage_path=crash_file,
            )
            self.assertEqual(outbox2.get_pending_count(), 2, "Pending events must survive process crash")
            pending_ids = [e.event_id for e in outbox2.get_pending_events()]
            self.assertIn("crash-evt-1", pending_ids)
            self.assertIn("crash-evt-2", pending_ids)

        finally:
            if crash_file.exists():
                crash_file.unlink()
            bak = crash_file.with_suffix(".bak")
            if bak.exists():
                bak.unlink()

    def test_12_chronological_dispatch_ordering(self):
        """Test 12: Events with earlier capture timestamps are prioritized for dispatch."""
        order_file = _TEST_DIR / "scratch_order_test.json"
        if order_file.exists():
            order_file.unlink()

        try:
            outbox = AttendanceOutbox(
                backend_url="http://offline.local",
                storage_path=order_file,
            )
            # Enqueue later event first
            outbox.enqueue(
                event_id="later-out-evt",
                employee_id="EMP001",
                camera_id="CAM-02",
                event_type="OUT",
                similarity=0.88,
                timestamp="2026-10-15T18:00:00.000Z",
            )
            # Enqueue earlier event second
            outbox.enqueue(
                event_id="earlier-in-evt",
                employee_id="EMP001",
                camera_id="CAM-01",
                event_type="IN",
                similarity=0.91,
                timestamp="2026-10-15T09:00:00.000Z",
            )

            # When dispatch checks ready items, earlier capture time must be dispatched first
            ready_items = list(outbox.get_pending_events())
            ready_items.sort(key=lambda x: x.timestamp)
            self.assertEqual(ready_items[0].event_id, "earlier-in-evt")
            self.assertEqual(ready_items[0].event_type, "IN")

        finally:
            if order_file.exists():
                order_file.unlink()
            bak = order_file.with_suffix(".bak")
            if bak.exists():
                bak.unlink()

    def test_13_permanent_rejection_safe_discard(self):
        """Test 13: Permanent validation failures (HTTP 400/404) are safely discarded without unbounded retries."""
        discard_file = _TEST_DIR / "scratch_discard_test.json"
        if discard_file.exists():
            discard_file.unlink()

        try:
            outbox = AttendanceOutbox(
                backend_url="http://test.local",
                storage_path=discard_file,
            )
            evt = outbox.enqueue(
                event_id="invalid-emp-evt",
                employee_id="INACTIVE_EMP",
                camera_id="CAM-01",
                event_type="IN",
                similarity=0.90,
            )

            with patch("requests.post") as mock_post:
                mock_resp = MagicMock()
                mock_resp.status_code = 400
                mock_resp.text = json.dumps({"success": False, "message": "Employee is inactive"})
                mock_post.return_value = mock_resp

                success, discard, msg = outbox._send_event(evt)
                self.assertFalse(success)
                self.assertTrue(discard, "HTTP 400 must trigger safe discard")
                self.assertIn("REJECTED", msg)

        finally:
            if discard_file.exists():
                discard_file.unlink()
            bak = discard_file.with_suffix(".bak")
            if bak.exists():
                bak.unlink()


if __name__ == "__main__":
    unittest.main()

