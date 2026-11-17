import cv2
import numpy as np
from pathlib import Path
from insightface.model_zoo import get_model


BASE_DIR = Path(__file__).resolve().parents[3]

IMAGE_PATH = BASE_DIR / "aligned_face.jpg"


# --------------------------------
# Load aligned face
# --------------------------------

image = cv2.imread(str(IMAGE_PATH))

if image is None:
    raise FileNotFoundError(
        f"Could not load aligned face: {IMAGE_PATH}"
    )

print("Aligned face loaded successfully")
print(f"Image size: {image.shape[1]} x {image.shape[0]}")


# --------------------------------
# Load ArcFace recognition model
# --------------------------------

print()
print("Loading ArcFace recognition model...")

MODEL_PATH = (
    Path.home()
    / ".insightface"
    / "models"
    / "buffalo_l"
    / "w600k_r50.onnx"
)

if not MODEL_PATH.exists():
    raise FileNotFoundError(
        f"ArcFace model not found:\n{MODEL_PATH}"
    )

arcface = get_model(
    str(MODEL_PATH),
    providers=["CPUExecutionProvider"]
)

arcface.prepare(ctx_id=0)

print("ArcFace recognition model loaded successfully")


# --------------------------------
# Generate embedding
# --------------------------------

embedding = arcface.get_feat(image)

embedding = embedding.flatten()


# --------------------------------
# Display embedding information
# --------------------------------

print()
print("================================")
print("ARCFACE EMBEDDING")
print("================================")

print(f"Embedding shape : {embedding.shape}")
print(f"Embedding size  : {len(embedding)}")

print()
print("First 10 values:")

for index, value in enumerate(embedding[:10], start=1):
    print(f"{index}: {value:.6f}")

print()
print("================================")
print("Embedding generated successfully")
print("================================")