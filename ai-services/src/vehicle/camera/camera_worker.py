"""Asynchronous Camera Frame Acquisition Worker.

Captures frames from a generic OpenCV VideoCapture source (local video file,
webcam device index, or RTSP stream) inside an isolated background thread.

Step 5 Enhancements:
- Full RTSP stream ingestion support with TCP transport preference.
- Comprehensive connection state machine (DISCONNECTED, CONNECTING, CONNECTED, RECONNECTING, STOPPED, ERROR).
- Automated connection resilience with bounded exponential backoff.
- Zero password leakage: all credentials sanitized in logs and telemetry.
- Single-slot latest-frame-only buffer maintained across disconnects and reconnects.
"""

from __future__ import annotations

import logging
import os
import re
import threading
import time
from enum import Enum
from pathlib import Path
from typing import Optional, Tuple, Any

import cv2
import numpy as np

from ..vehicle_config import (
    RTSP_TRANSPORT,
    RTSP_CONNECT_TIMEOUT_SEC,
    RTSP_READ_TIMEOUT_SEC,
    RTSP_RECONNECT_ENABLED,
    RTSP_RECONNECT_INITIAL_DELAY_SEC,
    RTSP_RECONNECT_BACKOFF_FACTOR,
    RTSP_RECONNECT_MAX_DELAY_SEC,
    RTSP_MAX_CONSECUTIVE_READ_FAILURES,
    sanitize_rtsp_url,
)

logger = logging.getLogger(__name__)


class ConnectionState(str, Enum):
    """Connection lifecycle states for camera ingestion."""

    DISCONNECTED = "DISCONNECTED"
    CONNECTING = "CONNECTING"
    CONNECTED = "CONNECTED"
    RECONNECTING = "RECONNECTING"
    STOPPED = "STOPPED"
    ERROR = "ERROR"


class CameraWorker:
    """Production Asynchronous Camera Frame Acquisition Worker.

    Responsibilities:
    - Runs OpenCV frame capture inside a dedicated background thread.
    - Supports local video files, USB/V4L webcams, and RTSP/RTSPS IP camera streams.
    - Manages connection lifecycle and automatic reconnection with bounded exponential backoff.
    - Maintains a single-slot latest-frame-only buffer with condition synchronization.
    - Enforces TCP transport preference on FFmpeg RTSP backend to eliminate UDP packet loss.
    - Sanitizes credentials to prevent password exposure in logs and metrics.
    - Guarantees clean resource deallocation and VideoCapture release on shutdown.
    """

    def __init__(
        self,
        source: str | int,
        name: str = "CameraWorker",
        auto_start: bool = False,
        reconnect_enabled: Optional[bool] = None,
        initial_reconnect_delay: float = RTSP_RECONNECT_INITIAL_DELAY_SEC,
        backoff_factor: float = RTSP_RECONNECT_BACKOFF_FACTOR,
        max_reconnect_delay: float = RTSP_RECONNECT_MAX_DELAY_SEC,
        connect_timeout_sec: float = RTSP_CONNECT_TIMEOUT_SEC,
        read_timeout_sec: float = RTSP_READ_TIMEOUT_SEC,
        max_consecutive_read_failures: int = RTSP_MAX_CONSECUTIVE_READ_FAILURES,
        transport: str = RTSP_TRANSPORT,
    ) -> None:
        """Initializes the camera worker.

        Args:
            source: Video source (integer for webcam, string for local file or RTSP stream).
            name: Human-readable worker identifier for logging.
            auto_start: Whether to start capture immediately upon instantiation.
            reconnect_enabled: Whether auto-reconnect is active (defaults to True for RTSP, False for files).
            initial_reconnect_delay: Initial reconnect delay in seconds (default: 1.0s).
            backoff_factor: Multiplier for exponential backoff (default: 2.0).
            max_reconnect_delay: Maximum reconnect backoff ceiling (default: 30.0s).
            connect_timeout_sec: Connection attempt timeout in seconds (default: 5.0s).
            read_timeout_sec: Frame read timeout in seconds (default: 3.0s).
            max_consecutive_read_failures: Read failures before triggering reconnect (default: 3).
            transport: RTSP transport protocol ('tcp' or 'udp').
        """
        # Parse numeric string to int for webcam indices
        if isinstance(source, str) and source.isdigit():
            self.source: str | int = int(source)
        else:
            self.source = source

        self.name = name

        # Source classification
        self.is_rtsp_source = (
            isinstance(self.source, str)
            and self.source.lower().startswith(("rtsp://", "rtsps://"))
        )
        self.is_file_source = (
            isinstance(self.source, (str, Path))
            and not self.is_rtsp_source
            and not str(self.source).lower().startswith(("http://", "https://"))
        )
        self.is_device_source = isinstance(self.source, int)

        # Sanitized source name for logging (credentials masked)
        self.sanitized_source = sanitize_rtsp_url(self.source)

        # Reconnection parameters
        if reconnect_enabled is not None:
            self.reconnect_enabled = reconnect_enabled
        else:
            # Default to auto-reconnect for live RTSP, disabled for local video files
            self.reconnect_enabled = self.is_rtsp_source

        self.initial_reconnect_delay = max(0.1, float(initial_reconnect_delay))
        self.backoff_factor = max(1.0, float(backoff_factor))
        self.max_reconnect_delay = max(self.initial_reconnect_delay, float(max_reconnect_delay))
        self.connect_timeout_sec = float(connect_timeout_sec)
        self.read_timeout_sec = float(read_timeout_sec)
        self.max_consecutive_read_failures = max(1, int(max_consecutive_read_failures))
        self.transport = str(transport).lower()

        # Threading state
        self._thread: Optional[threading.Thread] = None
        self._stop_event = threading.Event()
        self._lock = threading.Lock()
        self._condition = threading.Condition(self._lock)

        # OpenCV VideoCapture handle
        self._cap: Optional[cv2.VideoCapture] = None

        # Connection lifecycle state
        self._connection_state: ConnectionState = ConnectionState.DISCONNECTED
        self._connection_attempts: int = 0
        self._reconnect_count: int = 0
        self._consecutive_read_failures: int = 0
        self._current_backoff_delay: float = self.initial_reconnect_delay
        self._last_reconnect_time: Optional[float] = None

        # Latest-frame-only storage
        self._latest_frame: Optional[np.ndarray] = None
        self._latest_frame_idx: int = 0
        self._latest_timestamp: float = 0.0
        self._last_successful_frame_timestamp: float = 0.0
        self._has_new_frame: bool = False
        self._has_ended: bool = False

        # Diagnostic metrics
        self._captured_frames: int = 0
        self._replaced_frames: int = 0
        self._stream_width: int = 0
        self._stream_height: int = 0
        self._stream_fps: float = 0.0

        # FPS calculation state
        self._last_fps_calc_time: float = 0.0
        self._last_fps_calc_count: int = 0
        self._estimated_capture_fps: float = 0.0

        if auto_start:
            self.start()

    # -------------------------------------------------------------------------
    # Properties & Diagnostics
    # -------------------------------------------------------------------------

    @property
    def is_running(self) -> bool:
        """Returns True if the worker background capture thread is actively running."""
        return self._thread is not None and self._thread.is_alive() and not self._stop_event.is_set()

    @property
    def is_connected(self) -> bool:
        """Returns True if the video source is actively connected and capturing."""
        with self._lock:
            return self._connection_state == ConnectionState.CONNECTED

    @property
    def connection_state(self) -> str:
        """Returns current connection lifecycle state label."""
        with self._lock:
            return self._connection_state.value

    @property
    def connection_attempts(self) -> int:
        """Total number of connection attempts made since initialization."""
        with self._lock:
            return self._connection_attempts

    @property
    def reconnect_count(self) -> int:
        """Total number of reconnection attempts triggered due to disconnects or read errors."""
        with self._lock:
            return self._reconnect_count

    @property
    def consecutive_read_failures(self) -> int:
        """Current consecutive frame read failure count."""
        with self._lock:
            return self._consecutive_read_failures

    @property
    def current_backoff_delay(self) -> float:
        """Current backoff delay in seconds for next reconnect attempt."""
        with self._lock:
            return self._current_backoff_delay

    @property
    def last_frame_timestamp(self) -> float:
        """Epoch timestamp of the most recently received frame."""
        with self._lock:
            return self._last_successful_frame_timestamp

    @property
    def last_reconnect_time(self) -> Optional[float]:
        """Epoch timestamp when reconnection was last successfully established."""
        with self._lock:
            return self._last_reconnect_time

    @property
    def latest_frame_age_ms(self) -> float:
        """Age in milliseconds of the latest available frame relative to now."""
        with self._lock:
            if self._last_successful_frame_timestamp <= 0:
                return 0.0
            return max(0.0, (time.time() - self._last_successful_frame_timestamp) * 1000.0)

    @property
    def has_ended(self) -> bool:
        """Returns True if the video source has reached end-of-stream (EOF)."""
        with self._lock:
            return self._has_ended

    @property
    def frame_count(self) -> int:
        """Returns total frames read from the video capture source."""
        with self._lock:
            return self._captured_frames

    @property
    def captured_frames(self) -> int:
        """Alias for frame_count."""
        with self._lock:
            return self._captured_frames

    @property
    def replaced_frames(self) -> int:
        """Returns the number of frames overwritten before consumer processing (dropped)."""
        with self._lock:
            return self._replaced_frames

    @property
    def capture_fps(self) -> float:
        """Returns the measured real-time frame acquisition rate in FPS."""
        with self._lock:
            return self._estimated_capture_fps

    @property
    def resolution(self) -> Tuple[int, int]:
        """Returns the frame resolution as (width, height)."""
        with self._lock:
            return self._stream_width, self._stream_height

    @property
    def stream_fps(self) -> float:
        """Returns the nominal FPS reported by the capture source metadata."""
        return self._stream_fps

    @property
    def latest_frame(self) -> Optional[np.ndarray]:
        """Convenience property returning a copy of the latest captured BGR frame, or None."""
        with self._lock:
            return self._latest_frame.copy() if self._latest_frame is not None else None

    # -------------------------------------------------------------------------
    # Core Lifecycle & Stream Control
    # -------------------------------------------------------------------------

    def _open_capture_handle(self) -> bool:
        """Opens or reopens the underlying OpenCV VideoCapture handle."""
        self._connection_attempts += 1

        # Enforce TCP transport for RTSP streams via FFmpeg environment variable
        if self.is_rtsp_source and self.transport == "tcp":
            os.environ["OPENCV_FFMPEG_CAPTURE_OPTIONS"] = "rtsp_transport;tcp"

        logger.info(
            f"[{self.name}] Attempting connection to {self.sanitized_source} "
            f"(Attempt #{self._connection_attempts}, Transport: {self.transport.upper()})..."
        )

        try:
            if self.is_rtsp_source:
                cap = cv2.VideoCapture(self.source, cv2.CAP_FFMPEG)
                # Configure timeouts on OpenCV 5.0+ / FFmpeg backend where available
                if hasattr(cv2, "CAP_PROP_OPEN_TIMEOUT_MSEC"):
                    cap.set(cv2.CAP_PROP_OPEN_TIMEOUT_MSEC, int(self.connect_timeout_sec * 1000))
                if hasattr(cv2, "CAP_PROP_READ_TIMEOUT_MSEC"):
                    cap.set(cv2.CAP_PROP_READ_TIMEOUT_MSEC, int(self.read_timeout_sec * 1000))
            else:
                cap = cv2.VideoCapture(self.source)

            if cap is not None and cap.isOpened():
                self._cap = cap
                self._stream_width = int(cap.get(cv2.CAP_PROP_FRAME_WIDTH))
                self._stream_height = int(cap.get(cv2.CAP_PROP_FRAME_HEIGHT))
                fps_prop = cap.get(cv2.CAP_PROP_FPS)
                self._stream_fps = float(fps_prop) if fps_prop and fps_prop > 0 else 25.0

                logger.info(
                    f"[{self.name}] Connection established successfully: "
                    f"{self._stream_width}x{self._stream_height} @ {self._stream_fps:.1f} FPS"
                )
                return True
            else:
                if cap is not None:
                    cap.release()
                logger.warning(f"[{self.name}] Could not open video source: {self.sanitized_source}")
                return False
        except Exception as e:
            logger.error(f"[{self.name}] Exception while opening {self.sanitized_source}: {e}")
            return False

    def start(self) -> None:
        """Starts the frame acquisition thread.

        Raises:
            RuntimeError: If initial open fails and reconnect_enabled is False.
        """
        if self.is_running:
            logger.warning(f"[{self.name}] CameraWorker already running.")
            return

        self._stop_event.clear()
        self._has_ended = False
        self._consecutive_read_failures = 0
        self._current_backoff_delay = self.initial_reconnect_delay

        with self._lock:
            self._connection_state = ConnectionState.CONNECTING

        # For non-reconnecting sources (e.g. local files), test opening synchronously
        if not self.reconnect_enabled:
            opened = self._open_capture_handle()
            if not opened:
                with self._lock:
                    self._connection_state = ConnectionState.ERROR
                err_msg = f"[{self.name}] Failed to open video capture source: {self.sanitized_source}"
                logger.error(err_msg)
                raise RuntimeError(err_msg)
            with self._lock:
                self._connection_state = ConnectionState.CONNECTED

        self._last_fps_calc_time = time.perf_counter()
        self._last_fps_calc_count = 0

        # Launch background thread
        self._thread = threading.Thread(
            target=self._capture_loop,
            name=f"{self.name}-CaptureThread",
            daemon=True,
        )
        self._thread.start()

    def _capture_loop(self) -> None:
        """Background thread loop handling frame capture, rate pacing, and auto-reconnection."""
        logger.info(f"[{self.name}] Background capture thread started.")

        # Pacing interval for local file simulation
        frame_interval = (1.0 / self._stream_fps) if (self.is_file_source and self._stream_fps > 0) else 0.0

        while not self._stop_event.is_set():
            t_frame_start = time.perf_counter()

            # -----------------------------------------------------------------
            # 1. Ensure active VideoCapture handle (reconnecting if needed)
            # -----------------------------------------------------------------
            if self._cap is None or not self._cap.isOpened():
                if not self.reconnect_enabled:
                    # Non-reconnecting source cannot recover
                    with self._lock:
                        self._connection_state = ConnectionState.DISCONNECTED
                    break

                # If this is a reconnect attempt (past initial attempt), wait for backoff delay
                if self._connection_attempts > 0:
                    with self._lock:
                        self._connection_state = ConnectionState.RECONNECTING
                        self._reconnect_count += 1
                        self._has_new_frame = False

                    logger.info(
                        f"[{self.name}] Reconnecting to {self.sanitized_source} in "
                        f"{self._current_backoff_delay:.1f}s (Reconnect #{self._reconnect_count})..."
                    )

                    # Wait for backoff delay interruptibly
                    if self._stop_event.wait(timeout=self._current_backoff_delay):
                        logger.info(f"[{self.name}] Stop requested during reconnect backoff.")
                        break

                # Attempt to open handle
                success = self._open_capture_handle()
                if not success:
                    # Failed attempt: scale exponential backoff
                    with self._lock:
                        self._connection_state = ConnectionState.RECONNECTING
                        self._current_backoff_delay = min(
                            self._current_backoff_delay * self.backoff_factor,
                            self.max_reconnect_delay,
                        )
                    continue
                else:
                    # Successful connection establishment
                    with self._lock:
                        self._connection_state = ConnectionState.CONNECTED
                        self._current_backoff_delay = self.initial_reconnect_delay
                        self._consecutive_read_failures = 0
                        self._last_reconnect_time = time.time()
                    logger.info(f"[{self.name}] Connected successfully to {self.sanitized_source}")

            # -----------------------------------------------------------------
            # 2. Read frame from video capture
            # -----------------------------------------------------------------
            try:
                ret, frame = self._cap.read()
            except Exception as e:
                logger.error(f"[{self.name}] Exception during frame read: {e}")
                ret, frame = False, None

            now = time.time()

            # -----------------------------------------------------------------
            # 3. Handle read failure
            # -----------------------------------------------------------------
            if not ret or frame is None:
                if self.is_file_source:
                    # Video file reached end-of-stream (EOF)
                    logger.info(f"[{self.name}] Local video file reached EOF.")
                    with self._condition:
                        self._has_ended = True
                        self._connection_state = ConnectionState.STOPPED
                        self._condition.notify_all()
                    break
                else:
                    # Network stream read failure
                    with self._lock:
                        self._consecutive_read_failures += 1
                        failures = self._consecutive_read_failures

                    logger.warning(
                        f"[{self.name}] Read failure on {self.sanitized_source} "
                        f"({failures}/{self.max_consecutive_read_failures})"
                    )

                    if failures >= self.max_consecutive_read_failures:
                        logger.error(
                            f"[{self.name}] Maximum read failures reached on {self.sanitized_source}. "
                            f"Triggering stream reconnect cycle..."
                        )
                        # Release faulty handle
                        if self._cap is not None:
                            try:
                                self._cap.release()
                            except Exception:
                                pass
                            self._cap = None

                        with self._condition:
                            self._connection_state = ConnectionState.RECONNECTING
                            self._has_new_frame = False
                            self._condition.notify_all()

                    continue

            # -----------------------------------------------------------------
            # 4. Successful frame read -> Store in single-slot latest-frame buffer
            # -----------------------------------------------------------------
            with self._condition:
                self._connection_state = ConnectionState.CONNECTED
                self._consecutive_read_failures = 0
                self._current_backoff_delay = self.initial_reconnect_delay
                self._captured_frames += 1

                # If previous frame was never retrieved, it is dropped/replaced
                if self._has_new_frame:
                    self._replaced_frames += 1

                self._latest_frame = frame
                self._latest_frame_idx = self._captured_frames
                self._latest_timestamp = now
                self._last_successful_frame_timestamp = now
                self._has_new_frame = True

                # Measure capture FPS periodically (every ~0.5s)
                t_now = time.perf_counter()
                elapsed = t_now - self._last_fps_calc_time
                if elapsed >= 0.5:
                    frames_delta = self._captured_frames - self._last_fps_calc_count
                    self._estimated_capture_fps = frames_delta / elapsed
                    self._last_fps_calc_time = t_now
                    self._last_fps_calc_count = self._captured_frames

                # Notify waiting consumers
                self._condition.notify_all()

            # Pacing for local file sources to simulate real-time camera FPS
            if frame_interval > 0:
                elapsed = time.perf_counter() - t_frame_start
                sleep_remainder = frame_interval - elapsed
                if sleep_remainder > 0 and not self._stop_event.is_set():
                    time.sleep(sleep_remainder)

        with self._lock:
            self._connection_state = ConnectionState.STOPPED
        logger.info(f"[{self.name}] Background capture thread terminating.")

    def get_latest_frame(
        self,
        wait: bool = False,
        timeout: Optional[float] = None,
    ) -> Optional[Tuple[np.ndarray, int, float]]:
        """Retrieves the newest available frame from the single-slot buffer.

        Args:
            wait: If True, blocks until a new frame arrives or timeout expires.
            timeout: Maximum time in seconds to wait when wait=True.

        Returns:
            Tuple of (frame_bgr, frame_index, epoch_timestamp) or None if no frame available.
        """
        with self._condition:
            if wait and not self._has_new_frame and not self._has_ended and not self._stop_event.is_set():
                self._condition.wait(timeout=timeout)

            if self._latest_frame is None or not self._has_new_frame:
                # If we're not waiting or no new frame has arrived, return copy if available
                if not wait and self._latest_frame is not None:
                    return self._latest_frame.copy(), self._latest_frame_idx, self._latest_timestamp
                return None

            frame_copy = self._latest_frame.copy()
            idx = self._latest_frame_idx
            ts = self._latest_timestamp
            self._has_new_frame = False

            return frame_copy, idx, ts

    def stop(self, timeout: float = 2.0) -> None:
        """Gracefully stops frame acquisition and releases all video hardware/file handles."""
        logger.info(f"[{self.name}] Stopping camera worker...")
        self._stop_event.set()

        with self._condition:
            self._connection_state = ConnectionState.STOPPED
            self._condition.notify_all()

        if self._thread is not None and self._thread.is_alive():
            self._thread.join(timeout=timeout)
            if self._thread.is_alive():
                logger.warning(f"[{self.name}] Capture thread did not exit cleanly within timeout.")
            self._thread = None

        if self._cap is not None:
            try:
                self._cap.release()
            except Exception as e:
                logger.error(f"[{self.name}] Error releasing VideoCapture: {e}")
            self._cap = None

        logger.info(f"[{self.name}] Camera worker stopped cleanly.")

    def __enter__(self) -> CameraWorker:
        if not self.is_running:
            self.start()
        return self

    def __exit__(self, exc_type: Any, exc_val: Any, exc_tb: Any) -> None:
        self.stop()
