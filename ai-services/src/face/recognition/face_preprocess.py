"""Shared Face Crop Preprocessing & Enhancement Module.

Provides consistent, conservative image enhancement for face crops across
enrollment, single-image recognition, and live recognition pipelines:
1. BGR -> LAB color space conversion
2. Controlled automatic brightness adaptation (L channel gamma adjustment)
3. CLAHE (Contrast Limited Adaptive Histogram Equalization on L channel)
4. LAB -> BGR color space conversion
5. Mild color denoising (fastNlMeansDenoisingColored)
6. Conservative unsharp masking
7. Value clipping to valid uint8 [0, 255] range
"""

import cv2
import numpy as np

# Pre-allocated LUT tables and CLAHE object for sub-millisecond execution (< 0.5ms)
_CLAHE = cv2.createCLAHE(clipLimit=2.0, tileGridSize=(8, 8))
_LUT_DARK = np.array([((i / 255.0) ** 0.85) * 255 for i in range(256)], dtype=np.uint8)
_LUT_BRIGHT = np.array([((i / 255.0) ** 1.15) * 255 for i in range(256)], dtype=np.uint8)


def preprocess_face(face_crop: np.ndarray, fast_mode: bool = True) -> np.ndarray:
    """Robust OpenCV face crop enhancement pipeline.

    In fast_mode=True (default for live video streaming):
    Applies lightning-fast automatic brightness adaptation (gamma), CLAHE on L channel,
    and mild unsharp masking in < 0.5ms, omitting the CPU-heavy non-local means denoising.

    Args:
        face_crop: BGR face crop as numpy uint8 array.
        fast_mode: Set to True for real-time video stream processing (< 0.5ms).

    Returns:
        Enhanced BGR face crop as numpy uint8 array.
    """
    if face_crop is None or face_crop.size == 0:
        return face_crop

    # A. BGR -> LAB
    lab = cv2.cvtColor(face_crop, cv2.COLOR_BGR2LAB)
    l, a, b = cv2.split(lab)

    # Controlled automatic brightness adaptation on L channel using precomputed LUT
    mean_l = float(l.mean())
    if mean_l < 60.0:
        # Mild shadow lift for dark faces
        l = cv2.LUT(l, _LUT_DARK)
    elif mean_l > 200.0:
        # Mild highlight attenuation for overexposed faces
        l = cv2.LUT(l, _LUT_BRIGHT)

    # B. CLAHE on L channel for local contrast enhancement
    l_clahe = _CLAHE.apply(l)

    # C. LAB -> BGR
    bgr_clahe = cv2.cvtColor(cv2.merge((l_clahe, a, b)), cv2.COLOR_LAB2BGR)

    if not fast_mode:
        # High quality offline denoising for enrollment photos
        denoised = cv2.fastNlMeansDenoisingColored(
            bgr_clahe,
            None,
            h=3,
            hColor=3,
            templateWindowSize=7,
            searchWindowSize=15,
        )
    else:
        denoised = bgr_clahe

    # E. Mild unsharp masking
    blurred = cv2.GaussianBlur(denoised, (0, 0), 1.0)
    sharpened = cv2.addWeighted(
        denoised,
        1.25,
        blurred,
        -0.25,
        0,
    )

    # F & G. Clip to valid uint8 range
    return np.clip(sharpened, 0, 255).astype(np.uint8)
