#!/usr/bin/env python3
"""Run the live plate reader over a folder of vehicle images.

Ground truth may be supplied with --labels-csv (columns: filename,plate) or
included in each filename, e.g. TN39DU0320_cam02.jpg.
"""

from __future__ import annotations

import argparse
import csv
import re
import sys
from pathlib import Path

import cv2

AI_ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(AI_ROOT))

from src.vehicle.plate.plate_reader import recognize_plate  # noqa: E402


PLATE_PATTERN = re.compile(r"(?<![A-Z0-9])(?:[A-Z]{2}\d{2}[A-Z]{1,3}\d{4}|\d{2}BH\d{4}[A-Z]{1,2})(?![A-Z0-9])", re.I)


def load_labels(path: Path | None) -> dict[str, str]:
    if not path:
        return {}
    with path.open(newline="", encoding="utf-8-sig") as stream:
        return {row["filename"]: row["plate"].upper().strip() for row in csv.DictReader(stream) if row.get("filename") and row.get("plate")}


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("image_folder", type=Path)
    parser.add_argument("--labels-csv", type=Path, help="CSV with filename,plate columns")
    args = parser.parse_args()
    if not args.image_folder.is_dir():
        parser.error(f"Image folder does not exist: {args.image_folder}")
    labels = load_labels(args.labels_csv)
    images = sorted(path for path in args.image_folder.iterdir() if path.suffix.lower() in {".jpg", ".jpeg", ".png", ".bmp", ".webp"})
    if not images:
        parser.error("No supported images found in the folder")

    correct = 0
    labeled = 0
    for image_path in images:
        image = cv2.imread(str(image_path))
        result = recognize_plate(image, track_id=image_path.stem)
        expected = labels.get(image_path.name)
        if expected is None:
            match = PLATE_PATTERN.search(image_path.stem.upper())
            expected = match.group(0) if match else None
        if expected:
            labeled += 1
            if result["plate_text"] == expected:
                correct += 1
        print(
            f"{image_path.name}: expected={expected or 'n/a'} recognized={result['plate_text'] or '-'} "
            f"status={result['status']} confidence={result['confidence']:.3f} crop={result['plate_crop_path'] or '-'}"
        )
    print(f"Correct/total labeled: {correct}/{labeled} ({len(images)} images processed)")
    if not labeled:
        print("Add expected plate numbers to filenames or provide --labels-csv for an accuracy count.")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
