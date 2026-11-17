"""Number Plate Recognition & OCR Integration Boundary Module."""

from .plate_recognizer import (
    BasePlateDetector,
    BaseOCREngine,
    PlateDetectionResult,
    NullPlateOCR,
    MockPlateOCR,
    PaddleOCREngine,
    NumberPlatePipeline,
    normalize_plate_text,
    validate_indian_plate_format,
    preprocess_plate_image,
    PLATE_OCR_UNAVAILABLE_MESSAGE,
)

__all__ = [
    "BasePlateDetector",
    "BaseOCREngine",
    "PlateDetectionResult",
    "NullPlateOCR",
    "MockPlateOCR",
    "PaddleOCREngine",
    "NumberPlatePipeline",
    "normalize_plate_text",
    "validate_indian_plate_format",
    "preprocess_plate_image",
    "PLATE_OCR_UNAVAILABLE_MESSAGE",
]
