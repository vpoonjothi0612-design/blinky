"""Extract 512-D ArcFace normalized embedding from a face image.
Usage:
    python extract_face_embedding.py <image_path>
Output:
    JSON array of 512 floats to stdout, or empty array [] on failure.
"""

import sys
import json
from pathlib import Path
import cv2
import numpy as np

def extract_embedding(image_path: str):
    try:
        p = Path(image_path)
        if not p.exists():
            # Check relative to unknown images dir
            alt = Path(__file__).resolve().parents[3] / "data" / "unknown" / p.name
            if alt.exists():
                p = alt
            else:
                print("[]")
                return

        img = cv2.imread(str(p))
        if img is None or img.size == 0:
            print("[]")
            return

        from insightface.model_zoo import get_model
        model_path = Path.home() / ".insightface" / "models" / "buffalo_l" / "w600k_r50.onnx"
        if not model_path.exists():
            # Check repo models
            repo_model = Path(__file__).resolve().parents[3] / "models" / "arcface" / "w600k_r50.onnx"
            if repo_model.exists():
                model_path = repo_model

        if not model_path.exists():
            print("[]")
            return

        arcface = get_model(str(model_path), providers=["CPUExecutionProvider"])
        arcface.prepare(ctx_id=0)

        # Canonical resize to 112x112
        resized = cv2.resize(img, (112, 112))
        feat = arcface.get_feat(resized).flatten()
        norm = float(np.linalg.norm(feat))
        if norm > 0:
            feat = feat / norm
            print(json.dumps([round(float(x), 6) for x in feat.tolist()]))
        else:
            print("[]")
    except Exception as ex:
        sys.stderr.write(f"Extraction error: {ex}\n")
        print("[]")

if __name__ == "__main__":
    if len(sys.argv) > 1:
        extract_embedding(sys.argv[1])
    else:
        print("[]")
