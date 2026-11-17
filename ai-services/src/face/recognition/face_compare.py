import cv2
import numpy as np
from pathlib import Path
from insightface.model_zoo import get_model


BASE_DIR = Path(__file__).resolve().parents[3]

IMAGE_1_PATH = BASE_DIR / "aligned_face.jpg"
IMAGE_2_PATH = BASE_DIR / "aligned_face.jpg"

MODEL_PATH = (
    Path.home()
    / ".insightface"
    / "models"
    / "buffalo_l"
    / "w600k_r50.onnx"
)


# --------------------------------
# Load images
# --------------------------------

image1 = cv2.imread(str(IMAGE_1_PATH))
image2 = cv2.imread(str(IMAGE_2_PATH))

if image1 is None:
    raise FileNotFoundError(f"Could not load: {IMAGE_1_PATH}")

if image2 is None:
    raise FileNotFoundError(f"Could not load: {IMAGE_2_PATH}")

print("Both aligned faces loaded successfully")


# --------------------------------
# Load ArcFace
# --------------------------------

print()
print("Loading ArcFace model...")

arcface = get_model(
    str(MODEL_PATH),
    providers=["CPUExecutionProvider"]
)

arcface.prepare(ctx_id=0)

print("ArcFace model loaded successfully")


# --------------------------------
# Generate embeddings
# --------------------------------

embedding1 = arcface.get_feat(image1).flatten()
embedding2 = arcface.get_feat(image2).flatten()

print()
print("Embedding 1 size:", len(embedding1))
print("Embedding 2 size:", len(embedding2))


# --------------------------------
# Normalize embeddings
# --------------------------------

embedding1 = embedding1 / np.linalg.norm(embedding1)
embedding2 = embedding2 / np.linalg.norm(embedding2)


# --------------------------------
# Cosine similarity
# --------------------------------

similarity = np.dot(embedding1, embedding2)


# --------------------------------
# Display result
# --------------------------------

print()
print("================================")
print("FACE COMPARISON")
print("================================")

print(f"Cosine similarity: {similarity:.6f}")

print("================================")