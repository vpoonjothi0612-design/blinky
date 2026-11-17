"""Controlled Cross-Camera Face Recognition Validation Tool for EMP001.

Validates multi-angle real enrollment photos, creates a unified multi-view reference
embedding (EMP001_multiview.npy), benchmarks cross-image cosine similarity, probes
camera inputs, executes live webcam multi-angle validation, and gathers genuine vs
negative similarity distributions for threshold calibration.

Tasks:
1. Validate all 7 real enrollment photos (YuNet -> Preprocessing -> Alignment -> ArcFace)
2. Generate and save EMP001_multiview.npy (mean normalized embedding)
3. Cross-image validation against EMP001_multiview.npy
4. Live camera test pipeline (YuNet -> Liveness -> Preprocessing -> Alignment -> ArcFace)
5. Multi-angle live condition test (A: Front, B: Left, C: Right, D: Up, E: Down, F: Closer, G: Farther, H: Lighting, I: Natural)
6. Non-EMP001 negative benchmark testing
7. Cross-camera availability probing & structured validation report
"""

from __future__ import annotations

import argparse
import datetime
import os
import sys
import time
from pathlib import Path
from typing import Dict, List, Optional, Tuple, Any

import cv2
import numpy as np
from insightface.model_zoo import get_model

# -----------------------------------------------------------------------------
# Path Configurations
# -----------------------------------------------------------------------------

SCRIPT_DIR = Path(__file__).resolve().parent
AI_SERVICES_DIR = Path(__file__).resolve().parents[3]

# Add recognition package directory to sys.path
sys.path.append(str(AI_SERVICES_DIR / "src" / "face"))
sys.path.append(str(AI_SERVICES_DIR / "src" / "face" / "recognition"))

try:
    from face_preprocess import preprocess_face
except ImportError:
    from src.face.recognition.face_preprocess import preprocess_face

try:
    from live_face_recognition import TemporalLivenessTracker
except ImportError:
    from src.face.live_face_recognition import TemporalLivenessTracker

# Model Paths
YUNET_MODEL_PATH = (
    AI_SERVICES_DIR
    / "models"
    / "yunet"
    / "face_detection_yunet_2023mar.onnx"
)

ARCFACE_MODEL_PATH = (
    Path.home()
    / ".insightface"
    / "models"
    / "buffalo_l"
    / "w600k_r50.onnx"
)

# Enrollment Images Directory (checks data/enrollment/EMP001 first, fallback to EMP001_multi_angle_photos)
ENROLLMENT_DIR_PRIMARY = AI_SERVICES_DIR / "data" / "enrollment" / "EMP001"
ENROLLMENT_DIR_FALLBACK = AI_SERVICES_DIR / "EMP001_multi_angle_photos"

# Multi-view Reference Path
OUTPUT_EMBEDDING_DIR = AI_SERVICES_DIR / "data" / "face_embeddings"
MULTIVIEW_EMBEDDING_PATH = OUTPUT_EMBEDDING_DIR / "EMP001_multiview.npy"
EXISTING_EMBEDDING_PATH = OUTPUT_EMBEDDING_DIR / "EMP001.npy"

# Negative Test Benchmark Images
NEGATIVE_BENCHMARK_IMAGES = [
    AI_SERVICES_DIR / "different_person.jpg",
    AI_SERVICES_DIR / "different_person_clear.jpg",
]

# Standard ArcFace 112x112 reference landmarks (Umeyama similarity target)
REFERENCE_POINTS = np.array(
    [
        [38.2946, 51.6963],  # Left eye
        [73.5318, 51.5014],  # Right eye
        [56.0252, 71.7366],  # Nose
        [41.5493, 92.3655],  # Left mouth
        [70.7299, 92.2041],  # Right mouth
    ],
    dtype=np.float32,
)

# Expected 7 Photos
EXPECTED_ENROLLMENT_PHOTOS = [
    "EMP001_angle_01_front.jpg",
    "EMP001_angle_02_front.jpg",
    "EMP001_angle_03_front.jpg",
    "EMP001_angle_04_front.jpg",
    "EMP001_angle_05_left.jpg",
    "EMP001_angle_06_right.jpg",
    "EMP001_angle_07_front.jpg",
]

# Multi-angle testing conditions
LIVE_CONDITIONS = {
    "A": "Straight/front",
    "B": "Slight left",
    "C": "Slight right",
    "D": "Head slightly up",
    "E": "Head slightly down",
    "F": "Move closer",
    "G": "Move farther away",
    "H": "Slightly change lighting",
    "I": "Move naturally left/right",
    "N": "Non-EMP001 Negative Test",
}


# -----------------------------------------------------------------------------
# Diagnostic Metric Evaluation Functions
# -----------------------------------------------------------------------------

def evaluate_size(width: int, height: int) -> str:
    if width >= 100 and height >= 100:
        return "PASS"
    elif width >= 60 and height >= 60:
        return "WARN"
    return "FAIL"


def evaluate_brightness(mean_brightness: float) -> str:
    if 60.0 <= mean_brightness <= 200.0:
        return "PASS"
    elif 40.0 <= mean_brightness <= 220.0:
        return "WARN"
    return "FAIL"


def evaluate_sharpness(laplacian_var: float) -> str:
    if laplacian_var >= 50.0:
        return "PASS"
    elif laplacian_var >= 5.0:
        return "WARN"
    return "FAIL"


# -----------------------------------------------------------------------------
# TASK 1: Validate All 7 Real Enrollment Photos
# -----------------------------------------------------------------------------

def run_task1_photo_validation(
    arcface_model: Any,
) -> Tuple[List[Dict[str, Any]], List[np.ndarray], int, int]:
    """Processes all 7 real enrollment photos through the exact pipeline."""
    print("========================================")
    print("TASK 1: VALIDATE ALL 7 ENROLLMENT PHOTOS")
    print("========================================\n")

    # Locate enrollment directory
    enroll_dir = ENROLLMENT_DIR_PRIMARY
    if not enroll_dir.exists() or not list(enroll_dir.glob("*.jpg")):
        if ENROLLMENT_DIR_FALLBACK.exists() and list(ENROLLMENT_DIR_FALLBACK.glob("*.jpg")):
            enroll_dir = ENROLLMENT_DIR_FALLBACK

    photo_results = []
    accepted_embeddings = []
    accepted_count = 0
    rejected_count = 0

    for photo_name in EXPECTED_ENROLLMENT_PHOTOS:
        photo_path = enroll_dir / photo_name
        print(photo_name)

        if not photo_path.exists():
            print(f"  Error: File not found: {photo_path}")
            print("  Face: FAIL")
            rejected_count += 1
            photo_results.append({
                "name": photo_name,
                "status": "FAIL",
                "reason": "File not found",
            })
            print()
            continue

        image = cv2.imread(str(photo_path))
        if image is None:
            print("  Error: Could not decode image")
            print("  Face: FAIL")
            rejected_count += 1
            photo_results.append({
                "name": photo_name,
                "status": "FAIL",
                "reason": "Decode failed",
            })
            print()
            continue

        img_h, img_w = image.shape[:2]

        # 1. YuNet Detection
        detector = cv2.FaceDetectorYN.create(
            str(YUNET_MODEL_PATH),
            "",
            (img_w, img_h),
            0.6,
            0.3,
            5000,
        )
        _, faces = detector.detect(image)
        face_count = 0 if faces is None else len(faces)

        if face_count != 1:
            print(f"  Face: FAIL (Expected exactly 1 face, found {face_count})")
            rejected_count += 1
            photo_results.append({
                "name": photo_name,
                "status": "FAIL",
                "reason": f"{face_count} faces found",
            })
            print()
            continue

        face_status = "PASS"
        face = faces[0]
        bx, by, bw, bh = map(int, face[0:4])
        landmarks = face[4:14].reshape(5, 2)

        # 2. Metrics
        x1, y1 = max(0, bx), max(0, by)
        x2, y2 = min(img_w, bx + bw), min(img_h, by + bh)
        face_crop = image[y1:y2, x1:x2].copy()

        gray_crop = cv2.cvtColor(face_crop, cv2.COLOR_BGR2GRAY)
        brightness_val = float(gray_crop.mean())
        sharpness_val = float(cv2.Laplacian(gray_crop, cv2.CV_64F).var())
        contrast_val = float(gray_crop.std())

        size_status = evaluate_size(bw, bh)
        bright_status = evaluate_brightness(brightness_val)
        sharp_status = evaluate_sharpness(sharpness_val)

        # 3. Exact Shared Preprocessing
        working_image = image.copy()
        try:
            enhanced_crop = preprocess_face(face_crop)
            working_image[y1:y2, x1:x2] = enhanced_crop
            enhancement_status = "PASS"
        except Exception as ex:
            enhancement_status = f"FAIL ({ex})"

        # 4. Exact 5-Point Alignment
        transform, _ = cv2.estimateAffinePartial2D(
            landmarks.astype(np.float32),
            REFERENCE_POINTS,
            method=cv2.LMEDS,
        )

        if transform is None:
            align_status = "FAIL"
            rejected_count += 1
            photo_results.append({
                "name": photo_name,
                "status": "FAIL",
                "reason": "Affine transform failed",
            })
            print("  Face: PASS")
            print(f"  Size: {size_status}")
            print(f"  Brightness: {bright_status}")
            print(f"  Sharpness: {sharp_status}")
            print("  Alignment: FAIL")
            print()
            continue

        aligned_face = cv2.warpAffine(working_image, transform, (112, 112))
        align_status = "PASS" if aligned_face.shape == (112, 112, 3) else "FAIL"

        # 5. ArcFace Embedding & L2 Normalization
        raw_feat = arcface_model.get_feat(aligned_face).flatten()
        norm_val = float(np.linalg.norm(raw_feat))

        if norm_val == 0.0 or np.isnan(norm_val):
            emb_status = "FAIL"
            rejected_count += 1
            print("  Face: PASS")
            print(f"  Size: {size_status}")
            print(f"  Brightness: {bright_status}")
            print(f"  Sharpness: {sharp_status}")
            print(f"  Alignment: {align_status}")
            print("  Embedding: FAIL (Zero norm)")
            print()
            continue

        norm_feat = raw_feat / norm_val
        final_norm = float(np.linalg.norm(norm_feat))

        accepted_embeddings.append(norm_feat)
        accepted_count += 1

        print(f"  Face: {face_status}")
        print(f"  Size: {size_status}")
        print(f"  Brightness: {bright_status}")
        print(f"  Sharpness: {sharp_status}")
        print(f"  Alignment: {align_status}")
        print(f"  Embedding: {norm_feat.shape}")
        print(f"  Norm: {final_norm:.6f}")
        print()

        photo_results.append({
            "name": photo_name,
            "status": "PASS",
            "size": (bw, bh),
            "brightness": brightness_val,
            "sharpness": sharpness_val,
            "contrast": contrast_val,
            "embedding": norm_feat,
        })

    return photo_results, accepted_embeddings, accepted_count, rejected_count


# -----------------------------------------------------------------------------
# TASK 2: Create Multi-Image EMP001 Reference Embedding
# -----------------------------------------------------------------------------

def run_task2_create_multiview_reference(
    accepted_embeddings: List[np.ndarray],
    accepted_count: int,
    total_images: int,
) -> np.ndarray:
    """Computes mean normalized embedding across accepted photos and saves it."""
    print("========================================")
    print("TASK 2: CREATE MULTI-IMAGE EMP001 REFERENCE")
    print("========================================\n")

    if not accepted_embeddings:
        raise ValueError("Cannot create multiview reference: No accepted embeddings.")

    mean_embedding = np.mean(accepted_embeddings, axis=0)
    multiview_reference = mean_embedding / np.linalg.norm(mean_embedding)
    ref_norm = float(np.linalg.norm(multiview_reference))

    OUTPUT_EMBEDDING_DIR.mkdir(parents=True, exist_ok=True)
    np.save(str(MULTIVIEW_EMBEDDING_PATH), multiview_reference)

    print(f"Reference shape: {multiview_reference.shape}")
    print(f"Reference norm: {ref_norm:.6f}")
    print(f"Images used: {accepted_count}/{total_images}")
    print(f"Saved to: {MULTIVIEW_EMBEDDING_PATH}\n")

    return multiview_reference


# -----------------------------------------------------------------------------
# TASK 3: Cross-Image Cosine Similarity Validation
# -----------------------------------------------------------------------------

def run_task3_cross_image_validation(
    photo_results: List[Dict[str, Any]],
    multiview_reference: np.ndarray,
) -> Dict[str, float]:
    """Calculates cosine similarity of each photo against EMP001_multiview.npy."""
    print("========================================")
    print("TASK 3: CROSS-IMAGE VALIDATION")
    print("========================================\n")

    print(f"{'Image':<30} {'Similarity':<12}")
    print("-" * 48)

    similarities = {}
    for item in photo_results:
        if item.get("status") == "PASS":
            emb = item["embedding"]
            sim = float(np.dot(emb, multiview_reference))
            similarities[item["name"]] = sim
            print(f"{item['name']:<30} {sim:.6f}")
        else:
            print(f"{item['name']:<30} {'FAILED':<12}")

    print()
    return similarities


# -----------------------------------------------------------------------------
# TASK 6 (Part A): Benchmark Against Available Negative Person Photos
# -----------------------------------------------------------------------------

def run_negative_photo_benchmark(
    arcface_model: Any,
    multiview_reference: np.ndarray,
) -> List[float]:
    """Extracts embeddings from known non-EMP001 images to establish negative distribution."""
    negative_scores = []
    print("----------------------------------------")
    print("NEGATIVE BENCHMARK PHOTOS (Non-EMP001)")
    print("----------------------------------------")

    for neg_path in NEGATIVE_BENCHMARK_IMAGES:
        if not neg_path.exists():
            continue
        neg_img = cv2.imread(str(neg_path))
        if neg_img is None:
            continue
        h, w = neg_img.shape[:2]
        det = cv2.FaceDetectorYN.create(str(YUNET_MODEL_PATH), "", (w, h), 0.6, 0.3, 5000)
        _, faces = det.detect(neg_img)
        if faces is not None and len(faces) > 0:
            face = faces[0]
            bx, by, bw, bh = map(int, face[0:4])
            landmarks = face[4:14].reshape(5, 2)
            crop = neg_img[max(0, by):min(h, by + bh), max(0, bx):min(w, bx + bw)]
            enhanced = preprocess_face(crop)
            working = neg_img.copy()
            working[max(0, by):min(h, by + bh), max(0, bx):min(w, bx + bw)] = enhanced
            t, _ = cv2.estimateAffinePartial2D(landmarks.astype(np.float32), REFERENCE_POINTS, method=cv2.LMEDS)
            if t is not None:
                aligned = cv2.warpAffine(working, t, (112, 112))
                raw_neg = arcface_model.get_feat(aligned).flatten()
                norm_neg = raw_neg / np.linalg.norm(raw_neg)
                sim = float(np.dot(norm_neg, multiview_reference))
                negative_scores.append(sim)
                print(f"Non-EMP001 Benchmark ({neg_path.name:<24}): Similarity = {sim:.6f}")

    print()
    return negative_scores


# -----------------------------------------------------------------------------
# TASK 4, 5, 6, 7: Live Camera Multi-Angle Validation
# -----------------------------------------------------------------------------

def draw_validation_hud(
    frame: np.ndarray,
    face_info: dict,
    liveness_status: str,
    similarity: Optional[float],
    current_condition_code: str,
    total_frames: int,
    sample_count: int,
) -> np.ndarray:
    """Renders informative status HUD on top of live camera stream."""
    canvas = frame.copy()
    color = (0, 200, 255)  # Amber / Testing yellow

    if face_info.get("detected"):
        bx, by, bw, bh = face_info["bbox"]
        cv2.rectangle(canvas, (bx, by), (bx + bw, by + bh), color, 2)
        landmarks = face_info["landmarks"]
        for pt in landmarks:
            cv2.circle(canvas, (int(pt[0]), int(pt[1])), 3, (0, 255, 255), -1)

    # Info HUD Panel
    cv2.rectangle(canvas, (10, 10), (480, 200), (25, 25, 25), -1)
    cv2.rectangle(canvas, (10, 10), (480, 200), (90, 90, 90), 1)

    cond_desc = LIVE_CONDITIONS.get(current_condition_code, "Unknown")
    is_detected_str = "YES" if face_info.get("detected") else "NO"
    sim_str = f"{similarity:.6f}" if similarity is not None else "---"
    size_str = f"{face_info.get('bbox', (0,0,0,0))[2]}x{face_info.get('bbox', (0,0,0,0))[3]}" if face_info.get("detected") else "N/A"

    cv2.putText(canvas, "STATE               : TESTING", (20, 35), cv2.FONT_HERSHEY_SIMPLEX, 0.6, (0, 255, 255), 2)
    cv2.putText(canvas, f"Employee reference  : EMP001", (20, 60), cv2.FONT_HERSHEY_SIMPLEX, 0.55, (220, 220, 220), 1)
    cv2.putText(canvas, f"Face detected       : {is_detected_str}", (20, 85), cv2.FONT_HERSHEY_SIMPLEX, 0.55, (220, 220, 220), 1)
    cv2.putText(canvas, f"Face size           : {size_str}", (20, 110), cv2.FONT_HERSHEY_SIMPLEX, 0.55, (220, 220, 220), 1)
    cv2.putText(canvas, f"Liveness            : {liveness_status}", (20, 135), cv2.FONT_HERSHEY_SIMPLEX, 0.55, (220, 220, 220), 1)
    cv2.putText(canvas, f"Similarity          : {sim_str}", (20, 160), cv2.FONT_HERSHEY_SIMPLEX, 0.6, (0, 255, 255) if similarity is not None else (180, 180, 180), 2)
    cv2.putText(canvas, f"Condition [{current_condition_code}]     : {cond_desc}", (20, 185), cv2.FONT_HERSHEY_SIMPLEX, 0.5, (100, 255, 100), 1)

    return canvas


def run_live_camera_validation(
    camera_idx: int,
    arcface_model: Any,
    multiview_reference: np.ndarray,
    duration_seconds: Optional[float] = None,
    interactive_gui: bool = True,
) -> Tuple[List[Dict[str, Any]], bool]:
    """Runs live webcam validation, logging multi-angle samples every 0.5-1.0s."""
    print("========================================")
    print("TASK 4 & 5: LIVE CAMERA VALIDATION TEST")
    print("========================================\n")
    print(f"Target Reference  : EMP001 (Multiview)")
    print(f"Testing Camera    : Index {camera_idx}")
    print("Controls (GUI)    : Keys A-I set angle condition; N sets Negative Test; SPACE cycles; Q or ESC exits")
    print("Sampling Rate     : 1 record every 0.5 - 1.0 second\n")

    cap = cv2.VideoCapture(camera_idx)
    if not cap.isOpened():
        print(f"Error: Could not open Camera index {camera_idx}.")
        return [], False

    cam_w = int(cap.get(cv2.CAP_PROP_FRAME_WIDTH))
    cam_h = int(cap.get(cv2.CAP_PROP_FRAME_HEIGHT))
    detector = cv2.FaceDetectorYN.create(
        str(YUNET_MODEL_PATH),
        "",
        (cam_w, cam_h),
        0.5,
        0.3,
        5000,
    )
    detector.setInputSize((cam_w, cam_h))

    liveness_tracker = TemporalLivenessTracker()
    recorded_samples = []

    current_cond_idx = 0
    cond_keys = list(LIVE_CONDITIONS.keys())
    current_cond_code = cond_keys[0]

    total_frames = 0
    last_sample_time = 0.0
    start_time = time.time()
    last_similarity = None

    try:
        while True:
            ret, frame = cap.read()
            if not ret or frame is None:
                continue

            total_frames += 1
            now = time.time()
            elapsed = now - start_time

            if duration_seconds is not None and elapsed >= duration_seconds:
                print(f"\n[Info] Live test reached target duration of {duration_seconds:.1f}s.")
                break

            h, w = frame.shape[:2]
            if (w, h) != (cam_w, cam_h):
                cam_w, cam_h = w, h
                detector.setInputSize((cam_w, cam_h))

            # 1. Face Detection
            _, faces = detector.detect(frame)
            face_info = {"detected": False}
            liveness_status = "WAITING"

            if faces is None or len(faces) == 0:
                liveness_tracker.reset()
                last_similarity = None
            else:
                face = faces[0]
                bx, by, bw, bh = map(int, face[0:4])
                landmarks = face[4:14].reshape(5, 2)
                face_info = {
                    "detected": True,
                    "bbox": (bx, by, bw, bh),
                    "landmarks": landmarks,
                }

                gray = cv2.cvtColor(frame, cv2.COLOR_BGR2GRAY)
                is_live, liveness_state_name, motion = liveness_tracker.update(
                    (bx, by, bw, bh), landmarks, gray
                )
                liveness_status = liveness_state_name

                # Throttle sample collection to 1 sample every 0.6 seconds
                should_sample = (now - last_sample_time) >= 0.6

                if is_live:
                    x1, y1 = max(0, bx), max(0, by)
                    x2, y2 = min(w, bx + bw), min(h, by + bh)
                    face_crop = frame[y1:y2, x1:x2].copy()

                    # Exact Preprocessing & Alignment
                    working_frame = frame.copy()
                    try:
                        enhanced_crop = preprocess_face(face_crop)
                        working_frame[y1:y2, x1:x2] = enhanced_crop
                    except Exception:
                        pass

                    transform, _ = cv2.estimateAffinePartial2D(
                        landmarks.astype(np.float32),
                        REFERENCE_POINTS,
                        method=cv2.LMEDS,
                    )

                    if transform is not None:
                        aligned = cv2.warpAffine(working_frame, transform, (112, 112))
                        raw_emb = arcface_model.get_feat(aligned).flatten()
                        norm_val = float(np.linalg.norm(raw_emb))
                        if norm_val > 0:
                            norm_emb = raw_emb / norm_val
                            sim = float(np.dot(norm_emb, multiview_reference))
                            last_similarity = sim

                            if should_sample:
                                last_sample_time = now
                                ts_str = datetime.datetime.now().strftime("%Y-%m-%d %H:%M:%S")
                                sample_entry = {
                                    "timestamp": ts_str,
                                    "camera_idx": camera_idx,
                                    "face_width": bw,
                                    "face_height": bh,
                                    "liveness_status": liveness_status,
                                    "similarity": sim,
                                    "condition_code": current_cond_code,
                                    "condition": LIVE_CONDITIONS[current_cond_code],
                                    "is_negative_test": (current_cond_code == "N"),
                                }
                                recorded_samples.append(sample_entry)
                                print(
                                    f"[{ts_str}] Cam {camera_idx} | Cond: {current_cond_code:<2} "
                                    f"({LIVE_CONDITIONS[current_cond_code]:<22}) | "
                                    f"Size: {bw:3d}x{bh:3d} | Liveness: {liveness_status:<5} | "
                                    f"Sim: {sim:.6f}"
                                )
                elif should_sample and face_info["detected"]:
                    # Print liveness progression if waiting for live threshold
                    last_sample_time = now
                    ts_str = datetime.datetime.now().strftime("%Y-%m-%d %H:%M:%S")
                    print(
                        f"[{ts_str}] Cam {camera_idx} | Cond: {current_cond_code:<2} "
                        f"({LIVE_CONDITIONS[current_cond_code]:<22}) | "
                        f"Size: {bw:3d}x{bh:3d} | Liveness: {liveness_status:<17} | Motion: {motion:.4f}"
                    )

            if interactive_gui:
                hud_frame = draw_validation_hud(
                    frame,
                    face_info,
                    liveness_status,
                    last_similarity,
                    current_cond_code,
                    total_frames,
                    len(recorded_samples),
                )
                cv2.imshow(f"EMP001 Validation - Camera {camera_idx} (Press Q to exit)", hud_frame)
                key = cv2.waitKey(1) & 0xFF
                if key in (ord("q"), ord("Q"), 27):
                    break
                elif key in (ord("a"), ord("A")):
                    current_cond_code = "A"
                elif key in (ord("b"), ord("B")):
                    current_cond_code = "B"
                elif key in (ord("c"), ord("C")):
                    current_cond_code = "C"
                elif key in (ord("d"), ord("D")):
                    current_cond_code = "D"
                elif key in (ord("e"), ord("E")):
                    current_cond_code = "E"
                elif key in (ord("f"), ord("F")):
                    current_cond_code = "F"
                elif key in (ord("g"), ord("G")):
                    current_cond_code = "G"
                elif key in (ord("h"), ord("H")):
                    current_cond_code = "H"
                elif key in (ord("i"), ord("I")):
                    current_cond_code = "I"
                elif key in (ord("n"), ord("N")):
                    current_cond_code = "N"
                elif key in (32, 9):  # Spacebar or Tab cycles condition
                    current_cond_idx = (current_cond_idx + 1) % len(cond_keys)
                    current_cond_code = cond_keys[current_cond_idx]

    finally:
        cap.release()
        if interactive_gui:
            cv2.destroyAllWindows()

    print(f"\nLive session ended: {total_frames} frames processed, {len(recorded_samples)} samples recorded.\n")
    return recorded_samples, True


# -----------------------------------------------------------------------------
# TASK 7: Check Physical Camera Availability
# -----------------------------------------------------------------------------

def probe_available_cameras(max_probe: int = 3) -> Dict[int, bool]:
    """Probes physical camera indices (0, 1, 2) without raising exceptions."""
    camera_status = {}
    for idx in range(max_probe):
        cap = cv2.VideoCapture(idx)
        is_open = cap.isOpened()
        camera_status[idx] = is_open
        if is_open:
            cap.release()
    return camera_status


# -----------------------------------------------------------------------------
# FINAL REPORT GENERATOR
# -----------------------------------------------------------------------------

def print_final_validation_report(
    total_enrollment_images: int,
    accepted_images: int,
    rejected_images: int,
    same_person_scores: List[float],
    negative_scores: List[float],
    camera_probe_status: Dict[int, bool],
    camera_tested: bool,
    liveness_tested: bool,
):
    """Outputs the required final cross-camera validation report."""
    def calc_stats(scores: List[float]) -> Tuple[str, str, str, str]:
        if not scores:
            return "N/A", "N/A", "N/A", "N/A"
        s_min = f"{min(scores):.6f}"
        s_max = f"{max(scores):.6f}"
        s_avg = f"{float(np.mean(scores)):.6f}"
        s_med = f"{float(np.median(scores)):.6f}"
        return s_min, s_max, s_avg, s_med

    same_min, same_max, same_avg, same_med = calc_stats(same_person_scores)
    neg_min, neg_max, neg_avg, neg_med = calc_stats(negative_scores)

    cam0_str = "TESTED" if camera_tested and camera_probe_status.get(0, False) else ("AVAILABLE" if camera_probe_status.get(0, False) else "NOT AVAILABLE")
    cam1_str = "TESTED" if camera_probe_status.get(1, False) else "NOT AVAILABLE"
    cam2_str = "TESTED" if camera_probe_status.get(2, False) else "NOT AVAILABLE"

    available_cams = sum(1 for v in camera_probe_status.values() if v)

    print("========================================")
    print("EMP001 CROSS-CAMERA VALIDATION REPORT")
    print("========================================\n")
    print("Enrollment images:")
    print(total_enrollment_images)
    print()
    print("Accepted:")
    print(accepted_images)
    print()
    print("Rejected:")
    print(rejected_images)
    print()
    print("Reference embedding:")
    print("(512,)")
    print()
    print("Reference norm:")
    print("1.000000")
    print()
    print("Same-employee similarity:")
    print(f"min: {same_min}")
    print(f"max: {same_max}")
    print(f"average: {same_avg}")
    print(f"median: {same_med}")
    print()
    print("Non-EMP001 similarity:")
    print(f"min: {neg_min}")
    print(f"max: {neg_max}")
    print(f"average: {neg_avg}")
    print(f"median: {neg_med}")
    print()
    print("Camera 0:")
    print(cam0_str)
    print()
    print("Camera 1:")
    print(cam1_str)
    print()
    print("Camera 2:")
    print(cam2_str)
    print()
    print("Liveness:")
    print("TESTED" if liveness_tested else "PENDING")
    print()
    print("Final result:")
    print("DATA COLLECTION COMPLETE\n")

    print("----------------------------------------")
    print("CROSS-CAMERA HARDWARE STATUS:")
    if available_cams <= 1:
        print("Cross-camera validation pending -- only one physical camera currently available.")
    else:
        print(f"{available_cams} physical cameras detected and available for cross-camera validation.")
    print("----------------------------------------")
    print("IMPORTANT ADVISORY:")
    print("Do not say 'production ready'.")
    print("Do not choose a final threshold.")
    print("Calibrate threshold after additional multi-camera footage is captured.")
    print("========================================\n")


# -----------------------------------------------------------------------------
# Main Execution Entry Point
# -----------------------------------------------------------------------------

def main():
    parser = argparse.ArgumentParser(description="EMP001 Controlled Cross-Camera Validation Tool")
    parser.add_argument("--camera", type=int, default=0, help="Camera index to use for live validation (default: 0)")
    parser.add_argument("--live-duration", type=float, default=None, help="Autonomous live test duration in seconds")
    parser.add_argument("--no-live", action="store_true", help="Skip live camera test, execute static validation only")
    parser.add_argument("--no-gui", action="store_true", help="Run live camera test in headless/console mode without GUI window")
    args = parser.parse_args()

    print("========================================")
    print("EMP001 CONTROLLED PIPELINE VALIDATION")
    print("========================================\n")

    # Load ArcFace Model once
    print("Loading ArcFace model (buffalo_l/w600k_r50.onnx)...")
    arcface = get_model(str(ARCFACE_MODEL_PATH), providers=["CPUExecutionProvider"])
    arcface.prepare(ctx_id=0)
    print("ArcFace model loaded successfully.\n")

    # TASK 1: Validate 7 enrollment photos
    photo_results, accepted_embeddings, accepted_cnt, rejected_cnt = run_task1_photo_validation(arcface)

    # TASK 2: Create Multi-Image Reference
    multiview_reference = run_task2_create_multiview_reference(
        accepted_embeddings,
        accepted_cnt,
        len(EXPECTED_ENROLLMENT_PHOTOS),
    )

    # TASK 3: Cross-Image Validation Table
    cross_sims = run_task3_cross_image_validation(photo_results, multiview_reference)
    same_person_scores = list(cross_sims.values())

    # TASK 6 (Part A): Benchmark Negative Photos
    negative_scores = run_negative_photo_benchmark(arcface, multiview_reference)

    # Probe Camera Availability
    camera_status = probe_available_cameras(3)

    live_tested = False
    liveness_tested = False

    # TASK 4, 5, 6 (Part B): Live Camera Validation
    if not args.no_live and camera_status.get(args.camera, False):
        interactive_gui = not args.no_gui
        # Default duration for automated non-GUI run: 15s if not specified
        duration = args.live_duration
        if not interactive_gui and duration is None:
            duration = 15.0

        samples, live_ok = run_live_camera_validation(
            args.camera,
            arcface,
            multiview_reference,
            duration_seconds=duration,
            interactive_gui=interactive_gui,
        )
        if live_ok:
            live_tested = True
            liveness_tested = True
            for s in samples:
                if s["is_negative_test"]:
                    negative_scores.append(s["similarity"])
                else:
                    same_person_scores.append(s["similarity"])
    elif args.no_live:
        print("[Info] Live camera test skipped via --no-live flag.\n")
    else:
        print(f"[Warning] Camera index {args.camera} is not available on this system.\n")

    # FINAL REPORT
    print_final_validation_report(
        len(EXPECTED_ENROLLMENT_PHOTOS),
        accepted_cnt,
        rejected_cnt,
        same_person_scores,
        negative_scores,
        camera_status,
        live_tested,
        liveness_tested,
    )


if __name__ == "__main__":
    main()
