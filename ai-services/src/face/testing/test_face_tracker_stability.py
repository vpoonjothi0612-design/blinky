import unittest
import numpy as np
import sys
from pathlib import Path

sys.path.extend(["src/face", "src/face/recognition"])
from multi_employee_recognition import MultiFaceTracker, calculate_iou, calculate_normalized_centroid_distance

class TestMultiFaceTrackerStability(unittest.TestCase):
    def setUp(self):
        self.tracker = MultiFaceTracker(max_missed=30)
        self.dummy_landmarks = np.array([
            [100, 100], [140, 100], [120, 120], [105, 140], [135, 140]
        ], dtype=np.float32)

    def test_single_person_linear_motion(self):
        """Track ID remains identical as a person walks across the camera."""
        # Frame 1: Person at (100, 100, 80, 100)
        t1 = self.tracker.update([((100, 100, 80, 100), self.dummy_landmarks)])
        self.assertEqual(len(t1), 1)
        initial_id = t1[0].track_id

        # Frame 2-10: Walking steadily
        for i in range(1, 10):
            bbox = (100 + i * 5, 100 + i * 2, 80, 100)
            tracks = self.tracker.update([(bbox, self.dummy_landmarks)])
            self.assertEqual(len(tracks), 1)
            self.assertEqual(tracks[0].track_id, initial_id, f"Track ID changed at step {i}")

    def test_head_turn_to_profile_continuity(self):
        """When an employee turns head, bbox narrows & IoU drops, but track ID is preserved!"""
        # Frame 1: Frontal face (width 100)
        t1 = self.tracker.update([((200, 200, 100, 120), self.dummy_landmarks)])
        self.assertEqual(len(t1), 1)
        initial_id = t1[0].track_id

        # Frame 2: Person turns head sideways -> width shrinks to 45px, shifted slightly
        # IoU with previous bbox (200, 200, 100, 120) vs (225, 200, 45, 120) is low (~0.37)
        # Frame 3: Extreme profile turn -> (240, 205, 38, 115) -> IoU < 0.20
        extreme_profile = (240, 205, 38, 115)
        iou_val = calculate_iou((200, 200, 100, 120), extreme_profile)
        norm_dist = calculate_normalized_centroid_distance((200, 200, 100, 120), extreme_profile)

        t2 = self.tracker.update([(extreme_profile, self.dummy_landmarks)])
        self.assertEqual(len(t2), 1)
        self.assertEqual(
            t2[0].track_id, initial_id,
            f"Head turn caused new track ID! (IoU={iou_val:.2f}, norm_dist={norm_dist:.2f})"
        )

    def test_momentary_occlusion_or_blink_continuity(self):
        """Temporary detection drop (looking down/blinking for 5 frames) preserves track ID."""
        t1 = self.tracker.update([((300, 150, 90, 110), self.dummy_landmarks)])
        self.assertEqual(len(t1), 1)
        target_id = t1[0].track_id

        # 5 empty frames (person blinks or turns down)
        for _ in range(5):
            empty = self.tracker.update([])
            self.assertEqual(len(empty), 0)

        # Person reappears slightly moved
        t_reappear = self.tracker.update([((310, 155, 90, 110), self.dummy_landmarks)])
        self.assertEqual(len(t_reappear), 1)
        self.assertEqual(
            t_reappear[0].track_id, target_id,
            "Track ID failed to resume after momentary 5-frame drop"
        )

    def test_two_distinct_people_separation(self):
        """Two people standing at different locations receive distinct track IDs."""
        p1 = ((100, 100, 80, 100), self.dummy_landmarks)
        p2 = ((400, 100, 80, 100), self.dummy_landmarks)

        tracks = self.tracker.update([p1, p2])
        self.assertEqual(len(tracks), 2)
        tids = {t.track_id for t in tracks}
        self.assertEqual(len(tids), 2, "Both tracks must have distinct IDs")

        # Advance 5 frames
        for _ in range(5):
            tracks = self.tracker.update([p1, p2])
            self.assertEqual(len(tracks), 2)
            self.assertEqual({t.track_id for t in tracks}, tids)

    def test_stale_track_pruning(self):
        """Track is deleted only after exceeding max_missed frames."""
        tracker = MultiFaceTracker(max_missed=5)
        tracker.update([((100, 100, 80, 100), self.dummy_landmarks)])
        self.assertEqual(len(tracker.tracks), 1)

        # 5 missed frames -> still kept in internal memory
        for _ in range(5):
            tracker.update([])
        self.assertEqual(len(tracker.tracks), 1)

        # 6th missed frame -> exceeded max_missed -> pruned!
        tracker.update([])
        self.assertEqual(len(tracker.tracks), 0)

if __name__ == "__main__":
    unittest.main()

