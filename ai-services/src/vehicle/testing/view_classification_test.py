import sys
import unittest
from pathlib import Path
from types import SimpleNamespace

SRC_DIR = Path(__file__).resolve().parents[2]
if str(SRC_DIR) not in sys.path:
    sys.path.insert(0, str(SRC_DIR))

from view_classification import (  # noqa: E402
    BestViewCaptureRegistry,
    HUMAN_CAPTURE_ORIENTATIONS,
    VEHICLE_CAPTURE_ANGLES,
    normalize_human_orientation,
    normalize_vehicle_angle,
)
from vehicle.events.vehicle_event import VehicleEvent  # noqa: E402
from vehicle.events.line_counter import VehicleLineCounter  # noqa: E402


class ViewClassificationTests(unittest.TestCase):
    def test_invalid_or_unavailable_orientations_remain_unknown(self):
        self.assertEqual(normalize_human_orientation("front"), "FRONT")
        self.assertEqual(normalize_human_orientation("diagonal"), "UNKNOWN")
        self.assertEqual(normalize_vehicle_angle("TOP"), "TOP")
        self.assertEqual(normalize_vehicle_angle(None), "UNKNOWN")

    def test_human_capture_registry_rejects_back_and_unknown_images(self):
        registry = BestViewCaptureRegistry(HUMAN_CAPTURE_ORIENTATIONS)
        self.assertFalse(registry.consider("BACK", "back.jpg", 0.9))
        self.assertFalse(registry.consider("UNKNOWN", "unknown.jpg", 0.9))
        self.assertTrue(registry.consider("LEFT", "left-first.jpg", 0.7))
        self.assertTrue(registry.consider("LEFT", "left-better.jpg", 0.8))
        self.assertFalse(registry.consider("LEFT", "left-worse.jpg", 0.6))
        self.assertEqual(registry.paths(), {"LEFT": "left-better.jpg"})

    def test_vehicle_registry_keeps_one_highest_quality_image_per_angle(self):
        registry = BestViewCaptureRegistry(VEHICLE_CAPTURE_ANGLES)
        self.assertTrue(registry.consider("front", "front.jpg", 0.75))
        self.assertTrue(registry.consider("rear", "rear.jpg", 0.8))
        self.assertFalse(registry.consider("side", "side.jpg", 0.99))
        self.assertFalse(registry.consider("TOP", "top.jpg", 0.99))
        self.assertFalse(registry.consider("TOP", "", 0.99))
        self.assertEqual(registry.paths(), {"FRONT": "front.jpg", "REAR": "rear.jpg"})

    def test_vehicle_event_round_trip_keeps_optional_view_metadata_backward_compatible(self):
        event = VehicleEvent.create(
            track_id=4,
            vehicle_type="car",
            direction="ENTRY",
            confidence=0.9,
            bbox=(1, 2, 30, 40),
            view_angle="rear",
            view_angle_confidence=0.84,
            angle_images={"REAR": "captures/rear.jpg", "invalid": "captures/invalid.jpg"},
        )
        serialized = event.to_dict()
        self.assertEqual(serialized["view_angle"], "REAR")
        self.assertEqual(serialized["angle_images"], {"REAR": "captures/rear.jpg"})

        old_payload = {key: value for key, value in serialized.items() if not key.startswith("view_angle") and key != "angle_images"}
        restored = VehicleEvent.from_dict(old_payload)
        self.assertEqual(restored.view_angle, "UNKNOWN")
        self.assertEqual(restored.angle_images, {})

    def test_line_crossing_event_carries_best_angle_capture(self):
        registry = BestViewCaptureRegistry(VEHICLE_CAPTURE_ANGLES)
        registry.consider("REAR", "captures/rear-best.jpg", 0.9)
        track = SimpleNamespace(
            track_id=12,
            class_name="car",
            centroid=(320, 195),
            confidence=0.9,
            bbox=(270, 150, 370, 240),
            view_angle="REAR",
            view_angle_confidence=0.85,
            best_angle_images=registry,
        )
        counter = VehicleLineCounter(line_start=(100, 240), line_end=(540, 240))
        counter.update_tracks([track], frame_idx=1)
        track.centroid = (320, 275)
        events = counter.update_tracks([track], frame_idx=2)

        self.assertEqual(len(events), 1)
        payload = events[0].to_dict()
        self.assertEqual(payload["view_angle"], "REAR")
        self.assertEqual(payload["view_angle_confidence"], 0.85)
        self.assertEqual(payload["angle_images"], {"REAR": "captures/rear-best.jpg"})


if __name__ == "__main__":
    unittest.main()
