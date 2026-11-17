"""Vehicle Classes Definition & Dynamic COCO Mapping for YOLO11n.

Strictly targets road vehicle classes:
- car
- motorcycle
- bus
- truck

Explicitly ignores non-vehicle classes (e.g. person, bicycle, traffic light, etc.).
"""

from __future__ import annotations

from typing import Dict, List, Set, Any

TARGET_VEHICLE_NAMES: List[str] = ["car", "motorcycle", "bus", "truck"]


def extract_vehicle_class_map(model: Any) -> Dict[int, str]:
    """Dynamically extracts vehicle class IDs and names from the loaded YOLO model.

    Args:
        model: Ultralytics YOLO model instance.

    Returns:
        Dict mapping integer class ID to class name for valid vehicle classes.
    """
    if not hasattr(model, "names") or not model.names:
        raise ValueError("Model does not provide class names mapping.")

    vehicle_map: Dict[int, str] = {}
    target_set: Set[str] = set(TARGET_VEHICLE_NAMES)

    for class_id, name in model.names.items():
        name_lower = str(name).lower().strip()
        if name_lower in target_set:
            vehicle_map[int(class_id)] = name_lower

    return vehicle_map


def is_vehicle(class_id: int, vehicle_map: Dict[int, str]) -> bool:
    """Checks whether the given class ID corresponds to an authorized vehicle."""
    return class_id in vehicle_map
