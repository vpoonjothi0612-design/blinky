"""Interactive Live Camera Test Script for CP PLUS IP Cameras.

Allows testing Camera 1 (CAM-01), Camera 2 (CAM-02), or Both simultaneously.
Reads live frames from RTSP streams, renders real-time telemetry HUD, and
displays the video feed. Exits on 'Q' or ESC. Credential safety is enforced.
"""

from __future__ import annotations

import argparse
import logging
import sys
import time
from pathlib import Path
from typing import Dict, Optional, Tuple, List

import cv2
import numpy as np

# Ensure ai-services and src are in sys.path
_CURRENT_DIR = Path(__file__).resolve().parent
_SRC_DIR = _CURRENT_DIR.parent
_AI_SERVICES_DIR = _SRC_DIR.parent

for p in (str(_AI_SERVICES_DIR), str(_SRC_DIR), str(_CURRENT_DIR)):
    if p not in sys.path:
        sys.path.insert(0, p)

from camera_config import (
    CameraConfig,
    get_available_camera_configs,
    get_camera_config,
    sanitize_rtsp_url,
)
from camera_worker import CameraWorker, ConnectionState
from camera_manager import MultiCameraManager

logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s [%(levelname)s] %(message)s",
    datefmt="%H:%M:%S",
)
logger = logging.getLogger("test_camera")


def draw_camera_hud(
    frame: np.ndarray,
    camera_id: str,
    name: str,
    fps: float,
    frame_idx: int,
    state: str,
) -> np.ndarray:
    """Overlays status information on camera frame."""
    canvas = frame.copy()
    h, w = canvas.shape[:2]

    # Semi-transparent top bar
    bar_h = 36
    overlay = canvas.copy()
    cv2.rectangle(overlay, (0, 0), (w, bar_h), (20, 20, 20), -1)
    cv2.addWeighted(overlay, 0.7, canvas, 0.3, 0, canvas)

    # Color status based on state
    status_color = (0, 255, 0) if state == "CONNECTED" else (0, 165, 255)

    info_text = f"[{camera_id}] {name} | {w}x{h} | {fps:.1f} FPS | Frame: {frame_idx}"
    cv2.putText(canvas, info_text, (10, 24), cv2.FONT_HERSHEY_SIMPLEX, 0.6, (255, 255, 255), 1)

    # State indicator
    cv2.putText(canvas, state, (w - 140, 24), cv2.FONT_HERSHEY_SIMPLEX, 0.6, status_color, 2)
    return canvas


def test_single_camera(camera_id: str, duration: Optional[float] = None) -> bool:
    """Tests a single CP PLUS camera connection and live stream.

    Args:
        camera_id: "CAM-01" or "CAM-02".
        duration: Optional runtime in seconds before auto-closing (for automated tests).

    Returns:
        True if frames were successfully received and displayed.
    """
    try:
        cfg = get_camera_config(camera_id)
    except ValueError as err:
        logger.error(str(err))
        return False

    print("=================================================================")
    print(f"CP PLUS CAMERA TEST: {cfg.camera_id}")
    print("=================================================================")
    print(f"Name         : {cfg.name}")
    print(f"IP Address   : {cfg.ip}:{cfg.port}")
    print(f"Stream Path  : {cfg.get_rtsp_path()}")
    print(f"RTSP Stream  : {cfg.sanitized_url}")
    print(f"Transport    : {cfg.transport.upper()}")
    print("Controls     : Press 'q' or ESC in the window to stop stream")
    print("=================================================================\n")

    worker = CameraWorker(config=cfg, auto_start=True)

    window_name = f"CP PLUS Test - {cfg.camera_id} ({cfg.ip})"
    start_time = time.time()
    frames_received = 0
    fps = 0.0
    last_fps_time = start_time

    # Connection wait loop
    print("Waiting for camera connection...")
    wait_start = time.time()
    connected = False
    while time.time() - wait_start < 10.0:
        if worker.is_connected():
            connected = True
            break
        time.sleep(0.1)

    if not connected:
        status = worker.get_status()
        logger.error(f"Failed to receive frames within timeout. Worker state: {status['state']}")
        if status.get("last_error"):
            logger.error(f"Diagnostic error: {status['last_error']}")
        worker.stop()
        return False

    logger.info("Connected! Opening display window...")

    try:
        while True:
            has_frame, frame, ts, frame_idx = worker.get_latest_frame()

            if has_frame and frame is not None:
                frames_received += 1
                now = time.time()
                if frames_received % 15 == 0:
                    fps = 15.0 / max(0.001, (now - last_fps_time))
                    last_fps_time = now

                hud_frame = draw_camera_hud(
                    frame=frame,
                    camera_id=cfg.camera_id,
                    name=cfg.name,
                    fps=fps,
                    frame_idx=frame_idx,
                    state=worker.state.value,
                )

                if duration is None:
                    cv2.imshow(window_name, hud_frame)
                    key = cv2.waitKey(1) & 0xFF
                    if key in (ord("q"), ord("Q"), 27):
                        logger.info("Exit requested by user.")
                        break

            if duration is not None and (time.time() - start_time) >= duration:
                logger.info(f"Target duration of {duration}s reached.")
                break

            time.sleep(0.01)

    except KeyboardInterrupt:
        logger.info("Test interrupted by user.")
    finally:
        worker.stop()
        cv2.destroyAllWindows()

    print("\n=================================================================")
    print(f"TEST RESULTS: {cfg.camera_id}")
    print(f"Total Frames Displayed : {frames_received}")
    print(f"Worker State           : {worker.state.value}")
    print("=================================================================\n")
    return frames_received > 0


def test_both_cameras(duration: Optional[float] = None) -> bool:
    """Tests both CAM-01 and CAM-02 in parallel with fault-isolated feeds."""
    configs = get_available_camera_configs()
    if not configs:
        logger.error("No cameras configured in .env.")
        return False

    print("=================================================================")
    print("CP PLUS DUAL CAMERA TEST: CAM-01 & CAM-02")
    print("=================================================================")
    for cid, cfg in configs.items():
        print(f"  {cid}: {cfg.name} -> {cfg.sanitized_url}")
    print("Controls : Press 'q' or ESC in window to exit.")
    print("=================================================================\n")

    manager = MultiCameraManager(["CAM-01", "CAM-02"], auto_start=True)

    window_name = "CP PLUS Dual Camera Feed (CAM-01 & CAM-02)"
    start_time = time.time()
    frames_cam1 = 0
    frames_cam2 = 0
    fps_cam1 = 0.0
    fps_cam2 = 0.0
    last_time_c1 = start_time
    last_time_c2 = start_time

    # Placeholder blank frames if one camera disconnects
    placeholder_c1 = np.zeros((360, 640, 3), dtype=np.uint8)
    cv2.putText(placeholder_c1, "CAM-01 CONNECTING...", (140, 180), cv2.FONT_HERSHEY_SIMPLEX, 0.8, (0, 165, 255), 2)

    placeholder_c2 = np.zeros((360, 640, 3), dtype=np.uint8)
    cv2.putText(placeholder_c2, "CAM-02 CONNECTING...", (140, 180), cv2.FONT_HERSHEY_SIMPLEX, 0.8, (0, 165, 255), 2)

    try:
        while True:
            w1 = manager.get_worker("CAM-01")
            w2 = manager.get_worker("CAM-02")

            f1_ok, f1, ts1, idx1 = w1.get_latest_frame() if w1 else (False, None, 0.0, 0)
            f2_ok, f2, ts2, idx2 = w2.get_latest_frame() if w2 else (False, None, 0.0, 0)

            now = time.time()
            if f1_ok and f1 is not None:
                frames_cam1 += 1
                if frames_cam1 % 15 == 0:
                    fps_cam1 = 15.0 / max(0.001, (now - last_time_c1))
                    last_time_c1 = now
                disp_1 = cv2.resize(f1, (640, 360))
                disp_1 = draw_camera_hud(disp_1, "CAM-01", "Exit", fps_cam1, idx1, w1.state.value if w1 else "NONE")
            else:
                disp_1 = placeholder_c1.copy()
                state_txt = w1.state.value if w1 else "OFFLINE"
                cv2.putText(disp_1, f"CAM-01: {state_txt}", (160, 220), cv2.FONT_HERSHEY_SIMPLEX, 0.6, (180, 180, 180), 1)

            if f2_ok and f2 is not None:
                frames_cam2 += 1
                if frames_cam2 % 15 == 0:
                    fps_cam2 = 15.0 / max(0.001, (now - last_time_c2))
                    last_time_c2 = now
                disp_2 = cv2.resize(f2, (640, 360))
                disp_2 = draw_camera_hud(disp_2, "CAM-02", "Entrance", fps_cam2, idx2, w2.state.value if w2 else "NONE")
            else:
                disp_2 = placeholder_c2.copy()
                state_txt = w2.state.value if w2 else "OFFLINE"
                cv2.putText(disp_2, f"CAM-02: {state_txt}", (160, 220), cv2.FONT_HERSHEY_SIMPLEX, 0.6, (180, 180, 180), 1)

            # Combine side-by-side
            combined = np.hstack((disp_1, disp_2))

            if duration is None:
                cv2.imshow(window_name, combined)
                key = cv2.waitKey(1) & 0xFF
                if key in (ord("q"), ord("Q"), 27):
                    break

            if duration is not None and (time.time() - start_time) >= duration:
                break

            time.sleep(0.01)

    except KeyboardInterrupt:
        logger.info("Test interrupted.")
    finally:
        manager.stop_all()
        cv2.destroyAllWindows()

    print("\n=================================================================")
    print("DUAL CAMERA TEST RESULTS")
    print(f"CAM-01 Frames Displayed: {frames_cam1}")
    print(f"CAM-02 Frames Displayed: {frames_cam2}")
    print("=================================================================\n")
    return (frames_cam1 > 0) or (frames_cam2 > 0)


def main():
    parser = argparse.ArgumentParser(description="Test CP PLUS IP Camera RTSP feeds.")
    parser.add_argument(
        "--camera",
        "-c",
        type=str,
        default="CAM-01",
        help="Camera identifier: 'CAM-01', 'CAM-02', '1', '2', or 'both' (default: 'CAM-01')",
    )
    parser.add_argument(
        "--duration",
        "-d",
        type=float,
        default=None,
        help="Optional auto-exit duration in seconds (for automated headless test)",
    )
    args = parser.parse_args()

    cam_arg = args.camera.strip().lower()
    if cam_arg in ("both", "all"):
        success = test_both_cameras(duration=args.duration)
    elif cam_arg in ("2", "cam-2", "cam-02", "cam02"):
        success = test_single_camera("CAM-02", duration=args.duration)
    else:
        success = test_single_camera("CAM-01", duration=args.duration)

    sys.exit(0 if success else 1)


if __name__ == "__main__":
    main()
