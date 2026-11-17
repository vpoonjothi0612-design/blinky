import sys
import cv2
import numpy as np
from pathlib import Path
from insightface.model_zoo import get_model


# -----------------------------------
# Configuration & Paths
# -----------------------------------

EMPLOYEE_ID = "EMP001"

BASE_DIR = Path(__file__).resolve().parents[3]

# Input test image from command-line argument, default to test2.jpg
if len(sys.argv) > 1:
    arg_path = Path(sys.argv[1])
    if arg_path.is_absolute():
        IMAGE_PATH = arg_path
    elif (BASE_DIR / arg_path).exists():
        IMAGE_PATH = BASE_DIR / arg_path
    elif arg_path.exists():
        IMAGE_PATH = arg_path.resolve()
    else:
        IMAGE_PATH = BASE_DIR / arg_path
else:
    IMAGE_PATH = BASE_DIR / "test2.jpg"

_FACE_DIR = Path(__file__).resolve().parents[1]
if str(_FACE_DIR) not in sys.path:
    sys.path.append(str(_FACE_DIR))

from face_config import (
    YUNET_MODEL_PATH,
    ARCFACE_MODEL_PATH,
    REFERENCE_POINTS,
    EMBEDDINGS_DIR,
)

REFERENCE_EMBEDDING_PATH = EMBEDDINGS_DIR / f"{EMPLOYEE_ID}.npy"


# -----------------------------------
# Preprocessing & Enhancement Pipeline
# -----------------------------------

try:
    from face_preprocess import preprocess_face
except ImportError:
    from src.face.recognition.face_preprocess import preprocess_face


# -----------------------------------
# Validate File Existence
# -----------------------------------

if not IMAGE_PATH.exists():
    raise FileNotFoundError(f"Input image not found: {IMAGE_PATH}")

if not REFERENCE_EMBEDDING_PATH.exists():
    raise FileNotFoundError(f"Reference embedding not found: {REFERENCE_EMBEDDING_PATH}")

if not YUNET_MODEL_PATH.exists():
    raise FileNotFoundError(f"YuNet model not found: {YUNET_MODEL_PATH}")

if not ARCFACE_MODEL_PATH.exists():
    raise FileNotFoundError(f"ArcFace model not found: {ARCFACE_MODEL_PATH}")


# -----------------------------------
# 1. Load Image
# -----------------------------------

image = cv2.imread(str(IMAGE_PATH))
if image is None:
    raise ValueError(f"Could not load image: {IMAGE_PATH}")

img_h, img_w = image.shape[:2]


# -----------------------------------
# 2. Detect Face with YuNet (0.6 threshold)
# -----------------------------------

detector = cv2.FaceDetectorYN.create(
    str(YUNET_MODEL_PATH),
    "",
    (img_w, img_h),
    0.6,
    0.3,
    5000,
)

_, faces = detector.detect(image)

print("================================")
print("FACE RECOGNITION TEST")
print("================================")
print()
print(f"Input image       : {IMAGE_PATH.name}")
print(f"Employee reference: {EMPLOYEE_ID}")
print()

if faces is None or len(faces) == 0:
    print("Face detection    : FAIL (No face detected)")
    raise SystemExit("Face recognition test aborted: No face detected.")

print("Face detection    : PASS")
print()

# Use first detected face
face = faces[0]


# -----------------------------------
# 3. Face Crop & Quality Metrics (Information Only)
# -----------------------------------

x, y, w, h = map(int, face[0:4])
x1, y1 = max(0, x), max(0, y)
x2, y2 = min(img_w, x + w), min(img_h, y + h)

face_crop = image[y1:y2, x1:x2].copy()

# Calculate informational quality metrics (NEVER reject based on these)
gray_crop = cv2.cvtColor(face_crop, cv2.COLOR_BGR2GRAY)
sharpness_score = float(cv2.Laplacian(gray_crop, cv2.CV_64F).var())
brightness_score = float(gray_crop.mean())

print("Face Quality Metrics")
print("--------------------")
print(f"Face size         : {w}x{h}")
print(f"Sharpness         : {sharpness_score:.2f}")
print(f"Brightness        : {brightness_score:.2f}")
print()


# -----------------------------------
# 4. Face Enhancement
# -----------------------------------

working_image = image.copy()

try:
    enhanced_crop = preprocess_face(face_crop)
    working_image[y1:y2, x1:x2] = enhanced_crop
    print("Enhancement       : APPLIED")
except Exception:
    # If enhancement cannot be applied, continue with original image
    print("Enhancement       : SKIPPED")

print()


# -----------------------------------
# 5. Face Alignment (112x112)
# -----------------------------------

landmarks = face[4:14].reshape(5, 2)
transform, _ = cv2.estimateAffinePartial2D(
    landmarks.astype(np.float32),
    REFERENCE_POINTS,
    method=cv2.LMEDS,
)

if transform is None:
    print("Alignment         : FAIL")
    raise SystemExit("Face alignment failed: Transformation could not be computed.")

aligned_face = cv2.warpAffine(
    working_image,
    transform,
    (112, 112),
)
print("Alignment         : PASS")


# -----------------------------------
# 6. ArcFace Embedding Generation & L2-Normalization
# -----------------------------------

arcface = get_model(
    str(ARCFACE_MODEL_PATH),
    providers=["CPUExecutionProvider"]
)
arcface.prepare(ctx_id=0)

raw_embedding = arcface.get_feat(aligned_face).flatten()
embedding_norm = np.linalg.norm(raw_embedding)

if embedding_norm == 0:
    print("Embedding         : FAIL")
    raise ValueError("Zero-length embedding vector generated.")

test_embedding = raw_embedding / embedding_norm
print("Embedding         : PASS")


# -----------------------------------
# 7. Load & Verify Reference Embedding
# -----------------------------------

ref_embedding = np.load(str(REFERENCE_EMBEDDING_PATH))

if ref_embedding.shape != (512,):
    raise ValueError(f"Stored embedding shape mismatch: expected (512,), got {ref_embedding.shape}")

ref_norm = np.linalg.norm(ref_embedding)
if not np.isclose(ref_norm, 1.0, atol=1e-3):
    ref_embedding = ref_embedding / ref_norm


# -----------------------------------
# 8. Cosine Similarity & Results
# -----------------------------------

cosine_similarity = float(np.dot(test_embedding, ref_embedding))

print()
print(f"Embedding size    : {len(test_embedding)}")
print(f"Reference size    : {len(ref_embedding)}")
print()
print(f"Cosine similarity : {cosine_similarity:.6f}")
print()
print("--------------------------------")
print("Recognition test completed")
print("--------------------------------")
