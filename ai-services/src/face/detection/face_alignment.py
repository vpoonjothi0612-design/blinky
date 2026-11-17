import cv2
import numpy as np
from pathlib import Path


# -----------------------------------
# Paths
# -----------------------------------

BASE_DIR = Path(__file__).resolve().parents[3]

IMAGE_PATH = BASE_DIR / "test.jpg"
MODEL_PATH = (
    BASE_DIR
    / "models"
    / "yunet"
    / "face_detection_yunet_2023mar.onnx"
)

OUTPUT_PATH = BASE_DIR / "aligned_face.jpg"


# -----------------------------------
# Load image
# -----------------------------------

image = cv2.imread(str(IMAGE_PATH))

if image is None:
    raise FileNotFoundError(f"Could not load image: {IMAGE_PATH}")


height, width = image.shape[:2]

print(f"Image size: {width} x {height}")


# -----------------------------------
# Create YuNet detector
# -----------------------------------

detector = cv2.FaceDetectorYN.create(
    str(MODEL_PATH),
    "",
    (width, height),
    0.9,
    0.3,
    5000
)


# -----------------------------------
# Detect face
# -----------------------------------

_, faces = detector.detect(image)

if faces is None or len(faces) == 0:
    print("No face detected.")
    raise SystemExit


print(f"Faces detected: {len(faces)}")


# Use first detected face
face = faces[0]


# -----------------------------------
# Get YuNet landmarks
# -----------------------------------

landmarks = face[4:14].reshape(5, 2)

print()
print("YuNet landmarks:")

for index, point in enumerate(landmarks, start=1):
    x, y = point
    print(f"Landmark {index}: ({x:.2f}, {y:.2f})")


# -----------------------------------
# Standard ArcFace alignment points
# -----------------------------------

REFERENCE_POINTS = np.array(
    [
        [38.2946, 51.6963],   # Left eye
        [73.5318, 51.5014],   # Right eye
        [56.0252, 71.7366],   # Nose
        [41.5493, 92.3655],   # Left mouth
        [70.7299, 92.2041],   # Right mouth
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
    print("Could not calculate face alignment.")
    raise SystemExit


# -----------------------------------
# Align face
# -----------------------------------

aligned_face = cv2.warpAffine(
    image,
    transform,
    (112, 112),
)


# -----------------------------------
# Save aligned face
# -----------------------------------

cv2.imwrite(
    str(OUTPUT_PATH),
    aligned_face
)


print()
print("Aligned face size: 112 x 112")

print("Aligned face saved to:")
print(OUTPUT_PATH)


# -----------------------------------
# Display
# -----------------------------------

cv2.imshow("Aligned Face", aligned_face)

print("Press any key to close...")

cv2.waitKey(0)
cv2.destroyAllWindows()