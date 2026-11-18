"""Virtual Line Vehicle Counter & Direction Analyzer.

Detects vehicle entry and exit events across a configurable virtual line:
1. Calculates vehicle centroid per frame.
2. Tracks previous centroid per Track ID.
3. Detects line-segment intersection using 2D geometric orientation.
4. Determines ENTRY vs EXIT based on relative crossing direction.
5. Strictly prevents duplicate events per Track ID.
6. Records structured VehicleEvent records and maintains cumulative totals.
"""

from __future__ import annotations

from typing import Dict, List, Optional, Set, Tuple, Any

import cv2
import numpy as np

from .vehicle_event import VehicleEvent, DirectionType


def _ccw(a: Tuple[float, float], b: Tuple[float, float], c: Tuple[float, float]) -> float:
    """Computes cross product / orientation test for points a, b, c."""
    return (b[0] - a[0]) * (c[1] - a[1]) - (b[1] - a[1]) * (c[0] - a[0])


def _segments_intersect(
    p1: Tuple[float, float],
    p2: Tuple[float, float],
    q1: Tuple[float, float],
    q2: Tuple[float, float],
) -> bool:
    """Checks whether line segment (p1, p2) intersects segment (q1, q2)."""
    d1 = _ccw(p1, p2, q1)
    d2 = _ccw(p1, p2, q2)
    d3 = _ccw(q1, q2, p1)
    d4 = _ccw(q1, q2, p2)

    # Segments intersect if endpoints lie on opposite sides or touch
    if (d1 * d2 <= 0) and (d3 * d4 <= 0):
        # Bounding box overlap guard
        if (
            max(min(p1[0], p2[0]), min(q1[0], q2[0])) <= min(max(p1[0], p2[0]), max(q1[0], q2[0]))
            and max(min(p1[1], p2[1]), min(q1[1], q2[1])) <= min(max(p1[1], p2[1]), max(q1[1], q2[1]))
        ):
            return True

    return False


class VehicleLineCounter:
    """Virtual line counter for vehicle entry and exit monitoring."""

    def __init__(
        self,
        line_start: Tuple[int, int] = (100, 240),
        line_end: Tuple[int, int] = (540, 240),
        entry_from_side: str = "negative_to_positive",
        allowed_classes: Optional[List[str]] = None,
    ) -> None:
        """Initializes the line counter.

        Args:
            line_start: (x, y) coordinates of virtual line start.
            line_end: (x, y) coordinates of virtual line end.
            entry_from_side: 'negative_to_positive' or 'positive_to_negative'.
                For horizontal lines (left to right): negative side is top, positive is bottom.
                Moving top -> bottom (negative -> positive) is ENTRY by default.
            allowed_classes: List of vehicle class names to monitor (defaults to car, motorcycle, bus, truck).
        """
        self.line_start = (int(line_start[0]), int(line_start[1]))
        self.line_end = (int(line_end[0]), int(line_end[1]))
        self.entry_from_side = entry_from_side

        self.allowed_classes: Set[str] = set(
            allowed_classes or ["car", "motorcycle", "bus", "truck"]
        )

        # State tracking
        self.prev_centroids: Dict[int, Tuple[int, int]] = {}
        self.crossed_track_ids: Dict[int, str] = {}  # track_id -> direction ("ENTRY" or "EXIT")
        self.events: List[VehicleEvent] = []

        self.total_entries: int = 0
        self.total_exits: int = 0

    def reset(self) -> None:
        """Resets the counter state."""
        self.prev_centroids.clear()
        self.crossed_track_ids.clear()
        self.events.clear()
        self.total_entries = 0
        self.total_exits = 0

    def _signed_distance(self, pt: Tuple[float, float]) -> float:
        """Computes signed cross product from line vector to point."""
        return _ccw(self.line_start, self.line_end, pt)

    def check_crossing(
        self,
        track_id: int,
        vehicle_type: str,
        current_centroid: Tuple[int, int],
        confidence: float,
        bbox: Tuple[int, int, int, int],
        frame_idx: int,
        view_angle: object = "UNKNOWN",
        view_angle_confidence: object = None,
        angle_images: object = None,
    ) -> DirectionType:
        """Checks if a vehicle track crossed the line between the previous and current frame.

        Args:
            track_id: Unique integer ID of the vehicle.
            vehicle_type: Class name (e.g. 'car', 'motorcycle', etc.).
            current_centroid: (cx, cy) center point of vehicle.
            confidence: Detection confidence.
            bbox: (x1, y1, x2, y2) bounding box.
            frame_idx: Current frame index.

        Returns:
            "ENTRY", "EXIT", or "NONE".
        """
        vtype = vehicle_type.lower().strip()
        if vtype not in self.allowed_classes:
            return "NONE"

        prev_pt = self.prev_centroids.get(track_id)
        self.prev_centroids[track_id] = current_centroid

        # If this is the first frame vehicle is seen, we cannot detect crossing yet
        if prev_pt is None:
            return "NONE"

        # Requirement 4: Prevent duplicate events.
        # If this track ID has already crossed, do not trigger again!
        if track_id in self.crossed_track_ids:
            return "NONE"

        # Check line segment intersection
        curr_pt = current_centroid
        crossed = _segments_intersect(prev_pt, curr_pt, self.line_start, self.line_end)

        if not crossed:
            return "NONE"

        # Determine direction based on signed distance transition
        d_prev = self._signed_distance(prev_pt)
        d_curr = self._signed_distance(curr_pt)

        # Both cannot be strictly on the same side
        if (d_prev < 0 and d_curr < 0) or (d_prev > 0 and d_curr > 0):
            return "NONE"

        direction: DirectionType = "NONE"
        if self.entry_from_side == "negative_to_positive":
            if d_prev < 0 and d_curr >= 0:
                direction = "ENTRY"
            elif d_prev > 0 and d_curr <= 0:
                direction = "EXIT"
        else:
            if d_prev > 0 and d_curr <= 0:
                direction = "ENTRY"
            elif d_prev < 0 and d_curr >= 0:
                direction = "EXIT"

        if direction in ("ENTRY", "EXIT"):
            # Record event
            event = VehicleEvent.create(
                track_id=track_id,
                vehicle_type=vtype,
                direction=direction,
                confidence=confidence,
                bbox=bbox,
                frame_idx=frame_idx,
                view_angle=view_angle,
                view_angle_confidence=view_angle_confidence,
                angle_images=angle_images,
            )
            self.crossed_track_ids[track_id] = direction
            self.events.append(event)

            if direction == "ENTRY":
                self.total_entries += 1
            else:
                self.total_exits += 1

            event.print_log()
            return direction

        return "NONE"

    def update_tracks(
        self,
        tracks: List[Any],
        frame_idx: int,
    ) -> List[VehicleEvent]:
        """Processes all active tracks in the current frame and returns newly triggered events."""
        new_events: List[VehicleEvent] = []

        for trk in tracks:
            # trk is expected to have: track_id, class_name, centroid, confidence, bbox
            tid = trk.track_id
            cname = trk.class_name
            centroid = trk.centroid
            conf = trk.confidence
            bbox = trk.bbox
            angle_captures = getattr(trk, "best_angle_images", None)
            angle_images = angle_captures.paths() if angle_captures is not None else {}

            direction = self.check_crossing(
                track_id=tid,
                vehicle_type=cname,
                current_centroid=centroid,
                confidence=conf,
                bbox=bbox,
                frame_idx=frame_idx,
                view_angle=getattr(trk, "view_angle", "UNKNOWN"),
                view_angle_confidence=getattr(trk, "view_angle_confidence", None),
                angle_images=angle_images,
            )
            if direction != "NONE":
                new_events.append(self.events[-1])

        return new_events

    def draw(
        self,
        frame: np.ndarray,
        tracks: Optional[List[Any]] = None,
    ) -> np.ndarray:
        """Renders the virtual counting line and vehicle status annotations on the frame."""
        annotated = frame.copy()
        h, w = annotated.shape[:2]

        # Draw virtual counting line (Cyan line with endpoints)
        cv2.line(annotated, self.line_start, self.line_end, (255, 255, 0), 3, cv2.LINE_AA)
        cv2.circle(annotated, self.line_start, 6, (0, 0, 255), -1)
        cv2.circle(annotated, self.line_end, 6, (0, 0, 255), -1)

        # Line label
        mid_x = int((self.line_start[0] + self.line_end[0]) / 2)
        mid_y = int((self.line_start[1] + self.line_end[1]) / 2)
        cv2.putText(
            annotated,
            "COUNTING LINE (ENTRY v / EXIT ^)",
            (mid_x - 130, mid_y - 10),
            cv2.FONT_HERSHEY_SIMPLEX,
            0.50,
            (255, 255, 0),
            1,
            cv2.LINE_AA,
        )

        # Vehicle Status on each track
        if tracks:
            for trk in tracks:
                direction_status = self.crossed_track_ids.get(trk.track_id)
                if direction_status:
                    x1, y1, x2, y2 = trk.bbox
                    status_text = f"Track ID: {trk.track_id} | {trk.class_name.capitalize()} | {direction_status}"
                    color = (0, 255, 0) if direction_status == "ENTRY" else (0, 165, 255)

                    cv2.putText(
                        annotated,
                        status_text,
                        (x1, y2 + 18),
                        cv2.FONT_HERSHEY_SIMPLEX,
                        0.55,
                        color,
                        2,
                        cv2.LINE_AA,
                    )

        # Counting HUD Banner
        hud_h = 36
        overlay = annotated.copy()
        cv2.rectangle(overlay, (w - 280, 10), (w - 10, 10 + hud_h), (20, 20, 20), -1)
        cv2.addWeighted(overlay, 0.7, annotated, 0.3, 0, annotated)

        hud_text = f"ENTRY: {self.total_entries} | EXIT: {self.total_exits}"
        cv2.putText(
            annotated,
            hud_text,
            (w - 265, 34),
            cv2.FONT_HERSHEY_SIMPLEX,
            0.65,
            (0, 255, 255),
            2,
            cv2.LINE_AA,
        )

        return annotated
