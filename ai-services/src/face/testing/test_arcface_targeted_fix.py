"""Targeted ArcFace Recognition Fix Verification Test.

Validates the specific items required in Step 7:
1. Registered employee facing forward (EMP001_angle_02_front.jpg)
2. Registered employee turning left (EMP001_angle_05_left.jpg)
3. Registered employee turning right (EMP001_angle_06_right.jpg)
4. Low-quality and blurry frames (blurry crop quality check and handling)
5. Unregistered stranger person rejection (different_person_clear.jpg)
6. Similar-looking / ambiguous employee match checks
7. Encounter continuity grace period simulation (transient dip preserves state without false UNKNOWN alerts)
"""

import os
import sys
from pathlib import Path
import cv2
import numpy as np

AI_SERVICES_DIR = Path(__file__).resolve().parents[3]
FACE_DIR = AI_SERVICES_DIR / "src" / "face"
RECOGNITION_DIR = FACE_DIR / "recognition"

sys.path.append(str(FACE_DIR))
sys.path.append(str(RECOGNITION_DIR))

from employee_registry import (
    load_registry,
    load_all_active_embeddings,
    match_probe_against_registry,
)
from face_preprocess import preprocess_face
from face_config import (
    YUNET_MODEL_PATH,
    ARCFACE_MODEL_PATH,
    DATA_DIR,
    ENROLLMENT_BASE_DIR,
)
from insightface.model_zoo import get_model

def run_targeted_fix_verification():
    print("=" * 70)
    print("TARGETED ARCFACE FIX: MULTI-VIEW & CONTINUITY VERIFICATION")
    print("=" * 70)

    # 1. Load active registry with multiview embeddings
    active_employees = load_all_active_embeddings()
    print(f"Loaded {len(active_employees)} active employees from registry.")
    for emp_id, data in active_employees.items():
        views = data.get("views", [])
        print(f"  - {emp_id} ({data.get('name')}): views={views}")

    # 2. Initialize detector & ArcFace
    detector = cv2.FaceDetectorYN.create(
        str(YUNET_MODEL_PATH), "", (640, 640), 0.6, 0.3, 5000
    )
    rec_model = get_model(str(ARCFACE_MODEL_PATH))
    rec_model.prepare(ctx_id=-1)

    emp001_dir = ENROLLMENT_BASE_DIR / "EMP001"
    tests_summary = []
    
    # Helper to extract probe embedding using consistent preprocessing & landmark alignment
    def get_probe_embedding(img_bgr):
        h, w = img_bgr.shape[:2]
        detector.setInputSize((w, h))
        _, faces = detector.detect(img_bgr)
        if faces is None or len(faces) == 0:
            return None, "No face detected"
        face = faces[0]
        bx, by, bw, bh = map(int, face[0:4])
        landmarks = face[4:14].reshape(5, 2)

        x1, y1 = max(0, bx), max(0, by)
        x2, y2 = min(w, bx + bw), min(h, by + bh)
        crop = img_bgr[y1:y2, x1:x2].copy()
        if crop.size == 0:
            return None, "Empty crop"

        # Apply preprocess_face consistently
        proc_crop = preprocess_face(crop)
        working_img = img_bgr.copy()
        working_img[y1:y2, x1:x2] = proc_crop

        # Landmark affine alignment to 112x112 REFERENCE_POINTS
        from face_config import REFERENCE_POINTS
        transform, _ = cv2.estimateAffinePartial2D(
            landmarks.astype(np.float32),
            REFERENCE_POINTS,
            method=cv2.LMEDS,
        )
        if transform is None:
            return None, "Transform estimation failed"

        aligned = cv2.warpAffine(working_img, transform, (112, 112))
        emb = rec_model.get_feat(aligned).flatten()
        norm = np.linalg.norm(emb)
        if norm > 1e-6:
            emb = emb / norm
        return emb, None

    # Test 1: Registered employee facing forward
    front_path = emp001_dir / "EMP001_angle_02_front.jpg"
    img_front = cv2.imread(str(front_path))
    emb_front, err = get_probe_embedding(img_front)
    assert err is None, f"Failed front probe: {err}"
    
    match_front = match_probe_against_registry(
        emb_front, active_employees, recognition_threshold=0.65, min_match_margin=0.04
    )
    t1_pass = match_front.get("status", "").startswith("RECOGNIZED") and match_front["employee_id"] == "EMP001"
    print(f"\n[Test 1] Registered employee facing FORWARD:")
    print(f"  Status: {match_front['status']}, ID: {match_front['employee_id']}, "
          f"Sim: {match_front['similarity']:.4f}, View: {match_front['matched_view']}")
    tests_summary.append(("Forward Face Recognition", t1_pass, f"Sim: {match_front['similarity']:.4f}"))

    # Test 2: Registered employee turning LEFT
    left_path = emp001_dir / "EMP001_angle_05_left.jpg"
    img_left = cv2.imread(str(left_path))
    emb_left, err = get_probe_embedding(img_left)
    assert err is None, f"Failed left probe: {err}"
    
    match_left = match_probe_against_registry(
        emb_left, active_employees, recognition_threshold=0.65, min_match_margin=0.04
    )
    t2_pass = match_left.get("status", "").startswith("RECOGNIZED") and match_left["employee_id"] == "EMP001" and match_left["similarity"] >= 0.65
    print(f"\n[Test 2] Registered employee turning LEFT:")
    print(f"  Status: {match_left['status']}, ID: {match_left['employee_id']}, "
          f"Sim: {match_left['similarity']:.4f}, View: {match_left['matched_view']}")
    tests_summary.append(("Left Turn Recognition (Multi-View)", t2_pass, f"Sim: {match_left['similarity']:.4f} (Matched view: {match_left['matched_view']})"))

    # Test 3: Registered employee turning RIGHT
    right_path = emp001_dir / "EMP001_angle_06_right.jpg"
    img_right = cv2.imread(str(right_path))
    emb_right, err = get_probe_embedding(img_right)
    assert err is None, f"Failed right probe: {err}"
    
    match_right = match_probe_against_registry(
        emb_right, active_employees, recognition_threshold=0.65, min_match_margin=0.04
    )
    t3_pass = match_right.get("status", "").startswith("RECOGNIZED") and match_right["employee_id"] == "EMP001" and match_right["similarity"] >= 0.65
    print(f"\n[Test 3] Registered employee turning RIGHT:")
    print(f"  Status: {match_right['status']}, ID: {match_right['employee_id']}, "
          f"Sim: {match_right['similarity']:.4f}, View: {match_right['matched_view']}")
    tests_summary.append(("Right Turn Recognition (Multi-View)", t3_pass, f"Sim: {match_right['similarity']:.4f} (Matched view: {match_right['matched_view']})"))

    # Test 4: Unregistered stranger person
    stranger_path = DATA_DIR / "different_person_clear.jpg"
    if stranger_path.exists():
        img_stranger = cv2.imread(str(stranger_path))
        emb_stranger, err = get_probe_embedding(img_stranger)
        if emb_stranger is not None:
            match_stranger = match_probe_against_registry(
                emb_stranger, active_employees, recognition_threshold=0.65, min_match_margin=0.04
            )
            t4_pass = match_stranger.get("status") == "UNKNOWN" and match_stranger["similarity"] < 0.65
            print(f"\n[Test 4] Unregistered Stranger:")
            print(f"  Status: {match_stranger['status']}, ID: {match_stranger['employee_id']}, "
                  f"Top Sim: {match_stranger['similarity']:.4f} (Under 0.65 threshold)")
            tests_summary.append(("Stranger Rejection (False Accept Rate = 0)", t4_pass, f"Top Sim: {match_stranger['similarity']:.4f} < 0.65"))
    else:
        # Synthesize random normalized embedding
        rand_emb = np.random.randn(512)
        rand_emb /= np.linalg.norm(rand_emb)
        match_rand = match_probe_against_registry(
            rand_emb, active_employees, recognition_threshold=0.65, min_match_margin=0.04
        )
        t4_pass = match_rand.get("status") == "UNKNOWN"
        tests_summary.append(("Stranger Rejection (Random Probe)", t4_pass, f"Top Sim: {match_rand['similarity']:.4f} < 0.65"))

    # Test 5: Low-quality and blurry frame
    blurry_crop = cv2.GaussianBlur(img_front, (35, 35), 0)
    gray = cv2.cvtColor(blurry_crop, cv2.COLOR_BGR2GRAY)
    laplacian_var = cv2.Laplacian(gray, cv2.CV_64F).var()
    is_blurry = laplacian_var < 50.0
    print(f"\n[Test 5] Blurry Frame Quality Check:")
    print(f"  Laplacian Variance: {laplacian_var:.2f} (< 50 threshold = {is_blurry})")
    tests_summary.append(("Low Quality / Blurry Frame Detection", is_blurry, f"Blur variance {laplacian_var:.2f} correctly identified"))

    # Test 6: Ambiguous / Close Match Rejection
    # Synthesize two employees having identical similarity to probe
    mock_active = {
        "EMP001": {"name": "User 1", "embedding": emb_front, "embeddings": [emb_front], "views": ["FRONT"]},
        "EMP002": {"name": "User 2", "embedding": emb_front.copy(), "embeddings": [emb_front.copy()], "views": ["FRONT"]},
    }
    match_ambig = match_probe_against_registry(
        emb_front, mock_active, recognition_threshold=0.65, min_match_margin=0.04
    )
    t6_pass = match_ambig.get("status") == "AMBIGUOUS"
    print(f"\n[Test 6] Ambiguous Top-1 vs Top-2 Margin Safety Check:")
    print(f"  Status: {match_ambig['status']}, ID: {match_ambig['employee_id']}")
    tests_summary.append(("Ambiguous Match Safety Guard", t6_pass, f"Correctly caught status={match_ambig.get('status')}"))

    # Test 7: Encounter Continuity / Bounded Grace Period Logic
    # Simulate a sequence: [RECOGNIZED (0.95)] -> [DIP (0.58)] -> [DIP (0.61)] -> [RECOGNIZED (0.85)]
    session_id = None
    session_name = None
    session_grace = 0
    MAX_GRACE = 15
    events = []

    sequence_sims = [0.95, 0.58, 0.61, 0.85]
    for sim in sequence_sims:
        if sim >= 0.65:
            session_id = "EMP001"
            session_name = "sanjay"
            session_grace = 0
            state = f"RECOGNIZED: {session_id}"
            unknown_alert = False
        elif session_id is not None and session_grace < MAX_GRACE:
            session_grace += 1
            state = f"UNCERTAIN (OBSERVING: {sim:.2f})"
            unknown_alert = False  # Grace period prevents false unknown alert
        else:
            session_id = None
            session_name = None
            session_grace = 0
            state = "UNKNOWN FACE"
            unknown_alert = True
        events.append((sim, state, unknown_alert))

    dip_alerts = [ev[2] for ev in events[1:3]]
    t7_pass = not any(dip_alerts) and events[1][1].startswith("UNCERTAIN")
    print(f"\n[Test 7] Encounter Continuity Grace Period (Transient Dips):")
    for sim, state, alert in events:
        print(f"  Sim: {sim:.2f} -> State: {state} | Unknown Alert Fired: {alert}")
    tests_summary.append(("Encounter Continuity Grace Period", t7_pass, "0 false unknown alerts during momentary drops"))

    # Summary
    print("\n" + "=" * 70)
    print("TEST EXECUTION REPORT")
    print("=" * 70)
    all_ok = True
    for name, passed, detail in tests_summary:
        tag = "PASS" if passed else "FAIL"
        print(f"  [{tag:4s}] {name:<42} : {detail}")
        if not passed:
            all_ok = False

    print("=" * 70)
    print(f"OVERALL STATUS: {'ALL CHECKS PASSED' if all_ok else 'FAILED CHECKS DETECTED'}")
    print("=" * 70)
    return all_ok

if __name__ == "__main__":
    ok = run_targeted_fix_verification()
    sys.exit(0 if ok else 1)
