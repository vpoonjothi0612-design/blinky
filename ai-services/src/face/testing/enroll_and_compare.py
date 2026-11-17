"""Enroll one photo in memory and score a second photo using the production ArcFace pipeline."""
import argparse
import sys
from pathlib import Path

import cv2
import numpy as np

ROOT = Path(__file__).resolve().parents[3]
sys.path.insert(0, str(ROOT / "src" / "face"))
sys.path.insert(0, str(ROOT / "src" / "face" / "service"))
from face_api import extract_enrollment_embedding, get_face_service


def embed(service, path):
    image = cv2.imread(str(path))
    if image is None:
        raise SystemExit(f"Could not read image: {path}")
    vector, _ = extract_enrollment_embedding(service, image)
    return np.asarray(vector, dtype=np.float32)


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("enroll_photo", type=Path)
    parser.add_argument("recognition_photo", type=Path)
    args = parser.parse_args()
    service = get_face_service()
    enrolled = embed(service, args.enroll_photo)
    probe = embed(service, args.recognition_photo)
    print(f"cosine_similarity={float(np.dot(enrolled, probe)):.4f}")
    print(f"recommended_start_threshold={service.recognition_threshold:.2f}")


if __name__ == "__main__":
    main()
