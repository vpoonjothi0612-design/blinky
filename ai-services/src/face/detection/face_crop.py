"""Face Detection, Cropping & Canonical ArcFace Alignment.

Fast and correct 5-point face alignment pipeline:
1. Detects face and 5 landmarks using YuNet.
2. Crops raw face bounding box.
3. Applies canonical InsightFace / ArcFace 112x112 similarity alignment (norm_crop).
4. Saves both raw cropped face and aligned face.
"""

from pathlib import Path
import cv2
import numpy as np
from insightface.utils import face_align

# Project root
BASE_DIR = Path(__file__).resolve().parents[3]

# Input image
IMAGE_PATH = BASE_DIR / "test.jpg"

# Outputs
CROP_OUTPUT_PATH = BASE_DIR / "face_crop.jpg"
ALIGNED_OUTPUT_PATH = BASE_DIR / "aligned_face.jpg"

# YuNet model path
MODEL_PATH = (
    BASE_DIR
    / "models"
    / "yunet"
    / "face_detection_yunet_2023mar.onnx"
)

# Load image
image = cv2.imread(str(IMAGE_PATH))
if image is None:
    raise FileNotFoundError(f"Could not load image: {IMAGE_PATH}")

h, w = image.shape[:2]
print(f"Original image size: {w} x {h}")

# Create YuNet detector with calibrated threshold (0.6)
detector = cv2.FaceDetectorYN.create(
    str(MODEL_PATH),
    "",
    (w, h),
    0.6,
    0.3,
    5000,
)

# Detect faces
_, faces = detector.detect(image)
if faces is None or len(faces) == 0:
    print("No face detected.")
    raise SystemExit(1)

print(f"Faces detected: {len(faces)}")

face = faces[0]
bx, by, bw, bh = map(int, face[0:4])
landmarks = face[4:14].reshape(5, 2)

print(f"Face bounding box: x={bx}, y={by}, width={bw}, height={bh}")
print("5 Facial Landmarks (Left Eye, Right Eye, Nose, Left Mouth, Right Mouth):")
for i, pt in enumerate(landmarks, 1):
    print(f"  P{i}: ({pt[0]:.1f}, {pt[1]:.1f})")

# 1. Raw Face Crop with bounds checking
x1, y1 = max(0, bx), max(0, by)
x2, y2 = min(w, bx + bw), min(h, by + bh)
face_crop = image[y1:y2, x1:x2].copy()
cv2.imwrite(str(CROP_OUTPUT_PATH), face_crop)
print(f"\n[Saved] Raw crop ({face_crop.shape[1]}x{face_crop.shape[0]}) -> {CROP_OUTPUT_PATH}")

# 2. Canonical ArcFace 112x112 Alignment (Correct Umeyama Similarity Transform)
aligned_face = face_align.norm_crop(image, landmark=landmarks, image_size=112)
cv2.imwrite(str(ALIGNED_OUTPUT_PATH), aligned_face)
print(f"[Saved] Aligned face ({aligned_face.shape[1]}x{aligned_face.shape[0]}) -> {ALIGNED_OUTPUT_PATH}")

# Summary Display
print("\nFace alignment completed successfully.")