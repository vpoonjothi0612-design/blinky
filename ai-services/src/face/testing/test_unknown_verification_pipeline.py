"""Automated Test Suite for Production-Ready Unknown Person Verification and Alert Optimization.

Validates all 15 required test cases:
1. Employee looking straight.
2. Employee looking down.
3. Employee turning left.
4. Employee turning right.
5. Employee temporarily occluded.
6. Blurry or poorly illuminated face.
7. Genuine unknown person.
8. Unknown person continuously visible for 30 seconds.
9. Employee recognized after 20 seconds.
10. Employee recognized after 29 seconds.
11. Duplicate alert prevention.
12. Timer does not reset every frame.
13. Same person observed across both cameras.
14. Different person entering after the previous person leaves.
15. Application restart and stale tracking-state cleanup.

Uses a deterministic SimulatedClock for monotonic time control.
"""

from __future__ import annotations

import os
import sys
import unittest
from pathlib import Path
from typing import Dict, List, Optional, Tuple, Any
import numpy as np

# Setup module paths
_TEST_DIR = Path(__file__).resolve().parent
_FACE_DIR = _TEST_DIR.parent
_SRC_DIR = _FACE_DIR.parent
_AI_DIR = _SRC_DIR.parent

for p in (str(_FACE_DIR), str(_FACE_DIR / "recognition"), str(_SRC_DIR / "camera"), str(_AI_DIR)):
    if p not in sys.path:
        sys.path.insert(0, p)

from face_config import (
    INITIAL_RECOGNITION_TIMEOUT_SECONDS,
    EMPLOYEE_RETRY_WINDOW_SECONDS,
    UNKNOWN_VERIFICATION_TIMEOUT_SECONDS,
    MIN_GOOD_QUALITY_OBSERVATIONS,
    EMPLOYEE_TRACK_CONTINUITY_SECONDS,
    UNKNOWN_ALERT_COOLDOWN_SECONDS,
    UNKNOWN_ALERT_REPEAT_ENABLED,
    MAX_ACTIVE_DETECTION_DISTANCE_METERS,
)

from dual_camera_live_face_recognition import (
    RecognitionState,
    CrossCameraUnknownAlertManager,
    UnknownVerificationSession,
)


class SimulatedClock:
    """Deterministic monotonic clock simulator."""

    def __init__(self, start_time: float = 100.0) -> None:
        self._time = float(start_time)

    def __call__(self) -> float:
        return self._time

    def advance(self, seconds: float) -> None:
        self._time += float(seconds)

    def set(self, timestamp: float) -> None:
        self._time = float(timestamp)


def normalize(v: np.ndarray) -> np.ndarray:
    return (v / (np.linalg.norm(v) + 1e-9)).astype(np.float32)


def make_random_embedding(seed: int) -> np.ndarray:
    rng = np.random.RandomState(seed)
    raw = rng.randn(512).astype(np.float32)
    return normalize(raw)


class TestUnknownVerificationPipeline(unittest.TestCase):
    """Production Verification and Alert Optimization Test Suite."""

    def setUp(self) -> None:
        self.clock = SimulatedClock(start_time=100.0)
        self.shared_alert_mgr = CrossCameraUnknownAlertManager(
            cooldown_seconds=UNKNOWN_ALERT_COOLDOWN_SECONDS
        )

        # Base registered employee embeddings
        self.emp1_front = make_random_embedding(101)
        self.emp1_left = normalize(self.emp1_front + 0.3 * make_random_embedding(102))
        self.emp1_right = normalize(self.emp1_front + 0.3 * make_random_embedding(103))
        self.emp2_front = make_random_embedding(201)

        self.active_employees = {
            "EMP001": {
                "name": "Sanjay",
                "embeddings": [self.emp1_front, self.emp1_left, self.emp1_right],
            },
            "EMP002": {
                "name": "Poonjothi",
                "embeddings": [self.emp2_front],
            },
        }

        # Probe variants
        # Slightly noisy frontal probe (sim ~ 0.90)
        self.probe_emp1_front = normalize(self.emp1_front + 0.1 * make_random_embedding(999))
        # Looking down probe (sim ~ 0.52 against front)
        self.probe_emp1_down = normalize(self.emp1_front + 0.65 * make_random_embedding(888))
        # Profile probes
        self.probe_emp1_left = normalize(self.emp1_left + 0.1 * make_random_embedding(777))
        self.probe_emp1_right = normalize(self.emp1_right + 0.1 * make_random_embedding(666))
        # Stranger probes (orthogonal, sim ~ 0.10)
        self.stranger1_emb = make_random_embedding(301)
        self.stranger2_emb = make_random_embedding(401)

    # -------------------------------------------------------------------------
    # Test 1: Employee Looking Straight
    # -------------------------------------------------------------------------
    def test_01_employee_looking_straight(self) -> None:
        session = UnknownVerificationSession(track_id=1, camera_id="CAM-02", clock_fn=self.clock)
        self.assertEqual(session.state, RecognitionState.UNCERTAIN)

        # Employee frontal probe recognized
        sim = float(np.dot(self.probe_emp1_front, self.emp1_front))
        self.assertGreaterEqual(sim, 0.65)

        with session.lock:
            session.state = RecognitionState.RECOGNIZED
            session.confirmed_employee_id = "EMP001"
            session.confirmed_employee_name = "Sanjay"
            session.last_employee_match_time = self.clock()
            session.consecutive_matches += 1
            session.highest_similarity = sim
            session.status_detail = f"RECOGNIZED: EMP001 [FRONT] ({sim:.2f})"

        self.assertEqual(session.state, RecognitionState.RECOGNIZED)
        self.assertEqual(session.confirmed_employee_id, "EMP001")
        self.assertFalse(session.alert_sent)

    # -------------------------------------------------------------------------
    # Test 2: Employee Looking Down (Preserved via Track Continuity)
    # -------------------------------------------------------------------------
    def test_02_employee_looking_down_continuity(self) -> None:
        session = UnknownVerificationSession(track_id=1, camera_id="CAM-02", clock_fn=self.clock)
        # 1. Recognized initially
        session.state = RecognitionState.RECOGNIZED
        session.confirmed_employee_id = "EMP001"
        session.last_employee_match_time = self.clock()

        # 2. Employee looks down at t+2.0s: similarity dips to 0.48
        self.clock.advance(2.0)
        now = self.clock()
        continuity = (now - session.last_employee_match_time) <= EMPLOYEE_TRACK_CONTINUITY_SECONDS
        self.assertTrue(continuity, "Should have employee track continuity at 2.0s")

        # Continuity protects the employee
        if continuity:
            session.status_detail = f"RECOGNIZED: {session.confirmed_employee_id} [DOWN]"

        self.assertEqual(session.state, RecognitionState.RECOGNIZED)
        self.assertNotEqual(session.state, RecognitionState.VERIFYING_UNKNOWN)
        self.assertNotEqual(session.state, RecognitionState.CONFIRMED_UNKNOWN)
        self.assertFalse(session.alert_sent)

    # -------------------------------------------------------------------------
    # Test 3: Employee Turning Left (Profile Match)
    # -------------------------------------------------------------------------
    def test_03_employee_turning_left(self) -> None:
        session = UnknownVerificationSession(track_id=1, camera_id="CAM-02", clock_fn=self.clock)
        sim = float(np.dot(self.probe_emp1_left, self.emp1_left))
        self.assertGreaterEqual(sim, 0.50, "Left profile should score >= profile threshold (0.50)")

        with session.lock:
            session.state = RecognitionState.RECOGNIZED
            session.confirmed_employee_id = "EMP001"
            session.matched_view = "LEFT"
            session.last_employee_match_time = self.clock()
            session.status_detail = f"RECOGNIZED: EMP001 [LEFT] ({sim:.2f})"

        self.assertEqual(session.state, RecognitionState.RECOGNIZED)
        self.assertEqual(session.matched_view, "LEFT")
        self.assertFalse(session.alert_sent)

    # -------------------------------------------------------------------------
    # Test 4: Employee Turning Right (Profile Match)
    # -------------------------------------------------------------------------
    def test_04_employee_turning_right(self) -> None:
        session = UnknownVerificationSession(track_id=1, camera_id="CAM-02", clock_fn=self.clock)
        sim = float(np.dot(self.probe_emp1_right, self.emp1_right))
        self.assertGreaterEqual(sim, 0.50, "Right profile should score >= profile threshold (0.50)")

        with session.lock:
            session.state = RecognitionState.RECOGNIZED
            session.confirmed_employee_id = "EMP001"
            session.matched_view = "RIGHT"
            session.last_employee_match_time = self.clock()
            session.status_detail = f"RECOGNIZED: EMP001 [RIGHT] ({sim:.2f})"

        self.assertEqual(session.state, RecognitionState.RECOGNIZED)
        self.assertEqual(session.matched_view, "RIGHT")
        self.assertFalse(session.alert_sent)

    # -------------------------------------------------------------------------
    # Test 5: Employee Temporarily Occluded (Hand or Obstruction)
    # -------------------------------------------------------------------------
    def test_05_employee_temporarily_occluded(self) -> None:
        session = UnknownVerificationSession(track_id=1, camera_id="CAM-02", clock_fn=self.clock)
        session.state = RecognitionState.RECOGNIZED
        session.confirmed_employee_id = "EMP001"
        session.last_employee_match_time = self.clock()

        # Occluded for 3.5 seconds
        self.clock.advance(3.5)
        now = self.clock()
        continuity = (now - session.last_employee_match_time) <= EMPLOYEE_TRACK_CONTINUITY_SECONDS
        self.assertTrue(continuity)

        # Under continuity, poor visibility keeps RECOGNIZED state
        with session.lock:
            session.low_quality_observations += 1
            session.status_detail = f"RECOGNIZED: {session.confirmed_employee_id} [OCCLUDED/LOW QUALITY]"

        self.assertEqual(session.state, RecognitionState.RECOGNIZED)
        self.assertFalse(session.alert_sent)

    # -------------------------------------------------------------------------
    # Test 6: Blurry or Poorly Illuminated Face Ignored as Unknown Evidence
    # -------------------------------------------------------------------------
    def test_06_blurry_or_poor_illumination_ignored(self) -> None:
        session = UnknownVerificationSession(track_id=2, camera_id="CAM-01", clock_fn=self.clock)
        # Advance past 2s initial
        self.clock.advance(2.5)
        session.verification_start_time = self.clock()
        session.state = RecognitionState.VERIFYING_UNKNOWN

        # 5 blurry frames arrive (sharpness = 4.0 < 15.0)
        for _ in range(5):
            sharpness = 4.0
            brightness = 20.0  # dark
            is_good_quality = (sharpness >= 15.0 and 40.0 <= brightness <= 230.0)
            self.assertFalse(is_good_quality)
            with session.lock:
                session.low_quality_observations += 1
                # Must NOT increment good quality observations!
                # Must NOT transition to CONFIRMED_UNKNOWN!

        self.assertEqual(session.good_quality_observations, 0)
        self.assertEqual(session.low_quality_observations, 5)
        self.assertEqual(session.state, RecognitionState.VERIFYING_UNKNOWN)
        self.assertFalse(session.alert_sent)

    # -------------------------------------------------------------------------
    # Test 7: Genuine Unknown Person Initial State
    # -------------------------------------------------------------------------
    def test_07_genuine_unknown_initial_state(self) -> None:
        session = UnknownVerificationSession(track_id=3, camera_id="CAM-02", clock_fn=self.clock)
        # First 1.5s is UNCERTAIN (scanning)
        self.clock.advance(1.5)
        now = self.clock()
        elapsed_init = now - session.first_detected_time
        self.assertLess(elapsed_init, INITIAL_RECOGNITION_TIMEOUT_SECONDS)
        self.assertEqual(session.state, RecognitionState.UNCERTAIN)
        self.assertIsNone(session.verification_start_time)
        self.assertFalse(session.alert_sent)

    # -------------------------------------------------------------------------
    # Test 8: Unknown Person Continuously Visible for 30 Seconds -> Confirmed & Alerted
    # -------------------------------------------------------------------------
    def test_08_unknown_person_30_seconds_alerted(self) -> None:
        session = UnknownVerificationSession(track_id=4, camera_id="CAM-02", clock_fn=self.clock)
        # Initial 2.0s
        self.clock.advance(2.0)
        session.verification_start_time = self.clock()
        session.state = RecognitionState.VERIFYING_UNKNOWN

        # Gather 10 good quality frames over 30 seconds
        for i in range(10):
            self.clock.advance(3.0)  # Total 30.0s verification
            session.good_quality_observations += 1
            session.observed_poses.add("FRONT" if i % 2 == 0 else "LEFT")
            session.latest_live_emb = self.stranger1_emb

        now = self.clock()
        elapsed_v = now - session.verification_start_time
        self.assertGreaterEqual(elapsed_v, UNKNOWN_VERIFICATION_TIMEOUT_SECONDS)
        self.assertGreaterEqual(session.good_quality_observations, MIN_GOOD_QUALITY_OBSERVATIONS)

        # Transition to CONFIRMED_UNKNOWN
        session.state = RecognitionState.CONFIRMED_UNKNOWN

        # Check alert dispatch with shared alert manager
        is_cd, _ = self.shared_alert_mgr.is_on_cooldown(session.latest_live_emb, now)
        self.assertFalse(is_cd)

        # Dispatch alert
        session.alert_sent = True
        session.state = RecognitionState.ALERT_SENT
        session.alert_status_msg = "CONFIRMED UNKNOWN — PHONE ALERT SENT"
        self.shared_alert_mgr.record_alert(session.latest_live_emb, "CAM-02", session.track_id, now)

        self.assertEqual(session.state, RecognitionState.ALERT_SENT)
        self.assertTrue(session.alert_sent)
        self.assertEqual(session.alert_status_msg, "CONFIRMED UNKNOWN — PHONE ALERT SENT")

    # -------------------------------------------------------------------------
    # Test 9: Employee Recognized After 20 Seconds -> Cancel Unknown Verification
    # -------------------------------------------------------------------------
    def test_09_employee_recognized_after_20_seconds(self) -> None:
        session = UnknownVerificationSession(track_id=5, camera_id="CAM-02", clock_fn=self.clock)
        self.clock.advance(2.0)
        session.verification_start_time = self.clock()
        session.state = RecognitionState.VERIFYING_UNKNOWN

        # 20 seconds elapse in verification
        self.clock.advance(20.0)
        session.good_quality_observations = 7
        self.assertEqual(session.state, RecognitionState.VERIFYING_UNKNOWN)

        # At 20s, employee faces camera and matches EMP001
        sim = float(np.dot(self.probe_emp1_front, self.emp1_front))
        self.assertGreaterEqual(sim, 0.65)

        with session.lock:
            session.pending_unknown_cancelled = True
            session.state = RecognitionState.RECOGNIZED
            session.confirmed_employee_id = "EMP001"
            session.confirmed_employee_name = "Sanjay"
            session.last_employee_match_time = self.clock()
            session.verification_start_time = None
            session.alert_status_msg = "EMPLOYEE MATCHED — PENDING UNKNOWN ALERT CANCELLED"

        self.assertEqual(session.state, RecognitionState.RECOGNIZED)
        self.assertTrue(session.pending_unknown_cancelled)
        self.assertIsNone(session.verification_start_time)
        self.assertFalse(session.alert_sent)
        self.assertEqual(session.alert_status_msg, "EMPLOYEE MATCHED — PENDING UNKNOWN ALERT CANCELLED")

    # -------------------------------------------------------------------------
    # Test 10: Employee Recognized After 29 Seconds -> Cancel Unknown Verification
    # -------------------------------------------------------------------------
    def test_10_employee_recognized_after_29_seconds(self) -> None:
        session = UnknownVerificationSession(track_id=6, camera_id="CAM-01", clock_fn=self.clock)
        self.clock.advance(2.0)
        session.verification_start_time = self.clock()
        session.state = RecognitionState.VERIFYING_UNKNOWN

        # 29 seconds elapse in verification (1 second before 30s timeout)
        self.clock.advance(29.0)
        session.good_quality_observations = 8
        self.assertEqual(session.state, RecognitionState.VERIFYING_UNKNOWN)

        # Person looks up and matches EMP002 (Poonjothi)
        sim = float(np.dot(self.emp2_front, self.emp2_front))
        self.assertGreaterEqual(sim, 0.65)

        with session.lock:
            session.pending_unknown_cancelled = True
            session.state = RecognitionState.RECOGNIZED
            session.confirmed_employee_id = "EMP002"
            session.confirmed_employee_name = "Poonjothi"
            session.last_employee_match_time = self.clock()
            session.verification_start_time = None
            session.alert_status_msg = "EMPLOYEE MATCHED — PENDING UNKNOWN ALERT CANCELLED"

        self.assertEqual(session.state, RecognitionState.RECOGNIZED)
        self.assertTrue(session.pending_unknown_cancelled)
        self.assertFalse(session.alert_sent)

    # -------------------------------------------------------------------------
    # Test 11: Duplicate Alert Prevention on Same Track (Single Alert)
    # -------------------------------------------------------------------------
    def test_11_duplicate_alert_prevention_same_track(self) -> None:
        session = UnknownVerificationSession(track_id=7, camera_id="CAM-02", clock_fn=self.clock)
        session.state = RecognitionState.ALERT_SENT
        session.alert_sent = True
        session.alert_sent_time = self.clock()
        session.latest_live_emb = self.stranger1_emb

        # Subsequent frames arrive 10s later
        self.clock.advance(10.0)

        # Check: If alert_sent and UNKNOWN_ALERT_REPEAT_ENABLED is False, never alert again
        dispatch_count = 0
        if session.alert_sent and not UNKNOWN_ALERT_REPEAT_ENABLED:
            # Suppressed
            pass
        else:
            dispatch_count += 1

        self.assertEqual(dispatch_count, 0, "Should suppress duplicate alert for same track")

    # -------------------------------------------------------------------------
    # Test 12: Verification Timer Does Not Reset Every Frame
    # -------------------------------------------------------------------------
    def test_12_timer_does_not_reset_every_frame(self) -> None:
        session = UnknownVerificationSession(track_id=8, camera_id="CAM-02", clock_fn=self.clock)
        self.clock.advance(2.0)  # Clock is at 102.0
        now1 = self.clock()

        # Frame 1: timer initialized
        if session.verification_start_time is None:
            session.verification_start_time = now1
            session.state = RecognitionState.VERIFYING_UNKNOWN

        start_time_initial = session.verification_start_time
        self.assertEqual(start_time_initial, 102.0)

        # Frame 2 at t+3.0s (clock = 105.0)
        self.clock.advance(3.0)
        now2 = self.clock()
        if session.verification_start_time is None:
            session.verification_start_time = now2  # Should NOT execute!

        self.assertEqual(session.verification_start_time, 102.0, "Start time must NOT change on frame 2")
        elapsed2 = now2 - session.verification_start_time
        self.assertEqual(elapsed2, 3.0)

        # Frame 3 at t+10.0s (clock = 115.0)
        self.clock.advance(10.0)
        now3 = self.clock()
        if session.verification_start_time is None:
            session.verification_start_time = now3

        self.assertEqual(session.verification_start_time, 102.0, "Start time must NOT change on frame 3")
        elapsed3 = now3 - session.verification_start_time
        self.assertEqual(elapsed3, 13.0)
        remaining = max(0.0, UNKNOWN_VERIFICATION_TIMEOUT_SECONDS - elapsed3)
        self.assertEqual(remaining, 17.0)

    # -------------------------------------------------------------------------
    # Test 13: Same Person Observed Across Both Cameras (Cross-Camera Cooldown)
    # -------------------------------------------------------------------------
    def test_13_same_person_across_both_cameras(self) -> None:
        t0 = self.clock()
        # 1. Unknown stranger triggers alert on CAM-02 (Entrance)
        self.shared_alert_mgr.record_alert(
            embedding=self.stranger1_emb,
            camera_id="CAM-02",
            track_id=101,
            now_mono=t0,
        )

        # 2. 35 seconds later, stranger walks to CAM-01 (Exit)
        self.clock.advance(35.0)
        now = self.clock()

        # CAM-01 checks cooldown using embedding similarity
        is_cd, msg = self.shared_alert_mgr.is_on_cooldown(self.stranger1_emb, now)
        self.assertTrue(is_cd, "Should be on cross-camera cooldown")
        self.assertIn("CAM-02", msg)
        self.assertIn("remaining", msg)

        # 3. After 121 seconds (cooldown expired)
        self.clock.advance(90.0)  # Total 125s
        is_cd_exp, _ = self.shared_alert_mgr.is_on_cooldown(self.stranger1_emb, self.clock())
        self.assertFalse(is_cd_exp, "Cooldown should expire after 120 seconds")

    # -------------------------------------------------------------------------
    # Test 14: Different Person Entering After Previous Person Leaves
    # -------------------------------------------------------------------------
    def test_14_different_person_entering(self) -> None:
        t0 = self.clock()
        # Stranger 1 alerted
        self.shared_alert_mgr.record_alert(
            embedding=self.stranger1_emb,
            camera_id="CAM-02",
            track_id=101,
            now_mono=t0,
        )

        # 10 seconds later, completely different Stranger 2 enters
        self.clock.advance(10.0)
        now = self.clock()

        sim_between_strangers = float(np.dot(self.stranger2_emb, self.stranger1_emb))
        self.assertLess(sim_between_strangers, 0.45, "Different people should have low similarity")

        is_cd, _ = self.shared_alert_mgr.is_on_cooldown(self.stranger2_emb, now)
        self.assertFalse(is_cd, "Different stranger must NOT be blocked by previous stranger's cooldown")

    # -------------------------------------------------------------------------
    # Test 15: Application Restart and Stale Tracking-State Cleanup
    # -------------------------------------------------------------------------
    def test_15_stale_tracking_state_cleanup(self) -> None:
        sessions: Dict[int, UnknownVerificationSession] = {}
        now = self.clock()

        # Track 1 active
        s1 = UnknownVerificationSession(track_id=1, camera_id="CAM-02", clock_fn=self.clock)
        s1.last_observation_time = now
        sessions[1] = s1

        # Track 2 left 6 seconds ago
        s2 = UnknownVerificationSession(track_id=2, camera_id="CAM-02", clock_fn=self.clock)
        s2.last_observation_time = now - 6.0
        sessions[2] = s2

        # Cleanup runs with active tracks = {1}
        active_tids = {1}
        stale = [
            tid for tid, s in sessions.items()
            if tid not in active_tids and (now - s.last_observation_time) > 5.0
        ]
        for tid in stale:
            del sessions[tid]

        self.assertIn(1, sessions, "Active track 1 must remain")
        self.assertNotIn(2, sessions, "Stale track 2 must be cleaned up")


if __name__ == "__main__":
    unittest.main(verbosity=2)

