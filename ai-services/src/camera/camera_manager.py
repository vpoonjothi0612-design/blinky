"""Multi-Camera Ingestion Manager.

Orchestrates multiple independent CameraWorker instances (e.g. CAM-01 and CAM-02),
providing fault-isolated capture pipelines: if one camera disconnects, fails,
or reconnects, other cameras continue processing uninterrupted.
"""

from __future__ import annotations

import logging
from typing import Dict, List, Optional, Tuple, Any

import cv2
import numpy as np

try:
    from .camera_config import CameraConfig, get_available_camera_configs, get_camera_config
    from .camera_worker import CameraWorker, ConnectionState
except ImportError:
    try:
        from camera_config import CameraConfig, get_available_camera_configs, get_camera_config
        from camera_worker import CameraWorker, ConnectionState
    except ImportError:
        from src.camera.camera_config import CameraConfig, get_available_camera_configs, get_camera_config
        from src.camera.camera_worker import CameraWorker, ConnectionState

logger = logging.getLogger(__name__)


class MultiCameraManager:
    """Manages one or more independent CameraWorker instances.

    Ensures that failures in any individual camera stream do not impact
    other operational camera streams.
    """

    def __init__(self, camera_ids: Optional[List[str]] = None, auto_start: bool = False) -> None:
        """Initializes the multi-camera manager.

        Args:
            camera_ids: List of camera IDs to manage (e.g. ['CAM-01'], ['CAM-02'],
                        ['CAM-01', 'CAM-02']). If None, manages all configured cameras.
            auto_start: Whether to start capture workers immediately upon initialization.
        """
        self.workers: Dict[str, CameraWorker] = {}
        all_configs = get_available_camera_configs()

        if camera_ids is None or "all" in [c.lower() for c in camera_ids] or "both" in [c.lower() for c in camera_ids]:
            target_ids = list(all_configs.keys())
        else:
            target_ids = []
            for cid in camera_ids:
                normalized = cid.strip().upper()
                if normalized in ("1", "CAM-1", "CAM01"):
                    normalized = "CAM-01"
                elif normalized in ("2", "CAM-2", "CAM02"):
                    normalized = "CAM-02"
                target_ids.append(normalized)

        for cid in target_ids:
            if cid in all_configs:
                self.workers[cid] = CameraWorker(config=all_configs[cid], auto_start=auto_start)
            else:
                logger.warning(f"Camera ID '{cid}' is not defined in configuration.")

    def start_all(self) -> None:
        """Starts capture workers for all managed cameras."""
        for cid, worker in self.workers.items():
            if not worker.is_running():
                worker.start()

    def stop_all(self, timeout: float = 3.0) -> None:
        """Stops all camera capture workers cleanly."""
        for cid, worker in self.workers.items():
            worker.stop(timeout=timeout)

    def get_worker(self, camera_id: str) -> Optional[CameraWorker]:
        """Gets worker instance for a specific camera ID."""
        normalized = camera_id.strip().upper()
        if normalized in ("1", "CAM-1", "CAM01"):
            normalized = "CAM-01"
        elif normalized in ("2", "CAM-2", "CAM02"):
            normalized = "CAM-02"
        return self.workers.get(normalized)

    def get_latest_frames(self) -> Dict[str, Tuple[bool, Optional[np.ndarray], float, int]]:
        """Gathers latest available frame from each managed camera.

        Returns:
            Dictionary mapping camera_id to:
            (has_frame: bool, frame: Optional[np.ndarray], timestamp: float, frame_idx: int)
        """
        results: Dict[str, Tuple[bool, Optional[np.ndarray], float, int]] = {}
        for cid, worker in self.workers.items():
            results[cid] = worker.get_latest_frame()
        return results

    def get_operational_cameras(self) -> List[str]:
        """Returns list of camera IDs currently connected and receiving frames."""
        return [cid for cid, worker in self.workers.items() if worker.is_connected()]

    def get_health_status(self) -> Dict[str, Any]:
        """Returns comprehensive diagnostic summary for all managed cameras."""
        return {
            "total_cameras": len(self.workers),
            "operational_count": len(self.get_operational_cameras()),
            "cameras": {cid: worker.get_status() for cid, worker in self.workers.items()},
        }
