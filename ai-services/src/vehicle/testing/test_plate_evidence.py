from pathlib import Path
import sys
import tempfile
from types import SimpleNamespace
import unittest
from unittest.mock import patch

import cv2
import numpy as np

SRC_DIR = Path(__file__).resolve().parents[2]
if str(SRC_DIR) not in sys.path:
    sys.path.append(str(SRC_DIR))

from vehicle.plate.plate_reader import PlateVoter
from vehicle.plate.plate_recognizer import MockPlateOCR, NullPlateDetector, NumberPlatePipeline, PlateDetectionResult
from vehicle.service.vehicle_video_service import TrackedVehicleRecord, VehicleVideoAnalysisService


class PlateEvidenceTests(unittest.TestCase):
    def setUp(self):
        self.plate_crop = np.full((32, 120, 3), 180, dtype=np.uint8)

    def test_missing_localization_never_uses_vehicle_region_as_plate(self):
        pipeline = NumberPlatePipeline(
            detector=NullPlateDetector(),
            ocr_engine=MockPlateOCR(canned_plate="MH12AB1234"),
        )

        result = pipeline.process_vehicle_crop(np.full((100, 220, 3), 80, dtype=np.uint8))

        self.assertFalse(result.detected)
        self.assertIsNone(result.plate_bbox)
        self.assertIsNone(result.plate_crop)
        self.assertIsNone(result.plate_text)
        self.assertEqual(result.ocr_status, "PLATE_NOT_DETECTED")

    def test_uploaded_video_requires_three_matching_quality_reads(self):
        record = TrackedVehicleRecord(
            track_id=1,
            vehicle_type="car",
            confidence=0.9,
            first_seen_frame=1,
            first_seen_timestamp="00:00:00.000",
            last_seen_frame=1,
            last_seen_timestamp="00:00:00.000",
            best_bbox=[0, 0, 220, 100],
        )

        for _ in range(2):
            record.add_plate_observation(self._valid_result("MH12AB1234"))
            self.assertIsNone(record.number_plate)
            self.assertEqual(record.ocr_status, "PENDING_VERIFICATION")

        record.add_plate_observation(self._valid_result("MH12AB1234"))

        self.assertEqual(record.number_plate, "MH12AB1234")
        self.assertIsNone(record.plate_candidate)
        self.assertEqual(record.ocr_status, "RECOGNIZED")

    def test_unobserved_plate_serializes_as_unrecognized_without_a_crop(self):
        record = TrackedVehicleRecord(
            track_id=3,
            vehicle_type="car",
            confidence=0.9,
            first_seen_frame=1,
            first_seen_timestamp="00:00:00.000",
            last_seen_frame=1,
            last_seen_timestamp="00:00:00.000",
            best_bbox=[0, 0, 220, 100],
        )

        payload = record.to_dict()

        self.assertIsNone(payload["numberPlate"])
        self.assertIsNone(payload["plateCandidate"])
        self.assertFalse(payload["numberPlateDetected"])
        self.assertIsNone(payload["plateCrop"])
        self.assertEqual(payload["ocrStatus"], "PLATE_NOT_DETECTED")

    def test_video_pipeline_does_not_invent_plate_when_localization_fails(self):
        frame = np.full((100, 220, 3), 80, dtype=np.uint8)
        fake_capture = self._FakeCapture(frame)
        service = VehicleVideoAnalysisService.__new__(VehicleVideoAnalysisService)
        service.conf_threshold = 0.4
        service.tracker = self._FakeTracker()
        service.event_store = SimpleNamespace(add_event=lambda event: None)
        service.plate_pipeline = NumberPlatePipeline(
            detector=NullPlateDetector(),
            ocr_engine=MockPlateOCR(canned_plate="MH12AB1234"),
        )

        with tempfile.TemporaryDirectory() as temp_dir:
            source = Path(temp_dir) / "short.mp4"
            source.write_bytes(b"fixture")
            output_json = Path(temp_dir) / "result.json"
            with patch("vehicle.service.vehicle_video_service.cv2.VideoCapture", return_value=fake_capture):
                result = service.process_video(
                    video_source=source,
                    output_json_path=output_json,
                    processing_fps=1,
                    save_annotated=False,
                    max_frames=1,
                    print_progress=False,
                )

        vehicle = result["vehicles"][0]
        self.assertIsNone(vehicle["numberPlate"])
        self.assertIsNone(vehicle["plateCandidate"])
        self.assertIsNone(vehicle["plateConfidence"])
        self.assertFalse(vehicle["numberPlateDetected"])
        self.assertIsNone(vehicle["plateCrop"])
        self.assertEqual(vehicle["ocrStatus"], "PLATE_NOT_DETECTED")

    def test_conflicting_video_reads_do_not_confirm_a_plate(self):
        record = TrackedVehicleRecord(
            track_id=2,
            vehicle_type="car",
            confidence=0.9,
            first_seen_frame=1,
            first_seen_timestamp="00:00:00.000",
            last_seen_frame=1,
            last_seen_timestamp="00:00:00.000",
            best_bbox=[0, 0, 220, 100],
        )

        for text in ("MH12AB1234", "MH12AB1234", "MH12AB1235"):
            record.add_plate_observation(self._valid_result(text))

        self.assertIsNone(record.number_plate)
        self.assertEqual(record.ocr_status, "PENDING_VERIFICATION")

    def test_live_voter_requires_three_matching_reads(self):
        voter = PlateVoter(window=5, stride=1, lock_count=3)

        for token, sharpness in ((1, 10.0), (2, 20.0), (3, 30.0)):
            result = {
                "plate_text": "MH12AB1234",
                "confidence": 0.95,
                "status": "ok",
                "_sharpness": sharpness,
                "_plate_crop": np.full_like(self.plate_crop, token),
                "_plate_bbox": [1, 1, 121, 33],
            }
            voter.add("vehicle-1", {**result, "_frame_token": token})
            if token < 3:
                self.assertEqual(voter.get_final("vehicle-1")["status"], "pending_verification")

        final = voter.get_final("vehicle-1")
        self.assertEqual(final["status"], "ok")
        self.assertTrue(final["_confirmed"])
        self.assertEqual(final["_frame_token"], 3)
        self.assertEqual(int(final["_plate_crop"][0, 0, 0]), 3)

    def test_positionally_corrected_live_read_never_auto_confirms(self):
        voter = PlateVoter(window=5, stride=1, lock_count=3)
        result = {
            "plate_text": "MH12AB1234",
            "confidence": 0.95,
            "status": "pending_verification",
            "_sharpness": 20.0,
        }

        for _ in range(4):
            voter.add("vehicle-2", result)

        final = voter.get_final("vehicle-2")
        self.assertEqual(final["status"], "pending_verification")
        self.assertFalse(final["_confirmed"])

    def test_live_voter_requires_a_localized_valid_plate_box(self):
        voter = PlateVoter(window=5, stride=1, lock_count=3)
        result = {
            "plate_text": "MH12AB1234",
            "confidence": 0.95,
            "status": "ok",
            "_sharpness": 20.0,
        }

        for _ in range(3):
            voter.add("vehicle-3", result)

        final = voter.get_final("vehicle-3")
        self.assertEqual(final["status"], "pending_verification")
        self.assertFalse(final["_confirmed"])

    def _valid_result(self, text):
        return PlateDetectionResult(
            detected=True,
            plate_bbox=(10, 10, 130, 42),
            plate_text=text,
            confidence=0.95,
            ocr_status="RECOGNITION_SUCCESSFUL",
            raw_ocr_text=text,
            is_valid_format=True,
            plate_crop=self.plate_crop,
        )

    class _FakeCapture:
        def __init__(self, frame):
            self.frame = frame
            self.read_count = 0

        def isOpened(self):
            return True

        def get(self, prop):
            return {
                cv2.CAP_PROP_FRAME_WIDTH: self.frame.shape[1],
                cv2.CAP_PROP_FRAME_HEIGHT: self.frame.shape[0],
                cv2.CAP_PROP_FPS: 1.0,
                cv2.CAP_PROP_FRAME_COUNT: 1,
            }.get(prop, 0)

        def read(self):
            self.read_count += 1
            return (True, self.frame.copy()) if self.read_count == 1 else (False, None)

        def release(self):
            pass

    class _FakeTracker:
        def reset(self):
            pass

        def update(self, frame, frame_idx, conf_threshold):
            track = SimpleNamespace(
                track_id=7,
                class_name="car",
                bbox=(10, 10, 210, 90),
                confidence=0.9,
                centroid=(110, 50),
                centroid_history=[],
            )
            return [track], 0.0


if __name__ == "__main__":
    unittest.main()
