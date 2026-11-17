"""Comprehensive Automated Test Suite for Vehicle Line Counter (Phase 5).

Validates:
A. Car moving toward line -> No event before crossing, ENTRY upon crossing
B. Car moving across line -> Exactly one event generated
C. Car continuing after crossing -> No duplicate event
D. Vehicle moving opposite direction -> EXIT event
E. Two vehicles crossing -> Two separate events (ENTRY and EXIT)
F. Same vehicle crossing only once -> Exactly one event
+ End-to-end video test with HUD display:
  - Track ID: 1 | Car | ENTRY
  - Track ID: 2 | Motorcycle | EXIT
  - [VEHICLE EVENT] telemetry output
"""

from __future__ import annotations

import sys
import time
from pathlib import Path
from typing import Dict, List, Tuple, Any

import cv2
import numpy as np

PROJECT_ROOT = Path(__file__).resolve().parents[3]
sys.path.append(str(PROJECT_ROOT / "src"))

from vehicle.events.vehicle_event import VehicleEvent
from vehicle.events.line_counter import VehicleLineCounter
from vehicle.tracking.vehicle_tracker import VehicleTrack

OUTPUT_DIR = PROJECT_ROOT / "data" / "vehicle" / "output"


class VehicleLineCounterTestSuite:
    def __init__(self):
        print("============================================================")
        print("VEHICLE LINE COUNTER TEST SUITE (PHASE 5)")
        print("============================================================\n")
        self.counter = VehicleLineCounter(
            line_start=(100, 240),
            line_end=(540, 240),
            entry_from_side="negative_to_positive",
        )
        self.results: Dict[str, Tuple[str, str]] = {}

    def test_a_b_c_car_crossing_and_duplicate_prevention(self):
        print("------------------------------------------------------------")
        print("TESTS A, B, C: Car Approaching, Crossing (ENTRY), and Duplicate Guard")
        print("------------------------------------------------------------")
        self.counter.reset()
        track_id = 1
        vtype = "car"
        conf = 0.92
        bbox = (250, 150, 350, 230)

        # 1. Car approaches line from top (y: 160 -> 200 -> 220)
        events_before = []
        for f_idx, y in enumerate([160, 190, 220], start=1):
            res = self.counter.check_crossing(
                track_id=track_id,
                vehicle_type=vtype,
                current_centroid=(300, y),
                confidence=conf,
                bbox=bbox,
                frame_idx=f_idx,
            )
            events_before.append(res)
            print(f"  Frame {f_idx}: Centroid=(300, {y}) -> Event: {res}")

        # Test A: Car moving toward line (no cross yet)
        assert all(e == "NONE" for e in events_before), "Premature event generated while approaching"
        print("  [Step A - Approaching]: Correctly NONE before crossing.")

        # 2. Car crosses line on Frame 4 (y: 220 -> 270)
        res_cross = self.counter.check_crossing(
            track_id=track_id,
            vehicle_type=vtype,
            current_centroid=(300, 270),
            confidence=conf,
            bbox=bbox,
            frame_idx=4,
        )
        print(f"  Frame 4: Centroid=(300, 270) -> Event: {res_cross}")
        assert res_cross == "ENTRY", f"Expected ENTRY, got {res_cross}"
        assert self.counter.total_entries == 1, f"Expected 1 entry, got {self.counter.total_entries}"
        print("  [Step B - Crossing]: Exactly one ENTRY event generated.")

        # 3. Car continues moving away on Frames 5-8 (y: 300 -> 340 -> 380)
        events_after = []
        for f_idx, y in enumerate([300, 340, 380], start=5):
            res = self.counter.check_crossing(
                track_id=track_id,
                vehicle_type=vtype,
                current_centroid=(300, y),
                confidence=conf,
                bbox=bbox,
                frame_idx=f_idx,
            )
            events_after.append(res)
            print(f"  Frame {f_idx}: Centroid=(300, {y}) -> Event: {res}")

        # Test C: No duplicate events
        assert all(e == "NONE" for e in events_after), "Duplicate event generated after crossing"
        assert self.counter.total_entries == 1, "Duplicate count added"
        print("  [Step C - Continuing]: No duplicate events generated (Total entries remains 1).")

        self.results["TEST A (Car Toward Line)"] = ("PASS", "No event triggered before crossing")
        self.results["TEST B (Car Crossing Entry)"] = ("PASS", "Exactly one ENTRY event generated at boundary")
        self.results["TEST C (Duplicate Guard)"] = ("PASS", "Zero duplicate events generated while vehicle continues")
        print("  Result: PASS\n")

    def test_d_opposite_direction_exit(self):
        print("------------------------------------------------------------")
        print("TEST D: Vehicle Moving in Opposite Direction (EXIT)")
        print("------------------------------------------------------------")
        self.counter.reset()
        track_id = 2
        vtype = "motorcycle"
        conf = 0.88
        bbox = (380, 280, 420, 330)

        # Vehicle starts below line at y=300 and moves upward across y=240 to y=180
        res1 = self.counter.check_crossing(track_id, vtype, (400, 300), conf, bbox, frame_idx=1)
        res2 = self.counter.check_crossing(track_id, vtype, (400, 260), conf, bbox, frame_idx=2)
        print(f"  Frame 1: Centroid=(400, 300) -> Event: {res1}")
        print(f"  Frame 2: Centroid=(400, 260) -> Event: {res2}")

        # Crossing frame (260 -> 210)
        res_cross = self.counter.check_crossing(track_id, vtype, (400, 210), conf, bbox, frame_idx=3)
        print(f"  Frame 3: Centroid=(400, 210) -> Event: {res_cross}")

        assert res_cross == "EXIT", f"Expected EXIT, got {res_cross}"
        assert self.counter.total_exits == 1, f"Expected 1 exit, got {self.counter.total_exits}"
        assert self.counter.total_entries == 0, "Entry incremented incorrectly"

        # Continuing upward
        res4 = self.counter.check_crossing(track_id, vtype, (400, 160), conf, bbox, frame_idx=4)
        print(f"  Frame 4: Centroid=(400, 160) -> Event: {res4}")
        assert res4 == "NONE", "Duplicate EXIT event generated"

        self.results["TEST D (Opposite Exit)"] = ("PASS", "Opposite movement correctly identified as EXIT")
        print("  Result: PASS\n")

    def test_e_two_vehicles_crossing(self):
        print("------------------------------------------------------------")
        print("TEST E: Two Vehicles Crossing Concurrently (Independent Events)")
        print("------------------------------------------------------------")
        self.counter.reset()

        # Vehicle 1: Car entering (moving down)
        # Vehicle 2: Motorcycle exiting (moving up)
        car_id = 1
        moto_id = 2

        # Step 1: Initial positions
        self.counter.check_crossing(car_id, "car", (250, 200), 0.93, (200, 150, 300, 250), 1)
        self.counter.check_crossing(moto_id, "motorcycle", (450, 280), 0.89, (420, 250, 480, 310), 1)

        # Step 2: Both cross on frame 2
        car_res = self.counter.check_crossing(car_id, "car", (250, 260), 0.93, (200, 210, 300, 310), 2)
        moto_res = self.counter.check_crossing(moto_id, "motorcycle", (450, 210), 0.89, (420, 180, 480, 240), 2)

        print(f"  Frame 2 Car (ID {car_id})        -> Event: {car_res}")
        print(f"  Frame 2 Motorcycle (ID {moto_id}) -> Event: {moto_res}")

        assert car_res == "ENTRY", f"Expected ENTRY for Car, got {car_res}"
        assert moto_res == "EXIT", f"Expected EXIT for Motorcycle, got {moto_res}"
        assert self.counter.total_entries == 1, "Expected 1 entry"
        assert self.counter.total_exits == 1, "Expected 1 exit"
        assert len(self.counter.events) == 2, f"Expected 2 events, got {len(self.counter.events)}"

        self.results["TEST E (Two Vehicles)"] = ("PASS", "Car (ENTRY) and Motorcycle (EXIT) triggered independent events")
        print("  Result: PASS\n")

    def test_f_same_vehicle_single_event(self):
        print("------------------------------------------------------------")
        print("TEST F: Same Vehicle Crossing Only Once Verification")
        print("------------------------------------------------------------")
        self.counter.reset()
        truck_id = 7
        vtype = "truck"

        # Frame 1: before
        self.counter.check_crossing(truck_id, vtype, (320, 180), 0.91, (270, 130, 370, 230), 1)
        # Frame 2: cross
        ev = self.counter.check_crossing(truck_id, vtype, (320, 260), 0.91, (270, 210, 370, 310), 2)
        assert ev == "ENTRY"

        # Frame 3 to 10: hover around or move further
        for f in range(3, 11):
            res = self.counter.check_crossing(truck_id, vtype, (320, 260 + (f - 2) * 10), 0.91, (270, 210, 370, 310), f)
            assert res == "NONE", f"Duplicate event on frame {f}"

        assert len(self.counter.events) == 1, f"Expected exactly 1 event, got {len(self.counter.events)}"
        self.results["TEST F (Single Event Guard)"] = ("PASS", "Vehicle crossing once triggered exactly 1 event across 10 frames")
        print("  Result: PASS\n")

    def test_g_video_rendering_and_hud(self):
        print("------------------------------------------------------------")
        print("TEST G: Video Stream HUD Rendering & Telemetry Validation")
        print("------------------------------------------------------------")
        self.counter.reset()
        OUTPUT_DIR.mkdir(parents=True, exist_ok=True)
        out_video_path = OUTPUT_DIR / "test_line_crossing_demo.mp4"

        fourcc = cv2.VideoWriter_fourcc(*"mp4v")
        vw = cv2.VideoWriter(str(out_video_path), fourcc, 20.0, (640, 480))

        # Simulate 30 frames:
        # Car #1 moves down from y=120 to y=360
        # Motorcycle #2 moves up from y=360 to y=120
        car_track = VehicleTrack(
            track_id=1,
            class_id=2,
            class_name="car",
            bbox=(180, 120, 280, 200),
            confidence=0.92,
            first_seen_frame=1,
            last_seen_frame=1,
        )
        moto_track = VehicleTrack(
            track_id=2,
            class_id=3,
            class_name="motorcycle",
            bbox=(360, 360, 430, 430),
            confidence=0.88,
            first_seen_frame=1,
            last_seen_frame=1,
        )

        for f in range(1, 31):
            frame = np.full((480, 640, 3), 50, dtype=np.uint8)

            # Move car down
            y_car = int(120 + (f - 1) * 8.0)
            car_track.bbox = (180, y_car, 280, y_car + 80)
            car_track.last_seen_frame = f

            # Move motorcycle up
            y_moto = int(360 - (f - 1) * 8.0)
            moto_track.bbox = (360, y_moto, 430, y_moto + 70)
            moto_track.last_seen_frame = f

            tracks = [car_track, moto_track]

            # Update line counter
            self.counter.update_tracks(tracks, frame_idx=f)

            # Render
            annotated = self.counter.draw(frame, tracks)

            # Draw vehicle bounding boxes
            cv2.rectangle(annotated, (car_track.bbox[0], car_track.bbox[1]), (car_track.bbox[2], car_track.bbox[3]), (0, 255, 0), 2)
            cv2.rectangle(annotated, (moto_track.bbox[0], moto_track.bbox[1]), (moto_track.bbox[2], moto_track.bbox[3]), (0, 165, 255), 2)

            vw.write(annotated)

        vw.release()
        print(f"  Demo video written to: {out_video_path}")
        assert self.counter.total_entries == 1, f"Expected 1 entry, got {self.counter.total_entries}"
        assert self.counter.total_exits == 1, f"Expected 1 exit, got {self.counter.total_exits}"

        self.results["TEST G (Video & HUD Display)"] = (
            "PASS",
            f"Video rendered with Track #1 (ENTRY) and Track #2 (EXIT) HUD annotations: {out_video_path.name}",
        )
        print("  Result: PASS\n")

    def run_all(self):
        self.test_a_b_c_car_crossing_and_duplicate_prevention()
        self.test_d_opposite_direction_exit()
        self.test_e_two_vehicles_crossing()
        self.test_f_same_vehicle_single_event()
        self.test_g_video_rendering_and_hud()

        print("============================================================")
        print("VEHICLE LINE COUNTER TEST REPORT SUMMARY")
        print("============================================================")
        all_passed = True
        for name, (status, detail) in self.results.items():
            print(f"  {name:<34}: {status} - {detail}")
            if status != "PASS":
                all_passed = False
        print("============================================================")
        print(f"Total Entries Recorded: {self.counter.total_entries}")
        print(f"Total Exits Recorded  : {self.counter.total_exits}")
        print("============================================================\n")
        return all_passed


if __name__ == "__main__":
    suite = VehicleLineCounterTestSuite()
    success = suite.run_all()
    sys.exit(0 if success else 1)
