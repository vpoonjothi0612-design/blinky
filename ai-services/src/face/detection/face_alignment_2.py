import cv2
import numpy as np
from pathlib import Path


# -----------------------------------
# Paths
# -----------------------------------

BASE_DIR = Path(__file__).resolve().parents[3]

IMAGE_PATH = BASE_DIR / "different_person.jpg"
MODEL_PATH = (
    BASE_DIR
    / "models"
    / "yunet"
    / "face_detection_yunet_2023mar.onnx"
)

OUTPUT_PATH = BASE_DIR / "aligned_face_2.jpg"


# -----------------------------------
# Error check: Image existence
# -----------------------------------

if not IMAGE_PATH.exists():
    raise FileNotFoundError(
        f"Input image not found: {IMAGE_PATH}\n"
        f"Please place your photo as 'different_person.jpg' in 'ai-services/'."
    )


# -----------------------------------
# Load image
# -----------------------------------

image = cv2.imread(str(IMAGE_PATH))

if image is None:
    raise ValueError(f"Could not load image (file may be corrupted): {IMAGE_PATH}")


height, width = image.shape[:2]

print("================================")
print("FACE ALIGNMENT 2 (TEST 2)")
print("================================")
print(f"Input image     : {IMAGE_PATH.name}")
print(f"Image size      : {width} x {height}")


# -----------------------------------
# Error check: YuNet model existence
# -----------------------------------

if not MODEL_PATH.exists():
    raise FileNotFoundError(f"YuNet model not found: {MODEL_PATH}")


# -----------------------------------
# Create YuNet detector
# -----------------------------------

detector = cv2.FaceDetectorYN.create(
    str(MODEL_PATH),
    "",
    (width, height),
    0.6,
    0.3,
    5000,
)


# -----------------------------------
# Detect face
# -----------------------------------

_, faces = detector.detect(image)

if faces is None or len(faces) == 0:
    print("\nError: No face detected in image.")
    raise SystemExit(1)

print(f"Faces detected  : {len(faces)}")


# Use first detected face
face = faces[0]


# -----------------------------------
# Get YuNet landmarks (5 facial points)
# -----------------------------------

landmarks = face[4:14].reshape(5, 2)

landmark_names = [
    "Left Eye",
    "Right Eye",
    "Nose",
    "Left Mouth",
    "Right Mouth",
]

print()
print("YuNet 5 Landmarks:")
for name, point in zip(landmark_names, landmarks):
    x, y = point
    print(f"  {name:<12}: ({x:.2f}, {y:.2f})")


# -----------------------------------
# Standard ArcFace 112x112 reference points
# -----------------------------------

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


# -----------------------------------
# Calculate similarity transformation
# -----------------------------------

transform, _ = cv2.estimateAffinePartial2D(
    landmarks.astype(np.float32),
    REFERENCE_POINTS,
    method=cv2.LMEDS,
)

if transform is None:
    print("\nError: Could not calculate face alignment transformation.")
    raise SystemExit(1)


# -----------------------------------
# Align face to 112x112
# -----------------------------------

aligned_face = cv2.warpAffine(
    image,
    transform,
    (112, 112),
)


# -----------------------------------
# Save aligned face
# -----------------------------------

cv2.imwrite(str(OUTPUT_PATH), aligned_face)

out_h, out_w = aligned_face.shape[:2]

print()
print("================================")
print("ALIGNMENT RESULT")
print("================================")
print(f"Aligned face size: {out_w} x {out_h}")
print("Aligned face saved to:")
print(f"  {OUTPUT_PATH}")
print("================================")


# -----------------------------------
# Display
# -----------------------------------

cv2.imshow("Aligned Face 2", aligned_face)

print("\nPress any key in the image window to close...")
cv2.waitKey(0)
cv2.destroyAllWindows()
