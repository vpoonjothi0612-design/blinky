import cv2
import numpy as np
from pathlib import Path
from insightface.model_zoo import get_model


# -----------------------------------
# Paths
# -----------------------------------

# Project directory (ai-services)
BASE_DIR = Path(__file__).resolve().parents[3]

IMAGE_1_PATH = BASE_DIR / "aligned_face.jpg"
IMAGE_2_PATH = BASE_DIR / "aligned_face_2.jpg"

# Path to the ArcFace recognition model (from InsightFace buffalo_l pack)
MODEL_PATH = (
    Path.home()
    / ".insightface"
    / "models"
    / "buffalo_l"
    / "w600k_r50.onnx"
)


# -----------------------------------
# Error check: Image existence
# -----------------------------------

if not IMAGE_1_PATH.exists():
    raise FileNotFoundError(
        f"First aligned face not found:\n{IMAGE_1_PATH}\n"
        "Please run face_alignment.py first to create aligned_face.jpg"
    )

if not IMAGE_2_PATH.exists():
    raise FileNotFoundError(
        f"Second aligned face not found:\n{IMAGE_2_PATH}\n"
        "Please run face_alignment_2.py first to create aligned_face_2.jpg"
    )


# -----------------------------------
# Load images
# -----------------------------------

image1 = cv2.imread(str(IMAGE_1_PATH))
image2 = cv2.imread(str(IMAGE_2_PATH))

if image1 is None:
    raise ValueError(f"Could not load image file: {IMAGE_1_PATH}")

if image2 is None:
    raise ValueError(f"Could not load image file: {IMAGE_2_PATH}")

print("Both aligned face images loaded successfully.")
print(f"Image 1 size : {image1.shape[1]} x {image1.shape[0]}")
print(f"Image 2 size : {image2.shape[1]} x {image2.shape[0]}")


# -----------------------------------
# Error check: ArcFace model existence
# -----------------------------------

if not MODEL_PATH.exists():
    raise FileNotFoundError(
        f"ArcFace model file not found:\n{MODEL_PATH}\n"
        "Please ensure the buffalo_l model pack is downloaded."
    )


# -----------------------------------
# Load ArcFace model
# -----------------------------------

print()
print("Loading ArcFace recognition model...")

arcface = get_model(
    str(MODEL_PATH),
    providers=["CPUExecutionProvider"]
)

arcface.prepare(ctx_id=0)

print("ArcFace recognition model loaded successfully.")


# -----------------------------------
# Generate 512-D embeddings
# -----------------------------------

print()
print("Extracting feature embeddings...")

# get_feat accepts the 112x112 aligned BGR image
embedding1 = arcface.get_feat(image1).flatten()
embedding2 = arcface.get_feat(image2).flatten()


# -----------------------------------
# Normalize embeddings (L2 normalization)
# -----------------------------------

# L2 unit normalization ensures dot product equals cosine similarity
embedding1 = embedding1 / np.linalg.norm(embedding1)
embedding2 = embedding2 / np.linalg.norm(embedding2)


# -----------------------------------
# Calculate Cosine Similarity
# -----------------------------------

# Dot product of unit-length vectors gives cosine similarity [-1.0, 1.0]
similarity = float(np.dot(embedding1, embedding2))


# -----------------------------------
# Display results
# -----------------------------------

print()
print("================================")
print("SAME PERSON COMPARISON")
print("================================")
print(f"Embedding 1 size: {len(embedding1)}")
print(f"Embedding 2 size: {len(embedding2)}")
print()
print(f"Cosine similarity: {similarity:.6f}")
print("================================")
