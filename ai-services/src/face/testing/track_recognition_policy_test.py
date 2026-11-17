"""Automated Verification & Performance Test Suite for TrackRecognitionPolicy (Step 4A).

Validates all 10 policy requirements:
1. New track triggers recognition.
2. Confirmed track does not run ArcFace every frame.
3. Track identity is preserved.
4. Multiple tracks maintain separate identities.
5. Unknown track can be retried.
6. Ambiguous track is not permanently identified.
7. Expired track state is removed.
8. Liveness failure invalidates/restricts identity appropriately.
9. Track reset clears state.
10. Recognition count is measurable.

Includes an empirical 100-frame video benchmark measuring exact ArcFace neural invocations,
latency, processing time, and effective FPS comparing WITH vs WITHOUT policy.
"""

from __future__ import annotations

import os
import sys
import time
from pathlib import Path
from typing import Dict, List, Tuple, Any

import cv2
import numpy as np

# Ensure src/face is in sys.path
SCRIPT_DIR = Path(__file__).resolve().parent
FACE_DIR = SCRIPT_DIR.parent
AI_SERVICES_DIR = FACE_DIR.parent.parent

if str(FACE_DIR) not in sys.path:
    sys.path.append(str(FACE_DIR))

from service import (
    FaceRecognitionService,
    FaceRecognitionResult,
    TrackRecognitionPolicy,
    TrackState,
)
from face_config import (
    ENROLLMENT_BASE_DIR,
    RECOGNITION_THRESHOLD,
    DEFAULT_MIN_MATCH_MARGIN,
    TRACK_REVALIDATION_INTERVAL_FRAMES,
    TRACK_UNKNOWN_RETRY_INTERVAL_FRAMES,
    TRACK_MAX_MISSED_FRAMES,
    TRACK_MAX_CONSECUTIVE_LOW_QUALITY,
)


def run_track_policy_test_suite() -> Dict[str, Any]:
    print("=" * 70)
    print("STEP 4A: TRACK-BASED FACE RECOGNITION POLICY TEST SUITE")
    print("=" * 70)

    test_results: Dict[str, Tuple[str, str]] = {}

    # Initialize Service
    service = FaceRecognitionService(
        recognition_threshold=RECOGNITION_THRESHOLD,
        min_match_margin=DEFAULT_MIN_MATCH_MARGIN,
        use_track_policy=True,
        track_revalidation_interval=30,
        track_unknown_retry_interval=10,
        track_max_missed_frames=15,
    )

    # Load test frames
    img_emp001_path = ENROLLMENT_BASE_DIR / "EMP001" / "EMP001_angle_02_front.jpg"
    frame_emp001 = cv2.imread(str(img_emp001_path))
    assert frame_emp001 is not None, f"Failed to load {img_emp001_path}"

    img_emp002_path = ENROLLMENT_BASE_DIR / "EMP002" / "EMP002_angle_01_front.jpg"
    frame_emp002 = cv2.imread(str(img_emp002_path))
    assert frame_emp002 is not None, f"Failed to load {img_emp002_path}"

    img_sharp_unk = AI_SERVICES_DIR / "unregistered_person_sharp.jpg"
    img_unknown_path = img_sharp_unk if img_sharp_unk.exists() else (AI_SERVICES_DIR / "different_person_clear.jpg")
    frame_unknown = cv2.imread(str(img_unknown_path))
    assert frame_unknown is not None, f"Failed to load {img_unknown_path}"

    # -------------------------------------------------------------------------
    # Test 1: New track triggers recognition
    # -------------------------------------------------------------------------
    print("\n[TEST 1] New track triggers recognition...")
    service.reset_tracker()
    service.reset_arcface_call_count()

    results_f1 = service.process_frame(frame_emp001, enable_liveness=False)
    t1_pass = (
        len(results_f1) == 1
        and results_f1[0].status == "RECOGNIZED"
        and results_f1[0].employee_id == "EMP001"
        and results_f1[0].recognition_source == "NEW_RECOGNITION"
        and service.arcface_call_count == 1
    )
    test_results["1. New Track Triggers Recognition"] = (
        "PASS" if t1_pass else "FAIL",
        f"Status={results_f1[0].status}, Source={results_f1[0].recognition_source}, Calls={service.arcface_call_count}",
    )
    print(f"  Result : {'PASS' if t1_pass else 'FAIL'} (Source={results_f1[0].recognition_source}, ArcFace calls={service.arcface_call_count})")

    # -------------------------------------------------------------------------
    # Test 2: Confirmed track does not run ArcFace every frame
    # -------------------------------------------------------------------------
    print("\n[TEST 2] Confirmed track skips ArcFace on subsequent frames...")
    initial_calls = service.arcface_call_count
    results_f2 = service.process_frame(frame_emp001, enable_liveness=False)

    t2_pass = (
        len(results_f2) == 1
        and results_f2[0].status == "RECOGNIZED"
        and results_f2[0].employee_id == "EMP001"
        and results_f2[0].recognition_source == "REUSED_FROM_TRACK"
        and service.arcface_call_count == initial_calls
    )
    test_results["2. Skip ArcFace on Confirmed Track"] = (
        "PASS" if t2_pass else "FAIL",
        f"Source={results_f2[0].recognition_source}, Calls={service.arcface_call_count} (Delta: +{service.arcface_call_count - initial_calls})",
    )
    print(f"  Result : {'PASS' if t2_pass else 'FAIL'} (Source={results_f2[0].recognition_source}, ArcFace calls={service.arcface_call_count})")

    # -------------------------------------------------------------------------
    # Test 3: Track identity is preserved
    # -------------------------------------------------------------------------
    print("\n[TEST 3] Track identity is preserved over consecutive frames...")
    preserved_consistently = True
    for i in range(3, 15):
        res = service.process_frame(frame_emp001, enable_liveness=False)
        if not (
            len(res) == 1
            and res[0].status == "RECOGNIZED"
            and res[0].employee_id == "EMP001"
            and res[0].recognition_source == "REUSED_FROM_TRACK"
        ):
            preserved_consistently = False
            break

    t3_pass = preserved_consistently and (service.arcface_call_count == initial_calls)
    test_results["3. Track Identity Preserved"] = (
        "PASS" if t3_pass else "FAIL",
        f"Preserved across 15 frames without extra ArcFace calls (Total calls={service.arcface_call_count})",
    )
    print(f"  Result : {'PASS' if t3_pass else 'FAIL'} (15 frames verified, ArcFace calls={service.arcface_call_count})")

    # -------------------------------------------------------------------------
    # Test 4: Multiple tracks maintain separate identities
    # -------------------------------------------------------------------------
    print("\n[TEST 4] Multiple tracks maintain separate identities...")
    service.reset_tracker()
    service.reset_arcface_call_count()

    h1, w1 = frame_emp001.shape[:2]
    h2, w2 = frame_emp002.shape[:2]
    target_h = min(h1, h2, 480)
    img1_scaled = cv2.resize(frame_emp001, (int(w1 * target_h / h1), target_h))
    img2_scaled = cv2.resize(frame_emp002, (int(w2 * target_h / h2), target_h))
    dual_frame = np.hstack([img1_scaled, img2_scaled])

    # First frame -> both new
    dual_f1 = service.process_frame(dual_frame, enable_liveness=False)
    d1_map = {r.track_id: r.employee_id for r in dual_f1}
    calls_after_f1 = service.arcface_call_count

    # Second frame -> both reused
    dual_f2 = service.process_frame(dual_frame, enable_liveness=False)
    d2_map = {r.track_id: r.employee_id for r in dual_f2}
    d2_sources = [r.recognition_source for r in dual_f2]
    calls_after_f2 = service.arcface_call_count

    t4_pass = (
        len(dual_f1) == 2
        and set(d1_map.values()) == {"EMP001", "EMP002"}
        and len(dual_f2) == 2
        and set(d2_map.values()) == {"EMP001", "EMP002"}
        and d1_map == d2_map  # Track ID mapping strictly retained
        and all(s == "REUSED_FROM_TRACK" for s in d2_sources)
        and calls_after_f2 == calls_after_f1  # Zero additional ArcFace calls on frame 2
    )
    test_results["4. Multiple Tracks Separate Identities"] = (
        "PASS" if t4_pass else "FAIL",
        f"Tracks: {d1_map} -> Frame 2 Reused: {d2_sources}, Calls={calls_after_f2}",
    )
    print(f"  Result : {'PASS' if t4_pass else 'FAIL'} (Tracks mapped: {d1_map}, Frame 2 calls delta: +{calls_after_f2 - calls_after_f1})")

    # -------------------------------------------------------------------------
    # Test 5: Unknown track can be retried
    # -------------------------------------------------------------------------
    print("\n[TEST 5] Unknown track retry scheduling...")
    service.reset_tracker()
    service.reset_arcface_call_count()

    # Frame 1: New unknown track -> ArcFace executes
    unk_f1 = service.process_frame(frame_unknown, enable_liveness=False)
    calls_u1 = service.arcface_call_count
    unk_res_1 = (
        len(unk_f1) == 1
        and unk_f1[0].status == "UNKNOWN"
        and unk_f1[0].employee_id is None
        and unk_f1[0].recognition_source == "NEW_RECOGNITION"
        and calls_u1 == 1
    )

    # Frames 2..10: Backoff retry window -> ArcFace skipped
    calls_intermediate = 0
    for i in range(2, 11):
        unk_fi = service.process_frame(frame_unknown, enable_liveness=False)
        assert unk_fi[0].recognition_source == "REUSED_FROM_TRACK"
    calls_u10 = service.arcface_call_count

    # Frame 11 (after 10 frames interval): Retry triggers ArcFace
    unk_f11 = service.process_frame(frame_unknown, enable_liveness=False)
    calls_u11 = service.arcface_call_count

    t5_pass = (
        unk_res_1
        and (calls_u10 == 1)  # No extra calls during frames 2-10
        and (calls_u11 == 2)  # Exactly 1 retry call on frame 11
        and unk_f11[0].status == "UNKNOWN"
        and unk_f11[0].employee_id is None
    )
    test_results["5. Unknown Track Retry Scheduling"] = (
        "PASS" if t5_pass else "FAIL",
        f"Frame 1 calls=1, Frame 2-10 calls={calls_u10}, Frame 11 retry calls={calls_u11}",
    )
    print(f"  Result : {'PASS' if t5_pass else 'FAIL'} (F1 calls={calls_u1}, F2-10 calls={calls_u10}, F11 retry calls={calls_u11})")

    # -------------------------------------------------------------------------
    # Test 6: Ambiguous track is not permanently identified
    # -------------------------------------------------------------------------
    print("\n[TEST 6] Ambiguous track safety check...")
    # Test via policy unit logic directly with clashing candidates
    policy = TrackRecognitionPolicy(min_match_margin=0.08)
    state = policy.record_recognition(
        track_id=99,
        frame_idx=1,
        timestamp=time.time(),
        bbox=(10, 10, 100, 100),
        liveness_status="LIVE",
        employee_id=None,
        name=None,
        status="AMBIGUOUS",
        similarity=0.72,
        second_candidate="EMP002",
        second_similarity=0.70,
        margin=0.02,  # Clashing margin
    )
    t6_pass = (
        state.identity_confirmation_state == "AMBIGUOUS"
        and state.employee_id is None
        and state.recognition_status == "AMBIGUOUS"
    )
    test_results["6. Ambiguous Track Unconfirmed"] = (
        "PASS" if t6_pass else "FAIL",
        f"Identity confirmation state: {state.identity_confirmation_state}, Employee ID: {state.employee_id}",
    )
    print(f"  Result : {'PASS' if t6_pass else 'FAIL'} (Confirmation State={state.identity_confirmation_state}, Employee={state.employee_id})")

    # -------------------------------------------------------------------------
    # Test 7: Expired track state is removed
    # -------------------------------------------------------------------------
    print("\n[TEST 7] Expired track pruning...")
    service.reset_tracker()
    # Feed face for 1 frame
    service.process_frame(frame_emp001, enable_liveness=False)
    tid = list(service.track_policy.tracks.keys())[0]
    has_track_init = tid in service.track_policy.tracks

    # Feed 16 blank/empty frames (> max_missed_frames = 15)
    blank_frame = np.zeros((480, 640, 3), dtype=np.uint8)
    for _ in range(16):
        service.process_frame(blank_frame, enable_liveness=False)

    has_track_after = tid in service.track_policy.tracks
    t7_pass = has_track_init and not has_track_after
    test_results["7. Expired Track Pruned"] = (
        "PASS" if t7_pass else "FAIL",
        f"Track {tid} active initially: {has_track_init}, after 16 blank frames: {has_track_after}",
    )
    print(f"  Result : {'PASS' if t7_pass else 'FAIL'} (Track present before: {has_track_init}, present after: {has_track_after})")

    # -------------------------------------------------------------------------
    # Test 8: Liveness failure invalidates identity
    # -------------------------------------------------------------------------
    print("\n[TEST 8] Liveness failure invalidates confirmed identity...")
    policy = TrackRecognitionPolicy()
    # Create confirmed track
    policy.record_recognition(
        track_id=10,
        frame_idx=1,
        timestamp=time.time(),
        bbox=(10, 10, 100, 100),
        liveness_status="LIVE",
        employee_id="EMP001",
        name="Employee One",
        status="RECOGNIZED",
        similarity=0.88,
    )
    conf_before = policy.get_track_state(10).identity_confirmation_state

    # Trigger liveness failure
    policy.record_liveness_failure(10, "SPOOF_DETECTED")
    state_after = policy.get_track_state(10)

    t8_pass = (
        conf_before == "CONFIRMED"
        and state_after.identity_confirmation_state == "INVALIDATED"
        and state_after.employee_id is None
    )
    test_results["8. Liveness Failure Invalidation"] = (
        "PASS" if t8_pass else "FAIL",
        f"Before: {conf_before} -> After SPOOF: {state_after.identity_confirmation_state} (Emp ID: {state_after.employee_id})",
    )
    print(f"  Result : {'PASS' if t8_pass else 'FAIL'} (State before: {conf_before}, State after spoof: {state_after.identity_confirmation_state})")

    # -------------------------------------------------------------------------
    # Test 9: Track reset clears state
    # -------------------------------------------------------------------------
    print("\n[TEST 9] Track reset clears state...")
    service.process_frame(frame_emp001, enable_liveness=False)
    tracks_before_reset = service.track_policy.active_track_count
    service.reset_tracker()
    tracks_after_reset = service.track_policy.active_track_count

    t9_pass = (tracks_before_reset > 0) and (tracks_after_reset == 0)
    test_results["9. Track Reset Clears State"] = (
        "PASS" if t9_pass else "FAIL",
        f"Tracks before: {tracks_before_reset}, Tracks after: {tracks_after_reset}",
    )
    print(f"  Result : {'PASS' if t9_pass else 'FAIL'} (Before: {tracks_before_reset}, After: {tracks_after_reset})")

    # -------------------------------------------------------------------------
    # Test 10: Recognition count is measurable
    # -------------------------------------------------------------------------
    print("\n[TEST 10] Recognition count measurability...")
    service.reset_tracker()
    service.reset_arcface_call_count()

    # Revalidation interval = 30; process 65 frames
    for _ in range(65):
        service.process_frame(frame_emp001, enable_liveness=False)

    # Frame 1 (New track) -> call 1
    # Frame 31 (Revalidate) -> call 2
    # Frame 61 (Revalidate) -> call 3
    # Total calls should be exactly 3
    tid = list(service.track_policy.tracks.keys())[0]
    track_rec_count = service.track_policy.tracks[tid].recognition_count
    service_rec_count = service.arcface_call_count

    t10_pass = (track_rec_count == 3) and (service_rec_count == 3)
    test_results["10. Recognition Count Measurable"] = (
        "PASS" if t10_pass else "FAIL",
        f"Track recognition count={track_rec_count}, Service arcface calls={service_rec_count} across 65 frames",
    )
    print(f"  Result : {'PASS' if t10_pass else 'FAIL'} (Track count: {track_rec_count}, Service calls: {service_rec_count} across 65 frames)")

    # -------------------------------------------------------------------------
    # 100-Frame Empirical Benchmark: WITHOUT vs WITH Policy
    # -------------------------------------------------------------------------
    print("\n" + "=" * 70)
    print("100-FRAME EMPIRICAL BENCHMARK: WITHOUT POLICY vs WITH POLICY")
    print("=" * 70)

    NUM_FRAMES = 100

    # 1. Benchmark WITHOUT policy
    print(f"\n[A] Processing {NUM_FRAMES} frames WITHOUT policy (ArcFace every frame)...")
    service.reset_tracker()
    service.reset_arcface_call_count()

    t_start_without = time.perf_counter()
    latencies_without: List[float] = []

    for f_idx in range(NUM_FRAMES):
        t_f0 = time.perf_counter()
        service.process_frame(frame_emp001, enable_liveness=False, use_track_policy=False)
        latencies_without.append((time.perf_counter() - t_f0) * 1000.0)

    total_time_without_s = time.perf_counter() - t_start_without
    calls_without = service.arcface_call_count
    avg_latency_without_ms = float(np.mean(latencies_without))
    effective_fps_without = NUM_FRAMES / total_time_without_s

    print(f"  ArcFace Invocations : {calls_without} calls")
    print(f"  Total Duration      : {total_time_without_s:.2f} s")
    print(f"  Avg Frame Latency   : {avg_latency_without_ms:.2f} ms")
    print(f"  Effective FPS       : {effective_fps_without:.2f} FPS")

    # 2. Benchmark WITH policy (revalidation interval = 30)
    print(f"\n[B] Processing {NUM_FRAMES} frames WITH policy (Revalidation interval = 30)...")
    service.reset_tracker()
    service.reset_arcface_call_count()

    t_start_with = time.perf_counter()
    latencies_with: List[float] = []

    for f_idx in range(NUM_FRAMES):
        t_f0 = time.perf_counter()
        service.process_frame(frame_emp001, enable_liveness=False, use_track_policy=True)
        latencies_with.append((time.perf_counter() - t_f0) * 1000.0)

    total_time_with_s = time.perf_counter() - t_start_with
    calls_with = service.arcface_call_count
    avg_latency_with_ms = float(np.mean(latencies_with))
    effective_fps_with = NUM_FRAMES / total_time_with_s

    print(f"  ArcFace Invocations : {calls_with} calls")
    print(f"  Total Duration      : {total_time_with_s:.2f} s")
    print(f"  Avg Frame Latency   : {avg_latency_with_ms:.2f} ms")
    print(f"  Effective FPS       : {effective_fps_with:.2f} FPS")

    # Metrics Summary
    call_reduction_pct = ((calls_without - calls_with) / calls_without) * 100.0
    latency_reduction_pct = ((avg_latency_without_ms - avg_latency_with_ms) / avg_latency_without_ms) * 100.0
    speedup_factor = effective_fps_with / effective_fps_without

    print(f"\n  ArcFace Call Reduction : {call_reduction_pct:.1f}% ({calls_without} -> {calls_with})")
    print(f"  Latency Reduction      : {latency_reduction_pct:.1f}% ({avg_latency_without_ms:.1f}ms -> {avg_latency_with_ms:.1f}ms)")
    print(f"  Throughput Speedup     : {speedup_factor:.2f}x ({effective_fps_without:.1f} -> {effective_fps_with:.1f} FPS)")

    benchmark_metrics = {
        "num_frames": NUM_FRAMES,
        "calls_without": calls_without,
        "calls_with": calls_with,
        "total_time_without_s": total_time_without_s,
        "total_time_with_s": total_time_with_s,
        "avg_latency_without_ms": avg_latency_without_ms,
        "avg_latency_with_ms": avg_latency_with_ms,
        "effective_fps_without": effective_fps_without,
        "effective_fps_with": effective_fps_with,
        "call_reduction_pct": call_reduction_pct,
        "speedup_factor": speedup_factor,
    }

    # Summary table
    print("\n" + "=" * 70)
    print("TEST SUITE SUMMARY")
    print("=" * 70)
    all_passed = True
    for name, (status, detail) in test_results.items():
        symbol = "PASS" if status == "PASS" else "FAIL"
        print(f"  [{symbol:4s}] {name:<40} : {detail}")
        if status != "PASS":
            all_passed = False


    print("=" * 70)
    print(f"OVERALL RESULT: {'ALL TESTS PASSED (10/10)' if all_passed else 'SOME TESTS FAILED'}")
    print("=" * 70)

    return {
        "all_passed": all_passed,
        "test_results": test_results,
        "benchmark": benchmark_metrics,
    }


if __name__ == "__main__":
    result = run_track_policy_test_suite()
    sys.exit(0 if result["all_passed"] else 1)
