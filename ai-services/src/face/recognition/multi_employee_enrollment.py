"""Multi-Employee Face Enrollment Processor.

Processes multi-angle photos for any registered or new employee from:
data/enrollment/<employeeId>/

Pipeline:
YuNet -> Face Quality Check -> Shared face_preprocess.py -> 5-Point Alignment -> ArcFace w600k_r50 -> L2 Normalization.

Features:
1. Validates employee ID format and uniqueness.
2. Processes all valid real photos in data/enrollment/<employeeId>/.
3. Generates data/face_embeddings/<employeeId>_multiview_v2.npy.
4. Performs duplicate registration check against existing employees to prevent registering the same person twice.
5. Updates data/employees.json metadata registry.
"""

from __future__ import annotations

import argparse
import sys
from pathlib import Path
from typing import Dict, List, Optional, Tuple, Any

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

from employee_registry import (
    validate_employee_id,
    register_or_update_employee,
    check_duplicate_face,
    load_all_active_embeddings,
    load_registry,
    remove_employee_safely,
)

from face_config import (
    YUNET_MODEL_PATH,
    ARCFACE_MODEL_PATH,
    ENROLLMENT_BASE_DIR,
    EMBEDDINGS_DIR,
    REFERENCE_POINTS,
    MIN_FACE_DIM_ENROLL as MIN_FACE_DIM,
    MIN_BRIGHTNESS,
    MAX_BRIGHTNESS,
    MIN_SHARPNESS_ENROLL as MIN_SHARPNESS,
    DUPLICATE_REGISTRATION_THRESHOLD,
    PROTECTED_EMPLOYEE_IDS,
)


# -----------------------------------------------------------------------------
# Single Image Processing
# -----------------------------------------------------------------------------

def process_enrollment_image(
    image_path: Path,
    detector: cv2.FaceDetectorYN,
    arcface_model: Any,
    flip_horizontal: bool = False,
) -> Tuple[bool, Optional[np.ndarray], Dict[str, Any]]:
    """Runs single photo through the standard 9-step pipeline."""
    tag_suffix = " [FLIPPED]" if flip_horizontal else ""
    meta: Dict[str, Any] = {
        "name": f"{image_path.name}{tag_suffix}",
        "face_count": 0,
        "size": (0, 0),
        "brightness": 0.0,
        "sharpness": 0.0,
        "contrast": 0.0,
        "reason": "",
    }

    if not image_path.exists():
        meta["reason"] = "File not found"
        return False, None, meta

    image = cv2.imread(str(image_path))
    if image is None:
        meta["reason"] = "Could not decode image"
        return False, None, meta

    if flip_horizontal:
        image = cv2.flip(image, 1)

    img_h, img_w = image.shape[:2]

    # Normalize image resolution for YuNet face detector anchor sensitivity
    # High-resolution phone uploads (e.g. 4096x3072) cause YuNet to miss faces or pick false artifacts.
    scale = 1.0
    if max(img_w, img_h) > 1280:
        scale = 1024.0 / float(max(img_w, img_h))
        scaled_w = int(img_w * scale)
        scaled_h = int(img_h * scale)
        detect_image = cv2.resize(image, (scaled_w, scaled_h), interpolation=cv2.INTER_AREA)
    else:
        detect_image = image

    det_h, det_w = detect_image.shape[:2]
    detector.setInputSize((det_w, det_h))

    # 1. Face detection
    _, raw_faces = detector.detect(detect_image)
    
    # Filter for significant faces (reject tiny distant background noise)
    valid_faces = []
    if raw_faces is not None and len(raw_faces) > 0:
        for f in raw_faces:
            fw = f[2] / scale
            fh = f[3] / scale
            score = float(f[-1]) if len(f) >= 5 else 0.8
            if fw >= 60 and fh >= 60 and score >= 0.40:
                valid_faces.append(f)

    # Sort prominent faces by area descending (primary subject first)
    valid_faces.sort(key=lambda x: (x[2] * x[3]), reverse=True)
    face_count = len(valid_faces)
    meta["face_count"] = face_count

    # Registration accepts exactly one face so stored identity labels remain reliable.
    if face_count != 1:
        meta["reason"] = f"Expected exactly 1 face, found {face_count}"
        return False, None, meta

    # Pick the most prominent subject face
    face = valid_faces[0]
    bx = int(face[0] / scale)
    by = int(face[1] / scale)
    bw = int(face[2] / scale)
    bh = int(face[3] / scale)
    landmarks = (face[4:14].reshape(5, 2) / scale).astype(np.float32)

    # 3. Face size & landmarks
    meta["size"] = (bw, bh)
    meta["landmarks"] = landmarks
    x1, y1 = max(0, bx), max(0, by)
    x2, y2 = min(img_w, bx + bw), min(img_h, by + bh)
    face_crop = image[y1:y2, x1:x2].copy()
    if bw < 112 or bh < 112:
        meta["reason"] = "Face too small; move closer (minimum 112x112 pixels)"
        return False, None, meta

    # 4. Brightness & 5. Sharpness
    gray = cv2.cvtColor(face_crop, cv2.COLOR_BGR2GRAY)
    meta["brightness"] = float(gray.mean())
    meta["sharpness"] = float(cv2.Laplacian(gray, cv2.CV_64F).var())
    meta["contrast"] = float(gray.std())
    if meta["brightness"] < 45:
        meta["reason"] = "Image is too dark; improve lighting"
        return False, None, meta
    if meta["brightness"] > 220:
        meta["reason"] = "Image is too bright; reduce backlighting"
        return False, None, meta
    if meta["sharpness"] < 20:
        meta["reason"] = "Image is blurry; hold the camera steady"
        return False, None, meta

    # 6. Shared Preprocessing (Exact match)
    working_image = image.copy()
    try:
        enhanced = preprocess_face(face_crop)
        working_image[y1:y2, x1:x2] = enhanced
    except Exception as ex:
        meta["reason"] = f"Preprocessing failed: {ex}"
        return False, None, meta

    # 7. 5-Point Alignment
    transform, _ = cv2.estimateAffinePartial2D(
        landmarks.astype(np.float32),
        REFERENCE_POINTS,
        method=cv2.LMEDS,
    )
    if transform is None:
        meta["reason"] = "Could not compute affine alignment"
        return False, None, meta

    aligned = cv2.warpAffine(working_image, transform, (112, 112))
    if aligned.shape != (112, 112, 3):
        meta["reason"] = "Aligned image shape mismatch"
        return False, None, meta

    # 8. ArcFace Embedding & 9. L2 Normalization
    raw_emb = arcface_model.get_feat(aligned).flatten()
    norm = float(np.linalg.norm(raw_emb))
    if norm == 0.0 or np.isnan(norm):
        meta["reason"] = "Zero or invalid embedding norm"
        return False, None, meta

    norm_emb = raw_emb / norm
    return True, norm_emb, meta


# -----------------------------------------------------------------------------
# Multi-Employee Enrollment Compiler
# -----------------------------------------------------------------------------

def enroll_employee_from_directory(
    employee_id: str,
    employee_name: Optional[str] = None,
    custom_dir: Optional[Path] = None,
    duplicate_threshold: float = DUPLICATE_REGISTRATION_THRESHOLD,
    overwrite: bool = False,
) -> Dict[str, Any]:
    """Compiles multi-angle photos from data/enrollment/<employeeId>/ into multiview embedding."""
    valid_id, err = validate_employee_id(employee_id)
    if not valid_id:
        raise ValueError(f"Invalid employee ID: {err}")

    # Protected employee protection
    if employee_id.upper() in PROTECTED_EMPLOYEE_IDS and overwrite:
        raise PermissionError(f"{employee_id} is permanently protected and cannot be deleted or overwritten.")

    enroll_dir = custom_dir if custom_dir is not None else (ENROLLMENT_BASE_DIR / employee_id)
    output_filename = f"{employee_id}_multiview_v2.npy"
    output_path = EMBEDDINGS_DIR / output_filename

    # Overwrite check and notice
    reg = load_registry()
    is_in_registry = any(r.get("employeeId") == employee_id for r in reg)
    if is_in_registry or output_path.exists():
        if overwrite:
            print(f"[INFO] Overwrite flag enabled: Existing records/embeddings for {employee_id} will be replaced.")
        else:
            print(f"[Notice] Updating existing registry record for employee '{employee_id}'.")

    print("========================================")
    print(f"ENROLLING EMPLOYEE: {employee_id}")
    print("========================================")
    print(f"Employee ID          : {employee_id}")
    print(f"Employee Name        : {employee_name or f'Employee {employee_id}'}")
    print(f"Enrollment Directory : {enroll_dir}")
    print(f"Target Embedding     : {output_path}\n")

    if not enroll_dir.exists():
        raise FileNotFoundError(f"Enrollment folder does not exist: {enroll_dir}")

    # Discover photos
    images = sorted(enroll_dir.glob("*.jpg")) + sorted(enroll_dir.glob("*.png"))
    unique_paths = []
    seen = set()
    for p in images:
        if p.name not in seen:
            seen.add(p.name)
            unique_paths.append(p)

    total_images = len(unique_paths)
    if total_images == 0:
        raise FileNotFoundError(f"No image files (.jpg, .png) found in {enroll_dir}")

    print(f"Discovered {total_images} photo(s) for {employee_id}:\n")

    # Load Models
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

    accepted_embeddings = []
    accepted_meta = []
    rejected_meta = []

    for idx, img_p in enumerate(unique_paths, start=1):
        ok, emb, meta = process_enrollment_image(img_p, detector, arcface)
        if ok and emb is not None:
            accepted_embeddings.append(emb)
            accepted_meta.append(meta)
            print(
                f"[{idx:02d}/{total_images:02d}] {meta['name']:<32} | "
                f"Size: {meta['size'][0]:3d}x{meta['size'][1]:3d} | "
                f"Bright: {meta['brightness']:5.1f} | Sharp: {meta['sharpness']:5.1f} | "
                f"Result: ACCEPTED"
            )
        else:
            rejected_meta.append(meta)
            print(
                f"[{idx:02d}/{total_images:02d}] {meta['name']:<32} | "
                f"Result: REJECTED ({meta.get('reason')})"
            )

    accepted_count = len(accepted_embeddings)
    rejected_count = len(rejected_meta)
    print()
    print("----------------------------------------")
    print(f"Photos evaluated : {total_images}")
    print(f"Accepted         : {accepted_count}")
    print(f"Rejected         : {rejected_count}")
    print("----------------------------------------\n")

    if accepted_count == 0:
        raise ValueError(f"Enrollment aborted for {employee_id}: 0 valid images accepted.")

    # Group embeddings by viewing angle to prevent blind cross-angle averaging
    from employee_registry import estimate_face_pose

    front_embeddings: List[np.ndarray] = []
    left_embeddings: List[np.ndarray] = []
    right_embeddings: List[np.ndarray] = []
    up_embeddings: List[np.ndarray] = []
    down_embeddings: List[np.ndarray] = []

    for meta_item, emb_item in zip(accepted_meta, accepted_embeddings):
        img_name = meta_item["name"].lower()
        lmks = meta_item.get("landmarks")
        pose = estimate_face_pose(lmks) if lmks is not None else "FRONT"

        # Landmark geometry is the primary authority; fallback to filename tag only if landmarks neutral
        if pose == "LEFT" or ("left" in img_name and pose not in ("RIGHT", "UP", "DOWN")):
            left_embeddings.append(emb_item)
        elif pose == "RIGHT" or ("right" in img_name and pose not in ("LEFT", "UP", "DOWN")):
            right_embeddings.append(emb_item)
        elif pose == "UP" or ("up" in img_name and pose not in ("LEFT", "RIGHT", "DOWN")):
            up_embeddings.append(emb_item)
        elif pose == "DOWN" or ("down" in img_name and pose not in ("LEFT", "RIGHT", "UP")):
            down_embeddings.append(emb_item)
        else:
            front_embeddings.append(emb_item)

    # 1. Primary canonical embedding (Frontal priority)
    canonical_sources = front_embeddings if front_embeddings else accepted_embeddings
    mean_front = np.mean(canonical_sources, axis=0)
    ref_emb = mean_front / np.linalg.norm(mean_front)
    final_norm = float(np.linalg.norm(ref_emb))

    # 2. Left profile embedding
    left_ref_path = EMBEDDINGS_DIR / f"{employee_id}_left.npy"
    if left_embeddings:
        mean_left = np.mean(left_embeddings, axis=0)
        left_emb = mean_left / np.linalg.norm(mean_left)
        np.save(str(left_ref_path), left_emb)
        print(f"[SUCCESS] Saved Left profile embedding to: {left_ref_path}")

    # 3. Right profile embedding
    right_ref_path = EMBEDDINGS_DIR / f"{employee_id}_right.npy"
    if right_embeddings:
        mean_right = np.mean(right_embeddings, axis=0)
        right_emb = mean_right / np.linalg.norm(mean_right)
        np.save(str(right_ref_path), right_emb)
        print(f"[SUCCESS] Saved Right profile embedding to: {right_ref_path}")

    # 4. Up-tilt embedding
    up_ref_path = EMBEDDINGS_DIR / f"{employee_id}_up.npy"
    if up_embeddings:
        mean_up = np.mean(up_embeddings, axis=0)
        up_emb = mean_up / np.linalg.norm(mean_up)
        np.save(str(up_ref_path), up_emb)
        print(f"[SUCCESS] Saved Up-tilt profile embedding to: {up_ref_path}")

    # 5. Down-tilt embedding
    down_ref_path = EMBEDDINGS_DIR / f"{employee_id}_down.npy"
    if down_embeddings:
        mean_down = np.mean(down_embeddings, axis=0)
        down_emb = mean_down / np.linalg.norm(mean_down)
        np.save(str(down_ref_path), down_emb)
        print(f"[SUCCESS] Saved Down-tilt profile embedding to: {down_ref_path}")

    # Task 12: Duplicate Face Registration Check
    is_dup, closest_id, closest_name, dup_sim = check_duplicate_face(
        ref_emb,
        exclude_id=employee_id,
        threshold=duplicate_threshold,
    )

    if is_dup:
        print("!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!")
        print("WARNING: This face may already be registered.")
        print(f"  Similarity: {dup_sim:.6f} with existing employee: {closest_id} ({closest_name})")
        print(f"  Duplicate-registration threshold: {duplicate_threshold:.2f} (Calibration advisory)")
        print("!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!\n")
    else:
        if closest_id is not None:
            print(f"[Info] Duplicate check: Closest existing employee is {closest_id} with similarity {dup_sim:.6f} (< {duplicate_threshold:.2f}). Clean.\n")
        else:
            print("[Info] First employee enrolled or no other active employees to compare against.\n")

    # Save canonical embedding
    EMBEDDINGS_DIR.mkdir(parents=True, exist_ok=True)
    np.save(str(output_path), ref_emb)

    # Register in data/employees.json
    record = register_or_update_employee(
        employee_id=employee_id,
        name=employee_name,
        embedding_file=output_filename,
        status="active",
    )

    print(f"[SUCCESS] Saved canonical reference embedding to: {output_path}")
    print(f"[SUCCESS] Updated employee registry record in data/employees.json:\n  {record}\n")

    # Similarity breakdown of each enrollment photo against final reference
    print("----------------------------------------")
    print("ENROLLMENT PHOTOS SIMILARITY vs REFERENCE:")
    print("----------------------------------------")
    photo_sims = []
    for meta, emb in zip(accepted_meta, accepted_embeddings):
        sim = float(np.dot(emb, ref_emb))
        photo_sims.append(sim)
        print(f"  {meta['name']:<32} : {sim:.6f}")

    print(f"\nMinimum similarity : {min(photo_sims):.6f}")
    print(f"Maximum similarity : {max(photo_sims):.6f}")
    print(f"Average similarity : {float(np.mean(photo_sims)):.6f}")
    print(f"Median similarity  : {float(np.median(photo_sims)):.6f}")
    print("========================================\n")

    return {
        "employeeId": employee_id,
        "name": record["name"],
        "embeddingFile": output_filename,
        "accepted": accepted_count,
        "rejected": rejected_count,
        "reference_norm": final_norm,
        "duplicate_warning": is_dup,
        "closest_employee": closest_id,
        "closest_similarity": dup_sim,
        "similarities": photo_sims,
    }


def main():
    parser = argparse.ArgumentParser(description="Multi-Employee Face Enrollment Processor")
    parser.add_argument("--employee", type=str, required=True, help="Employee ID to enroll (e.g., EMP002)")
    parser.add_argument("--name", type=str, default=None, help="Employee display name (e.g., 'Employee 2')")
    parser.add_argument("--dir", type=Path, default=None, help="Custom enrollment photos directory")
    parser.add_argument("--dup-threshold", type=float, default=DUPLICATE_REGISTRATION_THRESHOLD, help="Duplicate warning threshold (default: 0.75)")
    parser.add_argument("--overwrite", action="store_true", help="Force overwrite of existing employee record")
    args = parser.parse_args()

    enroll_employee_from_directory(
        employee_id=args.employee,
        employee_name=args.name,
        custom_dir=args.dir,
        duplicate_threshold=args.dup_threshold,
        overwrite=args.overwrite,
    )


if __name__ == "__main__":
    main()
