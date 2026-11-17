"""Automated Test Suite for Vehicle Event Storage (Phase 6).

Validates all 9 test scenarios:
- Test A: Add one ENTRY event -> 1 event stored
- Test B: Add one EXIT event -> 2 events stored
- Test C: Duplicate event rejection -> Duplicate rejected, count unchanged
- Test D: Query today's events -> Correct events returned by date
- Test E: Query entries -> Only ENTRY events returned
- Test F: Query exits -> Only EXIT events returned
- Test G: Daily summary -> Correct totals and vehicle-type breakdown
- Test H: Event store reload / persistence -> Stored events survive re-initialization
- Test I: LineCounter + EventStore integration -> Single physical crossing = single stored event
"""

from __future__ import annotations

import json
import shutil
import sys
import time
from datetime import datetime, timezone
from pathlib import Path
from typing import Dict, List, Tuple, Any

import cv2
import numpy as np

PROJECT_ROOT = Path(__file__).resolve().parents[3]
sys.path.append(str(PROJECT_ROOT / "src"))

from vehicle.events.vehicle_event import VehicleEvent
from vehicle.events.line_counter import VehicleLineCounter
from vehicle.events.event_store import VehicleEventStore
from vehicle.events.event_manager import VehicleEventManager
from vehicle.tracking.vehicle_tracker import VehicleTrack

TEST_STORE_DIR = PROJECT_ROOT / "data" / "vehicle" / "events"
TEST_STORE_FILE = TEST_STORE_DIR / "test_vehicle_events.json"


class VehicleEventStoreTestSuite:
    def __init__(self):
        print("============================================================")
        print("VEHICLE EVENT STORAGE TEST SUITE (PHASE 6)")
        print("============================================================\n")
        TEST_STORE_DIR.mkdir(parents=True, exist_ok=True)
        if TEST_STORE_FILE.exists():
            TEST_STORE_FILE.unlink()

        self.store = VehicleEventStore(storage_path=TEST_STORE_FILE)
        self.results: Dict[str, Tuple[str, str]] = {}
        self.today_str = datetime.now(timezone.utc).strftime("%Y-%m-%d")

    def test_a_add_entry_event(self):
        print("------------------------------------------------------------")
        print("TEST A: Add Single ENTRY Event")
        print("------------------------------------------------------------")
        event = VehicleEvent.create(
            event_id="evt_test_001",
            track_id=1,
            vehicle_type="car",
            direction="ENTRY",
            confidence=0.92,
            bbox=(120, 100, 240, 220),
            frame_index=11,
            timestamp=f"{self.today_str}T10:00:00.000000Z",
        )
        saved = self.store.add_event(event)
        all_events = self.store.get_all_events()

        print(f"  Event Added: {saved}")
        print(f"  Total Stored Events: {len(all_events)}")
        assert saved is True, "Failed to save valid ENTRY event"
        assert len(all_events) == 1, f"Expected 1 event, got {len(all_events)}"
        assert all_events[0]["event_id"] == "evt_test_001"
        assert all_events[0]["direction"] == "ENTRY"

        self.results["TEST A (Add Entry Event)"] = ("PASS", "Single ENTRY event successfully added and validated")
        print("  Result: PASS\n")

    def test_b_add_exit_event(self):
        print("------------------------------------------------------------")
        print("TEST B: Add Single EXIT Event")
        print("------------------------------------------------------------")
        event = VehicleEvent.create(
            event_id="evt_test_002",
            track_id=2,
            vehicle_type="motorcycle",
            direction="EXIT",
            confidence=0.88,
            bbox=(350, 260, 420, 340),
            frame_index=21,
            timestamp=f"{self.today_str}T10:05:00.000000Z",
        )
        saved = self.store.add_event(event)
        all_events = self.store.get_all_events()

        print(f"  Event Added: {saved}")
        print(f"  Total Stored Events: {len(all_events)}")
        assert saved is True, "Failed to save valid EXIT event"
        assert len(all_events) == 2, f"Expected 2 events, got {len(all_events)}"
        assert all_events[1]["event_id"] == "evt_test_002"
        assert all_events[1]["direction"] == "EXIT"

        self.results["TEST B (Add Exit Event)"] = ("PASS", "EXIT event successfully added; store count increased to 2")
        print("  Result: PASS\n")

    def test_c_duplicate_event_rejection(self):
        print("------------------------------------------------------------")
        print("TEST C: Duplicate Event Rejection")
        print("------------------------------------------------------------")
        # Attempt 1: Re-add exact same event_id
        duplicate_event = VehicleEvent.create(
            event_id="evt_test_001",  # Same ID as Test A
            track_id=1,
            vehicle_type="car",
            direction="ENTRY",
            confidence=0.92,
            bbox=(120, 100, 240, 220),
            frame_index=11,
            timestamp=f"{self.today_str}T10:00:00.000000Z",
        )
        saved_1 = self.store.add_event(duplicate_event)
        print(f"  Attempt 1 (Same Event ID 'evt_test_001'): Saved = {saved_1} (Expected: False)")

        # Attempt 2: Same track_id & direction on same date but new event_id (duplicate crossing guard)
        duplicate_crossing = VehicleEvent.create(
            event_id="evt_test_003",
            track_id=1,  # Track 1 already crossed ENTRY
            vehicle_type="car",
            direction="ENTRY",
            confidence=0.92,
            bbox=(120, 100, 240, 220),
            frame_index=15,
            timestamp=f"{self.today_str}T10:00:10.000000Z",
        )
        saved_2 = self.store.add_event(duplicate_crossing)
        print(f"  Attempt 2 (Same Track ID 1 crossing ENTRY again): Saved = {saved_2} (Expected: False)")

        all_events = self.store.get_all_events()
        print(f"  Total Stored Events: {len(all_events)} (Unchanged)")

        assert saved_1 is False, "Store accepted duplicate event_id"
        assert saved_2 is False, "Store accepted duplicate track crossing"
        assert len(all_events) == 2, f"Expected 2 events, got {len(all_events)}"

        self.results["TEST C (Duplicate Rejection)"] = ("PASS", "Both duplicate event_id and repeat track transit were rejected")
        print("  Result: PASS\n")

    def test_d_get_events_by_date(self):
        print("------------------------------------------------------------")
        print("TEST D: Query Events by Date")
        print("------------------------------------------------------------")
        # Add an event with a different historical date
        past_date = "2026-01-15"
        past_event = VehicleEvent.create(
            event_id="evt_past_001",
            track_id=99,
            vehicle_type="truck",
            direction="ENTRY",
            confidence=0.85,
            bbox=(100, 100, 300, 300),
            frame_index=5,
            timestamp=f"{past_date}T08:00:00.000000Z",
        )
        self.store.add_event(past_event)

        today_events = self.store.get_events_by_date(self.today_str)
        past_events = self.store.get_events_by_date(past_date)
        other_events = self.store.get_events_by_date("2025-12-31")

        print(f"  Events on {self.today_str}: {len(today_events)}")
        print(f"  Events on {past_date}: {len(past_events)}")
        print(f"  Events on 2025-12-31 (empty): {len(other_events)}")

        assert len(today_events) == 2, f"Expected 2 events today, got {len(today_events)}"
        assert len(past_events) == 1, f"Expected 1 past event, got {len(past_events)}"
        assert len(other_events) == 0, f"Expected 0 events, got {len(other_events)}"

        self.results["TEST D (Events by Date)"] = ("PASS", "Date filtering correctly segmented records")
        print("  Result: PASS\n")

    def test_e_get_entries(self):
        print("------------------------------------------------------------")
        print("TEST E: Query Entries")
        print("------------------------------------------------------------")
        entries = self.store.get_entries()
        print(f"  Total Entries Found: {len(entries)}")
        for e in entries:
            print(f"    - Event #{e['event_id']}: {e['vehicle_type']} | {e['direction']} | {e['timestamp']}")
            assert e["direction"] == "ENTRY", f"Expected ENTRY, got {e['direction']}"

        assert len(entries) == 2, f"Expected 2 entries (evt_test_001 and evt_past_001), got {len(entries)}"
        self.results["TEST E (Query Entries)"] = ("PASS", "get_entries() returned strictly ENTRY records")
        print("  Result: PASS\n")

    def test_f_get_exits(self):
        print("------------------------------------------------------------")
        print("TEST F: Query Exits")
        print("------------------------------------------------------------")
        exits = self.store.get_exits()
        print(f"  Total Exits Found: {len(exits)}")
        for e in exits:
            print(f"    - Event #{e['event_id']}: {e['vehicle_type']} | {e['direction']} | {e['timestamp']}")
            assert e["direction"] == "EXIT", f"Expected EXIT, got {e['direction']}"

        assert len(exits) == 1, f"Expected 1 exit (evt_test_002), got {len(exits)}"
        self.results["TEST F (Query Exits)"] = ("PASS", "get_exits() returned strictly EXIT records")
        print("  Result: PASS\n")

    def test_g_daily_summary(self):
        print("------------------------------------------------------------")
        print("TEST G: Daily Aggregation Summary")
        print("------------------------------------------------------------")
        # Add a bus entry today to enrich vehicle types
        bus_event = VehicleEvent.create(
            event_id="evt_test_004",
            track_id=3,
            vehicle_type="bus",
            direction="ENTRY",
            confidence=0.95,
            bbox=(50, 50, 450, 400),
            frame_index=35,
            timestamp=f"{self.today_str}T11:20:00.000000Z",
        )
        self.store.add_event(bus_event)

        summary = self.store.get_daily_summary(self.today_str)
        print("  Daily Summary Output:")
        print(json.dumps(summary, indent=4))

        assert summary["date"] == self.today_str
        assert summary["total_entries"] == 2  # car (evt_test_001) + bus (evt_test_004)
        assert summary["total_exits"] == 1    # motorcycle (evt_test_002)
        assert summary["total_events"] == 3
        assert summary["by_vehicle_type"]["car"] == 1
        assert summary["by_vehicle_type"]["motorcycle"] == 1
        assert summary["by_vehicle_type"]["bus"] == 1
        assert summary["by_vehicle_type"]["truck"] == 0

        self.results["TEST G (Daily Summary)"] = ("PASS", "Daily summary statistics and vehicle-type breakdown verified")
        print("  Result: PASS\n")

    def test_h_store_reload_persistence(self):
        print("------------------------------------------------------------")
        print("TEST H: Store Persistence & File Reload")
        print("------------------------------------------------------------")
        # Instantiate a brand new VehicleEventStore instance targeting the same file
        reloaded_store = VehicleEventStore(storage_path=TEST_STORE_FILE)
        reloaded_events = reloaded_store.get_all_events()

        print(f"  Reloaded Store Path: {reloaded_store.storage_path.name}")
        print(f"  Total Events Loaded: {len(reloaded_events)}")

        assert len(reloaded_events) == 4, f"Expected 4 events on reload, got {len(reloaded_events)}"
        assert reloaded_store.get_event("evt_test_001") is not None
        assert reloaded_store.get_event("evt_test_002") is not None
        assert reloaded_store.get_event("evt_test_004") is not None
        assert reloaded_store.get_event("evt_past_001") is not None

        # Verify atomic write file integrity (check valid JSON format)
        with open(TEST_STORE_FILE, "r", encoding="utf-8") as f:
            raw_data = json.load(f)
        assert isinstance(raw_data, list) and len(raw_data) == 4

        self.results["TEST H (Persistence Reload)"] = ("PASS", "New store instance cleanly restored all records from disk")
        print("  Result: PASS\n")

    def test_i_line_counter_event_manager_integration(self):
        print("------------------------------------------------------------")
        print("TEST I: LineCounter + EventStore End-to-End Integration")
        print("------------------------------------------------------------")
        # Test file for manager
        manager_store_file = TEST_STORE_DIR / "test_manager_events.json"
        if manager_store_file.exists():
            manager_store_file.unlink()

        mgr_store = VehicleEventStore(storage_path=manager_store_file)
        line_counter = VehicleLineCounter(line_start=(100, 240), line_end=(540, 240))
        manager = VehicleEventManager(line_counter=line_counter, event_store=mgr_store)

        # Simulate vehicle #10 (car) crossing line across 5 frames
        track = VehicleTrack(
            track_id=10,
            class_id=2,
            class_name="car",
            bbox=(200, 160, 300, 230),
            confidence=0.94,
            first_seen_frame=1,
            last_seen_frame=1,
        )

        persisted_events_per_frame = []
        for f in range(1, 6):
            # Move from y=160 to y=320 (crossing y=240 on frame 3)
            y = int(160 + (f - 1) * 40)
            track.bbox = (200, y, 300, y + 70)
            track.last_seen_frame = f

            evs = manager.process_tracks([track], frame_idx=f)
            persisted_events_per_frame.append(len(evs))
            print(f"  Frame {f} (Centroid y={track.centroid[1]}): Persisted Events = {len(evs)}")

        # Frame 1: Approach -> 0
        # Frame 2: Approach -> 0
        # Frame 3: Crossing -> 1 (persisted!)
        # Frame 4: Continuing -> 0 (duplicate guard!)
        # Frame 5: Continuing -> 0 (duplicate guard!)
        assert persisted_events_per_frame == [0, 0, 1, 0, 0], f"Unexpected events per frame: {persisted_events_per_frame}"

        total_stored = len(mgr_store.get_all_events())
        print(f"  Final Stored Events in Manager: {total_stored}")
        assert total_stored == 1, f"Expected exactly 1 stored event, got {total_stored}"

        stored_ev = mgr_store.get_all_events()[0]
        assert stored_ev["track_id"] == 10
        assert stored_ev["direction"] == "ENTRY"
        assert stored_ev["vehicle_type"] == "car"
        assert stored_ev["frame_index"] == 3

        # Cleanup manager test file
        if manager_store_file.exists():
            manager_store_file.unlink()

        self.results["TEST I (Integration Pipeline)"] = (
            "PASS",
            "Single physical crossing generated exactly 1 persisted event in EventStore",
        )
        print("  Result: PASS\n")

    def run_all(self):
        self.test_a_add_entry_event()
        self.test_b_add_exit_event()
        self.test_c_duplicate_event_rejection()
        self.test_d_get_events_by_date()
        self.test_e_get_entries()
        self.test_f_get_exits()
        self.test_g_daily_summary()
        self.test_h_store_reload_persistence()
        self.test_i_line_counter_event_manager_integration()

        # Clean up test store file
        if TEST_STORE_FILE.exists():
            TEST_STORE_FILE.unlink()

        print("============================================================")
        print("VEHICLE EVENT STORAGE TEST SUMMARY REPORT")
        print("============================================================")
        all_passed = True
        for name, (status, detail) in self.results.items():
            print(f"  {name:<36}: {status} - {detail}")
            if status != "PASS":
                all_passed = False
        print("============================================================")
        if all_passed:
            print("OVERALL RESULT: ALL TESTS PASSED (100%)\n")
        else:
            print("OVERALL RESULT: SOME TESTS FAILED\n")
        return all_passed


if __name__ == "__main__":
    suite = VehicleEventStoreTestSuite()
    success = suite.run_all()
    sys.exit(0 if success else 1)
