"""Automated Multi-Employee Enrollment & Recognition Validator.

Runs the 3 required validation checks:
TEST 1: Newly enrolled EMP002 images -> Matched as EMP002 with similarity >= 0.65.
TEST 2: EMP001 images -> Matched as EMP001 with status RECOGNIZED: EMP001.
TEST 3: Completely unregistered face (different_person_clear.jpg) -> Rejected as UNKNOWN / NOT REGISTERED (< 0.65).
"""

from __future__ import annotations

import sys
from pathlib import Path
from typing import Dict, List, Tuple, Any

import cv2
import numpy as np
from insightface.model_zoo import get_model

AI_SERVICES_DIR = Path(__file__).resolve().parents[3]
sys.path.append(str(AI_SERVICES_DIR / "src" / "face"))
sys.path.append(str(AI_SERVICES_DIR / "src" / "face" / "recognition"))

from employee_registry import load_all_active_embeddings
from face_preprocess import preprocess_face
from multi_employee_recognition import evaluate_multi_employee_match, REFERENCE_POINTS

from face_config import (
    YUNET_MODEL_PATH,
    ARCFACE_MODEL_PATH,
    ENROLLMENT_BASE_DIR as ENROLLMENT_DIR,
    RECOGNITION_THRESHOLD as THRESHOLD,
)


def load_models():
    detector = cv2.FaceDetectorYN.create(str(YUNET_MODEL_PATH), "", (640, 480), 0.5, 0.3, 5000)
    arcface = get_model(str(ARCFACE_MODEL_PATH), providers=["CPUExecutionProvider"])
    arcface.prepare(ctx_id=0)
    return detector, arcface


def extract_face_and_evaluate(
    image_path: Path,
    detector: cv2.FaceDetectorYN,
    arcface_model: Any,
    active_employees: Dict[str, Dict[str, Any]],
    threshold: float = THRESHOLD,
) -> Dict[str, Any]:
    """Processes an image through the production pipeline and matches against active registry."""
    image = cv2.imread(str(image_path))
    if image is None:
        return {"error": f"Could not read image: {image_path}"}

    h, w = image.shape[:2]
    detector.setInputSize((w, h))
    _, faces = detector.detect(image)
    if faces is None or len(faces) == 0:
        return {"error": f"No face detected in {image_path.name}"}

    face = faces[0]
    bx, by, bw, bh = map(int, face[:4])
    lmarks = face[4:14].reshape(5, 2)

    x1, y1 = max(0, bx), max(0, by)
    x2, y2 = min(w, bx + bw), min(h, by + bh)
    crop = image[y1:y2, x1:x2].copy()

    working = image.copy()
    enhanced = preprocess_face(crop)
    working[y1:y2, x1:x2] = enhanced

    transform, _ = cv2.estimateAffinePartial2D(
        lmarks.astype(np.float32),
        REFERENCE_POINTS,
        method=cv2.LMEDS,
    )
    if transform is None:
        return {"error": f"Alignment failed for {image_path.name}"}

    aligned = cv2.warpAffine(working, transform, (112, 112))
    decision = evaluate_multi_employee_match(
        aligned_face=aligned,
        arcface_model=arcface_model,
        active_employees=active_employees,
        recognition_threshold=threshold,
    )
    decision["image_name"] = image_path.name
    decision["size"] = (bw, bh)
    return decision


def run_validation():
    print("============================================================")
    print("MULTI-EMPLOYEE RECOGNITION VALIDATION SUITE")
    print("============================================================")
    print(f"Decision Threshold: {THRESHOLD:.2f}\n")

    active_employees = load_all_active_embeddings()
    print(f"Loaded {len(active_employees)} active employee(s):")
    for emp_id, data in active_employees.items():
        print(f"  - {emp_id:<10}: {data['name']} ({data['embeddingFile']})")
    print()

    detector, arcface = load_models()

    results = {}

    # -------------------------------------------------------------------------
    # TEST 1: Enrolled EMP002 Images
    # -------------------------------------------------------------------------
    print("------------------------------------------------------------")
    print("TEST 1: Validate Enrolled EMP002 Images")
    print("------------------------------------------------------------")
    emp2_photos = sorted((ENROLLMENT_DIR / "EMP002").glob("*.jpg"))
    test1_passed = True
    emp2_sims = []

    for photo in emp2_photos:
        res = extract_face_and_evaluate(photo, detector, arcface, active_employees)
        top = res.get("top_candidate")
        sim = res.get("top_similarity", 0.0)
        status = res.get("status")
        emp2_sims.append(sim)

        print(f"  [{photo.name}]")
        print(f"    Top Candidate : {top}")
        print(f"    Similarity    : {sim:.4f}")
        print(f"    Status        : {status}")

        if top != "EMP002" or sim < THRESHOLD or not status.startswith("RECOGNIZED: EMP002"):
            test1_passed = False

    min_sim2 = min(emp2_sims) if emp2_sims else 0.0
    max_sim2 = max(emp2_sims) if emp2_sims else 0.0
    results["TEST 1 (EMP002)"] = ("PASS" if test1_passed and emp2_photos else "FAIL", f"Images: {len(emp2_photos)}, Range: {min_sim2:.4f} - {max_sim2:.4f}")
    print(f"\n  Result: {'PASS' if test1_passed else 'FAIL'}\n")

    # -------------------------------------------------------------------------
    # TEST 2: Enrolled EMP001 Images
    # -------------------------------------------------------------------------
    print("------------------------------------------------------------")
    print("TEST 2: Validate Enrolled EMP001 Images")
    print("------------------------------------------------------------")
    emp1_photos = sorted((ENROLLMENT_DIR / "EMP001").glob("*.jpg"))[:3]  # Check first 3 frontal/left angles
    test2_passed = True
    emp1_sims = []

    for photo in emp1_photos:
        res = extract_face_and_evaluate(photo, detector, arcface, active_employees)
        top = res.get("top_candidate")
        sim = res.get("top_similarity", 0.0)
        status = res.get("status")
        emp1_sims.append(sim)

        print(f"  [{photo.name}]")
        print(f"    Top Candidate : {top}")
        print(f"    Similarity    : {sim:.4f}")
        print(f"    Status        : {status}")

        if top != "EMP001" or sim < THRESHOLD or not status.startswith("RECOGNIZED: EMP001"):
            test2_passed = False

    min_sim1 = min(emp1_sims) if emp1_sims else 0.0
    max_sim1 = max(emp1_sims) if emp1_sims else 0.0
    results["TEST 2 (EMP001)"] = ("PASS" if test2_passed and emp1_photos else "FAIL", f"Images: {len(emp1_photos)}, Range: {min_sim1:.4f} - {max_sim1:.4f}")
    print(f"\n  Result: {'PASS' if test2_passed else 'FAIL'}\n")

    # -------------------------------------------------------------------------
    # TEST 3: Unregistered Person Rejection Under Threshold
    # -------------------------------------------------------------------------
    print("------------------------------------------------------------")
    print("TEST 3: Validate Unregistered Person Rejection (< 0.65)")
    print("------------------------------------------------------------")
    unknown_photo = AI_SERVICES_DIR / "different_person_clear.jpg"
    res_unk = extract_face_and_evaluate(unknown_photo, detector, arcface, active_employees)
    top_unk = res_unk.get("top_candidate")
    sim_unk = res_unk.get("top_similarity", 0.0)
    status_unk = res_unk.get("status")

    print(f"  [{unknown_photo.name}]")
    print(f"    Top Candidate : {top_unk}")
    print(f"    Similarity    : {sim_unk:.4f}")
    print(f"    Threshold     : {THRESHOLD:.2f}")
    print(f"    Status        : {status_unk}")

    test3_passed = (sim_unk < THRESHOLD) and (status_unk == "UNKNOWN / NOT REGISTERED")
    results["TEST 3 (Unknown)"] = ("PASS" if test3_passed else "FAIL", f"Top: {top_unk} ({sim_unk:.4f} < {THRESHOLD:.2f})")
    print(f"\n  Result: {'PASS' if test3_passed else 'FAIL'}\n")

    # -------------------------------------------------------------------------
    # Final Validation Report
    # -------------------------------------------------------------------------
    print("============================================================")
    print("VALIDATION SUMMARY REPORT")
    print("============================================================")
    for test_name, (outcome, detail) in results.items():
        print(f"  {test_name:<20}: {outcome:<4} ({detail})")
    print("============================================================\n")

    all_passed = all(outcome == "PASS" for outcome, _ in results.values())
    return all_passed


if __name__ == "__main__":
    passed = run_validation()
    sys.exit(0 if passed else 1)
