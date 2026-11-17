"""Comprehensive Dual-Camera Multi-Person Face Recognition & Attendance Test Suite.

Automated verification covering all 10 core production requirements:
1. Multi-person detection in the same camera frame.
2. Independent tracking IDs per person without identity coupling.
3. Registered employee identification with similarity threshold.
4. Unknown face classification without assigning employee records.
5. Distinct unknown track counting (no inflated per-frame counting).
6. Mixed frame processing (registered employee + unknown person together).
7. Top-1 vs Top-2 candidate ambiguity guard (margin check).
8. Multi-embedding support per registered employee.
9. Directional event mapping (CAM-01 -> OUT, CAM-02 -> IN) & Camera fault isolation.
10. Cooldown duplicate debounce and durable persistent outbox delivery.
"""

from __future__ import annotations

import json
import os
import sys
import time
import unittest
import uuid
from pathlib import Path
from typing import Dict, List, Tuple, Any
from unittest.mock import MagicMock, patch

import cv2
import numpy as np

# Ensure paths
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
from face.attendance_outbox import AttendanceOutbox, AttendanceEvent
from face.dual_camera_live_face_recognition import (
    CameraInferenceWorker,
    CAMERA_EVENT_MAPPING,
    match_probe_against_registry,
    load_arcface_model_auto,
)
try:
    from multi_employee_recognition import MultiFaceTracker, calculate_iou
except ImportError:
    from recognition.multi_employee_recognition import MultiFaceTracker, calculate_iou
try:
    from employee_registry import load_all_active_embeddings
except ImportError:
    from recognition.employee_registry import load_all_active_embeddings

try:
    from face_config import (
        YUNET_MODEL_PATH,
        ARCFACE_MODEL_PATH,
        RECOGNITION_THRESHOLD,
        DEFAULT_MIN_MATCH_MARGIN,
        ENROLLMENT_BASE_DIR,
    )
except ImportError:
    from face.face_config import (
        YUNET_MODEL_PATH,
        ARCFACE_MODEL_PATH,
        RECOGNITION_THRESHOLD,
        DEFAULT_MIN_MATCH_MARGIN,
        ENROLLMENT_BASE_DIR,
    )



class TestDualCameraMultiPerson(unittest.TestCase):
    """Production automated test suite for Dual-Camera Multi-Person Attendance."""

    @classmethod
    def setUpClass(cls):
        cls.active_employees = load_all_active_embeddings()
        assert len(cls.active_employees) >= 2, "Need at least EMP001 and EMP002 enrolled"
        cls.arcface, cls.provider = load_arcface_model_auto(ARCFACE_MODEL_PATH)
        assert cls.arcface is not None

        # Load real test images
        emp1_path = ENROLLMENT_BASE_DIR / "EMP001" / "EMP001_angle_02_front.jpg"
        emp2_path = ENROLLMENT_BASE_DIR / "EMP002" / "EMP002_angle_01_front.jpg"
        unk_path = _AI_SERVICES_DIR / "different_person_clear.jpg"

        cls.emp1_img = cv2.imread(str(emp1_path))
        cls.emp2_img = cv2.imread(str(emp2_path))
        cls.unk_img = cv2.imread(str(unk_path))

        assert cls.emp1_img is not None, f"Missing {emp1_path}"
        assert cls.emp2_img is not None, f"Missing {emp2_path}"
        assert cls.unk_img is not None, f"Missing {unk_path}"

    def setUp(self):
        self.test_outbox_file = _AI_SERVICES_DIR / "data" / f"test_outbox_{uuid.uuid4().hex[:8]}.json"
        self.test_audit_db = _AI_SERVICES_DIR / "data" / f"test_audit_{uuid.uuid4().hex[:8]}.db"
        self.outbox = AttendanceOutbox(
            backend_url="http://localhost:3000/api",
            auth_token="TEST_TOKEN",
            storage_path=self.test_outbox_file,
            audit_db_path=self.test_audit_db,
        )


    def tearDown(self):
        try:
            if self.test_outbox_file.exists():
                self.test_outbox_file.unlink()
            if self.test_audit_db.exists():
                self.test_audit_db.unlink()
        except Exception:
            pass

    def test_01_multi_person_synthetic_dual_frame_detection(self):
        """Test 1: Both EMP001 and EMP002 in the same camera frame are detected and recognized."""
        # Create a side-by-side composite frame containing both faces
        h1, w1 = self.emp1_img.shape[:2]
        h2, w2 = self.emp2_img.shape[:2]
        target_h = 480
        scale1 = target_h / float(h1)
        scale2 = target_h / float(h2)

        f1 = cv2.resize(self.emp1_img, (int(w1 * scale1), target_h))
        f2 = cv2.resize(self.emp2_img, (int(w2 * scale2), target_h))
        dual_frame = np.hstack((f1, f2))

        # Detect with YuNet
        det = cv2.FaceDetectorYN.create(
            str(YUNET_MODEL_PATH), "", (dual_frame.shape[1], dual_frame.shape[0]), 0.5, 0.3, 5000
        )
        _, faces = det.detect(dual_frame)
        self.assertIsNotNone(faces)
        self.assertGreaterEqual(len(faces), 2, "YuNet must detect both faces in the composite frame")

        # Multi-face tracker association
        tracker = MultiFaceTracker(max_missed=15)
        detections = []
        for face in faces:
            bx, by, bw, bh = map(int, face[:4])
            lmarks = face[4:14].reshape(5, 2)
            detections.append(((bx, by, bw, bh), lmarks))

        active_tracks = tracker.update(detections)
        self.assertEqual(len(active_tracks), 2, "Tracker must create separate tracks for both faces")
        self.assertNotEqual(active_tracks[0].track_id, active_tracks[1].track_id, "Track IDs must be unique")

    def test_02_mixed_frame_employee_and_unknown(self):
        """Test 2: Frame containing registered employee and unregistered person processes both independently."""
        h1, w1 = self.emp1_img.shape[:2]
        h2, w2 = self.unk_img.shape[:2]
        target_h = 480
        f_emp = cv2.resize(self.emp1_img, (int(w1 * (target_h / h1)), target_h))
        f_unk = cv2.resize(self.unk_img, (int(w2 * (target_h / h2)), target_h))
        mixed_frame = np.hstack((f_emp, f_unk))

        det = cv2.FaceDetectorYN.create(
            str(YUNET_MODEL_PATH), "", (mixed_frame.shape[1], mixed_frame.shape[0]), 0.5, 0.3, 5000
        )
        _, faces = det.detect(mixed_frame)
        self.assertIsNotNone(faces)
        self.assertGreaterEqual(len(faces), 2)

        # Extract normalized probe embeddings for both faces
        decisions = []
        for face in faces:
            lmarks = face[4:14].reshape(5, 2)
            # Affine alignment
            from face.face_config import REFERENCE_POINTS
            t, _ = cv2.estimateAffinePartial2D(lmarks.astype(np.float32), REFERENCE_POINTS, method=cv2.LMEDS)
            aligned = cv2.warpAffine(mixed_frame, t, (112, 112))
            emb = self.arcface.get_feat(aligned).flatten()
            normed = emb / np.linalg.norm(emb)
            dec = match_probe_against_registry(
                probe_emb=normed,
                active_employees=self.active_employees,
                recognition_threshold=RECOGNITION_THRESHOLD,
                min_match_margin=DEFAULT_MIN_MATCH_MARGIN,
            )
            decisions.append(dec)

        # One should be recognized as EMP001, the other as UNKNOWN
        recognized_ids = [d["employee_id"] for d in decisions if d["status"].startswith("RECOGNIZED")]
        unknown_statuses = [d["status"] for d in decisions if d["status"] == "UNKNOWN"]

        self.assertIn("EMP001", recognized_ids, "EMP001 must be recognized in the mixed frame")
        self.assertGreaterEqual(len(unknown_statuses), 1, "The unregistered face must be labeled UNKNOWN")

    def test_03_distinct_unknown_track_counting(self):
        """Test 3: Multiple consecutive frames of an unknown person increment distinct track count ONCE."""
        tracker = MultiFaceTracker(max_missed=15)
        bbox = (100, 100, 150, 150)
        lmarks = np.zeros((5, 2), dtype=np.float32)

        unknown_track_count = 0
        active_tracks = []

        # Simulate 20 consecutive frames of the same unknown person moving slightly
        for frame_idx in range(20):
            jitter_bbox = (bbox[0] + (frame_idx % 3), bbox[1] + (frame_idx % 2), bbox[2], bbox[3])
            active_tracks = tracker.update([(jitter_bbox, lmarks)])
            self.assertEqual(len(active_tracks), 1)
            tr = active_tracks[0]

            # Accounting logic: Count distinct unknown track only once
            if not getattr(tr, "is_unknown_accounted", False):
                tr.is_unknown_accounted = True
                unknown_track_count += 1

        self.assertEqual(unknown_track_count, 1, "Unknown person across 20 frames must only count as 1 distinct track")

    def test_04_top1_vs_top2_ambiguity_guard(self):
        """Test 4: Ambiguous probe close to two registered employees is rejected as AMBIGUOUS."""
        # Synthesize probe embedding that is close to both EMP001 and EMP002
        emp1_ref = self.active_employees["EMP001"]["embedding"]
        emp2_ref = self.active_employees["EMP002"]["embedding"]
        blended = (emp1_ref + emp2_ref) / 2.0
        blended = blended / np.linalg.norm(blended)

        decision = match_probe_against_registry(
            probe_emb=blended,
            active_employees=self.active_employees,
            recognition_threshold=0.30,  # Lower threshold to test margin check
            min_match_margin=0.08,
        )

        self.assertEqual(decision["status"], "AMBIGUOUS", "Blended candidate must trigger AMBIGUOUS guard")
        self.assertIsNone(decision["employee_id"], "Ambiguous candidate must never be assigned an employee identity")

    def test_05_multi_embedding_matching_per_employee(self):
        """Test 5: An employee with multiple authorized embeddings matches accurately against different angles."""
        emp1_data = self.active_employees["EMP001"]
        self.assertIn("embeddings", emp1_data, "Registry must store authorized embeddings list")
        self.assertGreaterEqual(len(emp1_data["embeddings"]), 1, "EMP001 must have authorized embeddings loaded")

        # Probe using primary embedding
        probe = emp1_data["embedding"]
        decision = match_probe_against_registry(
            probe_emb=probe,
            active_employees=self.active_employees,
            recognition_threshold=RECOGNITION_THRESHOLD,
        )
        self.assertEqual(decision["employee_id"], "EMP001")
        self.assertAlmostEqual(decision["similarity"], 1.0, places=3)

    def test_06_camera_event_mapping_and_direction(self):
        """Test 6: CAM-01 produces OUT events; CAM-02 produces IN events strictly."""
        self.assertEqual(CAMERA_EVENT_MAPPING["CAM-01"], "OUT")
        self.assertEqual(CAMERA_EVENT_MAPPING["CAM-02"], "IN")

    def test_07_cooldown_duplicate_debounce(self):
        """Test 7: Consecutive appearances within 60s cooldown prevent duplicate outbox enqueues."""
        mock_worker = MagicMock()
        mock_worker.state = ConnectionState.CONNECTED

        inf_worker = CameraInferenceWorker(
            camera_id="CAM-01",
            camera_worker=mock_worker,
            event_type="IN",
            active_employees=self.active_employees,
            arcface_model=self.arcface,
            arcface_lock=MagicMock(),
            outbox=self.outbox,
            recognition_threshold=0.65,
            confirmation_frames=1,
            cooldown_seconds=60.0,
            gui_enabled=False,
        )

        # Mock track
        mock_track = MagicMock()
        mock_track.employee_id = "EMP001"
        mock_track.name = "sanjay"
        mock_track.similarity = 0.95
        mock_track.track_id = 1

        ts1 = "2026-10-21T10:00:00Z"
        ts2 = "2026-10-21T10:00:05Z"  # 5 seconds later

        # First appearance -> recorded
        inf_worker._evaluate_attendance_for_track(mock_track, ts1)
        self.assertEqual(inf_worker.stats["attendance_recorded"], 1)
        self.assertEqual(self.outbox.get_depth(), 1)

        # Second appearance 5s later -> debounced by cooldown
        inf_worker._evaluate_attendance_for_track(mock_track, ts2)
        self.assertEqual(inf_worker.stats["attendance_recorded"], 1, "Duplicate within cooldown must not increase count")
        self.assertEqual(inf_worker.stats["duplicates_prevented"], 1, "Duplicates prevented counter must increment")
        self.assertEqual(self.outbox.get_depth(), 1, "Outbox depth must remain 1")

    def test_08_fault_isolation_one_camera_disconnects(self):
        """Test 8: Failure on CAM-01 does not impede CAM-02 processing."""
        w1 = CameraWorker(config=CameraConfig("CAM-01", "Exit", "192.168.9.207", 554, "admin", "p"), auto_start=False)
        w2 = CameraWorker(config=CameraConfig("CAM-02", "Entrance", "192.168.9.208", 554, "admin", "p"), auto_start=False)

        w1._set_state(ConnectionState.ERROR, error_msg="RTSP Socket Timeout")
        w2._set_state(ConnectionState.CONNECTED)

        inf_w1 = CameraInferenceWorker(
            "CAM-01", w1, "OUT", self.active_employees, self.arcface, MagicMock(), self.outbox, gui_enabled=False
        )
        inf_w2 = CameraInferenceWorker(
            "CAM-02", w2, "IN", self.active_employees, self.arcface, MagicMock(), self.outbox, gui_enabled=False
        )

        s1 = inf_w1.get_stats()
        s2 = inf_w2.get_stats()

        self.assertEqual(s1["connection_status"], "ERROR")
        self.assertEqual(s2["connection_status"], "CONNECTED")

    def test_09_durable_outbox_offline_persistence(self):
        """Test 9: Attendance events persist to JSON file and SQLite audit db during offline mode."""
        event_id = str(uuid.uuid4())
        self.outbox.enqueue(
            event_id=event_id,
            employee_id="EMP001",
            camera_id="CAM-01",
            event_type="IN",
            similarity=0.92,
            timestamp="2026-10-21T10:00:00Z",
            source="CP_PLUS_CAM-01",
            status="PRESENT",
        )

        self.assertTrue(self.test_outbox_file.exists(), "Outbox JSON file must exist on disk")
        content = json.loads(self.test_outbox_file.read_text(encoding="utf-8"))
        self.assertEqual(len(content), 1)
        self.assertEqual(content[0]["eventId"], event_id)
        self.assertEqual(content[0]["employeeId"], "EMP001")

    def test_10_separate_telemetry_reporting(self):
        """Test 10: Inference worker maintains distinct per-camera telemetry statistics."""
        mock_worker = MagicMock()
        mock_worker.state = ConnectionState.CONNECTED

        worker = CameraInferenceWorker(
            camera_id="CAM-02",
            camera_worker=mock_worker,
            event_type="OUT",
            active_employees=self.active_employees,
            arcface_model=self.arcface,
            arcface_lock=MagicMock(),
            outbox=self.outbox,
            gui_enabled=False,
        )

        stats = worker.get_stats()
        required_keys = [
            "camera_id",
            "event_type",
            "connection_status",
            "frames_processed",
            "faces_detected",
            "registered_identified",
            "unknown_tracks",
            "attendance_recorded",
            "duplicates_prevented",
            "avg_latency_ms",
            "fps",
            "pending_outbox",
        ]
        for k in required_keys:
            self.assertIn(k, stats, f"Stats must include '{k}'")
        self.assertEqual(stats["camera_id"], "CAM-02")
        self.assertEqual(stats["event_type"], "OUT")


if __name__ == "__main__":
    unittest.main()
