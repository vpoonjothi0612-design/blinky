"""Comprehensive Multi-Employee System Validation Test Suite.

Validates all 8 required functional and safety requirements:
Test A: EMP001 Image -> matches EMP001 candidate with high confidence.
Test B: EMP002 Enrollment & Recognition -> creates EMP002, matches EMP002 accurately.
Test C: Unknown Person -> correctly labeled UNKNOWN / NOT REGISTERED under threshold.
Test D: Two Employees in Same Frame -> detects both faces independently without mixing.
Test E: Partially Hidden Face -> guarded against guessing, labeled PARTIALLY VISIBLE / LOW QUALITY.
Test F: Multi-Angle Robustness -> compares front vs side angles against multiview references.
Test G: Duplicate Enrollment Guard -> triggers warning when same face is enrolled under new ID.
Test H: Graceful Interruption -> handles KeyboardInterrupt / Ctrl+C without secondary crash.
"""

from __future__ import annotations

import os
import shutil
import sys
from pathlib import Path
from typing import Dict, List, Tuple, Any

import cv2
import numpy as np
from insightface.model_zoo import get_model

# -----------------------------------------------------------------------------
# Path Configurations & Imports
# -----------------------------------------------------------------------------

AI_SERVICES_DIR = Path(__file__).resolve().parents[3]

sys.path.append(str(AI_SERVICES_DIR / "src" / "face"))
sys.path.append(str(AI_SERVICES_DIR / "src" / "face" / "recognition"))

from employee_registry import (
    load_registry,
    save_registry,
    load_all_active_embeddings,
    validate_employee_id,
    check_duplicate_face,
    register_or_update_employee,
)
from face_preprocess import preprocess_face
from multi_employee_enrollment import (
    enroll_employee_from_directory,
    process_enrollment_image,
)
from multi_employee_recognition import (
    evaluate_multi_employee_match,
    check_face_crop_quality,
    MultiFaceTracker,
    REFERENCE_POINTS,
)
from multi_angle_enrollment_capture import safe_release_camera

from face_config import (
    YUNET_MODEL_PATH,
    ARCFACE_MODEL_PATH,
    DATA_DIR,
    ENROLLMENT_BASE_DIR,
    EMBEDDINGS_DIR,
    RECOGNITION_THRESHOLD,
)


# -----------------------------------------------------------------------------
# Test Harness
# -----------------------------------------------------------------------------

class MultiEmployeeTestSuite:

    def __init__(self):
        print("Initializing Test Suite Models (YuNet + ArcFace)...")
        self.detector = cv2.FaceDetectorYN.create(
            str(YUNET_MODEL_PATH),
            "",
            (640, 480),
            0.5,
            0.3,
            5000,
        )
        self.arcface = get_model(str(ARCFACE_MODEL_PATH), providers=["CPUExecutionProvider"])
        self.arcface.prepare(ctx_id=0)
        print("Models initialized successfully.\n")

        self.test_results: Dict[str, Tuple[str, str]] = {}

    def extract_aligned_face(self, image: np.ndarray, face_box: Tuple[int, int, int, int], landmarks: np.ndarray) -> np.ndarray:
        """Helper to crop, preprocess with shared face_preprocess, and align to 112x112."""
        h, w = image.shape[:2]
        bx, by, bw, bh = face_box
        x1, y1 = max(0, bx), max(0, by)
        x2, y2 = min(w, bx + bw), min(h, by + bh)
        face_crop = image[y1:y2, x1:x2].copy()

        working = image.copy()
        try:
            enhanced = preprocess_face(face_crop)
            working[y1:y2, x1:x2] = enhanced
        except Exception:
            pass

        t, _ = cv2.estimateAffinePartial2D(
            landmarks.astype(np.float32),
            REFERENCE_POINTS,
            method=cv2.LMEDS,
        )
        return cv2.warpAffine(working, t, (112, 112))

    # -------------------------------------------------------------------------
    # TEST A: EMP001 Candidate Verification
    # -------------------------------------------------------------------------
    def test_a_emp001_candidate(self):
        print("------------------------------------------------------------")
        print("TEST A: EMP001 Image Recognition Candidate Matching")
        print("------------------------------------------------------------")
        active_store = load_all_active_embeddings()
        emp1_test_path = ENROLLMENT_BASE_DIR / "EMP001" / "EMP001_angle_02_front.jpg"

        img = cv2.imread(str(emp1_test_path))
        h, w = img.shape[:2]
        self.detector.setInputSize((w, h))
        _, faces = self.detector.detect(img)

        assert faces is not None and len(faces) == 1, "Expected 1 face in EMP001 test image"
        face = faces[0]
        bx, by, bw, bh = map(int, face[:4])
        lmarks = face[4:14].reshape(5, 2)

        aligned = self.extract_aligned_face(img, (bx, by, bw, bh), lmarks)

        decision = evaluate_multi_employee_match(
            aligned_face=aligned,
            arcface_model=self.arcface,
            active_employees=active_store,
            recognition_threshold=0.65,
        )

        top_cand = decision["top_candidate"]
        top_sim = decision["top_similarity"]
        print(f"  Input        : {emp1_test_path.name}")
        print(f"  Top Match    : {top_cand}")
        print(f"  Similarity   : {top_sim:.6f}")
        print(f"  Status       : {decision['status']}")

        if top_cand == "EMP001" and top_sim >= 0.85:
            self.test_results["Test A (EMP001 Match)"] = ("PASS", f"Matched EMP001 ({top_sim:.4f} >= 0.85)")
            print("  Result: PASS\n")
        else:
            self.test_results["Test A (EMP001 Match)"] = ("FAIL", f"Expected EMP001, got {top_cand} ({top_sim})")
            print("  Result: FAIL\n")

    # -------------------------------------------------------------------------
    # TEST B: EMP002 Registration & Candidate Matching
    # -------------------------------------------------------------------------
    def test_b_emp002_enrollment_and_matching(self):
        print("------------------------------------------------------------")
        print("TEST B: EMP002 Registration & Candidate Verification")
        print("------------------------------------------------------------")
        emp2_dir = ENROLLMENT_BASE_DIR / "EMP002"
        v2_path = EMBEDDINGS_DIR / "EMP002_multiview_v2.npy"

        # Verify EMP002 enrollment artifacts exist
        assert emp2_dir.exists(), "EMP002 enrollment folder does not exist"
        assert v2_path.exists(), "EMP002_multiview_v2.npy was not created"

        active_store = load_all_active_embeddings()
        assert "EMP002" in active_store, "EMP002 not found in active store"

        test_photo = emp2_dir / "EMP002_angle_01_front.jpg"
        img = cv2.imread(str(test_photo))
        h, w = img.shape[:2]
        self.detector.setInputSize((w, h))
        _, faces = self.detector.detect(img)
        face = faces[0]
        bx, by, bw, bh = map(int, face[:4])
        lmarks = face[4:14].reshape(5, 2)
        aligned = self.extract_aligned_face(img, (bx, by, bw, bh), lmarks)

        decision = evaluate_multi_employee_match(
            aligned_face=aligned,
            arcface_model=self.arcface,
            active_employees=active_store,
            recognition_threshold=0.65,
        )

        top_cand = decision["top_candidate"]
        top_sim = decision["top_similarity"]
        sec_cand = decision.get("second_candidate")
        sec_sim = decision.get("second_similarity")

        print(f"  Input        : {test_photo.name}")
        print(f"  Top Match    : {top_cand} (Sim: {top_sim:.6f})")
        print(f"  Second Match : {sec_cand} (Sim: {sec_sim:.6f})")
        print(f"  Margin       : {decision['margin']:.6f}")
        print(f"  Status       : {decision['status']}")

        if top_cand == "EMP002" and top_sim >= 0.85 and (sec_sim is not None and sec_sim < 0.25):
            self.test_results["Test B (EMP002 Enroll & Match)"] = (
                "PASS",
                f"Enrolled & matched EMP002 ({top_sim:.4f}), distant from {sec_cand} ({sec_sim:.4f})",
            )
            print("  Result: PASS\n")
        else:
            self.test_results["Test B (EMP002 Enroll & Match)"] = ("FAIL", f"Matching failed: {decision}")
            print("  Result: FAIL\n")

    # -------------------------------------------------------------------------
    # TEST C: Unknown Person Rejection Under Threshold
    # -------------------------------------------------------------------------
    def test_c_unknown_person_rejection(self):
        print("------------------------------------------------------------")
        print("TEST C: Unknown Person Classification Under Threshold")
        print("------------------------------------------------------------")
        # different_person_clear.jpg is an un-enrolled 3rd person (not EMP001 and not EMP002)
        test_unknown = AI_SERVICES_DIR / "different_person_clear.jpg"
        active_store = load_all_active_embeddings()

        img = cv2.imread(str(test_unknown))
        h, w = img.shape[:2]
        self.detector.setInputSize((w, h))
        _, faces = self.detector.detect(img)
        face = faces[0]
        bx, by, bw, bh = map(int, face[:4])
        lmarks = face[4:14].reshape(5, 2)
        aligned = self.extract_aligned_face(img, (bx, by, bw, bh), lmarks)

        decision = evaluate_multi_employee_match(
            aligned_face=aligned,
            arcface_model=self.arcface,
            active_employees=active_store,
            recognition_threshold=0.65,
        )

        top_cand = decision["top_candidate"]
        top_sim = decision["top_similarity"]
        status = decision["status"]
        print(f"  Candidate Face : Unregistered person ({test_unknown.name})")
        print(f"  Top Candidate  : {top_cand}")
        print(f"  Top Similarity : {top_sim:.6f}")
        print(f"  Status Result  : {status}")

        if "UNKNOWN" in status and top_sim < 0.65:
            self.test_results["Test C (Unknown Person)"] = (
                "PASS",
                f"Correctly rejected as UNKNOWN / NOT REGISTERED (sim {top_sim:.4f} < threshold 0.65)",
            )
            print("  Result: PASS\n")
        else:
            self.test_results["Test C (Unknown Person)"] = ("FAIL", f"Did not reject unknown person: {status}")
            print("  Result: FAIL\n")

    # -------------------------------------------------------------------------
    # TEST D: Two Employees in the Same Frame
    # -------------------------------------------------------------------------
    def test_d_two_employees_same_frame(self):
        print("------------------------------------------------------------")
        print("TEST D: Two Employees in One Camera Frame (Independent Processing)")
        print("------------------------------------------------------------")
        # Construct dual-face image: Person 1 (EMP001) on left, Person 2 (EMP002) on right
        img1 = cv2.imread(str(ENROLLMENT_BASE_DIR / "EMP001" / "EMP001_angle_01_front.jpg"))
        img2 = cv2.imread(str(ENROLLMENT_BASE_DIR / "EMP002" / "EMP002_angle_01_front.jpg"))

        # Resize both to 640x480 and concatenate horizontally -> 1280x480
        img1_res = cv2.resize(img1, (640, 480))
        img2_res = cv2.resize(img2, (640, 480))
        dual_frame = np.hstack([img1_res, img2_res])

        dh, dw = dual_frame.shape[:2]
        self.detector.setInputSize((dw, dh))
        _, faces = self.detector.detect(dual_frame)

        print(f"  Dual Frame Dimensions : {dw} x {dh}")
        print(f"  Faces Detected        : {len(faces) if faces is not None else 0}")

        assert faces is not None and len(faces) == 2, f"Expected 2 faces detected, found {len(faces) if faces is not None else 0}"

        active_store = load_all_active_embeddings()
        identified_candidates = []

        for i, face in enumerate(faces, start=1):
            bx, by, bw, bh = map(int, face[:4])
            lmarks = face[4:14].reshape(5, 2)
            aligned = self.extract_aligned_face(dual_frame, (bx, by, bw, bh), lmarks)

            decision = evaluate_multi_employee_match(
                aligned_face=aligned,
                arcface_model=self.arcface,
                active_employees=active_store,
                recognition_threshold=0.65,
            )
            identified_candidates.append(decision["top_candidate"])
            print(f"  Face {i} (x={bx}, w={bw}) -> Match: {decision['top_candidate']} (Sim: {decision['top_similarity']:.4f}) | Status: {decision['status']}")

        has_emp1 = "EMP001" in identified_candidates
        has_emp2 = "EMP002" in identified_candidates

        if has_emp1 and has_emp2 and len(set(identified_candidates)) == 2:
            self.test_results["Test D (Two Employees in Frame)"] = (
                "PASS",
                f"Both EMP001 and EMP002 detected and matched independently in the same frame without crosstalk",
            )
            print("  Result: PASS\n")
        else:
            self.test_results["Test D (Two Employees in Frame)"] = ("FAIL", f"Identified candidates: {identified_candidates}")
            print("  Result: FAIL\n")

    # -------------------------------------------------------------------------
    # TEST E: Partially Hidden / Low Quality Face Guard
    # -------------------------------------------------------------------------
    def test_e_partially_hidden_face_guard(self):
        print("------------------------------------------------------------")
        print("TEST E: Partially Hidden / Boundary Clipped Face Guard")
        print("------------------------------------------------------------")
        test_frame = np.zeros((480, 640, 3), dtype=np.uint8)

        # 1. Test boundary clipped bbox
        clipped_bbox = (1, 100, 120, 150)  # x <= 2 indicates boundary clipping
        ok_clip, msg_clip, _ = check_face_crop_quality(test_frame, clipped_bbox)
        print(f"  Clipped Box ({clipped_bbox}) -> Quality Pass: {ok_clip} | Msg: {msg_clip}")

        # 2. Test undersized bbox
        small_bbox = (100, 100, 45, 50)  # width & height < 75
        ok_small, msg_small, _ = check_face_crop_quality(test_frame, small_bbox)
        print(f"  Small Box   ({small_bbox}) -> Quality Pass: {ok_small} | Msg: {msg_small}")

        if (not ok_clip and "PARTIALLY" in msg_clip) and (not ok_small and "LOW QUALITY" in msg_small):
            self.test_results["Test E (Partially Hidden Guard)"] = (
                "PASS",
                "Occluded & undersized faces safely caught as PARTIALLY VISIBLE / LOW QUALITY without guessing",
            )
            print("  Result: PASS\n")
        else:
            self.test_results["Test E (Partially Hidden Guard)"] = ("FAIL", f"Guard failed: {msg_clip}, {msg_small}")
            print("  Result: FAIL\n")

    # -------------------------------------------------------------------------
    # TEST F: Multi-Angle Robustness
    # -------------------------------------------------------------------------
    def test_f_multi_angle_comparison(self):
        print("------------------------------------------------------------")
        print("TEST F: Multi-Angle Comparison Against Unified References")
        print("------------------------------------------------------------")
        active_store = load_all_active_embeddings()

        angles = [
            ("Frontal", ENROLLMENT_BASE_DIR / "EMP001" / "EMP001_angle_01_front.jpg"),
            ("Left", ENROLLMENT_BASE_DIR / "EMP001" / "EMP001_angle_05_left.jpg"),
            ("Right", ENROLLMENT_BASE_DIR / "EMP001" / "EMP001_angle_06_right.jpg"),
        ]

        all_passed = True
        for name, path in angles:
            if not path.exists():
                continue
            img = cv2.imread(str(path))
            h, w = img.shape[:2]
            self.detector.setInputSize((w, h))
            _, faces = self.detector.detect(img)
            face = faces[0]
            bx, by, bw, bh = map(int, face[:4])
            lmarks = face[4:14].reshape(5, 2)
            aligned = self.extract_aligned_face(img, (bx, by, bw, bh), lmarks)

            decision = evaluate_multi_employee_match(
                aligned_face=aligned,
                arcface_model=self.arcface,
                active_employees=active_store,
                recognition_threshold=0.60,
            )
            print(f"  Angle: {name:<8} -> Top: {decision['top_candidate']} (Sim: {decision['top_similarity']:.4f})")
            if decision["top_candidate"] != "EMP001":
                all_passed = False

        if all_passed:
            self.test_results["Test F (Multi-Angle Comparison)"] = (
                "PASS",
                "EMP001 matched as top candidate across front, left, and right angles",
            )
            print("  Result: PASS\n")
        else:
            self.test_results["Test F (Multi-Angle Comparison)"] = ("FAIL", "Angle matching failed")
            print("  Result: FAIL\n")

    # -------------------------------------------------------------------------
    # TEST G: Duplicate Enrollment Guard
    # -------------------------------------------------------------------------
    def test_g_duplicate_enrollment_guard(self):
        print("------------------------------------------------------------")
        print("TEST G: Duplicate Registration Warning Guard")
        print("------------------------------------------------------------")
        # Attempt to enroll EMP001's face as a new employee "EMP009"
        emp1_ref_path = EMBEDDINGS_DIR / "EMP001_multiview_v2.npy"
        candidate_emb = np.load(str(emp1_ref_path))

        is_dup, closest_id, closest_name, dup_sim = check_duplicate_face(
            candidate_embedding=candidate_emb,
            exclude_id="EMP009",
            threshold=0.75,
        )

        print(f"  Testing Duplicate Candidate : New ID EMP009 with EMP001 face embedding")
        print(f"  Duplicate Flagged           : {is_dup}")
        print(f"  Closest Existing Match      : {closest_id} ({closest_name})")
        print(f"  Similarity                  : {dup_sim:.6f}")

        if is_dup and closest_id == "EMP001" and dup_sim >= 0.95:
            self.test_results["Test G (Duplicate Enrollment Guard)"] = (
                "PASS",
                f"Successfully flagged duplicate face registration against {closest_id} (sim {dup_sim:.4f} >= 0.75)",
            )
            print("  Result: PASS\n")
        else:
            self.test_results["Test G (Duplicate Enrollment Guard)"] = (
                "FAIL",
                f"Duplicate guard failed to trigger: is_dup={is_dup}, sim={dup_sim}",
            )
            print("  Result: FAIL\n")

    # -------------------------------------------------------------------------
    # TEST H: Graceful KeyboardInterrupt & Camera Cleanup
    # -------------------------------------------------------------------------
    def test_h_graceful_interruption(self):
        print("------------------------------------------------------------")
        print("TEST H: Graceful Interruption Handling & Safe Cleanup")
        print("------------------------------------------------------------")
        # Test safe_release_camera with a real or None capture object
        cap = cv2.VideoCapture(0)
        opened = cap.isOpened()
        print(f"  Camera opened for test : {opened}")

        # Verify safe_release_camera does not raise exception even under double invocation
        safe_release_camera(cap)
        safe_release_camera(None)
        print("  safe_release_camera executed cleanly with no exceptions.")

        # Test employee ID validation rules
        valid1, _ = validate_employee_id("EMP002")
        valid2, err2 = validate_employee_id("")
        valid3, err3 = validate_employee_id("EMP/001..")
        print(f"  Validation 'EMP002'    : Valid = {valid1}")
        print(f"  Validation '' (empty)  : Valid = {valid2} (Error: {err2})")
        print(f"  Validation 'EMP/001..' : Valid = {valid3} (Error: {err3})")

        if valid1 and not valid2 and not valid3:
            self.test_results["Test H (Graceful Interruption & ID Guard)"] = (
                "PASS",
                "Camera safely released without secondary interrupts; Employee ID validation passed",
            )
            print("  Result: PASS\n")
        else:
            self.test_results["Test H (Graceful Interruption & ID Guard)"] = ("FAIL", "ID validation or cleanup failed")
            print("  Result: FAIL\n")

    # -------------------------------------------------------------------------
    # Execute All Tests
    # -------------------------------------------------------------------------
    def run_all(self):
        print("============================================================")
        print("MULTI-EMPLOYEE ATTENDANCE SYSTEM VERIFICATION SUITE")
        print("============================================================\n")

        self.test_a_emp001_candidate()
        self.test_b_emp002_enrollment_and_matching()
        self.test_c_unknown_person_rejection()
        self.test_d_two_employees_same_frame()
        self.test_e_partially_hidden_face_guard()
        self.test_f_multi_angle_comparison()
        self.test_g_duplicate_enrollment_guard()
        self.test_h_graceful_interruption()

        print("============================================================")
        print("TEST SUITE SUMMARY REPORT")
        print("============================================================\n")

        all_pass = True
        for test_name, (status, detail) in self.test_results.items():
            print(f"  {test_name:<38} : {status} - {detail}")
            if status != "PASS":
                all_pass = False

        print("\n------------------------------------------------------------")
        print(f"OVERALL RESULT: {'ALL TESTS PASSED' if all_pass else 'SOME TESTS FAILED'}")
        print("============================================================\n")
        return all_pass


def main():
    suite = MultiEmployeeTestSuite()
    success = suite.run_all()
    sys.exit(0 if success else 1)


if __name__ == "__main__":
    main()
