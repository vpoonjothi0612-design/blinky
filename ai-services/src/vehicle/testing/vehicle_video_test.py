"""YOLO11n Vehicle Video Detection & Tracking Test Script.

Validates vehicle detection, ByteTrack tracking, and vehicle counting on video files or webcams:
- Local MP4 video or webcam input (0, 1, ...)
- Video -> OpenCV frame -> YOLO11n -> Vehicle filtering -> Tracking -> HUD Display
- Maintains unique Vehicle #ID across frames
- Displays real-time FPS, latency, currently visible count, and unique seen count
- Graceful release of video streams
"""

from __future__ import annotations

import argparse
import sys
import time
from pathlib import Path
from typing import Dict, List, Optional, Any

import cv2
import numpy as np

# Ensure project src path is discoverable
PROJECT_ROOT = Path(__file__).resolve().parents[3]
sys.path.append(str(PROJECT_ROOT / "src"))

from vehicle.detection.yolo_detector import YOLOVehicleDetector, DEFAULT_MODEL_PATH
from vehicle.tracking.vehicle_tracker import VehicleTracker
from vehicle.events.line_counter import VehicleLineCounter

DEFAULT_OUTPUT_DIR = PROJECT_ROOT / "data" / "vehicle" / "output"


def run_video_stream(
    source: str | int,
    detector: YOLOVehicleDetector,
    tracker: VehicleTracker,
    conf_threshold: float = 0.40,
    output_video_path: Optional[Path] = None,
    max_frames: Optional[int] = None,
    headless: bool = False,
    enable_line_counter: bool = False,
) -> Dict[str, Any]:
    """Processes video or camera stream through YOLO11n detection and tracking."""
    # Determine source (integer for webcam or string path for video)
    if isinstance(source, str) and source.isdigit():
        source_val: str | int = int(source)
    else:
        source_val = source

    print(f"\n========================================")
    print(f"YOLO11n VEHICLE TRACKING STREAM")
    print(f"========================================")
    print(f"Source: {source_val}")
    print(f"Confidence Threshold: {conf_threshold:.2f}")

    cap = cv2.VideoCapture(source_val)
    if not cap.isOpened():
        raise RuntimeError(f"Could not open video source: {source_val}")

    width = int(cap.get(cv2.CAP_PROP_FRAME_WIDTH))
    height = int(cap.get(cv2.CAP_PROP_FRAME_HEIGHT))
    input_fps = cap.get(cv2.CAP_PROP_FPS) or 25.0
    total_file_frames = int(cap.get(cv2.CAP_PROP_FRAME_COUNT)) if not isinstance(source_val, int) else -1

    print(f"Stream Resolution: {width} x {height} @ {input_fps:.1f} FPS")
    if total_file_frames > 0:
        print(f"Total Video Frames: {total_file_frames}")

    # Setup VideoWriter if output requested
    writer = None
    if output_video_path:
        output_video_path.parent.mkdir(parents=True, exist_ok=True)
        fourcc = cv2.VideoWriter_fourcc(*"mp4v")
        writer = cv2.VideoWriter(str(output_video_path), fourcc, input_fps, (width, height))
        print(f"Recording output to: {output_video_path}")

    line_counter = (
        VehicleLineCounter(
            line_start=(int(width * 0.15), int(height * 0.50)),
            line_end=(int(width * 0.85), int(height * 0.50)),
        )
        if enable_line_counter
        else None
    )
    if line_counter:
        print(f"Virtual Line Counter Active: {line_counter.line_start} -> {line_counter.line_end}")

    frame_count = 0
    total_inference_ms = 0.0
    total_pipeline_ms = 0.0
    fps_estimate = 0.0
    t_start_total = time.perf_counter()

    try:
        while True:
            t_frame_start = time.perf_counter()
            ret, frame = cap.read()
            if not ret or frame is None:
                print("\n[INFO] End of video stream reached.")
                break

            frame_count += 1

            # Tracking update
            tracks, latency_ms = tracker.update(
                frame=frame,
                frame_idx=frame_count,
                conf_threshold=conf_threshold,
            )
            total_inference_ms += latency_ms

            # Compute running FPS
            t_frame_end = time.perf_counter()
            frame_duration_ms = (t_frame_end - t_frame_start) * 1000.0
            total_pipeline_ms += frame_duration_ms

            if frame_count % 5 == 0:
                fps_estimate = 1000.0 / max(frame_duration_ms, 1e-3)

            # Draw visualization
            annotated = tracker.draw_tracks(
                frame=frame,
                tracks=tracks,
                fps=fps_estimate,
                latency_ms=latency_ms,
                show_trails=True,
            )

            if line_counter:
                line_counter.update_tracks(tracks, frame_idx=frame_count)
                annotated = line_counter.draw(annotated, tracks)

            if writer:
                writer.write(annotated)

            # Terminal telemetry periodically or on change
            if frame_count % 15 == 0 or frame_count == 1:
                track_summary = ", ".join([f"#{t.track_id}:{t.class_name}" for t in tracks]) or "None"
                print(
                    f"[Frame {frame_count:04d}] "
                    f"Visible: {len(tracks):2d} | "
                    f"Unique: {tracker.total_unique_vehicles:2d} | "
                    f"Latency: {latency_ms:5.1f}ms | "
                    f"FPS: {fps_estimate:4.1f} | "
                    f"Tracks: [{track_summary}]"
                )

            if not headless:
                cv2.imshow("YOLO11n Vehicle Tracking", annotated)
                key = cv2.waitKey(1) & 0xFF
                if key in (ord("q"), ord("Q"), 27):
                    print("\n[INFO] Stream aborted by user.")
                    break

            if max_frames and frame_count >= max_frames:
                print(f"\n[INFO] Reached requested max_frames ({max_frames}).")
                break

    finally:
        cap.release()
        if writer:
            writer.release()
        if not headless:
            cv2.destroyAllWindows()

    total_time = time.perf_counter() - t_start_total
    avg_fps = frame_count / max(total_time, 1e-3)
    avg_inf_ms = total_inference_ms / max(frame_count, 1)
    avg_pipe_ms = total_pipeline_ms / max(frame_count, 1)

    print("\n========================================")
    print("VEHICLE TRACKING SESSION SUMMARY")
    print("========================================")
    print(f"Frames Processed      : {frame_count}")
    print(f"Unique Vehicles Seen  : {tracker.total_unique_vehicles}")
    if line_counter:
        print(f"Total Entries Recorded: {line_counter.total_entries}")
        print(f"Total Exits Recorded  : {line_counter.total_exits}")
    print(f"Average Inference Time: {avg_inf_ms:.2f} ms")
    print(f"Average Pipeline Time : {avg_pipe_ms:.2f} ms")
    print(f"Overall Processing FPS: {avg_fps:.1f} FPS")
    print("========================================\n")

    return {
        "frames_processed": frame_count,
        "unique_vehicles": tracker.total_unique_vehicles,
        "avg_inference_ms": avg_inf_ms,
        "avg_fps": avg_fps,
        "output_path": str(output_video_path) if output_video_path else None,
    }


def main():
    parser = argparse.ArgumentParser(description="YOLO11n Vehicle Video Detection & Tracking Tester")
    parser.add_argument("--source", type=str, default="0", help="Video source (0 for webcam, or path to MP4 video)")
    parser.add_argument("--conf", type=float, default=0.40, help="Confidence threshold (default: 0.40)")
    parser.add_argument("--tracker", type=str, default="bytetrack.yaml", help="Tracker type ('bytetrack.yaml' or 'botsort.yaml')")
    parser.add_argument("--output", type=str, default=None, help="Path to save annotated video")
    parser.add_argument("--max-frames", type=int, default=None, help="Maximum frames to process")
    parser.add_argument("--headless", action="store_true", help="Run without graphical window")
    parser.add_argument("--line", action="store_true", help="Enable virtual entry/exit line counter")
    parser.add_argument("--model", type=str, default=str(DEFAULT_MODEL_PATH), help="Path to yolo11n.pt")
    parser.add_argument("--device", type=str, default="cpu", help="Compute device ('cpu' or 'cuda')")
    args = parser.parse_args()

    detector = YOLOVehicleDetector(model_path=args.model, conf_threshold=args.conf, device=args.device)
    tracker = VehicleTracker(detector=detector, tracker_type=args.tracker)

    out_path = Path(args.output) if args.output else None
    run_video_stream(
        source=args.source,
        detector=detector,
        tracker=tracker,
        conf_threshold=args.conf,
        output_video_path=out_path,
        max_frames=args.max_frames,
        headless=args.headless,
        enable_line_counter=args.line,
    )


if __name__ == "__main__":
    main()
