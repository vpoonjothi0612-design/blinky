import sys
import tempfile
import unittest
from pathlib import Path
from unittest.mock import patch

import cv2
import numpy as np

AI_ROOT = Path(__file__).resolve().parents[3]
sys.path.insert(0, str(AI_ROOT / "src" / "surveillance"))
from gate_classifier import (  # noqa: E402
    GateObjectClassifierPipeline,
    ObjectTrack,
    classify_face_orientation,
    estimate_yunet_pose,
    crop_face_passport,
    map_yunet_face_to_frame,
)
from gate_hud import draw_gate_surveillance_hud, person_status_color, should_draw_body_box  # noqa: E402


class GateFaceLifecycleTests(unittest.TestCase):
    def test_person_body_box_is_hidden_when_show_body_box_is_false(self):
        self.assertFalse(should_draw_body_box("PERSON", show_body_box=False))
        self.assertTrue(should_draw_body_box("VEHICLE", show_body_box=False))

    def test_hud_colors_distinguish_recognition_statuses(self):
        self.assertEqual(person_status_color("REGISTERED"), (0, 220, 50))
        self.assertEqual(person_status_color("RECOGNITION_PENDING"), (255, 200, 0))
        self.assertEqual(person_status_color("LOW_FACE_QUALITY"), (0, 255, 255))
        self.assertEqual(person_status_color("FACE_NOT_VISIBLE"), (150, 150, 150))
        self.assertEqual(person_status_color("UNKNOWN_PERSON"), (0, 0, 255))

    def test_face_only_hud_draws_face_box_without_person_body_box_or_label(self):
        frame = np.zeros((240, 160, 3), dtype=np.uint8)
        person = {
            "class": "PERSON", "bbox": (10, 35, 100, 230), "face_bbox": (38, 70, 34, 42),
            "face_state": "FACE_EVALUATED", "face_landmarks": [], "track_id": 7,
        }
        with patch("gate_hud.SHOW_BODY_BOX", False), patch.object(cv2, "rectangle", wraps=cv2.rectangle) as rectangle:
            draw_gate_surveillance_hud(frame, [person], "CAM-02", "IN", 18.0)

        rectangles = [call.args[1:3] for call in rectangle.call_args_list]
        self.assertIn(((38, 70), (72, 112)), rectangles)
        self.assertNotIn(((10, 35), (100, 230)), rectangles)

    def pipeline(self):
        with patch.object(GateObjectClassifierPipeline, "_init_yolo", lambda self: None):
            pipeline = GateObjectClassifierPipeline("CAM-02", {"direction": "IN", "face_min_px": 48})
        pipeline.debug_dir = Path(tempfile.mkdtemp(prefix="facetrack-test-tracks-"))
        pipeline.face_recognition_min_interval_sec = 0.0
        return pipeline

    def person_track(self):
        return ObjectTrack(1, (20, 10, 180, 195), "PERSON", "person")

    def test_body_only_track_is_never_labeled_unknown(self):
        pipeline = self.pipeline()
        pipeline.tracks[1] = self.person_track()
        frame = np.full((220, 220, 3), 120, dtype=np.uint8)

        hud, events = pipeline.process_frame(frame, lambda _crop: None, None, None)

        self.assertEqual(hud[0]["face_state"], "FACE_NOT_VISIBLE")
        self.assertEqual(hud[0]["name"], "Person")
        self.assertFalse(any("UNKNOWN" in event["eventType"] for event in events))

    def test_small_face_has_explicit_state_and_no_unknown_event(self):
        pipeline = self.pipeline()
        pipeline.tracks[1] = self.person_track()
        frame = np.full((220, 220, 3), 120, dtype=np.uint8)
        face_row = np.array([45, 20, 30, 30, 52, 31, 67, 31, 60, 40, 54, 48, 66, 48, 0.95], dtype=np.float32)

        hud, events = pipeline.process_frame(frame, lambda _crop: np.array([face_row]), None, None)

        self.assertEqual(hud[0]["face_state"], "FACE_TOO_SMALL")
        self.assertFalse(any("UNKNOWN" in event["eventType"] for event in events))

    def test_face_extending_outside_frame_is_deferred_as_low_quality(self):
        pipeline = self.pipeline()
        pipeline.tracks[1] = ObjectTrack(1, (0, 0, 180, 200), "PERSON", "person")
        frame = np.random.default_rng(42).integers(80, 180, (220, 220, 3), dtype=np.uint8)
        clipped_face = np.array([-10, 30, 80, 80, 5, 50, 45, 50, 25, 60, 10, 75, 40, 75, 0.95], dtype=np.float32)
        recognizer_calls = []

        hud, events = pipeline.process_frame(
            frame,
            lambda _crop: np.array([clipped_face]),
            lambda *args: recognizer_calls.append(args),
            None,
        )

        self.assertEqual(hud[0]["recognition_status"], "LOW_FACE_QUALITY")
        self.assertEqual(recognizer_calls, [])
        self.assertFalse(any("UNKNOWN" in event["eventType"] for event in events))

    def test_face_candidate_is_recognized_against_its_own_source_frame(self):
        pipeline = self.pipeline()
        pipeline.tracks[1] = self.person_track()
        face_row = np.array([40, 30, 80, 80, 55, 55, 105, 55, 80, 83, 65, 100, 95, 100, 0.99], dtype=np.float32)
        first_frame = np.random.default_rng(1).integers(120, 145, (220, 220, 3), dtype=np.uint8)
        current_frame = np.random.default_rng(2).integers(60, 90, (220, 220, 3), dtype=np.uint8)

        pipeline.process_frame(first_frame, lambda _crop: np.array([face_row]), None, None)
        observed = []

        def recognizer(crop, _landmarks, source_frame, _bbox, _track_id):
            observed.append((crop.copy(), source_frame))
            return {"status": "RECOGNIZED", "employee_id": "EMP001", "similarity": 0.8}

        pipeline.process_frame(current_frame, lambda _crop: np.array([face_row]), recognizer, None)

        self.assertEqual(len(observed), 1)
        np.testing.assert_array_equal(observed[0][0], current_frame[30:110, 40:120])
        self.assertIs(observed[0][1], current_frame)

    def test_face_from_neighboring_person_is_not_added_to_track(self):
        pipeline = self.pipeline()
        track = ObjectTrack(1, (100, 10, 200, 190), "PERSON", "person")
        pipeline.tracks[1] = track
        frame = np.random.default_rng(42).integers(80, 180, (220, 260, 3), dtype=np.uint8)
        neighbor_face = np.array([-20, 20, 80, 80, -5, 40, 35, 40, 10, 50, 0, 65, 20, 65, 0.99], dtype=np.float32)
        track_face = np.array([50, 20, 80, 80, 65, 40, 105, 40, 85, 70, 70, 85, 100, 85, 0.95], dtype=np.float32)

        pipeline.process_frame(
            frame,
            lambda _crop: np.array([neighbor_face, track_face]),
            lambda *_args: {"status": "RECOGNITION_PENDING"},
            None,
        )

        self.assertEqual(len(track.best_face_crops), 1)
        self.assertEqual(track.best_face_crops[0].bbox[0], 120)

    def test_full_frame_face_fallback_runs_once_for_multiple_tracks(self):
        pipeline = self.pipeline()
        pipeline.tracks[1] = ObjectTrack(1, (20, 10, 100, 190), "PERSON", "person")
        pipeline.tracks[2] = ObjectTrack(2, (150, 10, 230, 190), "PERSON", "person")
        frame = np.full((220, 260, 3), 120, dtype=np.uint8)
        detector_calls = []

        def detector(crop):
            detector_calls.append(crop.shape)
            return None

        pipeline.process_frame(frame, detector, None, None)

        self.assertEqual(detector_calls.count(frame.shape), 1)
        self.assertEqual(len(detector_calls), 3)

    def test_yunet_landmarks_detect_profile_yaw(self):
        frontal = np.array([[30, 30], [70, 30], [50, 50], [38, 68], [62, 68]], dtype=np.float32)
        profile = frontal.copy()
        profile[2, 0] = 78

        frontal_yaw, _ = estimate_yunet_pose(frontal, 90)
        profile_yaw, _ = estimate_yunet_pose(profile, 90)

        self.assertLess(abs(frontal_yaw), 2)
        self.assertGreater(abs(profile_yaw), 35)

    def test_face_orientation_classification_distinguishes_front_and_side_angles(self):
        self.assertEqual(classify_face_orientation(0), "FRONT")
        self.assertEqual(classify_face_orientation(-25), "FRONT_LEFT")
        self.assertEqual(classify_face_orientation(25), "FRONT_RIGHT")
        self.assertEqual(classify_face_orientation(-55), "LEFT_PROFILE")
        self.assertEqual(classify_face_orientation(55), "RIGHT_PROFILE")
        self.assertEqual(classify_face_orientation(70), "UNKNOWN_ORIENTATION")

    def test_yunet_coordinates_map_to_full_resolution_frame(self):
        face = np.array([20, 30, 80, 90, 35, 50, 80, 50, 58, 70, 42, 98, 74, 98, 0.9], dtype=np.float32)
        bbox, landmarks = map_yunet_face_to_frame(face, origin=(640, 360), scale=0.5)
        self.assertEqual(bbox, (680, 420, 160, 180))
        np.testing.assert_allclose(landmarks[0], [710, 460])

    def test_passport_crop_is_centered_on_full_resolution_face(self):
        frame = np.zeros((720, 1280, 3), dtype=np.uint8)
        # A colored marker at the known full-resolution face center must remain
        # near the center of the resulting passport portrait.
        frame[310:390, 590:670] = (20, 210, 30)
        portrait = crop_face_passport(frame, (590, 310, 80, 80))
        self.assertIsNotNone(portrait)
        self.assertAlmostEqual(portrait.shape[1] / portrait.shape[0], 3.5 / 4.5, delta=0.01)
        self.assertGreater(float(portrait[portrait.shape[0] // 2, portrait.shape[1] // 2, 1]), 150)

    def test_profile_face_reaches_recognizer_and_is_classified(self):
        pipeline = self.pipeline()
        pipeline.tracks[1] = self.person_track()
        frame = np.random.default_rng(42).integers(80, 180, (220, 220, 3), dtype=np.uint8)
        face_row = np.array([40, 30, 80, 80, 50, 50, 90, 50, 98, 64, 60, 90, 80, 90, 0.95], dtype=np.float32)
        recognizer_calls = []

        def recognizer(*args):
            recognizer_calls.append(args)
            return {"status": "RECOGNIZED", "employee_id": "EMP001", "similarity": 0.81}

        hud, events = pipeline.process_frame(frame, lambda _crop: np.array([face_row]), recognizer, None)

        self.assertEqual(hud[0]["face_state"], "FACE_EVALUATED")
        self.assertEqual(hud[0]["human_orientation"], "RIGHT_PROFILE")
        self.assertEqual(hud[0]["recognition_status"], "RECOGNITION_PENDING")
        self.assertEqual(len(recognizer_calls), 1)
        self.assertFalse(any("UNKNOWN" in event["eventType"] for event in events))

    def test_frontal_face_pitch_gate_is_not_relaxed_for_profile_support(self):
        pipeline = self.pipeline()
        pipeline.tracks[1] = self.person_track()
        frame = np.random.default_rng(42).integers(80, 180, (220, 220, 3), dtype=np.uint8)
        face_row = np.array([40, 30, 80, 80, 55, 50, 105, 50, 80, 64, 65, 90, 95, 90, 0.95], dtype=np.float32)
        recognizer_calls = []

        hud, events = pipeline.process_frame(
            frame,
            lambda _crop: np.array([face_row]),
            lambda *args: recognizer_calls.append(args),
            None,
        )

        self.assertEqual(hud[0]["face_state"], "FACE_TURNED_AWAY")
        self.assertEqual(hud[0]["human_orientation"], "FRONT")
        self.assertEqual(recognizer_calls, [])
        self.assertFalse(any("UNKNOWN" in event["eventType"] for event in events))

    def test_recognition_errors_never_vote_as_unknown(self):
        pipeline = self.pipeline()
        pipeline.tracks[1] = self.person_track()
        rng = np.random.default_rng(9)
        face_row = np.array([40, 30, 80, 80, 55, 55, 105, 55, 80, 83, 65, 100, 95, 100, 0.99], dtype=np.float32)

        def failing_recognizer(*_args):
            raise RuntimeError("model unavailable")

        all_events = []
        for _ in range(3):
            hud, events = pipeline.process_frame(
                rng.integers(80, 180, (220, 220, 3), dtype=np.uint8),
                lambda _crop: np.array([face_row]),
                failing_recognizer,
                None,
            )
            all_events.extend(events)

        self.assertEqual(hud[0]["face_state"], "RECOGNITION_ERROR")
        self.assertEqual(hud[0]["recognition_status"], "RECOGNITION_ERROR")
        self.assertEqual(list(pipeline.tracks[1].face_identity_votes), ["__DEFERRED__"] * 3)
        self.assertFalse(any("UNKNOWN" in event["eventType"] for event in all_events))

    def test_recognition_sampling_limits_near_duplicate_frame_inference(self):
        pipeline = self.pipeline()
        pipeline.face_recognition_min_interval_sec = 0.2
        pipeline.tracks[1] = self.person_track()
        frame = np.random.default_rng(42).integers(80, 180, (220, 220, 3), dtype=np.uint8)
        face_row = np.array([40, 30, 80, 80, 55, 55, 105, 55, 80, 83, 65, 100, 95, 100, 0.99], dtype=np.float32)
        calls = []
        clock = [100.0]
        recognizer = lambda *_args: calls.append(clock[0]) or {"status": "UNKNOWN", "similarity": 0.2}

        with patch("gate_classifier.time.monotonic", side_effect=lambda: clock[0]):
            pipeline.process_frame(frame, lambda _crop: np.array([face_row]), recognizer, None)
            clock[0] = 100.1
            pipeline.process_frame(frame, lambda _crop: np.array([face_row]), recognizer, None)
            clock[0] = 100.21
            pipeline.process_frame(frame, lambda _crop: np.array([face_row]), recognizer, None)

        self.assertEqual(calls, [100.0, 100.21])
        self.assertEqual(list(pipeline.tracks[1].face_identity_votes), ["__UNKNOWN__", "__UNKNOWN__"])

    def test_unknown_requires_repeated_face_failures_and_track_exit(self):
        pipeline = self.pipeline()
        track = self.person_track()
        pipeline.tracks[1] = track
        rng = np.random.default_rng(9)
        face_row = np.array([40, 30, 80, 80, 55, 55, 105, 55, 80, 83, 65, 100, 95, 100, 0.99], dtype=np.float32)
        recognizer = lambda *_args: {"status": "UNKNOWN", "similarity": 0.20, "threshold": 0.48}

        with (
            patch.object(pipeline, "_save_jpeg"),
            patch.object(pipeline, "_save_passport_crop"),
            patch.object(pipeline, "_save_person_capture_bundle", return_value={"face_passport_path": "test-face.jpg", "frame_path": "test-frame.jpg"}),
            patch.object(pipeline, "_post_event_async"),
            patch.object(pipeline, "_post_unknown_review_async"),
        ):
            _, first_events = pipeline.process_frame(rng.integers(80, 180, (220, 220, 3), dtype=np.uint8), lambda _crop: np.array([face_row]), recognizer, None)
            _, second_events = pipeline.process_frame(rng.integers(80, 180, (220, 220, 3), dtype=np.uint8), lambda _crop: np.array([face_row]), recognizer, None)
            self.assertFalse(first_events or second_events)

            track.update_box((20, 0, 180, 90), "PERSON", "person")
            _, exit_one = pipeline.process_frame(rng.integers(80, 180, (220, 220, 3), dtype=np.uint8), lambda _crop: np.array([face_row]), recognizer, None)
            _, exit_two = pipeline.process_frame(rng.integers(80, 180, (220, 220, 3), dtype=np.uint8), lambda _crop: np.array([face_row]), recognizer, None)
            track.left_gate = True
            hud, exit_three = pipeline.process_frame(rng.integers(80, 180, (220, 220, 3), dtype=np.uint8), lambda _crop: np.array([face_row]), recognizer, None)

        self.assertFalse(exit_one or exit_two)
        self.assertEqual(hud[0]["face_state"], "UNKNOWN")
        self.assertEqual(exit_three[0]["eventType"], "PERSON_UNKNOWN_IN")

    def test_no_face_exit_event_uses_body_crop_and_review_label(self):
        pipeline = self.pipeline()
        track = self.person_track()
        track.ever_in_gate = True
        track.last_body_crop = np.ones((32, 24, 3), dtype=np.uint8)
        track.last_body_timestamp = "2026-11-16T15:30:00+05:30"
        with patch.object(pipeline, "_save_person_capture_bundle", return_value={"face_passport_path": None, "body_path": "captures/CAM-02/1/1/body.jpg", "frame_path": "captures/CAM-02/1/1/frame.jpg"}) as save_bundle, patch.object(pipeline, "_post_unknown_review_async"):
            event = pipeline._make_no_face_event(track)

        self.assertEqual(event["eventType"], "NO_FACE_CAPTURED")
        self.assertEqual(event["name"], "Face not captured")
        self.assertIsNone(event["imageFace"])
        self.assertEqual(event["metadata"]["body_path"], "captures/CAM-02/1/1/body.jpg")
        save_bundle.assert_called_once()
        self.assertEqual(event["timestamp"], track.last_body_timestamp)
        self.assertEqual(track.face_state, "NO_FACE_CAPTURED")

    def test_downward_only_observations_finalize_no_face_as_turned_away(self):
        pipeline = self.pipeline()
        track = self.person_track()
        track.last_body_crop = np.ones((32, 24, 3), dtype=np.uint8)
        track.note_face_rejection("FACE_TURNED_AWAY", "Face turned away (yaw=2.0°, pitch=-35.0°)")
        with patch.object(pipeline, "_save_person_capture_bundle", return_value={"face_passport_path": None, "body_path": "body.jpg", "frame_path": "frame.jpg"}), patch.object(pipeline, "_post_unknown_review_async"):
            event = pipeline._make_no_face_event(track)
        self.assertEqual(event["eventType"], "NO_FACE_CAPTURED")
        self.assertEqual(event["faceReason"], "FACE_TURNED_AWAY")
        self.assertIsNone(event["imageFace"])
        self.assertEqual(event["metadata"]["reason"], "Face turned away (looking down)")


if __name__ == "__main__":
    unittest.main()
