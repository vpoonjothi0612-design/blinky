"""Vehicle Event Manager.

Orchestrates line crossing detection and event persistence:
VehicleLineCounter -> VehicleEvent -> VehicleEventStore
"""

from __future__ import annotations

from pathlib import Path
from typing import Dict, List, Optional, Any

import cv2
import numpy as np

from .vehicle_event import VehicleEvent
from .line_counter import VehicleLineCounter
from .event_store import VehicleEventStore


class VehicleEventManager:
    """High-level coordinator bridging real-time tracking, line crossing, and event storage."""

    def __init__(
        self,
        line_counter: Optional[VehicleLineCounter] = None,
        event_store: Optional[VehicleEventStore] = None,
    ) -> None:
        """Initializes the event manager.

        Args:
            line_counter: VehicleLineCounter instance. Defaults to default line settings.
            event_store: VehicleEventStore instance. Defaults to data/vehicle/events/vehicle_events.json.
        """
        self.line_counter = line_counter or VehicleLineCounter()
        self.event_store = event_store or VehicleEventStore()

    def reset(self) -> None:
        """Resets the line counter and internal state (keeps stored events intact)."""
        self.line_counter.reset()

    def process_tracks(
        self,
        tracks: List[Any],
        frame_idx: int,
    ) -> List[VehicleEvent]:
        """Processes active vehicle tracks, detects line crossings, and persists confirmed events.

        Args:
            tracks: List of active VehicleTrack objects.
            frame_idx: Current frame index.

        Returns:
            List of newly persisted VehicleEvent instances in this frame.
        """
        raw_events = self.line_counter.update_tracks(tracks, frame_idx=frame_idx)
        persisted_events: List[VehicleEvent] = []

        for ev in raw_events:
            success = self.event_store.add_event(ev)
            if success:
                persisted_events.append(ev)

        return persisted_events

    def draw(self, frame: np.ndarray, tracks: Optional[List[Any]] = None) -> np.ndarray:
        """Renders virtual counting line, track statuses, and summary counters on the frame."""
        return self.line_counter.draw(frame, tracks=tracks)

    @property
    def total_entries(self) -> int:
        """Returns total entries recorded in this session."""
        return self.line_counter.total_entries

    @property
    def total_exits(self) -> int:
        """Returns total exits recorded in this session."""
        return self.line_counter.total_exits

    def get_daily_summary(self, date_str: Optional[str] = None) -> Dict[str, Any]:
        """Retrieves daily aggregated statistics from the event store."""
        return self.event_store.get_daily_summary(date_str)
