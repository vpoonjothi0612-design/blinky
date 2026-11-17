"""Face Recognition Service Package.

Provides headless, production-ready face recognition engines and structured result data structures.
"""

from .face_service import FaceRecognitionService, FaceRecognitionResult
from .track_recognition_policy import TrackRecognitionPolicy, TrackState

__all__ = [
    "FaceRecognitionService",
    "FaceRecognitionResult",
    "TrackRecognitionPolicy",
    "TrackState",
]

