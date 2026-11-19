from __future__ import annotations

import math
from typing import Dict, Iterable, Optional

HUMAN_ORIENTATIONS = frozenset({
    "FRONT",
    "FRONT_LEFT",
    "FRONT_RIGHT",
    "LEFT_PROFILE",
    "RIGHT_PROFILE",
    "LEFT",
    "RIGHT",
    "BACK",
    "UNKNOWN",
    "UNKNOWN_ORIENTATION",
})
HUMAN_CAPTURE_ORIENTATIONS = (
    "FRONT",
    "FRONT_LEFT",
    "FRONT_RIGHT",
    "LEFT_PROFILE",
    "RIGHT_PROFILE",
)
VEHICLE_ANGLES = frozenset({"FRONT", "LEFT", "RIGHT", "REAR", "TOP", "UNKNOWN"})
VEHICLE_CAPTURE_ANGLES = ("FRONT", "LEFT", "RIGHT", "REAR")


def _normalize_label(value: object, allowed: Iterable[str]) -> str:
    if not isinstance(value, str):
        return "UNKNOWN"
    label = value.strip().upper()
    return label if label in allowed else "UNKNOWN"


def normalize_human_orientation(value: object) -> str:
    return _normalize_label(value, HUMAN_ORIENTATIONS)


def normalize_vehicle_angle(value: object) -> str:
    return _normalize_label(value, VEHICLE_ANGLES)


def normalize_confidence(value: object) -> Optional[float]:
    if isinstance(value, bool):
        return None
    try:
        confidence = float(value)
    except (TypeError, ValueError):
        return None
    return confidence if math.isfinite(confidence) and 0.0 <= confidence <= 1.0 else None


def normalize_angle_images(images: object, allowed_angles: Iterable[str]) -> Dict[str, str]:
    if not isinstance(images, dict):
        return {}
    allowed = frozenset(allowed_angles)
    result: Dict[str, str] = {}
    for angle, image_path in images.items():
        normalized_angle = _normalize_label(angle, allowed)
        if normalized_angle == "UNKNOWN" or not isinstance(image_path, str):
            continue
        image_path = image_path.strip()
        if image_path:
            result[normalized_angle] = image_path
    return result


class BestViewCaptureRegistry:
    def __init__(self, allowed_angles: Iterable[str]) -> None:
        self.allowed_angles = frozenset(
            _normalize_label(angle, VEHICLE_ANGLES | HUMAN_ORIENTATIONS)
            for angle in allowed_angles
        ) - {"UNKNOWN"}
        self._captures: Dict[str, Dict[str, object]] = {}

    def consider(self, angle: object, image_path: object, quality: object) -> bool:
        normalized_angle = _normalize_label(angle, self.allowed_angles)
        if normalized_angle not in self.allowed_angles or not isinstance(image_path, str) or isinstance(quality, bool):
            return False
        path = image_path.strip()
        try:
            score = float(quality)
        except (TypeError, ValueError):
            return False
        if not path or not math.isfinite(score) or score < 0:
            return False

        current = self._captures.get(normalized_angle)
        if current and float(current["quality"]) >= score:
            return False
        self._captures[normalized_angle] = {"path": path, "quality": score}
        return True

    def paths(self) -> Dict[str, str]:
        return {
            angle: str(capture["path"])
            for angle, capture in self._captures.items()
        }

    def items(self) -> Dict[str, Dict[str, object]]:
        return {angle: dict(capture) for angle, capture in self._captures.items()}
