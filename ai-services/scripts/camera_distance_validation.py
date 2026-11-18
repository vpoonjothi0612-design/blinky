"""CP PLUS 1-5 metre face-size and recognition validation procedure.

Run while an employee stands at one labelled distance for an interval:
python scripts/camera_distance_validation.py --camera-id CAM-02 --distance-m 1 --frames 300

The script saves original frames, detected face dimensions, sharpness, exposure,
ArcFace similarity, and recognition/unknown status to a timestamped CSV directory.
It does not claim a physical recognition guarantee; measured values must come from this run.
"""

from __future__ import annotations

import argparse
import csv
import os
import sys
import time
from pathlib import Path

import cv2
import numpy as np
from insightface.model_zoo import get_model

AI_ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(AI_ROOT / "src" / "camera"))
sys.path.insert(0, str(AI_ROOT / "src" / "face"))
sys.path.insert(0, str(AI_ROOT / "src" / "face" / "recognition"))

from camera_config import get_camera_config, sanitize_rtsp_url
from camera_worker import CameraWorker
from employee_registry import load_all_active_embeddings, match_probe_against_registry
from face_config import (
    ARCFACE_MODEL_PATH,
    REFERENCE_POINTS,
    YUNET_MODEL_PATH,
)


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--camera-id", default="CAM-02", choices=["CAM-01", "CAM-02"])
    parser.add_argument("--distance-m", required=True, type=float, choices=[1, 2, 3, 4, 5])
    parser.add_argument("--frames", type=int, default=300)
    parser.add_argument("--min-face-px", type=int, default=64)
    args = parser.parse_args()

    config = get_camera_config(args.camera_id)
    worker = CameraWorker(config=config, auto_start=True)
    deadline = time.time() + 15
    while not worker.is_connected() and time.time() < deadline:
        time.sleep(0.1)
    if not worker.is_connected():
        print(f"[ERROR] Camera did not connect: {sanitize_rtsp_url(config.get_rtsp_url())}")
        worker.stop()
        return 1

    yunet = cv2.FaceDetectorYN.create(
        str(YUNET_MODEL_PATH), "", (320, 320),
        float(os.environ.get("YUNET_LIVE_SCORE_THRESHOLD", "0.55")), 0.3, 5000,
    )
    arcface = get_model(str(ARCFACE_MODEL_PATH), providers=["CPUExecutionProvider"])
    arcface.prepare(ctx_id=-1)
    registry = load_all_active_embeddings()

    run_dir = AI_ROOT / "data" / "distance_validation" / (
        f"{args.camera_id}_{args.distance_m:g}m_{int(time.time())}"
    )
    run_dir.mkdir(parents=True, exist_ok=True)
    csv_path = run_dir / "measurements.csv"

    processed = 0
    with csv_path.open("w", newline="", encoding="utf-8") as handle:
        fieldnames = [
            "timestamp", "camera_id", "distance_m", "face_width", "face_height",
            "sharpness", "mean_brightness", "similarity", "threshold",
            "status", "employee_id",
        ]
        writer = csv.DictWriter(handle, fieldnames=fieldnames)
        writer.writeheader()

        last_idx = -1
        while processed < args.frames:
            has_frame, frame, capture_ts, frame_idx = worker.get_latest_frame()
            if not has_frame or frame_idx == last_idx:
                time.sleep(0.033)
                continue
            last_idx = frame_idx
            original = frame.copy()
            h, w = original.shape[:2]
            yunet.setInputSize((w, h))
            _, faces = yunet.detect(original)

            cv2.imwrite(str(run_dir / f"frame_{processed:05d}.jpg"), original)
            if faces is None or len(faces) == 0:
                writer.writerow({
                    "timestamp": capture_ts, "camera_id": args.camera_id,
                    "distance_m": args.distance_m, "face_width": 0, "face_height": 0,
                    "sharpness": 0, "mean_brightness": 0, "similarity": 0,
                    "threshold": float(os.environ.get("RECOGNITION_THRESHOLD", "0.55")),
                    "status": "NO_FACE", "employee_id": "",
                })
            else:
                face = faces[0]
                fx, fy, fw, fh = map(int, face[:4])
                crop = original[max(0, fy):min(h, fy + fh), max(0, fx):min(w, fx + fw)]
                if crop.size == 0:
                    continue
                gray = cv2.cvtColor(crop, cv2.COLOR_BGR2GRAY)
                sharpness = float(cv2.Laplacian(gray, cv2.CV_64F).var())
                brightness = float(gray.mean())
                landmarks = face[4:14].reshape((5, 2)).astype(np.float32)
                transform, _ = cv2.estimateAffinePartial2D(
                    landmarks, REFERENCE_POINTS, method=cv2.LMEDS,
                )

                status = "LOW_FACE_QUALITY"
                employee_id = ""
                similarity = 0.0
                threshold = float(os.environ.get("RECOGNITION_THRESHOLD", "0.55"))
                if fw >= args.min_face_px and fh >= args.min_face_px and transform is not None:
                    aligned = cv2.warpAffine(original, transform, (112, 112))
                    embedding = arcface.get_feat(aligned).flatten()
                    norm = float(np.linalg.norm(embedding))
                    if norm > 0:
                        probe = embedding / norm
                        decision = match_probe_against_registry(
                            probe, registry, threshold,
                            min_match_margin=float(os.environ.get("MIN_MATCH_MARGIN", "0.05")),
                            profile_recognition_threshold=threshold,
                            probe_landmarks=landmarks,
                        )
                        status = decision["status"]
                        employee_id = decision["employee_id"] or ""
                        similarity = float(decision["similarity"] or 0.0)

                writer.writerow({
                    "timestamp": capture_ts, "camera_id": args.camera_id,
                    "distance_m": args.distance_m, "face_width": fw, "face_height": fh,
                    "sharpness": round(sharpness, 2), "mean_brightness": round(brightness, 2),
                    "similarity": round(similarity, 4), "threshold": threshold,
                    "status": status, "employee_id": employee_id,
                })
            processed += 1
            if processed % 50 == 0:
                print(f"[{args.camera_id}] Captured and measured {processed}/{args.frames} frames")

    worker.stop()
    print(f"[DONE] Results: {csv_path}")
    print(f"[DONE] Original frames: {run_dir}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
