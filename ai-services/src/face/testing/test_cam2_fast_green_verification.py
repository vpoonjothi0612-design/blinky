import unittest
import numpy as np
import cv2
import sys
from pathlib import Path

# Add paths
base_dir = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(base_dir))
sys.path.insert(0, str(base_dir / "recognition"))

from face_config import (
    MIN_FACE_DIM_LIVE,
    MIN_SHARPNESS_LIVE,
    MIN_SHARPNESS_LIVE_RELAXED,
    estimate_face_distance_meters,
    is_face_in_active_gate_zone,
)
from multi_employee_recognition import check_face_crop_quality
from face_preprocess import preprocess_face
from live_face_recognition import TemporalLivenessTracker, draw_multi_person_hud


class TestCAM02FastGreenVerification(unittest.TestCase):
    """Verifies that CAM-02 responds with <50ms latency and renders vibrant green on recognition."""

    def test_01_quality_gates_allow_distance_recognition(self):
        """At 2.0m - 4.0m distance, faces are 24-50px. Quality gates must allow recognition."""
        self.assertLessEqual(MIN_FACE_DIM_LIVE, 24)
        self.assertLessEqual(MIN_SHARPNESS_LIVE_RELAXED, 6.0)

        # Test distance calculation
        # Face of width 35px at ~2.4m
        dist = estimate_face_distance_meters(35)
        self.assertTrue(1.5 <= dist <= 3.0)

        # Test in active gate zone
        in_zone, dist_val, label = is_face_in_active_gate_zone((100, 100, 35, 35), 720)
        self.assertTrue(in_zone)
        self.assertEqual(label, "IN_ZONE")

    def test_02_crop_quality_accepts_small_face(self):
        """Face crop quality must accept faces down to 24px."""
        frame = np.ones((720, 1280, 3), dtype=np.uint8) * 120
        # Draw some features for Laplacian sharpness
        cv2.circle(frame, (215, 215), 5, (20, 20, 20), -1)
        cv2.circle(frame, (225, 215), 5, (20, 20, 20), -1)

        ok, msg, crop = check_face_crop_quality(frame, (200, 200, 30, 30), strict_boundary=False)
        self.assertTrue(ok, f"Crop check failed: {msg}")
        self.assertIsNotNone(crop)

    def test_03_preprocess_face_fast_mode_latency(self):
        """preprocess_face with fast_mode=True must execute in under 10ms (>> 100 FPS)."""
        import time
        face_crop = np.random.randint(40, 200, (60, 60, 3), dtype=np.uint8)
        
        # Warm up
        preprocess_face(face_crop, fast_mode=True)

        t0 = time.perf_counter()
        for _ in range(20):
            res = preprocess_face(face_crop, fast_mode=True)
        elapsed_avg_ms = ((time.perf_counter() - t0) / 20.0) * 1000.0

        self.assertIsNotNone(res)
        self.assertLess(elapsed_avg_ms, 10.0, f"preprocess_face too slow: {elapsed_avg_ms:.2f}ms")

    def test_04_liveness_tracker_immediate_validation(self):
        """Liveness tracker must validate human geometry immediately for faces >= 24px."""
        tracker = TemporalLivenessTracker(min_frames=3)
        gray = np.ones((720, 1280), dtype=np.uint8) * 120
        landmarks = np.array([[210, 210], [230, 210], [220, 220], [215, 230], [225, 230]])

        # Test with a 30x30 face
        is_live, status, score = tracker.update((200, 200, 30, 30), landmarks, gray)
        self.assertTrue(is_live)
        self.assertEqual(status, "LIVE")

    def test_05_hud_renders_vibrant_green_for_identified_employee(self):
        """draw_multi_person_hud MUST render bounding box in prominent vibrant green (0, 255, 0)."""
        canvas = np.zeros((720, 1280, 3), dtype=np.uint8)
        tracks_info = [{
            "track_id": 1,
            "bbox": (200, 200, 80, 80),
            "landmarks": np.array([[220, 220], [260, 220], [240, 240], [230, 260], [250, 260]]),
            "status": "RECOGNIZED: EMP001 [FRONT] (0.85)",
            "state": "RECOGNIZED",
            "employee_id": "EMP001",
            "name": "sanjay",
            "similarity": 0.85,
            "matched_view": "FRONT",
            "attendance_state": "IN Recorded",
            "distance_meters": 1.8,
            "is_in_zone": True,
            "head_pose": "FRONT",
            "alert_msg": None,
        }]

        hud = draw_multi_person_hud(
            frame=canvas,
            tracks_info=tracks_info,
            camera_id="CAM-02",
            event_type="IN",
            stats={"frames_processed": 1, "registered_identified": 1, "unknown_tracks": 0, "attendance_recorded": 1, "duplicates_prevented": 0, "avg_latency_ms": 15.0},
            fps=25.0,
            outbox_depth=0,
        )

        # Check that bounding box pixel is bright green: BGR = (0, 255, 0)
        pixel_corner = hud[200, 200]
        self.assertEqual(pixel_corner[0], 0)
        self.assertEqual(pixel_corner[1], 255)
        self.assertEqual(pixel_corner[2], 0)

        # Check solid green banner above bbox (y in [181, 199], x in [201, 250])
        banner_region = hud[182:199, 201:250]
        green_pixels = np.sum(banner_region[:, :, 1] > 100)
        self.assertGreater(green_pixels, 50, "Header banner should be solid green")


if __name__ == "__main__":
    unittest.main()
