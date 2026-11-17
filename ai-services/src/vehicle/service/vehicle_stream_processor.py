"""Vehicle Stream Processor Module.

Decouples high-rate camera capture from lower-rate AI inference:
CameraWorker (25-30 FPS)
     ↓
Latest-Frame Buffer
     ↓
VehicleStreamProcessor (Target: 5 FPS)
     ↓
YOLO11n Vehicle Detector
     ↓
ByteTrack Vehicle Tracker
     ↓
Virtual Line Counter
     ↓
Vehicle Event Manager
     ↓
Vehicle Event Store
"""

from __future__ import annotations

import logging
import threading
import time
from dataclasses import dataclass, field
from pathlib import Path
from typing import Callable, Dict, List, Optional, Tuple, Any

import cv2
import numpy as np

from ..camera.camera_worker import CameraWorker
from ..detection.yolo_detector import YOLOVehicleDetector, DEFAULT_MODEL_PATH
from ..tracking.vehicle_tracker import VehicleTracker, VehicleTrack
from ..events.line_counter import VehicleLineCounter
from ..events.event_manager import VehicleEventManager
from ..events.event_store import VehicleEventStore
from ..events.vehicle_event import VehicleEvent
from ..vehicle_config import (
    VEHICLE_PROCESSING_FPS,
    DEFAULT_CONF_THRESHOLD,
    DEFAULT_DEVICE,
    DEFAULT_TRACKER_TYPE,
    DEFAULT_MAX_LOST_FRAMES,
    DEFAULT_LINE_START,
    DEFAULT_LINE_END,
    DEFAULT_ENTRY_SIDE,
)

logger = logging.getLogger(__name__)


@dataclass
class ProcessingStatistics:
    """Runtime diagnostics and throughput telemetry for the vehicle pipeline."""

    captured_frames: int = 0
    processed_frames: int = 0
    dropped_frames: int = 0
    generated_events: int = 0
    capture_fps: float = 0.0
    processing_fps: float = 0.0
    latest_frame_age_ms: float = 0.0
    processing_latency_ms: float = 0.0
    worker_running: bool = False
    processor_running: bool = False

    def to_dict(self) -> Dict[str, Any]:
        """Serializes statistics to standard dictionary."""
        return {
            "captured_frames": self.captured_frames,
            "processed_frames": self.processed_frames,
            "dropped_frames": self.dropped_frames,
            "generated_events": self.generated_events,
            "capture_fps": round(self.capture_fps, 2),
            "processing_fps": round(self.processing_fps, 2),
            "latest_frame_age_ms": round(self.latest_frame_age_ms, 2),
            "processing_latency_ms": round(self.processing_latency_ms, 2),
            "worker_running": self.worker_running,
            "processor_running": self.processor_running,
        }


class VehicleStreamProcessor:
    """Orchestrates asynchronous vehicle video processing pipeline."""

    def __init__(
        self,
        camera_worker: CameraWorker,
        detector: Optional[YOLOVehicleDetector] = None,
        tracker: Optional[VehicleTracker] = None,
        line_counter: Optional[VehicleLineCounter] = None,
        event_store: Optional[VehicleEventStore] = None,
        event_manager: Optional[VehicleEventManager] = None,
        processing_fps: float = VEHICLE_PROCESSING_FPS,
        conf_threshold: float = DEFAULT_CONF_THRESHOLD,
        on_event: Optional[Callable[[VehicleEvent], None]] = None,
        on_frame: Optional[Callable[[Dict[str, Any]], None]] = None,
        name: str = "VehicleStreamProcessor",
    ) -> None:
        """Initializes the vehicle stream processor.

        Args:
            camera_worker: Active CameraWorker frame provider.
            detector: YOLOVehicleDetector instance (initialized if None).
            tracker: VehicleTracker instance (initialized if None).
            line_counter: VehicleLineCounter instance.
            event_store: VehicleEventStore instance.
            event_manager: VehicleEventManager instance (bridges line_counter & event_store).
            processing_fps: Target AI processing rate limit (default: 5.0 FPS).
            conf_threshold: Detection confidence threshold.
            on_event: Callback invoked on each newly persisted VehicleEvent.
            on_frame: Callback invoked on each processed frame with diagnostic payload.
            name: Human-readable processor identifier.
        """
        self.camera_worker = camera_worker
        self.processing_fps = float(processing_fps) if processing_fps else 0.0
        self.conf_threshold = conf_threshold
        self.on_event = on_event
        self.on_frame = on_frame
        self.name = name

        # 1. Initialize detector if not provided
        self.detector = detector or YOLOVehicleDetector(
            model_path=DEFAULT_MODEL_PATH,
            conf_threshold=self.conf_threshold,
            device=DEFAULT_DEVICE,
        )

        # 2. Initialize tracker if not provided
        self.tracker = tracker or VehicleTracker(
            detector=self.detector,
            tracker_type=DEFAULT_TRACKER_TYPE,
            max_lost_frames=DEFAULT_MAX_LOST_FRAMES,
        )

        # 3. Initialize line counter and event manager if not provided
        self.line_counter = line_counter or VehicleLineCounter(
            line_start=DEFAULT_LINE_START,
            line_end=DEFAULT_LINE_END,
            entry_from_side=DEFAULT_ENTRY_SIDE,
        )
        self.event_store = event_store or VehicleEventStore()
        self.event_manager = event_manager or VehicleEventManager(
            line_counter=self.line_counter,
            event_store=self.event_store,
        )

        # Threading state
        self._thread: Optional[threading.Thread] = None
        self._stop_event = threading.Event()
        self._lock = threading.Lock()

        # Telemetry & metrics state
        self._processed_frames: int = 0
        self._generated_events_count: int = 0
        self._latest_latency_ms: float = 0.0
        self._latest_frame_age_ms: float = 0.0

        # Processing FPS moving average
        self._last_fps_calc_time = time.perf_counter()
        self._last_fps_calc_count = 0
        self._estimated_processing_fps: float = 0.0

        # Last processed frame identifier to avoid processing identical frame twice
        self._last_processed_frame_idx: int = -1

    @property
    def is_running(self) -> bool:
        """Returns True if the background processing thread is active."""
        return self._thread is not None and self._thread.is_alive() and not self._stop_event.is_set()

    @property
    def statistics(self) -> ProcessingStatistics:
        """Returns snapshot of current pipeline performance statistics."""
        with self._lock:
            captured = self.camera_worker.captured_frames
            processed = self._processed_frames
            dropped = self.camera_worker.replaced_frames
            events_count = self._generated_events_count
            cap_fps = self.camera_worker.capture_fps
            proc_fps = self._estimated_processing_fps
            frame_age = self._latest_frame_age_ms
            latency = self._latest_latency_ms
            worker_alive = self.camera_worker.is_running
            processor_alive = self.is_running

        return ProcessingStatistics(
            captured_frames=captured,
            processed_frames=processed,
            dropped_frames=dropped,
            generated_events=events_count,
            capture_fps=cap_fps,
            processing_fps=proc_fps,
            latest_frame_age_ms=frame_age,
            processing_latency_ms=latency,
            worker_running=worker_alive,
            processor_running=processor_alive,
        )

    def process_next_frame(
        self,
        wait: bool = True,
        timeout: Optional[float] = 1.0,
    ) -> Optional[Dict[str, Any]]:
        """Pulls the latest frame from CameraWorker and runs detection, tracking, and event handling.

        Args:
            wait: Whether to wait for a new frame if currently empty.
            timeout: Maximum wait time in seconds.

        Returns:
            Dictionary containing processed results (tracks, events, latency, frame) or None.
        """
        frame_data = self.camera_worker.get_latest_frame(wait=wait, timeout=timeout)
        if frame_data is None:
            return None

        frame, frame_idx, frame_timestamp = frame_data

        # Skip if this identical frame was already processed
        if frame_idx == self._last_processed_frame_idx:
            return None

        t_proc_start = time.perf_counter()
        now = time.time()
        frame_age_ms = max(0.0, (now - frame_timestamp) * 1000.0)

        # 1. Update multi-object tracker
        tracks, inference_ms = self.tracker.update(
            frame=frame,
            frame_idx=frame_idx,
            conf_threshold=self.conf_threshold,
        )

        # 2. Check line crossing and persist new events
        new_events = self.event_manager.process_tracks(tracks=tracks, frame_idx=frame_idx)

        total_proc_ms = (time.perf_counter() - t_proc_start) * 1000.0

        # Update metrics
        with self._lock:
            self._processed_frames += 1
            self._last_processed_frame_idx = frame_idx
            self._latest_latency_ms = total_proc_ms
            self._latest_frame_age_ms = frame_age_ms
            self._generated_events_count += len(new_events)

            # Rolling processing FPS
            t_now = time.perf_counter()
            elapsed = t_now - self._last_fps_calc_time
            if elapsed >= 0.5:
                delta = self._processed_frames - self._last_fps_calc_count
                self._estimated_processing_fps = delta / elapsed
                self._last_fps_calc_time = t_now
                self._last_fps_calc_count = self._processed_frames

        # Trigger callbacks
        for ev in new_events:
            if self.on_event:
                try:
                    self.on_event(ev)
                except Exception as e:
                    logger.error(f"[{self.name}] Error in on_event callback: {e}")

        result_payload = {
            "frame": frame,
            "frame_idx": frame_idx,
            "timestamp": frame_timestamp,
            "tracks": tracks,
            "events": new_events,
            "inference_ms": inference_ms,
            "latency_ms": total_proc_ms,
            "frame_age_ms": frame_age_ms,
        }

        if self.on_frame:
            try:
                self.on_frame(result_payload)
            except Exception as e:
                logger.error(f"[{self.name}] Error in on_frame callback: {e}")

        return result_payload

    def start(self) -> None:
        """Starts the background stream processing thread."""
        if self.is_running:
            logger.warning(f"[{self.name}] Processor thread already running.")
            return

        # Ensure camera worker is running
        if not self.camera_worker.is_running:
            logger.info(f"[{self.name}] Starting camera worker dependency...")
            self.camera_worker.start()

        self._stop_event.clear()
        self._last_fps_calc_time = time.perf_counter()
        self._last_fps_calc_count = 0

        self._thread = threading.Thread(
            target=self._processing_loop,
            name=f"{self.name}-WorkerThread",
            daemon=True,
        )
        self._thread.start()
        logger.info(f"[{self.name}] Vehicle stream processor thread started.")

    def _processing_loop(self) -> None:
        """Continuous execution loop with rate-limiting to target processing_fps."""
        target_interval = (1.0 / self.processing_fps) if self.processing_fps > 0 else 0.0

        while not self._stop_event.is_set():
            t_cycle_start = time.perf_counter()

            # Check if camera stream has ended and no more frames exist
            if self.camera_worker.has_ended and self.camera_worker.get_latest_frame(wait=False) is None:
                logger.info(f"[{self.name}] Video stream ended; stopping processor loop.")
                break

            try:
                self.process_next_frame(wait=True, timeout=0.2)
            except Exception as e:
                logger.error(f"[{self.name}] Exception during frame processing: {e}", exc_info=True)

            # Enforce target processing FPS by sleeping remaining duration
            if target_interval > 0:
                cycle_duration = time.perf_counter() - t_cycle_start
                sleep_remainder = target_interval - cycle_duration
                if sleep_remainder > 0 and not self._stop_event.is_set():
                    time.sleep(sleep_remainder)

        logger.info(f"[{self.name}] Vehicle stream processor thread exiting.")

    def stop(self, timeout: float = 3.0, stop_camera: bool = True) -> None:
        """Gracefully halts the processor thread and optionally stops the camera worker.

        Args:
            timeout: Maximum wait time for thread join.
            stop_camera: If True, also terminates the underlying CameraWorker.
        """
        logger.info(f"[{self.name}] Stopping vehicle stream processor...")
        self._stop_event.set()

        if self._thread is not None and self._thread.is_alive():
            self._thread.join(timeout=timeout)
            if self._thread.is_alive():
                logger.warning(f"[{self.name}] Processor thread did not terminate within timeout.")
            self._thread = None

        if stop_camera and self.camera_worker.is_running:
            self.camera_worker.stop()

        logger.info(f"[{self.name}] Vehicle stream processor stopped cleanly.")

    def __enter__(self) -> VehicleStreamProcessor:
        if not self.is_running:
            self.start()
        return self

    def __exit__(self, exc_type: Any, exc_val: Any, exc_tb: Any) -> None:
        self.stop()
