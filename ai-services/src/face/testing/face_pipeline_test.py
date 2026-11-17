"""Comprehensive Face Pipeline Diagnostics & Validation Tool.

Validates the complete computer vision pipeline across all available sample images:
1. Image loading & dimensions
2. YuNet face detection & confidence
3. Face bounding box size
4. Brightness exposure
5. Sharpness / blur (Laplacian variance)
6. Contrast (RMS / standard deviation)
7. Overall face quality classification (PASS / WARNING / FAIL)
8. Enhancement / preprocessing (LAB -> Gamma -> CLAHE -> Denoising -> Unsharp)
9. 5-point facial landmark detection & affine alignment (112x112)
10. ArcFace 512-D embedding extraction & L2-normalization
11. Preprocessing consistency verification across enrollment, recognition, and live pipelines.

NOTE: This is a diagnostic and testing tool for pipeline verification.
Development diagnostic threshold - calibrate later using real CP PLUS camera footage.
"""

from __future__ import annotations

import ast
import os
import sys
from pathlib import Path
from typing import Dict, List, Optional, Tuple, Any

import cv2
import numpy as np
from insightface.model_zoo import get_model


# -----------------------------------------------------------------------------
# Path Configurations
# -----------------------------------------------------------------------------

# File: ai-services/src/face/testing/face_pipeline_test.py
# .parent: testing
# .parents[1]: face
# .parents[2]: src
# .parents[3]: ai-services (project root)
SCRIPT_DIR = Path(__file__).resolve().parent
AI_SERVICES_DIR = Path(__file__).resolve().parents[3]

# Add recognition package directory to sys.path
sys.path.append(str(AI_SERVICES_DIR / "src" / "face" / "recognition"))
try:
    from face_preprocess import preprocess_face
except ImportError:
    from src.face.recognition.face_preprocess import preprocess_face

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

# Diagnostic image export directory (inside data/ which is gitignored)
DIAGNOSTIC_DIR = AI_SERVICES_DIR / "data" / "face_pipeline_tests"
ORIGINAL_OUTPUT_DIR = DIAGNOSTIC_DIR / "original"
ENHANCED_OUTPUT_DIR = DIAGNOSTIC_DIR / "enhanced"
ALIGNED_OUTPUT_DIR = DIAGNOSTIC_DIR / "aligned"

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

# Default images to validate if none specified on CLI
DEFAULT_IMAGE_NAMES = [
    "test.jpg",
    "test2.jpg",
    "test_3_same_person.jpg",
    "different_person.jpg",
    "different_person_clear.jpg",
]

# Related scripts for preprocessing consistency verification
ENROLLMENT_SCRIPT = AI_SERVICES_DIR / "src" / "face" / "recognition" / "face_enrollment.py"
RECOGNITION_SCRIPT = AI_SERVICES_DIR / "src" / "face" / "recognition" / "face_recognition.py"
LIVE_RECOGNITION_SCRIPT = AI_SERVICES_DIR / "src" / "face" / "live_face_recognition.py"


# -----------------------------------------------------------------------------
# Diagnostic Thresholds (Development / Diagnostic Only)
# -----------------------------------------------------------------------------
# Development diagnostic threshold - calibrate later using real CP PLUS camera footage.

# Face Size:
MIN_PASS_FACE_DIM = 100
MIN_WARN_FACE_DIM = 60

# Brightness:
MIN_PASS_BRIGHTNESS = 60.0
MAX_PASS_BRIGHTNESS = 200.0
MIN_WARN_BRIGHTNESS = 40.0
MAX_WARN_BRIGHTNESS = 220.0

# Sharpness (Laplacian variance):
MIN_PASS_SHARPNESS = 50.0
MIN_WARN_SHARPNESS = 5.0

# Contrast (Grayscale Standard Deviation):
MIN_PASS_CONTRAST = 25.0
MAX_PASS_CONTRAST = 85.0
MIN_WARN_CONTRAST = 15.0
MAX_WARN_CONTRAST = 95.0


# -----------------------------------------------------------------------------
# Preprocessing Pipeline (Matching existing face_recognition.py exactly)
# -----------------------------------------------------------------------------

def preprocess_face_detailed(face_crop: np.ndarray) -> Tuple[np.ndarray, Dict[str, str]]:
    """Applies the exact OpenCV face enhancement pipeline used in the recognition pipeline.

    Returns the enhanced crop and detailed status for each sub-stage:
    1. LAB conversion & automatic brightness adaptation
    2. CLAHE on L channel
    3. Mild color denoising
    4. Unsharp masking
    5. uint8 clipping
    """
    sub_status = {
        "clahe": "FAIL",
        "denoising": "FAIL",
        "unsharp": "FAIL",
    }

    # A. BGR -> LAB
    lab = cv2.cvtColor(face_crop, cv2.COLOR_BGR2LAB)
    l_channel, a_channel, b_channel = cv2.split(lab)

    # Automatic brightness adaptation on L channel
    mean_l = float(l_channel.mean())
    if mean_l < 60.0:
        gamma = 0.85
        lut = np.array([((i / 255.0) ** gamma) * 255 for i in range(256)], dtype=np.uint8)
        l_channel = cv2.LUT(l_channel, lut)
    elif mean_l > 200.0:
        gamma = 1.15
        lut = np.array([((i / 255.0) ** gamma) * 255 for i in range(256)], dtype=np.uint8)
        l_channel = cv2.LUT(l_channel, lut)

    # B. CLAHE on L channel
    clahe = cv2.createCLAHE(clipLimit=2.0, tileGridSize=(8, 8))
    l_clahe = clahe.apply(l_channel)
    if l_clahe is not None and l_clahe.shape == l_channel.shape:
        sub_status["clahe"] = "PASS"

    # C. LAB -> BGR
    bgr_clahe = cv2.cvtColor(cv2.merge((l_clahe, a_channel, b_channel)), cv2.COLOR_LAB2BGR)

    # D. Mild color denoising
    denoised = cv2.fastNlMeansDenoisingColored(
        bgr_clahe,
        None,
        h=3,
        hColor=3,
        templateWindowSize=7,
        searchWindowSize=15,
    )
    if denoised is not None and denoised.shape == face_crop.shape:
        sub_status["denoising"] = "PASS"

    # E. Mild unsharp masking
    blurred = cv2.GaussianBlur(denoised, (0, 0), 1.0)
    sharpened = cv2.addWeighted(
        denoised,
        1.25,
        blurred,
        -0.25,
        0,
    )
    if sharpened is not None and sharpened.shape == face_crop.shape:
        sub_status["unsharp"] = "PASS"

    # F & G. Clip to valid uint8 range
    final_enhanced = np.clip(sharpened, 0, 255).astype(np.uint8)
    return final_enhanced, sub_status


# -----------------------------------------------------------------------------
# Diagnostic Evaluation Helpers
# -----------------------------------------------------------------------------

def evaluate_size(width: int, height: int) -> Tuple[str, str]:
    if width >= MIN_PASS_FACE_DIM and height >= MIN_PASS_FACE_DIM:
        return "PASS", f"Width: {width}, Height: {height} (>= {MIN_PASS_FACE_DIM}px)"
    elif width >= MIN_WARN_FACE_DIM and height >= MIN_WARN_FACE_DIM:
        return "WARNING", f"Borderline face size: {width}x{height} (Warning range: {MIN_WARN_FACE_DIM}-{MIN_PASS_FACE_DIM}px)"
    else:
        return "FAIL", f"Face too small: {width}x{height} (< {MIN_WARN_FACE_DIM}px)"


def evaluate_brightness(mean_brightness: float) -> Tuple[str, str]:
    if MIN_PASS_BRIGHTNESS <= mean_brightness <= MAX_PASS_BRIGHTNESS:
        return "PASS", f"Mean brightness: {mean_brightness:.2f} (Optimal: {MIN_PASS_BRIGHTNESS:.0f}-{MAX_PASS_BRIGHTNESS:.0f})"
    elif MIN_WARN_BRIGHTNESS <= mean_brightness <= MAX_WARN_BRIGHTNESS:
        return "WARNING", f"Mean brightness: {mean_brightness:.2f} (Borderline: {MIN_WARN_BRIGHTNESS:.0f}-{MAX_WARN_BRIGHTNESS:.0f})"
    else:
        return "FAIL", f"Mean brightness: {mean_brightness:.2f} (Extreme under/over exposure)"


def evaluate_sharpness(laplacian_var: float) -> Tuple[str, str]:
    if laplacian_var >= MIN_PASS_SHARPNESS:
        return "PASS", f"Laplacian variance: {laplacian_var:.2f} (>= {MIN_PASS_SHARPNESS:.1f})"
    elif laplacian_var >= MIN_WARN_SHARPNESS:
        return "WARNING", f"Laplacian variance: {laplacian_var:.2f} (Moderately blurred/softened: {MIN_WARN_SHARPNESS:.1f}-{MIN_PASS_SHARPNESS:.1f})"
    else:
        return "FAIL", f"Laplacian variance: {laplacian_var:.2f} (Severely blurred: < {MIN_WARN_SHARPNESS:.1f})"


def evaluate_contrast(contrast_std: float) -> Tuple[str, str]:
    if MIN_PASS_CONTRAST <= contrast_std <= MAX_PASS_CONTRAST:
        return "PASS", f"Contrast/std: {contrast_std:.2f} (Optimal: {MIN_PASS_CONTRAST:.0f}-{MAX_PASS_CONTRAST:.0f})"
    elif MIN_WARN_CONTRAST <= contrast_std <= MAX_WARN_CONTRAST:
        return "WARNING", f"Contrast/std: {contrast_std:.2f} (Borderline: {MIN_WARN_CONTRAST:.0f}-{MAX_WARN_CONTRAST:.0f})"
    else:
        return "FAIL", f"Contrast/std: {contrast_std:.2f} (Unusable contrast)"


# -----------------------------------------------------------------------------
# Preprocessing Consistency Verifier
# -----------------------------------------------------------------------------

def check_preprocessing_consistency() -> Tuple[str, str]:
    """Inspects face_enrollment.py, face_recognition.py, and live_face_recognition.py

    to verify whether all three pipelines import and use the shared preprocess_face()
    module from face_preprocess.py.
    """
    shared_module_path = AI_SERVICES_DIR / "src" / "face" / "recognition" / "face_preprocess.py"
    if not shared_module_path.exists():
        return "FAIL", f"Shared preprocessing module not found: {shared_module_path}"

    # Verify shared module defines preprocess_face
    try:
        shared_content = shared_module_path.read_text(encoding="utf-8")
        shared_tree = ast.parse(shared_content)
        shared_funcs = [node.name for node in ast.walk(shared_tree) if isinstance(node, ast.FunctionDef)]
        if "preprocess_face" not in shared_funcs:
            return "FAIL", "Shared module face_preprocess.py does not define preprocess_face()"
    except Exception as ex:
        return "FAIL", f"Error parsing face_preprocess.py: {ex}"

    scripts = {
        "face_enrollment.py": ENROLLMENT_SCRIPT,
        "face_recognition.py": RECOGNITION_SCRIPT,
        "live_face_recognition.py": LIVE_RECOGNITION_SCRIPT,
    }

    missing_files = []
    imports_preprocess = {}
    calls_preprocess = {}

    for name, path in scripts.items():
        if not path.exists():
            missing_files.append(name)
            continue
        try:
            content = path.read_text(encoding="utf-8")
            tree = ast.parse(content)

            # Check imports via AST
            has_import = False
            for node in ast.walk(tree):
                if isinstance(node, ast.ImportFrom):
                    if any(alias.name == "preprocess_face" for alias in node.names):
                        has_import = True
                        break
                elif isinstance(node, ast.Import):
                    if any(alias.name == "face_preprocess" for alias in node.names):
                        has_import = True
                        break

            # Check function calls
            has_call = False
            for node in ast.walk(tree):
                if isinstance(node, ast.Call):
                    if isinstance(node.func, ast.Name) and node.func.id == "preprocess_face":
                        has_call = True
                        break
                    elif isinstance(node.func, ast.Attribute) and node.func.attr == "preprocess_face":
                        has_call = True
                        break

            imports_preprocess[name] = has_import
            calls_preprocess[name] = has_call
        except Exception as ex:
            return "WARNING", f"Error parsing {name}: {ex}"

    if missing_files:
        return "WARNING", f"Missing script files: {', '.join(missing_files)}"

    all_imported = all(imports_preprocess.values())
    all_called = all(calls_preprocess.values())

    if all_imported and all_called:
        return "PASS", "All 3 scripts (face_enrollment.py, face_recognition.py, live_face_recognition.py) import and use shared preprocess_face()"
    else:
        diffs = []
        for name in scripts:
            imp = imports_preprocess.get(name, False)
            call = calls_preprocess.get(name, False)
            if not imp or not call:
                diffs.append(f"{name} (imported={imp}, called={call})")
        return "WARNING", f"implementations differ: {'; '.join(diffs)}"


# -----------------------------------------------------------------------------
# Main Image Pipeline Test Runner
# -----------------------------------------------------------------------------

def run_face_pipeline_test(image_paths: List[Path]) -> Dict[str, Any]:
    """Runs end-to-end pipeline validation on the provided image list."""

    # Ensure output directories exist for diagnostic export
    ORIGINAL_OUTPUT_DIR.mkdir(parents=True, exist_ok=True)
    ENHANCED_OUTPUT_DIR.mkdir(parents=True, exist_ok=True)
    ALIGNED_OUTPUT_DIR.mkdir(parents=True, exist_ok=True)

    # 1. Verify Model Files
    if not YUNET_MODEL_PATH.exists():
        raise FileNotFoundError(f"YuNet model not found: {YUNET_MODEL_PATH}")
    if not ARCFACE_MODEL_PATH.exists():
        raise FileNotFoundError(f"ArcFace model not found: {ARCFACE_MODEL_PATH}")

    # Load ArcFace Model once
    print("\nLoading ArcFace model (buffalo_l/w600k_r50.onnx)...")
    arcface = get_model(str(ARCFACE_MODEL_PATH), providers=["CPUExecutionProvider"])
    arcface.prepare(ctx_id=0)
    print("ArcFace model loaded successfully.\n")

    # Metrics collectors for final summary
    total_images = len(image_paths)
    total_faces_detected = 0

    detection_statuses = []
    size_statuses = []
    brightness_statuses = []
    sharpness_statuses = []
    contrast_statuses = []
    enhancement_statuses = []
    alignment_statuses = []
    arcface_statuses = []

    for image_path in image_paths:
        print("========================================")
        print("FACE PIPELINE TEST")
        print("========================================")
        print(f"\nImage: {image_path.name}\n")

        # -------------------------------------------------------------
        # [1] IMAGE
        # -------------------------------------------------------------
        if not image_path.exists():
            print("[1] IMAGE")
            print(f"Error: File not found ({image_path})")
            print("Status: FAIL\n")
            print("========================================")
            print("FINAL RESULT: FAIL")
            print("========================================\n")
            detection_statuses.append("FAIL")
            continue

        image = cv2.imread(str(image_path))
        if image is None:
            print("[1] IMAGE")
            print("Error: Could not decode image")
            print("Status: FAIL\n")
            print("========================================")
            print("FINAL RESULT: FAIL")
            print("========================================\n")
            detection_statuses.append("FAIL")
            continue

        img_h, img_w = image.shape[:2]
        channels = image.shape[2] if len(image.shape) > 2 else 1
        print("[1] IMAGE")
        print(f"Resolution: {img_w} x {img_h}")
        print(f"Channels: {channels}")
        print("Status: PASS\n")

        # Save diagnostic original
        cv2.imwrite(str(ORIGINAL_OUTPUT_DIR / image_path.name), image)

        # -------------------------------------------------------------
        # [2] FACE DETECTION (YuNet)
        # -------------------------------------------------------------
        detector = cv2.FaceDetectorYN.create(
            str(YUNET_MODEL_PATH),
            "",
            (img_w, img_h),
            0.6,
            0.3,
            5000,
        )
        _, faces = detector.detect(image)
        num_faces = 0 if faces is None else len(faces)
        total_faces_detected += num_faces

        print("[2] FACE DETECTION")
        print(f"Faces detected: {num_faces}")

        if num_faces == 0:
            print("Status: FAIL (No face detected)")
            print("\n========================================")
            print("FINAL RESULT: FAIL")
            print("========================================\n")
            detection_statuses.append("FAIL")
            continue

        print("Status: PASS\n")
        detection_statuses.append("PASS")

        # Select primary face
        face = faces[0]
        bx, by, bw, bh = map(int, face[0:4])
        x1, y1 = max(0, bx), max(0, by)
        x2, y2 = min(img_w, bx + bw), min(img_h, by + bh)
        face_crop = image[y1:y2, x1:x2].copy()

        # -------------------------------------------------------------
        # [3] FACE SIZE
        # -------------------------------------------------------------
        size_status, size_msg = evaluate_size(bw, bh)
        print("[3] FACE SIZE")
        print(f"Width: {bw}")
        print(f"Height: {bh}")
        print(f"Status: {size_status}\n")
        size_statuses.append(size_status)

        # Grayscale for metrics
        gray_crop = cv2.cvtColor(face_crop, cv2.COLOR_BGR2GRAY)

        # -------------------------------------------------------------
        # [4] BRIGHTNESS
        # -------------------------------------------------------------
        mean_brightness = float(gray_crop.mean())
        bright_status, bright_msg = evaluate_brightness(mean_brightness)
        print("[4] BRIGHTNESS")
        print(f"Mean brightness: {mean_brightness:.2f}")
        print(f"Status: {bright_status}\n")
        brightness_statuses.append(bright_status)

        # -------------------------------------------------------------
        # [5] SHARPNESS
        # -------------------------------------------------------------
        laplacian_var = float(cv2.Laplacian(gray_crop, cv2.CV_64F).var())
        sharp_status, sharp_msg = evaluate_sharpness(laplacian_var)
        print("[5] SHARPNESS")
        print(f"Laplacian variance: {laplacian_var:.2f}")
        print(f"Status: {sharp_status}\n")
        sharpness_statuses.append(sharp_status)

        # -------------------------------------------------------------
        # [6] CONTRAST
        # -------------------------------------------------------------
        contrast_std = float(gray_crop.std())
        contrast_status, contrast_msg = evaluate_contrast(contrast_std)
        print("[6] CONTRAST")
        print(f"Contrast/std: {contrast_std:.2f}")
        print(f"Status: {contrast_status}\n")
        contrast_statuses.append(contrast_status)

        # -------------------------------------------------------------
        # [7] OVERALL QUALITY
        # -------------------------------------------------------------
        quality_components = [size_status, bright_status, sharp_status, contrast_status]
        if "FAIL" in quality_components:
            overall_quality = "FAIL"
        elif "WARNING" in quality_components:
            overall_quality = "WARNING"
        else:
            overall_quality = "PASS"

        print("[7] OVERALL QUALITY")
        print(f"Status: {overall_quality}")
        print("Note: Development diagnostic threshold - calibrate later using real CP PLUS camera footage.\n")

        # -------------------------------------------------------------
        # [8] ENHANCEMENT / PREPROCESSING
        # -------------------------------------------------------------
        enhancement_pass = False
        working_image = image.copy()
        try:
            enhanced_crop, sub_status = preprocess_face_detailed(face_crop)
            working_image[y1:y2, x1:x2] = enhanced_crop

            print("[8] ENHANCEMENT")
            print(f"CLAHE: {sub_status['clahe']}")
            print(f"Denoising: {sub_status['denoising']}")
            print(f"Unsharp enhancement: {sub_status['unsharp']}")

            if (
                sub_status["clahe"] == "PASS"
                and sub_status["denoising"] == "PASS"
                and sub_status["unsharp"] == "PASS"
            ):
                print("Status: PASS\n")
                enhancement_statuses.append("PASS")
                enhancement_pass = True
            else:
                print("Status: WARNING (Partial enhancement execution)\n")
                enhancement_statuses.append("WARNING")

            # Save diagnostic enhanced crop
            cv2.imwrite(str(ENHANCED_OUTPUT_DIR / image_path.name), enhanced_crop)
        except Exception as ex:
            print("[8] ENHANCEMENT")
            print(f"Error: {ex}")
            print("Status: FAIL\n")
            enhancement_statuses.append("FAIL")

        # -------------------------------------------------------------
        # [9] ALIGNMENT (5 landmarks -> 112x112)
        # -------------------------------------------------------------
        alignment_pass = False
        aligned_face = None
        landmarks = face[4:14].reshape(5, 2)

        has_5_landmarks = (
            len(landmarks) == 5
            and not np.isnan(landmarks).any()
            and not np.isinf(landmarks).any()
        )

        transform, _ = cv2.estimateAffinePartial2D(
            landmarks.astype(np.float32),
            REFERENCE_POINTS,
            method=cv2.LMEDS,
        )

        print("[9] ALIGNMENT")
        if transform is not None and has_5_landmarks:
            aligned_face = cv2.warpAffine(
                working_image,
                transform,
                (112, 112),
            )
            out_h, out_w = aligned_face.shape[:2]
            print(f"Output: {out_w} x {out_h}")
            print(f"5 landmarks detected: {'YES' if has_5_landmarks else 'NO'}")
            if out_w == 112 and out_h == 112 and aligned_face.size > 0:
                print("Status: PASS\n")
                alignment_statuses.append("PASS")
                alignment_pass = True
                # Save diagnostic aligned face
                cv2.imwrite(str(ALIGNED_OUTPUT_DIR / image_path.name), aligned_face)
            else:
                print("Status: FAIL (Invalid output dimensions)\n")
                alignment_statuses.append("FAIL")
        else:
            print(f"5 landmarks detected: {'YES' if has_5_landmarks else 'NO'}")
            print("Status: FAIL (Affine partial 2D transform could not be estimated)\n")
            alignment_statuses.append("FAIL")

        # -------------------------------------------------------------
        # [10] ARCFACE EMBEDDING
        # -------------------------------------------------------------
        arcface_pass = False
        print("[10] ARCFACE")
        if aligned_face is not None and alignment_pass:
            try:
                raw_emb = arcface.get_feat(aligned_face).flatten()
                emb_norm = float(np.linalg.norm(raw_emb))
                if emb_norm == 0.0 or np.isnan(emb_norm):
                    print("Error: Zero or invalid embedding norm")
                    print("Status: FAIL\n")
                    arcface_statuses.append("FAIL")
                else:
                    norm_emb = raw_emb / emb_norm
                    final_norm = float(np.linalg.norm(norm_emb))
                    print(f"Embedding shape: {norm_emb.shape}")
                    print(f"Embedding norm: {final_norm:.6f}")
                    if norm_emb.shape == (512,) and np.isclose(final_norm, 1.0, atol=1e-4):
                        print("Status: PASS\n")
                        arcface_statuses.append("PASS")
                        arcface_pass = True
                    else:
                        print("Status: FAIL (Dimension or norm mismatch)\n")
                        arcface_statuses.append("FAIL")
            except Exception as ex:
                print(f"Error during ArcFace feature extraction: {ex}")
                print("Status: FAIL\n")
                arcface_statuses.append("FAIL")
        else:
            print("Status: FAIL (Alignment missing, cannot extract embedding)\n")
            arcface_statuses.append("FAIL")

        # -------------------------------------------------------------
        # FINAL RESULT FOR THIS IMAGE
        # -------------------------------------------------------------
        all_stage_statuses = [
            "PASS",  # Image load
            "PASS",  # Face detection
            size_status,
            bright_status,
            sharp_status,
            contrast_status,
            enhancement_statuses[-1],
            alignment_statuses[-1],
            arcface_statuses[-1],
        ]

        if "FAIL" in all_stage_statuses:
            img_final_result = "FAIL"
        elif "WARNING" in all_stage_statuses:
            img_final_result = "PASS WITH WARNINGS"
        else:
            img_final_result = "PASS"

        print("========================================")
        print(f"FINAL RESULT: {img_final_result}")
        print("========================================\n")

    # -----------------------------------------------------------------
    # Cross-file Preprocessing Consistency Verification
    # -----------------------------------------------------------------
    consistency_status, consistency_msg = check_preprocessing_consistency()

    # -----------------------------------------------------------------
    # FINAL SUMMARY REPORT
    # -----------------------------------------------------------------
    def aggregate_status(status_list: List[str]) -> str:
        if not status_list:
            return "N/A"
        if "FAIL" in status_list:
            return "FAIL"
        if "WARNING" in status_list:
            return "WARNING"
        return "PASS"

    det_summary = aggregate_status(detection_statuses)
    size_summary = aggregate_status(size_statuses)
    bright_summary = aggregate_status(brightness_statuses)
    sharp_summary = aggregate_status(sharpness_statuses)
    contrast_summary = aggregate_status(contrast_statuses)
    enh_summary = aggregate_status(enhancement_statuses)
    align_summary = aggregate_status(alignment_statuses)
    arc_summary = aggregate_status(arcface_statuses)

    core_summaries = [
        det_summary,
        size_summary,
        bright_summary,
        sharp_summary,
        contrast_summary,
        enh_summary,
        align_summary,
        arc_summary,
        consistency_status,
    ]

    if "FAIL" in core_summaries:
        overall_pipeline_status = "FAIL"
    elif "WARNING" in core_summaries:
        overall_pipeline_status = "PASS WITH WARNINGS"
    else:
        overall_pipeline_status = "PASS"

    print("========================================")
    print("FINAL PIPELINE SUMMARY")
    print("========================================")
    print()
    print(f"Images tested: {total_images}")
    print(f"Faces detected: {total_faces_detected}")
    print()
    print(f"Face detection: {det_summary}")
    print(f"Face size: {size_summary}")
    print(f"Brightness: {bright_summary}")
    print(f"Sharpness: {sharp_summary}")
    print(f"Contrast: {contrast_summary}")
    print(f"Enhancement: {enh_summary}")
    print(f"Alignment: {align_summary}")
    print(f"ArcFace embedding: {arc_summary}")
    if consistency_status == "PASS":
        print(f"Preprocessing consistency: PASS")
    else:
        print(f"Preprocessing consistency: WARNING - {consistency_msg}")
    print()
    print(f"Overall pipeline:")
    print(f"{overall_pipeline_status}")
    print()
    print("========================================")
    print("DIAGNOSTIC ADVISORY:")
    print("Do not call the pipeline production-ready based on this test alone.")
    print("Development diagnostic threshold - calibrate later using real CP PLUS camera footage.")
    print(f"Diagnostic artifacts exported to: {DIAGNOSTIC_DIR}")
    print("========================================\n")

    return {
        "total_images": total_images,
        "total_faces_detected": total_faces_detected,
        "overall_status": overall_pipeline_status,
        "consistency_status": consistency_status,
        "consistency_msg": consistency_msg,
    }


def main():
    """Main CLI entry point."""
    print("========================================")
    print("FACE PIPELINE VALIDATION & DIAGNOSTICS")
    print("========================================")

    # Resolve target test images from CLI arguments or default sample images
    image_paths: List[Path] = []
    if len(sys.argv) > 1:
        for arg in sys.argv[1:]:
            p = Path(arg)
            if p.is_absolute() and p.exists():
                image_paths.append(p)
            elif (AI_SERVICES_DIR / p).exists():
                image_paths.append(AI_SERVICES_DIR / p)
            elif p.exists():
                image_paths.append(p.resolve())
            else:
                print(f"[Warning] Specified image not found: {arg}")
    else:
        for name in DEFAULT_IMAGE_NAMES:
            img_path = AI_SERVICES_DIR / name
            if img_path.exists():
                image_paths.append(img_path)
            else:
                print(f"[Info] Default image not present: {name}")

    if not image_paths:
        print("Error: No test images found to process.")
        sys.exit(1)

    print(f"Discovered {len(image_paths)} sample image(s) for validation:")
    for p in image_paths:
        print(f"  - {p.name}")

    run_face_pipeline_test(image_paths)


if __name__ == "__main__":
    main()
