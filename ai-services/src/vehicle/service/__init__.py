"""Vehicle Processing Service Package.

Provides stream processing, decoupled camera capture coordination, and diagnostics.
"""

from .vehicle_stream_processor import VehicleStreamProcessor, ProcessingStatistics
from .vehicle_image_service import (
    VehicleImageRecognitionService,
    VehicleRecognitionItem,
    PerformanceBreakdown,
)
from .vehicle_video_service import (
    VehicleVideoAnalysisService,
    TrackedVehicleRecord,
)

__all__ = [
    "VehicleStreamProcessor",
    "ProcessingStatistics",
    "VehicleImageRecognitionService",
    "VehicleRecognitionItem",
    "PerformanceBreakdown",
    "VehicleVideoAnalysisService",
    "TrackedVehicleRecord",
]


