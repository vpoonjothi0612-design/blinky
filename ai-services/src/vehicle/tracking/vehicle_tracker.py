"""Vehicle Tracking & Counting Module using YOLO11n ByteTrack.

Maintains:
- Unique vehicle track IDs across consecutive frames
- Vehicle classification per track
- Bounding box and confidence
- First and last seen frames
- Motion trail history
- Real-time visible and cumulative unique vehicle counting
"""

from __future__ import annotations

import time
from collections import deque
from dataclasses import dataclass, field
from pathlib import Path
from typing import Dict, List, Optional, Set, Tuple, Any

import cv2
import numpy as np

from ..detection.vehicle_classes import TARGET_VEHICLE_NAMES
from ..detection.yolo_detector import YOLOVehicleDetector, CLASS_COLORS, DEFAULT_COLOR


@dataclass
class VehicleTrack:
    """Represents a tracked vehicle entity over time."""

    track_id: int
    class_id: int
    class_name: str
    bbox: Tuple[int, int, int, int]  # (x1, y1, x2, y2)
    confidence: float
    first_seen_frame: int
    last_seen_frame: int
    centroid_history: deque = field(default_factory=lambda: deque(maxlen=40))

    @property
    def centroid(self) -> Tuple[int, int]:
        x1, y1, x2, y2 = self.bbox
        return int((x1 + x2) / 2), int((y1 + y2) / 2)


class VehicleTracker:
    """Production Multi-Vehicle Tracker & Counter."""

    def __init__(
        self,
        detector: YOLOVehicleDetector,
        tracker_type: str = "bytetrack.yaml",
        max_lost_frames: int = 30,
    ) -> None:
        """Initializes the vehicle tracker.

        Args:
            detector: Pre-initialized YOLOVehicleDetector.
            tracker_type: Ultralytics tracker config ('bytetrack.yaml' or 'botsort.yaml').
            max_lost_frames: Number of frames before a lost track is purged from active tracks.
        """
        self.detector = detector
        self.tracker_type = tracker_type
        self.max_lost_frames = max_lost_frames

        self.active_tracks: Dict[int, VehicleTrack] = {}
        self.seen_track_ids: Set[int] = set()
        self._fallback_id_counter: int = 1000  # Fallback if tracker misses ID

    def reset(self) -> None:
        """Resets tracker state and model predictor trackers."""
        self.active_tracks.clear()
        self.seen_track_ids.clear()
        if hasattr(self.detector.model, "predictor") and self.detector.model.predictor is not None:
            if hasattr(self.detector.model.predictor, "trackers") and self.detector.model.predictor.trackers:
                for trk in self.detector.model.predictor.trackers:
                    try:
                        trk.reset()
                    except Exception:
                        pass

    def update(
        self,
        frame: np.ndarray,
        frame_idx: int,
        conf_threshold: Optional[float] = None,
    ) -> Tuple[List[VehicleTrack], float]:
        """Processes a frame, updates tracks, and returns currently visible vehicle tracks.

        Args:
            frame: OpenCV BGR image (H, W, 3).
            frame_idx: Current 1-indexed or 0-indexed frame counter.
            conf_threshold: Optional confidence threshold.

        Returns:
            Tuple of (currently visible VehicleTrack list, inference_ms).
        """
        if frame is None or frame.size == 0:
            return [], 0.0

        conf = conf_threshold if conf_threshold is not None else self.detector.conf_threshold

        t0 = time.perf_counter()
        results = self.detector.model.track(
            source=frame,
            persist=True,
            tracker=self.tracker_type,
            classes=self.detector.vehicle_class_ids,
            conf=conf,
            device=self.detector.device,
            verbose=False,
        )
        inference_ms = (time.perf_counter() - t0) * 1000.0

        current_frame_tracks: List[VehicleTrack] = []
        updated_track_ids: Set[int] = set()

        if results and len(results) > 0:
            boxes = results[0].boxes
            if boxes is not None and len(boxes) > 0:
                xyxy = boxes.xyxy.cpu().numpy()
                confs = boxes.conf.cpu().numpy()
                cls_ids = boxes.cls.cpu().numpy().astype(int)
                track_ids = (
                    boxes.id.cpu().numpy().astype(int)
                    if boxes.id is not None
                    else None
                )

                if track_ids is not None:
                    for idx, (box, score, cid) in enumerate(zip(xyxy, confs, cls_ids)):
                        if idx >= len(track_ids):
                            continue
                        tid = int(track_ids[idx])
                        class_name = self.detector.vehicle_map.get(cid, "vehicle")
                        x1, y1, x2, y2 = map(int, box)
                        bbox = (x1, y1, x2, y2)

                        updated_track_ids.add(tid)
                        self.seen_track_ids.add(tid)

                        if tid in self.active_tracks:
                            track = self.active_tracks[tid]
                            track.bbox = bbox
                            track.confidence = float(score)
                            track.class_id = int(cid)
                            track.class_name = class_name
                            track.last_seen_frame = frame_idx
                            track.centroid_history.append(track.centroid)
                        else:
                            track = VehicleTrack(
                                track_id=tid,
                                class_id=int(cid),
                                class_name=class_name,
                                bbox=bbox,
                                confidence=float(score),
                                first_seen_frame=frame_idx,
                                last_seen_frame=frame_idx,
                            )
                            track.centroid_history.append(track.centroid)
                            self.active_tracks[tid] = track

                        current_frame_tracks.append(track)

        # Purge dead tracks that exceeded max_lost_frames
        dead_ids = [
            tid
            for tid, trk in self.active_tracks.items()
            if (frame_idx - trk.last_seen_frame) > self.max_lost_frames
        ]
        for tid in dead_ids:
            del self.active_tracks[tid]

        return current_frame_tracks, inference_ms

    def _assign_fallback_id(self, bbox: Tuple[int, int, int, int], frame_idx: int) -> int:
        """IoU-based fallback association when tracker returns no ID on first appearance."""
        cx, cy = int((bbox[0] + bbox[2]) / 2), int((bbox[1] + bbox[3]) / 2)
        best_id = None
        min_dist = 60.0

        for tid, trk in self.active_tracks.items():
            if (frame_idx - trk.last_seen_frame) <= 3:
                tcx, tcy = trk.centroid
                dist = np.hypot(cx - tcx, cy - tcy)
                if dist < min_dist:
                    min_dist = dist
                    best_id = tid

        if best_id is not None:
            return best_id

        self._fallback_id_counter += 1
        return self._fallback_id_counter

    @property
    def total_unique_vehicles(self) -> int:
        """Returns the total number of distinct vehicle tracks observed."""
        return len(self.seen_track_ids)

    @property
    def currently_visible_count(self) -> int:
        """Returns the number of vehicles currently tracked in the latest frame."""
        return len(self.active_tracks)

    def draw_tracks(
        self,
        frame: np.ndarray,
        tracks: List[VehicleTrack],
        fps: Optional[float] = None,
        latency_ms: Optional[float] = None,
        show_trails: bool = True,
    ) -> np.ndarray:
        """Renders bounding boxes, track IDs, motion trails, and diagnostic HUD on a copy of the frame."""
        annotated = frame.copy()
        h, w = annotated.shape[:2]

        # Draw motion trails
        if show_trails:
            for trk in tracks:
                pts = list(trk.centroid_history)
                color = CLASS_COLORS.get(trk.class_name, DEFAULT_COLOR)
                for i in range(1, len(pts)):
                    alpha = i / float(len(pts))
                    thickness = max(1, int(3 * alpha))
                    cv2.line(annotated, pts[i - 1], pts[i], color, thickness)

        # Draw bounding boxes and headers
        for trk in tracks:
            x1, y1, x2, y2 = trk.bbox
            color = CLASS_COLORS.get(trk.class_name, DEFAULT_COLOR)
            cv2.rectangle(annotated, (x1, y1), (x2, y2), color, 2)

            # Label: Vehicle #ID | CLASS CONF
            label = f"Vehicle #{trk.track_id} | {trk.class_name.upper()} {trk.confidence:.2f}"
            (tw, th), baseline = cv2.getTextSize(label, cv2.FONT_HERSHEY_SIMPLEX, 0.55, 1)
            y_label = max(y1 - 6, th + 4)
            cv2.rectangle(
                annotated,
                (x1, y_label - th - 4),
                (x1 + tw + 6, y_label + baseline),
                color,
                -1,
            )
            cv2.putText(
                annotated,
                label,
                (x1 + 3, y_label - 2),
                cv2.FONT_HERSHEY_SIMPLEX,
                0.55,
                (0, 0, 0),
                1,
                cv2.LINE_AA,
            )

        # Diagnostic HUD Banner
        hud_bg = np.zeros((70, w, 3), dtype=np.uint8)
        alpha = 0.65
        annotated[0:70, 0:w] = cv2.addWeighted(annotated[0:70, 0:w], 1 - alpha, hud_bg, alpha, 0)

        line1 = f"Vehicles Visible: {len(tracks)} | Unique Seen: {self.total_unique_vehicles}"
        perf_parts = []
        if fps is not None:
            perf_parts.append(f"FPS: {fps:.1f}")
        if latency_ms is not None:
            perf_parts.append(f"Inference: {latency_ms:.1f}ms")
        line2 = " | ".join(perf_parts) if perf_parts else "YOLO11n Vehicle Tracking"

        cv2.putText(annotated, line1, (15, 28), cv2.FONT_HERSHEY_SIMPLEX, 0.75, (0, 255, 255), 2, cv2.LINE_AA)
        cv2.putText(annotated, line2, (15, 56), cv2.FONT_HERSHEY_SIMPLEX, 0.55, (200, 200, 200), 1, cv2.LINE_AA)

        return annotated
