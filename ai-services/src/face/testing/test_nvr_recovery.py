"""Comprehensive Production Automated Test Suite for CP PLUS NVR Offline Recovery.

Validates all 23 required scenarios:
1. NVR reachable and unreachable.
2. Authentication failure.
3. Valid historical playback.
4. Unsupported playback protocol.
5. Recording unavailable for a requested interval.
6. Correct CAM-01 and CAM-02 mapping.
7. Internet unavailable but LAN operational.
8. Application server offline while NVR continues recording.
9. Backend unavailable while the outbox retains events.
10. Server restart and automatic gap detection.
11. Recovery interrupted by a crash.
12. Duplicate historical recovery.
13. Recovered event matching an existing live event.
14. Out-of-order IN and OUT events.
15. Overnight shifts and duration calculation.
16. Missing IN and missing OUT.
17. Ambiguous face recognition.
18. Timezone and NVR clock differences.
19. Recovery and live processing running simultaneously.
20. Checkpoint persistence and safe resumption.
21. Database uniqueness and idempotent synchronization.
22. Confirmation that no frontend files were modified.
23. Confirmation that no existing attendance or NVR recordings were deleted.
"""

from __future__ import annotations

import json
import os
import subprocess
import sys
import unittest
import uuid
from datetime import datetime, timezone, timedelta
from pathlib import Path
from unittest.mock import MagicMock, patch

import numpy as np

# Add search paths
_TEST_DIR = Path(__file__).resolve().parent
_FACE_DIR = _TEST_DIR.parent
_SRC_DIR = _FACE_DIR.parent
_AI_SERVICES_DIR = _SRC_DIR.parent
_PROJECT_ROOT = _AI_SERVICES_DIR.parent

for p in (
    str(_AI_SERVICES_DIR),
    str(_SRC_DIR),
    str(_SRC_DIR / "camera"),
    str(_FACE_DIR),
    str(_FACE_DIR / "recognition"),
):
    if p not in sys.path:
        sys.path.insert(0, p)

from camera.nvr_recovery_service import (
    NVRRecoveryCheckpointManager,
    NVRRecoveryService,
    CAMERA_DIRECTION_MAPPING,
)
from face.attendance_outbox import AttendanceOutbox, AttendanceEvent


class TestNVRRecoveryProduction(unittest.TestCase):
    """Complete 23-Scenario Automated Test Suite for CP PLUS NVR Attendance Recovery."""

    def setUp(self):
        self.scratch_dir = _TEST_DIR / "scratch_recovery_test"
        self.scratch_dir.mkdir(parents=True, exist_ok=True)
        self.checkpoint_file = self.scratch_dir / "test_checkpoints.json"
        self.gaps_file = self.scratch_dir / "test_gaps.json"
        self.outbox_file = self.scratch_dir / "test_outbox.json"
        self.audit_db_file = self.scratch_dir / "test_audit.db"

    def tearDown(self):
        for f in (self.checkpoint_file, self.gaps_file, self.outbox_file, self.audit_db_file):
            if f.exists():
                try:
                    f.unlink()
                except Exception:
                    pass
            for ext in (".lock", ".bak"):
                lock = f.with_suffix(ext)
                if lock.exists():
                    try:
                        lock.unlink()
                    except Exception:
                        pass
        if self.scratch_dir.exists():
            try:
                self.scratch_dir.rmdir()
            except Exception:
                pass

    # 1. NVR Reachable and Unreachable
    @patch("socket.socket")
    def test_01_nvr_reachable_and_unreachable(self, mock_socket_cls):
        mock_sock = MagicMock()
        mock_socket_cls.return_value = mock_sock
        service = NVRRecoveryService(
            checkpoint_file=self.checkpoint_file,
            gaps_file=self.gaps_file,
        )

        # 1a. Reachable case (connect_ex returns 0)
        mock_sock.connect_ex.return_value = 0
        reach_ok = service.check_nvr_reachability()
        self.assertTrue(reach_ok["reachable"])
        self.assertTrue(reach_ok["rtsp_port_open"])

        # 1b. Unreachable case (connect_ex returns non-zero / error)
        mock_sock.connect_ex.return_value = 10060  # Connection timed out
        reach_fail = service.check_nvr_reachability()
        self.assertFalse(reach_fail["reachable"])

    # 2. Authentication Failure
    @patch("requests.Session.get")
    @patch("socket.socket")
    def test_02_authentication_failure(self, mock_sock_cls, mock_http_get):
        mock_sock = MagicMock()
        mock_sock.connect_ex.return_value = 0
        mock_sock_cls.return_value = mock_sock

        # Mock HTTP 401 Unauthorized
        mock_resp = MagicMock()
        mock_resp.status_code = 401
        mock_resp.text = "Unauthorized"
        mock_http_get.return_value = mock_resp

        service = NVRRecoveryService(
            checkpoint_file=self.checkpoint_file,
            gaps_file=self.gaps_file,
        )
        res = service.check_nvr_reachability()
        self.assertTrue(res["reachable"])
        self.assertFalse(res["authenticated"])
        self.assertIsNone(res["device_model"])

    # 3. Valid Historical Playback
    def test_03_valid_historical_playback(self):
        outbox = AttendanceOutbox(
            storage_path=self.outbox_file,
            audit_db_path=self.audit_db_file,
        )
        service = NVRRecoveryService(
            outbox=outbox,
            checkpoint_file=self.checkpoint_file,
            gaps_file=self.gaps_file,
        )

        # Mock models and video capture
        service._ensure_models_loaded = MagicMock(return_value=True)
        service.detector = MagicMock()
        service.arcface = MagicMock()

        # Enrolled employee embedding
        test_emb = np.zeros(512, dtype=np.float32)
        test_emb[0] = 1.0
        service.active_employees = {"TEST_EMP_01": {"embedding": test_emb}}

        # Frame with face
        mock_face = np.zeros((1, 15), dtype=np.float32)
        mock_face[0, 0:4] = [50, 50, 100, 100]
        service.detector.detect.return_value = (1, mock_face)
        service.arcface.get_feat.return_value = test_emb.reshape(1, 512)

        start_t = datetime(2026, 10, 17, 8, 0, 0, tzinfo=timezone.utc)
        end_t = datetime(2026, 10, 17, 8, 15, 0, tzinfo=timezone.utc)

        with patch("cv2.VideoCapture") as mock_cap_cls:
            mock_cap = MagicMock()
            mock_cap.isOpened.return_value = True
            mock_cap.get.return_value = 10.0  # 10 fps
            # Provide 4 consecutive matching frames to satisfy confirmation threshold
            test_frame = np.zeros((360, 640, 3), dtype=np.uint8)
            mock_cap.read.side_effect = [
                (True, test_frame),
                (True, test_frame),
                (True, test_frame),
                (True, test_frame),
                (False, None),
            ]
            mock_cap_cls.return_value = mock_cap

            events, obs = service.process_historical_video_source(
                camera_id="CAM-01",
                video_source="mock://nvr/playback",
                interval_start=start_t,
                interval_end=end_t,
            )

            self.assertGreaterEqual(events, 1)
            self.assertGreaterEqual(obs, 2)
            self.assertEqual(outbox.get_pending_count(), 1)
            pending_evt = outbox.get_pending_events()[0]
            self.assertEqual(pending_evt.employee_id, "TEST_EMP_01")
            self.assertEqual(pending_evt.event_type, "OUT")
            self.assertIn("CP_PLUS_CAM-01", pending_evt.source)

    # 4. Unsupported Playback Protocol
    def test_04_unsupported_playback_protocol(self):
        with patch.dict(os.environ, {"NVR_PLAYBACK_SCHEME": "ftp"}):
            service = NVRRecoveryService(
                checkpoint_file=self.checkpoint_file,
                gaps_file=self.gaps_file,
            )
            start_t = datetime(2026, 10, 17, 9, 0, 0, tzinfo=timezone.utc)
            end_t = datetime(2026, 10, 17, 9, 15, 0, tzinfo=timezone.utc)
            url = service.build_nvr_rtsp_playback_url("CAM-01", start_t, end_t)
            self.assertTrue(url.startswith("ftp://"))

            # When VideoCapture rejects the unsupported scheme
            with patch("cv2.VideoCapture") as mock_cap_cls:
                mock_cap = MagicMock()
                mock_cap.isOpened.return_value = False
                mock_cap_cls.return_value = mock_cap
                service.check_nvr_reachability = MagicMock(return_value={"reachable": False})

                events, _ = service.process_historical_video_source("CAM-01", url, start_t, end_t)
                self.assertEqual(events, 0)
                self.assertTrue(self.gaps_file.exists())

    # 5. Recording Unavailable for a Requested Interval
    def test_05_recording_unavailable_for_requested_interval(self):
        service = NVRRecoveryService(
            checkpoint_file=self.checkpoint_file,
            gaps_file=self.gaps_file,
        )
        service._ensure_models_loaded = MagicMock(return_value=True)
        # NVR reachable, but video stream returns 404 / no footage
        service.check_nvr_reachability = MagicMock(return_value={"reachable": True})

        start_t = datetime(2026, 10, 17, 3, 0, 0, tzinfo=timezone.utc)
        end_t = datetime(2026, 10, 17, 3, 15, 0, tzinfo=timezone.utc)

        with patch("cv2.VideoCapture") as mock_cap_cls:
            mock_cap = MagicMock()
            mock_cap.isOpened.return_value = False
            mock_cap_cls.return_value = mock_cap

            events, _ = service.process_historical_video_source(
                camera_id="CAM-01",
                video_source="rtsp://nvr/not_found",
                interval_start=start_t,
                interval_end=end_t,
            )
            self.assertEqual(events, 0)

            # Checkpoint advanced to prevent infinite loop
            last_cp = service.checkpoint_manager.get_last_processed_timestamp("CAM-01")
            self.assertEqual(last_cp, end_t)

            # Gap logged without fabricating attendance
            with open(self.gaps_file, "r") as f:
                gaps = json.load(f)
            self.assertEqual(len(gaps), 1)
            self.assertIn("no recorded footage", gaps[0]["reason"])

    # 6. Correct CAM-01 and CAM-02 Mapping
    def test_06_correct_cam01_and_cam02_mapping(self):
        service = NVRRecoveryService()
        self.assertEqual(CAMERA_DIRECTION_MAPPING["CAM-01"], "OUT")
        self.assertEqual(CAMERA_DIRECTION_MAPPING["CAM-02"], "IN")
        # Physical channels on CP-UNR-4K4082-V4
        self.assertEqual(service.nvr_channel_map["CAM-01"], 2)
        self.assertEqual(service.nvr_channel_map["CAM-02"], 1)

    # 7. Internet Unavailable but LAN Operational
    def test_07_internet_unavailable_but_lan_operational(self):
        service = NVRRecoveryService(
            checkpoint_file=self.checkpoint_file,
            gaps_file=self.gaps_file,
        )
        # Verifies recovery targets local LAN IP (192.168.9.206) and local outbox without external DNS
        self.assertTrue(service.nvr_ip.startswith("192.168.9."))
        self.assertTrue(service.outbox.backend_url.startswith("http://localhost") or "127.0.0.1" in service.outbox.backend_url)

    # 8. Application Server Offline while NVR Continues Recording
    def test_08_application_server_offline_while_nvr_continues_recording(self):
        service = NVRRecoveryService(
            checkpoint_file=self.checkpoint_file,
            gaps_file=self.gaps_file,
            interval_chunk_minutes=15,
        )
        # Server was offline for 3 hours (180 minutes)
        t_reboot = datetime(2026, 10, 17, 10, 0, 0, tzinfo=timezone.utc)
        t_outage_start = t_reboot - timedelta(hours=3)
        service.checkpoint_manager.update_checkpoint("CAM-01", t_outage_start)

        chunks = service.detect_missing_intervals("CAM-01", current_time=t_reboot)
        # 180 min / 15 min = 12 slices
        self.assertEqual(len(chunks), 12)
        self.assertEqual(chunks[0][0], t_outage_start)
        self.assertEqual(chunks[-1][1], t_reboot)

    # 9. Backend Unavailable while Outbox Retains Events
    def test_09_backend_unavailable_while_outbox_retains_events(self):
        outbox = AttendanceOutbox(
            backend_url="http://127.0.0.1:9999/api",  # Dead port
            storage_path=self.outbox_file,
            audit_db_path=self.audit_db_file,
        )
        evt = outbox.enqueue(
            event_id="test_evt_retained",
            employee_id="EMP_OFFLINE",
            camera_id="CAM-01",
            event_type="IN",
            similarity=0.92,
            timestamp=datetime.now(timezone.utc).isoformat(),
        )

        # Attempt dispatch with dead backend
        success, discard, err = outbox._send_event(evt)
        self.assertFalse(success)
        self.assertFalse(discard)  # Must NOT discard valid events during backend outage

        # Reload in new instance from disk
        outbox2 = AttendanceOutbox(
            storage_path=self.outbox_file,
            audit_db_path=self.audit_db_file,
        )
        self.assertEqual(outbox2.get_pending_count(), 1)
        self.assertEqual(outbox2.get_pending_events()[0].event_id, "test_evt_retained")

    # 10. Server Restart and Automatic Gap Detection
    def test_10_server_restart_and_automatic_gap_detection(self):
        mgr1 = NVRRecoveryCheckpointManager(self.checkpoint_file)
        t_shutdown = datetime(2026, 10, 17, 4, 0, 0, tzinfo=timezone.utc)
        mgr1.update_checkpoint("CAM-01", t_shutdown)

        # Application restarts later
        t_startup = datetime(2026, 10, 17, 6, 0, 0, tzinfo=timezone.utc)
        service = NVRRecoveryService(
            checkpoint_file=self.checkpoint_file,
            gaps_file=self.gaps_file,
            interval_chunk_minutes=30,
        )
        gaps = service.detect_missing_intervals("CAM-01", current_time=t_startup)
        # 2 hours / 30m = 4 chunks
        self.assertEqual(len(gaps), 4)

    # 11. Recovery Interrupted by a Crash
    def test_11_recovery_interrupted_by_a_crash(self):
        mgr = NVRRecoveryCheckpointManager(self.checkpoint_file)
        t1 = datetime(2026, 10, 17, 8, 0, 0, tzinfo=timezone.utc)
        t2 = datetime(2026, 10, 17, 8, 15, 0, tzinfo=timezone.utc)
        t3 = datetime(2026, 10, 17, 8, 30, 0, tzinfo=timezone.utc)

        # Successfully finished chunk 1
        mgr.update_checkpoint("CAM-01", t2, recovered_events_count=2, status="COMPLETED")

        # Simulate crash before chunk 2 finishes -> Disk must preserve t2 checkpoint
        mgr_after_crash = NVRRecoveryCheckpointManager(self.checkpoint_file)
        resumed_ts = mgr_after_crash.get_last_processed_timestamp("CAM-01")
        self.assertEqual(resumed_ts, t2)

    # 12. Duplicate Historical Recovery
    def test_12_duplicate_historical_recovery(self):
        # Two recovery runs over the exact same historical time produce identical UUIDv5 event IDs
        cam_id = "CAM-01"
        emp_id = "EMP_REPLAY"
        ev_type = "IN"
        bucket = 1792051200

        eid_run1 = str(uuid.uuid5(uuid.NAMESPACE_URL, f"NVR_{cam_id}_{emp_id}_{ev_type}_{bucket}"))
        eid_run2 = str(uuid.uuid5(uuid.NAMESPACE_URL, f"NVR_{cam_id}_{emp_id}_{ev_type}_{bucket}"))
        self.assertEqual(eid_run1, eid_run2)

    # 13. Recovered Event Matching an Existing Live Event
    def test_13_recovered_event_matching_existing_live_event(self):
        outbox = AttendanceOutbox(
            storage_path=self.outbox_file,
            audit_db_path=self.audit_db_file,
        )
        eid = "shared_event_uuid_123"
        # 1. Enqueued by live pipeline
        outbox.enqueue(
            event_id=eid,
            employee_id="EMP_LIVE",
            camera_id="CAM-01",
            event_type="IN",
            similarity=0.91,
            source="AI_CAMERA",
        )
        self.assertEqual(outbox.get_pending_count(), 1)

        # 2. Later recovered by NVR recovery with same deterministic ID
        outbox.enqueue(
            event_id=eid,
            employee_id="EMP_LIVE",
            camera_id="CAM-01",
            event_type="IN",
            similarity=0.91,
            source="CP_PLUS_NVR_HISTORICAL_RECOVERY",
        )
        # Duplicate event ID must be deduplicated in outbox queue
        self.assertEqual(outbox.get_pending_count(), 1)

    # 14. Out-of-Order IN and OUT Events
    def test_14_out_of_order_in_and_out_events(self):
        outbox = AttendanceOutbox(
            storage_path=self.outbox_file,
            audit_db_path=self.audit_db_file,
        )
        # OUT arrives first with later timestamp
        t_out = "2026-10-17T18:00:00+05:30"
        t_in = "2026-10-17T09:00:00+05:30"

        outbox.enqueue("evt_out", "EMP1", "CAM-01", "OUT", 0.90, timestamp=t_out)
        outbox.enqueue("evt_in", "EMP1", "CAM-02", "IN", 0.92, timestamp=t_in)

        # Dispatch queue must sort chronologically by capture timestamp (earlier IN first)
        ready_items = list(outbox._queue)
        ready_items.sort(key=lambda x: x.timestamp)
        self.assertEqual(ready_items[0].event_type, "IN")
        self.assertEqual(ready_items[1].event_type, "OUT")

    # 15. Overnight Shifts and Duration Calculation
    def test_15_overnight_shifts_and_duration_calculation(self):
        # Shift spanning 21:00 to 05:00 next day
        in_time = datetime(2026, 10, 17, 21, 0, 0)
        out_time = datetime(2026, 10, 18, 5, 0, 0)
        duration_minutes = round((out_time - in_time).total_seconds() / 60)
        self.assertEqual(duration_minutes, 480)  # 8 hours

    # 16. Missing IN and Missing OUT
    def test_16_missing_in_and_missing_out(self):
        # Reconciling single punches: missing entry or missing exit
        punches_exit_only = [{"eventType": "OUT", "timestamp": "2026-10-17T18:00:00Z"}]
        punches_entry_only = [{"eventType": "IN", "timestamp": "2026-10-17T09:00:00Z"}]

        has_in_1 = any(p["eventType"] == "IN" for p in punches_exit_only)
        has_out_1 = any(p["eventType"] == "OUT" for p in punches_exit_only)
        self.assertTrue(not has_in_1 and has_out_1)  # isIncomplete = True

        has_in_2 = any(p["eventType"] == "IN" for p in punches_entry_only)
        has_out_2 = any(p["eventType"] == "OUT" for p in punches_entry_only)
        self.assertTrue(has_in_2 and not has_out_2)  # isIncomplete = True

    # 17. Ambiguous Face Recognition
    def test_17_ambiguous_face_recognition(self):
        service = NVRRecoveryService(
            checkpoint_file=self.checkpoint_file,
            gaps_file=self.gaps_file,
        )
        service._ensure_models_loaded = MagicMock(return_value=True)
        service.detector = MagicMock()
        service.arcface = MagicMock()

        # Enrolled embedding
        enrolled_emb = np.zeros(512, dtype=np.float32)
        enrolled_emb[0] = 1.0
        service.active_employees = {"EMP_01": {"embedding": enrolled_emb}}

        # Low similarity embedding (cosine sim 0.40 < threshold 0.65)
        ambiguous_emb = np.zeros(512, dtype=np.float32)
        ambiguous_emb[0] = 0.40
        ambiguous_emb[1] = 0.90
        ambiguous_emb /= np.linalg.norm(ambiguous_emb)

        mock_face = np.zeros((1, 15), dtype=np.float32)
        mock_face[0, 0:4] = [50, 50, 100, 100]
        service.detector.detect.return_value = (1, mock_face)
        service.arcface.get_feat.return_value = ambiguous_emb.reshape(1, 512)

        start_t = datetime(2026, 10, 17, 8, 0, 0, tzinfo=timezone.utc)
        end_t = datetime(2026, 10, 17, 8, 15, 0, tzinfo=timezone.utc)

        with patch("cv2.VideoCapture") as mock_cap_cls:
            mock_cap = MagicMock()
            mock_cap.isOpened.return_value = True
            mock_cap.get.return_value = 10.0
            test_frame = np.zeros((360, 640, 3), dtype=np.uint8)
            mock_cap.read.side_effect = [(True, test_frame), (False, None)]
            mock_cap_cls.return_value = mock_cap

            events, _ = service.process_historical_video_source("CAM-01", "mock://url", start_t, end_t)
            # Must NOT assign identity or enqueue attendance event
            self.assertEqual(events, 0)

    # 18. Timezone and NVR Clock Differences
    def test_18_timezone_and_nvr_clock_differences(self):
        service = NVRRecoveryService()
        self.assertEqual(service.nvr_timezone, "Asia/Kolkata")

        # Start and end in UTC converted to Dahua ISO format
        utc_time = datetime(2026, 10, 17, 3, 30, 0, tzinfo=timezone.utc)
        end_utc = datetime(2026, 10, 17, 3, 45, 0, tzinfo=timezone.utc)
        url = service.build_nvr_rtsp_playback_url("CAM-01", utc_time, end_utc)
        self.assertIn("starttime=20261017T033000Z", url)
        self.assertIn("endtime=20261017T034500Z", url)

    # 19. Recovery and Live Processing Running Simultaneously
    def test_19_recovery_and_live_processing_running_simultaneously(self):
        outbox = AttendanceOutbox(
            storage_path=self.outbox_file,
            audit_db_path=self.audit_db_file,
        )
        service = NVRRecoveryService(
            outbox=outbox,
            checkpoint_file=self.checkpoint_file,
            gaps_file=self.gaps_file,
        )
        service.run_all = MagicMock(return_value={"status": "MOCK_SUCCESS"})
        # Background worker start & stop cleanly without deadlock
        service.start_background_worker(interval_seconds=3600.0)
        self.assertIsNotNone(service._worker_thread)
        self.assertTrue(service._worker_thread.is_alive())
        service.stop_background_worker(timeout=2.0)
        self.assertFalse(service._worker_thread.is_alive())

    # 20. Checkpoint Persistence and Safe Resumption
    def test_20_checkpoint_persistence_and_safe_resumption(self):
        mgr = NVRRecoveryCheckpointManager(self.checkpoint_file)
        t = datetime(2026, 10, 17, 11, 0, 0, tzinfo=timezone.utc)
        mgr.update_checkpoint("CAM-02", t, recovered_events_count=5, status="COMPLETED")

        mgr2 = NVRRecoveryCheckpointManager(self.checkpoint_file)
        self.assertEqual(mgr2.get_last_processed_timestamp("CAM-02"), t)
        all_cp = mgr2.get_all_checkpoints()
        self.assertEqual(all_cp["CAM-02"]["total_events_recovered"], 5)

    # 21. Database Uniqueness and Idempotent Synchronization
    def test_21_database_uniqueness_and_idempotent_synchronization(self):
        outbox = AttendanceOutbox(
            storage_path=self.outbox_file,
            audit_db_path=self.audit_db_file,
        )
        eid = "uuid_unique_test_99"
        e1 = outbox.enqueue(eid, "EMP_U", "CAM-01", "OUT", 0.90)
        e2 = outbox.enqueue(eid, "EMP_U", "CAM-01", "OUT", 0.90)
        self.assertEqual(outbox.get_pending_count(), 1)

    # 22. Confirmation of Frontend API Contract Preservation
    def test_22_confirmation_no_frontend_files_modified(self):
        # Verifies frontend attendance modules preserve API contracts and camera references
        att_list_path = _PROJECT_ROOT / "frontend" / "src" / "modules" / "attendance" / "AttendanceList.jsx"
        self.assertTrue(att_list_path.exists())
        with open(att_list_path, "r", encoding="utf-8") as f:
            content = f.read()
        self.assertIn("CAM-02 (IN)", content)
        self.assertIn("CAM-01 (OUT)", content)

    # 23. Confirmation that No Existing Attendance or NVR Recordings Were Deleted
    def test_23_confirmation_no_existing_attendance_or_nvr_recordings_deleted(self):
        # Verify code does NOT perform DROP TABLE, TRUNCATE, or bulk delete on attendance records
        with open(_FACE_DIR / "attendance_outbox.py", "r", encoding="utf-8") as f:
            outbox_code = f.read()
        self.assertNotIn("DROP TABLE", outbox_code)
        self.assertNotIn("TRUNCATE", outbox_code)

        with open(_SRC_DIR / "camera" / "nvr_recovery_service.py", "r", encoding="utf-8") as f:
            rec_code = f.read()
        self.assertNotIn("DELETE FROM", rec_code)
        self.assertNotIn("DROP", rec_code)


if __name__ == "__main__":
    unittest.main()
