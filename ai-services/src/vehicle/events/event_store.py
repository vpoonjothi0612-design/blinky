"""Local JSON-Based Vehicle Event Store.

Provides persistent, atomic storage for vehicle entry/exit events.
Features:
- Atomic, crash-resilient JSON writing using temporary file replacement
- Fast in-memory index with file-backed persistence
- Strict duplicate event prevention (by event_id and track_id/direction)
- Query APIs: get_event, get_all_events, get_events_by_date, get_entries, get_exits, get_vehicle_type_events
- Daily aggregation summary calculation
"""

from __future__ import annotations

import json
import os
import threading
from datetime import datetime, timezone
from pathlib import Path
from typing import Dict, List, Optional, Set, Tuple, Any

from .vehicle_event import VehicleEvent

DEFAULT_STORE_DIR = (
    Path(__file__).resolve().parents[3]
    / "data"
    / "vehicle"
    / "events"
)
DEFAULT_STORE_PATH = DEFAULT_STORE_DIR / "vehicle_events.json"


class VehicleEventStore:
    """Atomic file-backed JSON event store for vehicle tracking events."""

    def __init__(self, storage_path: Optional[Path | str] = None) -> None:
        """Initializes the event store.

        Args:
            storage_path: Path to the JSON file. Defaults to data/vehicle/events/vehicle_events.json.
        """
        self.storage_path = Path(storage_path) if storage_path else DEFAULT_STORE_PATH
        self.storage_path.parent.mkdir(parents=True, exist_ok=True)

        self._lock = threading.Lock()
        self._events: List[Dict[str, Any]] = []
        self._seen_event_ids: Set[str] = set()
        self._seen_track_signatures: Set[Tuple[int, str, str]] = set()  # (track_id, direction, date)

        self._load_from_disk()

    def _load_from_disk(self) -> None:
        """Loads existing events from disk into memory."""
        with self._lock:
            self._events.clear()
            self._seen_event_ids.clear()
            self._seen_track_signatures.clear()

            if not self.storage_path.exists():
                return

            try:
                with open(self.storage_path, "r", encoding="utf-8") as f:
                    data = json.load(f)

                if isinstance(data, list):
                    for item in data:
                        if isinstance(item, dict) and "event_id" in item:
                            self._events.append(item)
                            self._seen_event_ids.add(item["event_id"])

                            # Record signature to prevent duplicate crossings
                            tid = item.get("track_id")
                            direction = item.get("direction")
                            ts = item.get("timestamp", "")
                            date_part = ts[:10] if len(ts) >= 10 else ""
                            if tid is not None and direction and date_part:
                                self._seen_track_signatures.add((int(tid), str(direction), date_part))
            except Exception as e:
                print(f"[Warning] VehicleEventStore: Failed to read {self.storage_path}: {e}")

    def _atomic_save(self) -> None:
        """Writes in-memory events to a temporary file and atomically replaces destination."""
        temp_path = self.storage_path.with_name(f"{self.storage_path.name}.tmp")

        try:
            with open(temp_path, "w", encoding="utf-8") as f:
                json.dump(self._events, f, indent=2, ensure_ascii=False)
                f.flush()
                os.fsync(f.fileno())

            # Atomic swap on filesystem
            os.replace(temp_path, self.storage_path)
        except Exception as e:
            if temp_path.exists():
                try:
                    temp_path.unlink()
                except OSError:
                    pass
            raise IOError(f"VehicleEventStore: Atomic save failed: {e}") from e

    def add_event(self, event: VehicleEvent | Dict[str, Any]) -> bool:
        """Adds a vehicle event to the store if it is not a duplicate.

        Args:
            event: VehicleEvent instance or event dictionary.

        Returns:
            True if event was saved, False if rejected as duplicate or invalid.
        """
        if isinstance(event, VehicleEvent):
            event_dict = event.to_dict()
        elif isinstance(event, dict):
            event_dict = dict(event)
        else:
            return False

        eid = event_dict.get("event_id")
        tid = event_dict.get("track_id")
        direction = event_dict.get("direction")
        ts = event_dict.get("timestamp")

        if not eid or tid is None or not direction or not ts:
            return False

        date_part = ts[:10] if len(ts) >= 10 else datetime.now(timezone.utc).strftime("%Y-%m-%d")
        sig = (int(tid), str(direction), date_part)

        with self._lock:
            # Check 1: Duplicate event_id
            if eid in self._seen_event_ids:
                return False

            # Check 2: Duplicate physical transit for same track_id + direction on same date
            if sig in self._seen_track_signatures:
                return False

            # Ensure bbox is a standard list
            if "bbox" in event_dict:
                event_dict["bbox"] = [int(v) for v in event_dict["bbox"]]

            # Standardize frame_index
            if "frame_index" not in event_dict and "frame_idx" in event_dict:
                event_dict["frame_index"] = int(event_dict.pop("frame_idx"))

            self._events.append(event_dict)
            self._seen_event_ids.add(eid)
            self._seen_track_signatures.add(sig)

            self._atomic_save()
            return True

    def get_event(self, event_id: str) -> Optional[Dict[str, Any]]:
        """Retrieves a single event by event_id."""
        with self._lock:
            for ev in self._events:
                if ev.get("event_id") == event_id:
                    return dict(ev)
        return None

    def get_all_events(self) -> List[Dict[str, Any]]:
        """Returns a copy of all stored events."""
        with self._lock:
            return [dict(ev) for ev in self._events]

    def get_events_by_date(self, date_str: str) -> List[Dict[str, Any]]:
        """Retrieves all events matching a specific UTC date (format 'YYYY-MM-DD')."""
        target = date_str.strip()[:10]
        with self._lock:
            return [
                dict(ev)
                for ev in self._events
                if ev.get("timestamp", "").startswith(target)
            ]

    def get_entries(self) -> List[Dict[str, Any]]:
        """Retrieves all ENTRY events."""
        with self._lock:
            return [
                dict(ev)
                for ev in self._events
                if ev.get("direction") == "ENTRY"
            ]

    def get_exits(self) -> List[Dict[str, Any]]:
        """Retrieves all EXIT events."""
        with self._lock:
            return [
                dict(ev)
                for ev in self._events
                if ev.get("direction") == "EXIT"
            ]

    def get_vehicle_type_events(self, vehicle_type: str) -> List[Dict[str, Any]]:
        """Retrieves all events matching a specific vehicle type ('car', 'motorcycle', etc.)."""
        target = vehicle_type.lower().strip()
        with self._lock:
            return [
                dict(ev)
                for ev in self._events
                if str(ev.get("vehicle_type", "")).lower() == target
            ]

    def get_daily_summary(self, date_str: Optional[str] = None) -> Dict[str, Any]:
        """Calculates daily statistics for a specified UTC date (defaults to today)."""
        target_date = (
            date_str.strip()[:10]
            if date_str
            else datetime.now(timezone.utc).strftime("%Y-%m-%d")
        )

        daily_events = self.get_events_by_date(target_date)

        total_entries = sum(1 for e in daily_events if e.get("direction") == "ENTRY")
        total_exits = sum(1 for e in daily_events if e.get("direction") == "EXIT")

        by_type: Dict[str, int] = {
            "car": 0,
            "motorcycle": 0,
            "bus": 0,
            "truck": 0,
        }

        for ev in daily_events:
            vtype = str(ev.get("vehicle_type", "")).lower()
            if vtype in by_type:
                by_type[vtype] += 1
            else:
                by_type[vtype] = by_type.get(vtype, 0) + 1

        return {
            "date": target_date,
            "total_entries": total_entries,
            "total_exits": total_exits,
            "total_events": len(daily_events),
            "by_vehicle_type": by_type,
        }

    def clear(self) -> None:
        """Clears all events in memory and resets disk file (for testing purposes)."""
        with self._lock:
            self._events.clear()
            self._seen_event_ids.clear()
            self._seen_track_signatures.clear()
            self._atomic_save()
