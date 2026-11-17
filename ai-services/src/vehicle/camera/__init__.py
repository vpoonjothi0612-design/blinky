"""Vehicle Camera Module.

Provides asynchronous camera capture, RTSP abstraction, and frame buffering.
"""

from .camera_worker import CameraWorker, ConnectionState

__all__ = ["CameraWorker", "ConnectionState"]

