import sys
import cv2
import numpy as np
from pathlib import Path
from insightface.model_zoo import get_model

try:
    from face_preprocess import preprocess_face
except ImportError:
    from src.face.recognition.face_preprocess import preprocess_face


# -----------------------------------
# Configuration & Paths
# -----------------------------------

EMPLOYEE_ID = "EMP001"

BASE_DIR = Path(__file__).resolve().parents[3]

# Input images for multi-image enrollment
INPUT_IMAGES = [
    BASE_DIR / "test.jpg",
    BASE_DIR / "test2.jpg",
    BASE_DIR / "test_3_same_person.jpg",
]

_FACE_DIR = Path(__file__).resolve().parents[1]
if str(_FACE_DIR) not in sys.path:
    sys.path.append(str(_FACE_DIR))

from face_config import (
    YUNET_MODEL_PATH,
    ARCFACE_MODEL_PATH,
    EMBEDDINGS_DIR as OUTPUT_DIR,
    REFERENCE_POINTS,
)

OUTPUT_FILE = OUTPUT_DIR / f"{EMPLOYEE_ID}.npy"


# -----------------------------------
# Thresholds & Alignment Reference Points
# -----------------------------------

MIN_FACE_WIDTH = 120
MIN_FACE_HEIGHT = 120
MIN_SHARPNESS = 100.0
MIN_BRIGHTNESS = 60.0
MAX_BRIGHTNESS = 200.0

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
# Verify Model Existence
# -----------------------------------

if not YUNET_MODEL_PATH.exists():
    raise FileNotFoundError(f"YuNet model not found: {YUNET_MODEL_PATH}")

if not ARCFACE_MODEL_PATH.exists():
    raise FileNotFoundError(f"ArcFace model not found: {ARCFACE_MODEL_PATH}")


# -----------------------------------
# Load ArcFace Model
# -----------------------------------

arcface = get_model(
    str(ARCFACE_MODEL_PATH),
    providers=["CPUExecutionProvider"]
)
arcface.prepare(ctx_id=0)


# -----------------------------------
# Multi-Image Processing
# -----------------------------------

valid_embeddings = []
images_processed = len(INPUT_IMAGES)
images_accepted = 0
images_rejected = 0

print("================================")
print("MULTI-IMAGE FACE ENROLLMENT")
print("================================")

for index, image_path in enumerate(INPUT_IMAGES, start=1):
    print(f"\nImage {index}: {image_path.name}")

    if not image_path.exists():
        print("Face detected: FAIL (File not found)")
        print("Quality: FAIL")
        print("Embedding: FAIL")
        images_rejected += 1
        continue

    image = cv2.imread(str(image_path))
    if image is None:
        print("Face detected: FAIL (Cannot decode image)")
        print("Quality: FAIL")
        print("Embedding: FAIL")
        images_rejected += 1
        continue

    img_h, img_w = image.shape[:2]

    # 1. Face Detection with YuNet
    detector = cv2.FaceDetectorYN.create(
        str(YUNET_MODEL_PATH),
        "",
        (img_w, img_h),
        0.6,
        0.3,
        5000,
    )
    _, faces = detector.detect(image)

    if faces is None or len(faces) != 1:
        print(f"Face detected: FAIL ({0 if faces is None else len(faces)} faces found)")
        print("Quality: FAIL")
        print("Embedding: FAIL")
        images_rejected += 1
        continue

    print("Face detected: PASS")
    face = faces[0]

    # 2. Quality Checks
    x, y, w, h = map(int, face[0:4])
    x1, y1 = max(0, x), max(0, y)
    x2, y2 = min(img_w, x + w), min(img_h, y + h)
    face_crop = image[y1:y2, x1:x2]

    size_pass = (w >= MIN_FACE_WIDTH and h >= MIN_FACE_HEIGHT)
    gray = cv2.cvtColor(face_crop, cv2.COLOR_BGR2GRAY)
    sharpness_score = float(cv2.Laplacian(gray, cv2.CV_64F).var())
    sharpness_pass = sharpness_score >= MIN_SHARPNESS
    brightness_score = float(gray.mean())
    brightness_pass = MIN_BRIGHTNESS <= brightness_score <= MAX_BRIGHTNESS

    quality_pass = size_pass and sharpness_pass and brightness_pass

    if not quality_pass:
        print("Quality: FAIL")
        print("Embedding: FAIL")
        images_rejected += 1
        continue

    print("Quality: PASS")

    # 3. Enhancement with Shared Preprocessing
    working_image = image.copy()
    try:
        enhanced_crop = preprocess_face(face_crop)
        working_image[y1:y2, x1:x2] = enhanced_crop
    except Exception:
        pass

    # 4. Alignment to 112x112
    landmarks = face[4:14].reshape(5, 2)
    transform, _ = cv2.estimateAffinePartial2D(
        landmarks.astype(np.float32),
        REFERENCE_POINTS,
        method=cv2.LMEDS,
    )

    if transform is None:
        print("Embedding: FAIL (Alignment failed)")
        images_rejected += 1
        continue

    aligned_face = cv2.warpAffine(
        working_image,
        transform,
        (112, 112),
    )

    # 4. Generate & L2-Normalize Embedding
    embedding = arcface.get_feat(aligned_face).flatten()
    norm = np.linalg.norm(embedding)

    if norm == 0:
        print("Embedding: FAIL (Zero vector)")
        images_rejected += 1
        continue

    normalized_embedding = embedding / norm
    valid_embeddings.append(normalized_embedding)
    images_accepted += 1
    print("Embedding: PASS")


# -----------------------------------
# Aggregation & Save
# -----------------------------------

if len(valid_embeddings) == 0:
    print("\n--------------------------------")
    print(f"Images processed: {images_processed}")
    print(f"Images accepted: {images_accepted}")
    print(f"Images rejected: {images_rejected}")
    print("Embedding saved: FAIL")
    print("--------------------------------")
    raise SystemExit("Enrollment failed: No valid embeddings collected.")

# Calculate mean embedding
mean_embedding = np.mean(valid_embeddings, axis=0)

# L2-normalize final mean embedding
final_embedding = mean_embedding / np.linalg.norm(mean_embedding)
final_norm = float(np.linalg.norm(final_embedding))

# Save to .npy
OUTPUT_DIR.mkdir(parents=True, exist_ok=True)
np.save(str(OUTPUT_FILE), final_embedding)

print("\n--------------------------------")
print(f"Images processed: {images_processed}")
print(f"Images accepted: {images_accepted}")
print(f"Images rejected: {images_rejected}")
print(f"Final embedding size: {len(final_embedding)}")
print(f"Final embedding norm: {final_norm:.6f}")
print("Embedding saved: PASS")
print("--------------------------------")
print("\nEnrollment completed successfully!")
