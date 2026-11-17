import cv2
import numpy as np
from pathlib import Path
from insightface.model_zoo import get_model


# -----------------------------------
# Configuration & Paths
# -----------------------------------

EMPLOYEE_ID = "EMP001"

BASE_DIR = Path(__file__).resolve().parents[3]

# Reference embedding file
REFERENCE_EMBEDDING_PATH = (
    BASE_DIR
    / "data"
    / "face_embeddings"
    / f"{EMPLOYEE_ID}.npy"
)

# Calibration dataset directories
CALIBRATION_DIR = BASE_DIR / "data" / "calibration"
SAME_PERSON_DIR = CALIBRATION_DIR / "same_person"
DIFFERENT_PERSON_DIR = CALIBRATION_DIR / "different_person"

# YuNet detector model path
YUNET_MODEL_PATH = (
    BASE_DIR
    / "models"
    / "yunet"
    / "face_detection_yunet_2023mar.onnx"
)

# ArcFace model path
ARCFACE_MODEL_PATH = (
    Path.home()
    / ".insightface"
    / "models"
    / "buffalo_l"
    / "w600k_r50.onnx"
)

# Standard ArcFace 112x112 reference points
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

VALID_IMAGE_EXTENSIONS = {".jpg", ".jpeg", ".png", ".bmp", ".webp"}


# -----------------------------------
# Preprocessing Pipeline (Same as face_recognition.py)
# -----------------------------------

def preprocess_face(face_crop: np.ndarray) -> np.ndarray:
    """Exact preprocessing matching face_recognition.py:

    - LAB conversion
    - Controlled automatic brightness adaptation
    - CLAHE on L channel
    - LAB -> BGR
    - Mild fastNlMeans color denoising
    - Mild unsharp mask
    - uint8 clipping
    """
    lab = cv2.cvtColor(face_crop, cv2.COLOR_BGR2LAB)
    l, a, b = cv2.split(lab)

    mean_l = float(l.mean())
    if mean_l < 60.0:
        gamma = 0.85
        lut = np.array([((i / 255.0) ** gamma) * 255 for i in range(256)], dtype=np.uint8)
        l = cv2.LUT(l, lut)
    elif mean_l > 200.0:
        gamma = 1.15
        lut = np.array([((i / 255.0) ** gamma) * 255 for i in range(256)], dtype=np.uint8)
        l = cv2.LUT(l, lut)

    clahe = cv2.createCLAHE(clipLimit=2.0, tileGridSize=(8, 8))
    l_clahe = clahe.apply(l)

    bgr_clahe = cv2.cvtColor(cv2.merge((l_clahe, a, b)), cv2.COLOR_LAB2BGR)

    denoised = cv2.fastNlMeansDenoisingColored(
        bgr_clahe,
        None,
        h=3,
        hColor=3,
        templateWindowSize=7,
        searchWindowSize=15,
    )

    blurred = cv2.GaussianBlur(denoised, (0, 0), 1.0)
    sharpened = cv2.addWeighted(
        denoised,
        1.25,
        blurred,
        -0.25,
        0,
    )

    return np.clip(sharpened, 0, 255).astype(np.uint8)


# -----------------------------------
# Validation & Initialization
# -----------------------------------

if not REFERENCE_EMBEDDING_PATH.exists():
    raise FileNotFoundError(f"Reference embedding not found: {REFERENCE_EMBEDDING_PATH}")

if not YUNET_MODEL_PATH.exists():
    raise FileNotFoundError(f"YuNet model not found: {YUNET_MODEL_PATH}")

if not ARCFACE_MODEL_PATH.exists():
    raise FileNotFoundError(f"ArcFace model not found: {ARCFACE_MODEL_PATH}")

if not SAME_PERSON_DIR.exists():
    raise FileNotFoundError(f"Directory not found: {SAME_PERSON_DIR}")

if not DIFFERENT_PERSON_DIR.exists():
    raise FileNotFoundError(f"Directory not found: {DIFFERENT_PERSON_DIR}")

# Load and verify reference embedding
ref_embedding = np.load(str(REFERENCE_EMBEDDING_PATH))
if ref_embedding.shape != (512,):
    raise ValueError(f"Stored embedding shape mismatch: expected (512,), got {ref_embedding.shape}")

ref_norm = np.linalg.norm(ref_embedding)
if not np.isclose(ref_norm, 1.0, atol=1e-3):
    ref_embedding = ref_embedding / ref_norm

# Load ArcFace model
arcface = get_model(
    str(ARCFACE_MODEL_PATH),
    providers=["CPUExecutionProvider"]
)
arcface.prepare(ctx_id=0)


# -----------------------------------
# Process Single Image
# -----------------------------------

def evaluate_image(img_path: Path):
    """Processes an image through the exact same recognition pipeline and returns cosine similarity."""
    image = cv2.imread(str(img_path))
    if image is None:
        return None

    img_h, img_w = image.shape[:2]

    detector = cv2.FaceDetectorYN.create(
        str(YUNET_MODEL_PATH),
        "",
        (img_w, img_h),
        0.6,
        0.3,
        5000,
    )
    _, faces = detector.detect(image)

    if faces is None or len(faces) == 0:
        return None

    face = faces[0]
    x, y, w, h = map(int, face[0:4])
    x1, y1 = max(0, x), max(0, y)
    x2, y2 = min(img_w, x + w), min(img_h, y + h)
    face_crop = image[y1:y2, x1:x2].copy()

    # Preprocessing
    working_image = image.copy()
    try:
        enhanced_crop = preprocess_face(face_crop)
        working_image[y1:y2, x1:x2] = enhanced_crop
    except Exception:
        pass

    # Alignment
    landmarks = face[4:14].reshape(5, 2)
    transform, _ = cv2.estimateAffinePartial2D(
        landmarks.astype(np.float32),
        REFERENCE_POINTS,
        method=cv2.LMEDS,
    )
    if transform is None:
        return None

    aligned_face = cv2.warpAffine(
        working_image,
        transform,
        (112, 112),
    )

    # Embedding extraction & L2 normalization
    raw_emb = arcface.get_feat(aligned_face).flatten()
    norm = np.linalg.norm(raw_emb)
    if norm == 0:
        return None

    norm_emb = raw_emb / norm
    similarity = float(np.dot(norm_emb, ref_embedding))

    return similarity


def scan_directory(dir_path: Path) -> dict:
    """Scans directory for images and computes similarity for each."""
    results = {}
    image_files = sorted(
        [p for p in dir_path.iterdir() if p.is_file() and p.suffix.lower() in VALID_IMAGE_EXTENSIONS]
    )

    for img_path in image_files:
        score = evaluate_image(img_path)
        if score is not None:
            results[img_path.name] = score
        else:
            results[img_path.name] = None

    return results


# -----------------------------------
# Run Dataset Calibration
# -----------------------------------

same_person_results = scan_directory(SAME_PERSON_DIR)
different_person_results = scan_directory(DIFFERENT_PERSON_DIR)


# -----------------------------------
# Output Report
# -----------------------------------

print("========================================")
print("FACE RECOGNITION CALIBRATION")
print("========================================")
print(f"Reference employee: {EMPLOYEE_ID}")
print()

print("SAME PERSON")
print("----------------------------------------")
same_scores = []
for name, score in same_person_results.items():
    if score is not None:
        same_scores.append(score)
        print(f"{name:<24} | {score:.6f}")
    else:
        print(f"{name:<24} | FAILED (Detection/Alignment)")

print()
print("DIFFERENT PERSON")
print("----------------------------------------")
diff_scores = []
for name, score in different_person_results.items():
    if score is not None:
        diff_scores.append(score)
        print(f"{name:<24} | {score:.6f}")
    else:
        print(f"{name:<24} | FAILED (Detection/Alignment)")

print()
print("Same-person:")
print(f"- count   : {len(same_scores)}")
if same_scores:
    print(f"- minimum : {min(same_scores):.6f}")
    print(f"- maximum : {max(same_scores):.6f}")
    print(f"- average : {np.mean(same_scores):.6f}")
    print(f"- median  : {float(np.median(same_scores)):.6f}")

print()
print("Different-person:")
print(f"- count   : {len(diff_scores)}")
if diff_scores:
    print(f"- minimum : {min(diff_scores):.6f}")
    print(f"- maximum : {max(diff_scores):.6f}")
    print(f"- average : {np.mean(diff_scores):.6f}")
    print(f"- median  : {float(np.median(diff_scores)):.6f}")

print()
print("========================================")
print("CURRENT SCORE SEPARATION")
print("========================================")

if same_scores and diff_scores:
    same_min = min(same_scores)
    diff_max = max(diff_scores)
    gap = same_min - diff_max
    print(f"Same-person minimum     : {same_min:.6f}")
    print(f"Different-person maximum: {diff_max:.6f}")
    print(f"Gap                     : {gap:.6f}")
else:
    print("Insufficient data to calculate score separation.")

print("========================================")
