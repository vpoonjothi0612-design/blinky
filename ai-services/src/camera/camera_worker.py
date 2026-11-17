"""Asynchronous Multi-Camera Frame Acquisition Worker.

Captures frames from RTSP streams (or USB webcams) in a dedicated background
thread, enforcing RTSP-over-TCP transport, connection resilience, bounded
exponential reconnection backoff, single-slot latest-frame buffering, and
zero-leakage credential logging.
"""

from __future__ import annotations

import logging
import os
import threading
import time
from enum import Enum
from typing import Optional, Tuple, Any

import cv2
import numpy as np

try:
    from .camera_config import CameraConfig, sanitize_rtsp_url
except ImportError:
    try:
        from camera_config import CameraConfig, sanitize_rtsp_url
    except ImportError:
        from src.camera.camera_config import CameraConfig, sanitize_rtsp_url

logger = logging.getLogger(__name__)


class ConnectionState(str, Enum):
    """Lifecycle states for camera connection."""

    DISCONNECTED = "DISCONNECTED"
    CONNECTING = "CONNECTING"
    CONNECTED = "CONNECTED"
    RECONNECTING = "RECONNECTING"
    STOPPED = "STOPPED"
    ERROR = "ERROR"


class CameraWorker:
    """Threaded worker capturing frames continuously from a single camera source.

    Attributes:
        camera_id: Unique identifier (e.g. 'CAM-01', 'CAM-02').
        config: Associated CameraConfig instance (if RTSP), or source string/int.
        state: Current ConnectionState.
    """

    def __init__(
        self,
        config: CameraConfig | str | int,
        camera_id: Optional[str] = None,
        name: Optional[str] = None,
        auto_start: bool = False,
    ) -> None:
        if isinstance(config, CameraConfig):
            self.config: Optional[CameraConfig] = config
            self.camera_id = config.camera_id
            self.name = name or config.name
            self.raw_source = config.get_rtsp_url(sanitize=False)
            self.sanitized_source = config.sanitized_url
            self.transport = config.transport
            self.connect_timeout = config.connect_timeout_sec
            self.read_timeout = config.read_timeout_sec
            self.reconnect_enabled = config.reconnect_enabled
            self.initial_reconnect_delay = config.reconnect_initial_delay
            self.backoff_factor = config.reconnect_backoff_factor
            self.max_reconnect_delay = config.reconnect_max_delay
        else:
            self.config = None
            self.camera_id = camera_id or ("CAM-01" if str(config) == "0" else str(config))
            self.name = name or f"Camera ({self.camera_id})"
            self.raw_source = config
            self.sanitized_source = sanitize_rtsp_url(config)
            self.transport = "tcp"
            self.connect_timeout = 5.0
            self.read_timeout = 3.0
            self.reconnect_enabled = True
            self.initial_reconnect_delay = 1.0
            self.backoff_factor = 2.0
            self.max_reconnect_delay = 30.0

        # State management (Reentrant Lock to allow nested locking)
        self.state: ConnectionState = ConnectionState.DISCONNECTED
        self._state_lock = threading.RLock()

        # Thread synchronization
        self._thread: Optional[threading.Thread] = None
        self._stop_event = threading.Event()

        # Latest frame buffer (Single-slot)
        self._frame_lock = threading.Lock()
        self._latest_frame: Optional[np.ndarray] = None
        self._latest_timestamp: float = 0.0
        self._latest_frame_idx: int = 0
        self._frame_width: int = 0
        self._frame_height: int = 0

        # Metrics
        self.total_frames_received: int = 0
        self.consecutive_read_failures: int = 0
        self.last_successful_read_time: float = 0.0
        self.reconnect_count: int = 0
        self.last_error_message: str = ""

        # Enforce RTSP-over-TCP via FFmpeg environment variable if using RTSP
        if isinstance(self.raw_source, str) and self.raw_source.startswith("rtsp"):
            if self.transport.lower() == "tcp":
                os.environ["OPENCV_FFMPEG_CAPTURE_OPTIONS"] = "rtsp_transport;tcp"

        if auto_start:
            self.start()

    def _set_state(self, new_state: ConnectionState, error_msg: str = "") -> None:
        with self._state_lock:
            old_state = self.state
            self.state = new_state
            if error_msg:
                self.last_error_message = error_msg
            if old_state != new_state:
                logger.info(f"[{self.camera_id}] State changed: {old_state} -> {new_state}")

    def start(self) -> bool:
        """Starts the capture background thread."""
        with self._state_lock:
            if self._thread and self._thread.is_alive():
                logger.warning(f"[{self.camera_id}] Worker thread is already running.")
                return True

            self._stop_event.clear()
            self._set_state(ConnectionState.CONNECTING)

            self._thread = threading.Thread(
                target=self._capture_loop,
                name=f"CaptureWorker-{self.camera_id}",
                daemon=True,
            )
            self._thread.start()
            logger.info(f"[{self.camera_id}] Capture worker thread started.")
            return True

    def stop(self, timeout: float = 3.0) -> None:
        """Stops the capture worker cleanly and releases resources."""
        self._stop_event.set()
        if self._thread and self._thread.is_alive():
            self._thread.join(timeout=timeout)
        self._set_state(ConnectionState.STOPPED)
        logger.info(f"[{self.camera_id}] Capture worker stopped.")

    def is_running(self) -> bool:
        """Returns True if the worker thread is active."""
        return self._thread is not None and self._thread.is_alive()

    def is_connected(self) -> bool:
        """Returns True if the worker is currently receiving frames."""
        with self._state_lock:
            return self.state == ConnectionState.CONNECTED

    def get_latest_frame(self) -> Tuple[bool, Optional[np.ndarray], float, int]:
        """Fetches the most recently captured frame in a thread-safe manner.

        Returns:
            Tuple of:
                - success (bool): True if a valid frame is available.
                - frame (Optional[np.ndarray]): BGR frame copy or None.
                - timestamp (float): Unix epoch timestamp of frame acquisition.
                - frame_idx (int): Monotonic frame sequence counter.
        """
        with self._state_lock:
            connected = self.state == ConnectionState.CONNECTED

        with self._frame_lock:
            if not connected or self._latest_frame is None:
                return False, None, 0.0, 0
            # Return copy to prevent race conditions during downstream processing
            return True, self._latest_frame.copy(), self._latest_timestamp, self._latest_frame_idx

    def get_status(self) -> dict:
        """Returns real-time worker diagnostic status."""
        with self._state_lock:
            current_state = self.state.value
            err_msg = self.last_error_message

        with self._frame_lock:
            w, h = self._frame_width, self._frame_height
            ts = self._latest_timestamp
            f_idx = self._latest_frame_idx

        return {
            "camera_id": self.camera_id,
            "name": self.name,
            "state": current_state,
            "source": self.sanitized_source,
            "connected": current_state == ConnectionState.CONNECTED,
            "resolution": f"{w}x{h}" if w > 0 else "N/A",
            "fps_frame_count": self.total_frames_received,
            "reconnect_count": self.reconnect_count,
            "last_frame_time": ts,
            "last_frame_idx": f_idx,
            "last_error": err_msg,
        }

    def _open_capture(self) -> Optional[cv2.VideoCapture]:
        """Attempts to open OpenCV VideoCapture for the configured source with fallback."""
        logger.info(f"[{self.camera_id}] Connecting to: {self.sanitized_source}")

        if isinstance(self.raw_source, int):
            cap = cv2.VideoCapture(self.raw_source, cv2.CAP_DSHOW)
            if not cap.isOpened():
                cap = cv2.VideoCapture(self.raw_source)
            if cap.isOpened():
                cap.set(cv2.CAP_PROP_BUFFERSIZE, 1)
                return cap
            return None

        # Build candidate URLs (handling scheme rtsps/rtsp and alternate paths)
        candidate_urls = [self.raw_source]
        if self.config:
            alt_scheme = "rtsp" if getattr(self.config, "scheme", "rtsps") == "rtsps" else "rtsps"
            alt_url_scheme = self.config.get_rtsp_url(sanitize=False, override_scheme=alt_scheme)
            if alt_url_scheme not in candidate_urls:
                candidate_urls.append(alt_url_scheme)

            curr_path = self.config.get_rtsp_path()
            alt_path = (
                f"/video/live?channel={self.config.channel}&subtype={self.config.subtype}&unicast=true&proto=Onvif"
                if "/cam/realmonitor" in curr_path
                else f"/cam/realmonitor?channel={self.config.channel}&subtype={self.config.subtype}"
            )
            candidate_urls.append(self.config.get_rtsp_url(sanitize=False, override_path=alt_path))
            candidate_urls.append(self.config.get_rtsp_url(sanitize=False, override_scheme=alt_scheme, override_path=alt_path))

        # Enforce TCP transport for RTSP/RTSPS
        if self.transport.lower() == "tcp":
            os.environ["OPENCV_FFMPEG_CAPTURE_OPTIONS"] = "rtsp_transport;tcp"

        for url in candidate_urls:
            timeout_params = []
            open_timeout_prop = getattr(cv2, "CAP_PROP_OPEN_TIMEOUT_MSEC", None)
            read_timeout_prop = getattr(cv2, "CAP_PROP_READ_TIMEOUT_MSEC", None)
            if open_timeout_prop is not None:
                timeout_params.extend([int(open_timeout_prop), max(1, int(self.connect_timeout * 1000))])
            if read_timeout_prop is not None:
                timeout_params.extend([int(read_timeout_prop), max(1, int(self.read_timeout * 1000))])

            try:
                if timeout_params:
                    cap = cv2.VideoCapture(url, cv2.CAP_FFMPEG, timeout_params)
                else:
                    cap = cv2.VideoCapture(url, cv2.CAP_FFMPEG)
            except (TypeError, cv2.error):
                logger.warning(f"[{self.camera_id}] OpenCV rejected RTSP timeout parameters; using backend defaults.")
                cap = cv2.VideoCapture(url, cv2.CAP_FFMPEG)
            if cap.isOpened():
                cap.set(cv2.CAP_PROP_BUFFERSIZE, 1)
                self.raw_source = url
                self.sanitized_source = sanitize_rtsp_url(url)
                logger.info(f"[{self.camera_id}] VideoCapture opened successfully on {self.sanitized_source}")
                return cap
            cap.release()

        logger.error(f"[{self.camera_id}] Failed to open VideoCapture for {self.sanitized_source}")
        return None

    def _capture_loop(self) -> None:
        """Continuous background capture loop with reconnection backoff."""
        reconnect_delay = self.initial_reconnect_delay

        while not self._stop_event.is_set():
            cap = None
            try:
                self._set_state(
                    ConnectionState.CONNECTING if self.reconnect_count == 0 else ConnectionState.RECONNECTING
                )
                cap = self._open_capture()

                if cap is None or not cap.isOpened():
                    raise RuntimeError("Unable to open camera stream.")

                # Probe initial frame
                ret, first_frame = cap.read()
                if not ret or first_frame is None:
                    raise RuntimeError("Failed to read initial frame from camera.")

                # Stream is operational
                h, w = first_frame.shape[:2]
                with self._frame_lock:
                    self._frame_width = w
                    self._frame_height = h
                    self._latest_frame = first_frame
                    self._latest_timestamp = time.time()
                    self._latest_frame_idx += 1

                self.total_frames_received += 1
                self.last_successful_read_time = time.time()
                self.consecutive_read_failures = 0
                reconnect_delay = self.initial_reconnect_delay
                self._set_state(ConnectionState.CONNECTED)
                logger.info(f"[{self.camera_id}] Stream connected ({w}x{h}).")

                # Frame acquisition loop
                while not self._stop_event.is_set():
                    ret, frame = cap.read()

                    now = time.time()
                    time_since_last = now - self.last_successful_read_time
                    if time_since_last > self.read_timeout:
                        logger.warning(
                            f"[{self.camera_id}] Frame read timeout ({time_since_last:.1f}s > {self.read_timeout}s)."
                        )
                        break

                    if not ret or frame is None:
                        self.consecutive_read_failures += 1
                        time.sleep(0.01)
                        continue

                    # Successful read
                    self.consecutive_read_failures = 0
                    self.last_successful_read_time = now
                    self.total_frames_received += 1

                    with self._frame_lock:
                        self._latest_frame = frame
                        self._latest_timestamp = now
                        self._latest_frame_idx += 1
                        self._frame_width = frame.shape[1]
                        self._frame_height = frame.shape[0]

            except Exception as exc:
                err_text = f"Connection error: {str(exc)}"
                logger.error(f"[{self.camera_id}] {err_text}")
                self._set_state(ConnectionState.ERROR, error_msg=err_text)

            finally:
                if cap is not None:
                    try:
                        cap.release()
                    except Exception:
                        pass
                if not self._stop_event.is_set():
                    with self._frame_lock:
                        self._latest_frame = None
                        self._latest_timestamp = 0.0
                        self._frame_width = 0
                        self._frame_height = 0
                logger.info(f"[{self.camera_id}] VideoCapture released.")

            if self._stop_event.is_set():
                break

            if not self.reconnect_enabled:
                logger.info(f"[{self.camera_id}] Reconnection disabled, worker stopping.")
                break

            # Reconnection backoff wait
            self.reconnect_count += 1
            self._set_state(
                ConnectionState.RECONNECTING,
                error_msg=f"Reconnecting attempt #{self.reconnect_count} in {reconnect_delay:.1f}s...",
            )
            logger.info(
                f"[{self.camera_id}] Reconnecting in {reconnect_delay:.1f}s (Attempt #{self.reconnect_count})..."
            )

            # Wait in small intervals so stop() can exit promptly
            elapsed = 0.0
            step = 0.05
            while elapsed < reconnect_delay and not self._stop_event.is_set():
                time.sleep(step)
                elapsed += step

            reconnect_delay = min(reconnect_delay * self.backoff_factor, self.max_reconnect_delay)

        self._set_state(ConnectionState.STOPPED)
