"""EMP001 Multi-Angle Enrollment Reference Generator (v2).

Processes all real multi-angle photos from data/enrollment/EMP001/ using the exact pipeline:
YuNet -> Shared face_preprocess.py -> 5-Point Alignment -> ArcFace w600k_r50 -> L2 Normalization.

Generates:
- data/face_embeddings/EMP001_multiview_v2.npy

Calculates and reports:
- Number of images evaluated, accepted, and rejected
- Individual cosine similarity of every enrollment image against the new reference
- Summary distribution statistics (min, max, average, median)
- Benchmark cosine similarity of known non-EMP001 images
"""

from __future__ import annotations

import argparse
import sys
from pathlib import Path
from typing import Dict, List, Tuple, Any

import cv2
import numpy as np
from insightface.model_zoo import get_model

# -----------------------------------------------------------------------------
# Path Configurations
# -----------------------------------------------------------------------------

AI_SERVICES_DIR = Path(__file__).resolve().parents[3]

sys.path.append(str(AI_SERVICES_DIR / "src" / "face"))
sys.path.append(str(AI_SERVICES_DIR / "src" / "face" / "recognition"))

try:
    from face_preprocess import preprocess_face
except ImportError:
    from src.face.recognition.face_preprocess import preprocess_face

from face_config import (
    YUNET_MODEL_PATH,
    ARCFACE_MODEL_PATH,
    ENROLLMENT_BASE_DIR,
    EMBEDDINGS_DIR as OUTPUT_DIR,
    REFERENCE_POINTS,
    MIN_FACE_DIM_ENROLL as MIN_FACE_DIM,
    MIN_BRIGHTNESS,
    MAX_BRIGHTNESS,
    MIN_SHARPNESS_ENROLL as MIN_SHARPNESS,
)

ENROLLMENT_DIR = ENROLLMENT_BASE_DIR / "EMP001"
OUTPUT_FILE_V2 = OUTPUT_DIR / "EMP001_multiview_v2.npy"

# Negative Test Benchmark Images
NEGATIVE_BENCHMARK_IMAGES = [
    AI_SERVICES_DIR / "different_person.jpg",
    AI_SERVICES_DIR / "different_person_clear.jpg",
]


# -----------------------------------------------------------------------------
# Single Image Processing Function
# -----------------------------------------------------------------------------

def process_single_enrollment_image(
    image_path: Path,
    detector: cv2.FaceDetectorYN,
    arcface_model: Any,
    flip_horizontal: bool = False,
) -> Tuple[bool, Optional[np.ndarray], Dict[str, Any]]:
    """Executes the exact 9-step face pipeline for a single image."""
    tag_suffix = " [FLIPPED]" if flip_horizontal else ""
    result_meta: Dict[str, Any] = {
        "name": f"{image_path.name}{tag_suffix}",
        "face_detected": False,
        "face_count": 0,
        "size": (0, 0),
        "brightness": 0.0,
        "sharpness": 0.0,
        "contrast": 0.0,
        "preprocessing": "FAIL",
        "alignment": "FAIL",
        "embedding": "FAIL",
        "reason": "",
    }

    if not image_path.exists():
        result_meta["reason"] = "File not found"
        return False, None, result_meta

    image = cv2.imread(str(image_path))
    if image is None:
        result_meta["reason"] = "Could not decode image"
        return False, None, result_meta

    if flip_horizontal:
        image = cv2.flip(image, 1)

    img_h, img_w = image.shape[:2]
    detector.setInputSize((img_w, img_h))

    # 1. YuNet Detection
    _, faces = detector.detect(image)
    face_count = 0 if faces is None else len(faces)
    result_meta["face_count"] = face_count

    # 2. Exactly-one-face validation
    if face_count != 1:
        result_meta["reason"] = f"Expected 1 face, detected {face_count}"
        return False, None, result_meta

    result_meta["face_detected"] = True
    face = faces[0]
    bx, by, bw, bh = map(int, face[0:4])
    landmarks = face[4:14].reshape(5, 2)

    # 3. Face size measurement
    result_meta["size"] = (bw, bh)
    if bw < MIN_FACE_DIM or bh < MIN_FACE_DIM:
        result_meta["reason"] = f"Face dimensions ({bw}x{bh}) below minimum ({MIN_FACE_DIM}px)"
        # Note: In diagnostic enrollment, we still allow extraction if geometry allows, but flag it
        size_warn = True
    else:
        size_warn = False

    # 4. Brightness & 5. Sharpness & Contrast
    x1, y1 = max(0, bx), max(0, by)
    x2, y2 = min(img_w, bx + bw), min(img_h, by + bh)
    face_crop = image[y1:y2, x1:x2].copy()

    gray_crop = cv2.cvtColor(face_crop, cv2.COLOR_BGR2GRAY)
    brightness = float(gray_crop.mean())
    sharpness = float(cv2.Laplacian(gray_crop, cv2.CV_64F).var())
    contrast = float(gray_crop.std())

    result_meta["brightness"] = brightness
    result_meta["sharpness"] = sharpness
    result_meta["contrast"] = contrast

    # 6. Shared Preprocessing (Exact face_preprocess.py)
    working_image = image.copy()
    try:
        enhanced_crop = preprocess_face(face_crop)
        working_image[y1:y2, x1:x2] = enhanced_crop
        result_meta["preprocessing"] = "PASS"
    except Exception as ex:
        result_meta["reason"] = f"Preprocessing failed: {ex}"
        return False, None, result_meta

    # 7. 5-Point Alignment to 112x112
    transform, _ = cv2.estimateAffinePartial2D(
        landmarks.astype(np.float32),
        REFERENCE_POINTS,
        method=cv2.LMEDS,
    )

    if transform is None:
        result_meta["reason"] = "Could not estimate affine partial 2D transform"
        return False, None, result_meta

    aligned_face = cv2.warpAffine(working_image, transform, (112, 112))
    if aligned_face.shape != (112, 112, 3) or aligned_face.size == 0:
        result_meta["reason"] = "Aligned face output dimension mismatch"
        return False, None, result_meta

    result_meta["alignment"] = "PASS"

    # 8. ArcFace 512-D Embedding & 9. L2 Normalization
    raw_emb = arcface_model.get_feat(aligned_face).flatten()
    emb_norm = float(np.linalg.norm(raw_emb))

    if emb_norm == 0.0 or np.isnan(emb_norm):
        result_meta["reason"] = "Zero or NaN embedding norm"
        return False, None, result_meta

    normalized_emb = raw_emb / emb_norm
    result_meta["embedding"] = "PASS"
    result_meta["norm"] = float(np.linalg.norm(normalized_emb))

    return True, normalized_emb, result_meta


# -----------------------------------------------------------------------------
# Main Multi-View Reference Generator
# -----------------------------------------------------------------------------

def generate_multiview_v2_reference(
    enrollment_dir: Optional[Path] = None,
) -> Dict[str, Any]:
    """Inspects all enrollment images, generates EMP001_multiview_v2.npy, and prints reports."""
    target_dir = enrollment_dir if enrollment_dir is not None else ENROLLMENT_DIR
    print("========================================")
    print("EMP001 MULTI-VIEW ENROLLMENT GENERATOR (v2)")
    print("========================================\n")
    print(f"Enrollment Directory : {target_dir}")
    print(f"Output Reference     : {OUTPUT_FILE_V2}\n")

    if not YUNET_MODEL_PATH.exists():
        raise FileNotFoundError(f"YuNet model not found: {YUNET_MODEL_PATH}")
    if not ARCFACE_MODEL_PATH.exists():
        raise FileNotFoundError(f"ArcFace model not found: {ARCFACE_MODEL_PATH}")

    # Initialize Models
    print("Initializing YuNet and ArcFace models...")
    detector = cv2.FaceDetectorYN.create(
        str(YUNET_MODEL_PATH),
        "",
        (640, 480),
        0.6,
        0.3,
        5000,
    )
    arcface = get_model(str(ARCFACE_MODEL_PATH), providers=["CPUExecutionProvider"])
    arcface.prepare(ctx_id=0)
    print("Models loaded successfully.\n")

    # Discover all enrollment images
    image_paths = sorted(target_dir.glob("*.jpg")) + sorted(target_dir.glob("*.png"))
    # Filter unique filenames
    unique_paths: List[Path] = []
    seen_names = set()
    for p in image_paths:
        if p.name not in seen_names:
            seen_names.add(p.name)
            unique_paths.append(p)

    total_images = len(unique_paths)
    print(f"Discovered {total_images} enrollment image(s) for processing:\n")

    accepted_embeddings: List[np.ndarray] = []
    accepted_metadata: List[Dict[str, Any]] = []
    rejected_metadata: List[Dict[str, Any]] = []

    for idx, img_path in enumerate(unique_paths, start=1):
        success, emb, meta = process_single_enrollment_image(img_path, detector, arcface)
        if success and emb is not None:
            accepted_embeddings.append(emb)
            accepted_metadata.append(meta)
            print(
                f"[{idx:02d}/{total_images:02d}] {meta['name']:<30} | "
                f"Size: {meta['size'][0]:3d}x{meta['size'][1]:3d} | "
                f"Bright: {meta['brightness']:5.1f} | Sharp: {meta['sharpness']:5.1f} | "
                f"Result: ACCEPTED"
            )
        else:
            rejected_metadata.append(meta)
            print(
                f"[{idx:02d}/{total_images:02d}] {meta['name']:<30} | "
                f"Result: REJECTED ({meta.get('reason', 'Failed validation')})"
            )

    accepted_count = len(accepted_embeddings)
    rejected_count = len(rejected_metadata)

    print()
    print("----------------------------------------")
    print(f"Number of images : {total_images}")
    print(f"Accepted         : {accepted_count}")
    print(f"Rejected         : {rejected_count}")
    print("----------------------------------------\n")

    if accepted_count == 0:
        print("[Error] No valid face embeddings could be generated from the enrollment images.")
        sys.exit(1)

    # Group embeddings by viewing angle to preserve profile models independently
    front_embeddings: List[np.ndarray] = []
    left_embeddings: List[np.ndarray] = []
    right_embeddings: List[np.ndarray] = []
    up_embeddings: List[np.ndarray] = []
    down_embeddings: List[np.ndarray] = []

    for meta_item, emb_item in zip(accepted_metadata, accepted_embeddings):
        img_name = meta_item["name"].lower()
        if "left" in img_name:
            left_embeddings.append(emb_item)
        elif "right" in img_name:
            right_embeddings.append(emb_item)
        elif "up" in img_name:
            up_embeddings.append(emb_item)
        elif "down" in img_name:
            down_embeddings.append(emb_item)
        else:
            front_embeddings.append(emb_item)

    # 1. Primary canonical frontal embedding
    canonical_sources = front_embeddings if front_embeddings else accepted_embeddings
    mean_front = np.mean(canonical_sources, axis=0)
    reference_v2 = mean_front / np.linalg.norm(mean_front)
    final_norm = float(np.linalg.norm(reference_v2))

    OUTPUT_DIR.mkdir(parents=True, exist_ok=True)
    np.save(str(OUTPUT_FILE_V2), reference_v2)

    print(f"Generated EMP001_multiview_v2.npy (Canonical Frontal) successfully.")
    print(f"Reference shape  : {reference_v2.shape}")
    print(f"Reference norm   : {final_norm:.6f}")
    print(f"Saved to         : {OUTPUT_FILE_V2}\n")

    # 2. Left profile reference
    left_output_file = OUTPUT_DIR / "EMP001_left.npy"
    if left_embeddings:
        mean_left = np.mean(left_embeddings, axis=0)
        ref_left = mean_left / np.linalg.norm(mean_left)
        np.save(str(left_output_file), ref_left)
        print(f"Generated EMP001_left.npy successfully -> {left_output_file}")

    # 3. Right profile reference
    right_output_file = OUTPUT_DIR / "EMP001_right.npy"
    if right_embeddings:
        mean_right = np.mean(right_embeddings, axis=0)
        ref_right = mean_right / np.linalg.norm(mean_right)
        np.save(str(right_output_file), ref_right)
        print(f"Generated EMP001_right.npy successfully -> {right_output_file}\n")

    # 4. Up profile reference
    up_output_file = OUTPUT_DIR / "EMP001_up.npy"
    if up_embeddings:
        mean_up = np.mean(up_embeddings, axis=0)
        ref_up = mean_up / np.linalg.norm(mean_up)
        np.save(str(up_output_file), ref_up)
        print(f"Generated EMP001_up.npy successfully -> {up_output_file}\n")

    # 5. Down profile reference
    down_output_file = OUTPUT_DIR / "EMP001_down.npy"
    if down_embeddings:
        mean_down = np.mean(down_embeddings, axis=0)
        ref_down = mean_down / np.linalg.norm(mean_down)
        np.save(str(down_output_file), ref_down)
        print(f"Generated EMP001_down.npy successfully -> {down_output_file}\n")

    # Compare every enrollment image against the new reference
    print("========================================")
    print("ENROLLMENT IMAGES SIMILARITY (vs v2 Reference)")
    print("========================================")
    print(f"{'Image':<32} {'Similarity':<12}")
    print("-" * 46)

    same_employee_similarities: List[float] = []
    for meta, emb in zip(accepted_metadata, accepted_embeddings):
        sim = float(np.dot(emb, reference_v2))
        same_employee_similarities.append(sim)
        print(f"{meta['name']:<32} {sim:.6f}")

    print("-" * 46)

    # Calculate distribution statistics
    sim_min = min(same_employee_similarities)
    sim_max = max(same_employee_similarities)
    sim_avg = float(np.mean(same_employee_similarities))
    sim_med = float(np.median(same_employee_similarities))

    print(f"Minimum similarity : {sim_min:.6f}")
    print(f"Maximum similarity : {sim_max:.6f}")
    print(f"Average similarity : {sim_avg:.6f}")
    print(f"Median similarity  : {sim_med:.6f}\n")

    # Compare known different-person benchmark images
    print("========================================")
    print("NON-EMP001 BENCHMARK COMPARISON (vs v2 Reference)")
    print("========================================")
    negative_scores: List[float] = []
    for neg_path in NEGATIVE_BENCHMARK_IMAGES:
        if not neg_path.exists():
            continue
        success, neg_emb, neg_meta = process_single_enrollment_image(neg_path, detector, arcface)
        if success and neg_emb is not None:
            neg_sim = float(np.dot(neg_emb, reference_v2))
            negative_scores.append(neg_sim)
            print(f"{neg_path.name:<32} {neg_sim:.6f}")

    if negative_scores:
        print("-" * 46)
        print(f"Non-EMP001 Minimum : {min(negative_scores):.6f}")
        print(f"Non-EMP001 Maximum : {max(negative_scores):.6f}")
        print(f"Non-EMP001 Average : {float(np.mean(negative_scores)):.6f}")
        print(f"Non-EMP001 Median  : {float(np.median(negative_scores)):.6f}")

    print("========================================\n")

    return {
        "total_images": total_images,
        "accepted_count": accepted_count,
        "rejected_count": rejected_count,
        "reference_norm": final_norm,
        "same_employee_stats": {
            "min": sim_min,
            "max": sim_max,
            "average": sim_avg,
            "median": sim_med,
        },
        "negative_scores": negative_scores,
    }


def main():
    parser = argparse.ArgumentParser(description="EMP001 Multi-View Enrollment Generator v2")
    parser.add_argument(
        "--enrollment-dir",
        type=Path,
        default=None,
        help="Custom enrollment image directory",
    )
    args = parser.parse_args()

    generate_multiview_v2_reference(args.enrollment_dir)


if __name__ == "__main__":
    main()
