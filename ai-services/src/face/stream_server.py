"""Lightweight, High-Performance HTTP MJPEG & Snapshot Streaming Server.

Serves live annotated camera feeds from CAM-01 and CAM-02 inference workers to:
- Node.js backend proxy (/api/cameras/live-stream/:cameraId)
- Frontend Live Attendance Monitoring Dashboard directly via standard <img> elements
"""

from __future__ import annotations

import json
import logging
import os
import threading
import time
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from typing import Callable, Dict, Optional

import cv2
import numpy as np

logger = logging.getLogger("stream_server")

# Default streaming port
DEFAULT_STREAM_PORT = int(os.environ.get("STREAM_SERVER_PORT", "5055"))


def _create_placeholder_frame(camera_id: str, message: str = "Connecting Camera Stream...") -> np.ndarray:
    """Generates an aesthetic 640x360 placeholder frame when camera is initializing."""
    canvas = np.zeros((360, 640, 3), dtype=np.uint8)
    canvas[:] = (18, 24, 38)  # Deep slate dark background

    # Subtle grid accent
    for y in range(0, 360, 40):
        cv2.line(canvas, (0, y), (640, y), (28, 36, 52), 1)
    for x in range(0, 640, 40):
        cv2.line(canvas, (x, 0), (x, 360), (28, 36, 52), 1)

    # Status box
    cv2.rectangle(canvas, (120, 110), (520, 250), (30, 41, 59), -1)
    cv2.rectangle(canvas, (120, 110), (520, 250), (2, 132, 199), 2)

    # Title & Badge
    cam_color = (0, 220, 0) if "02" in camera_id else (0, 165, 255)
    cv2.putText(canvas, f"{camera_id} LIVE FEED", (210, 150), cv2.FONT_HERSHEY_SIMPLEX, 0.7, cam_color, 2)
    cv2.putText(canvas, message, (160, 195), cv2.FONT_HERSHEY_SIMPLEX, 0.5, (220, 220, 220), 1)
    cv2.putText(canvas, "CP PLUS RTSP Biometric Recognition", (185, 225), cv2.FONT_HERSHEY_SIMPLEX, 0.38, (148, 163, 184), 1)

    return canvas


class MJPEGStreamHandler(BaseHTTPRequestHandler):
    """Handles HTTP requests for live MJPEG video streams and snapshots."""

    # Frame getter registry shared by the server instance
    frame_getters: Dict[str, Callable[[], Optional[np.ndarray]]] = {}

    def log_message(self, format: str, *args) -> None:
        """Suppress noisy request logging for continuous streaming."""
        pass

    def _resolve_camera_id(self) -> str:
        """Parses camera ID from URL path or query string."""
        path = self.path.split("?")[0].strip("/")
        parts = path.split("/")
        if len(parts) >= 2 and parts[1]:
            return parts[1].upper()
        # Query parameter fallback
        if "?" in self.path:
            query = self.path.split("?")[1]
            for param in query.split("&"):
                if "=" in param:
                    k, v = param.split("=", 1)
                    if k.lower() in ("camera", "camera_id", "cam"):
                        return v.upper()
        return "CAM-02"

    def do_GET(self) -> None:
        path = self.path.split("?")[0].strip("/")

        # Health / Status endpoint
        if path == "status" or path == "":
            self.send_response(200)
            self.send_header("Content-Type", "application/json")
            self.send_header("Access-Control-Allow-Origin", "*")
            self.end_headers()
            status_data = {
                "service": "ai-camera-stream-server",
                "status": "ONLINE",
                "port": DEFAULT_STREAM_PORT,
                "available_cameras": list(self.frame_getters.keys()),
                "timestamp": time.time(),
            }
            self.wfile.write(json.dumps(status_data).encode("utf-8"))
            return

        cam_id = self._resolve_camera_id()
        if cam_id not in self.frame_getters and ("CAM-01" in cam_id or "CAM-02" in cam_id):
            # Standardize e.g. CAM01 -> CAM-01
            cam_id = "CAM-01" if "1" in cam_id else "CAM-02"

        getter = self.frame_getters.get(cam_id)

        # Single JPEG frame snapshot endpoint
        if path.startswith("frame") or path.startswith("snapshot"):
            frame = getter() if getter else None
            if frame is None:
                frame = _create_placeholder_frame(cam_id, "Camera Initializing...")

            ret, jpeg = cv2.imencode(".jpg", frame, [cv2.IMWRITE_JPEG_QUALITY, 80])
            if not ret:
                self.send_error(500, "JPEG Encoding Error")
                return

            self.send_response(200)
            self.send_header("Content-Type", "image/jpeg")
            self.send_header("Content-Length", str(len(jpeg)))
            self.send_header("Cache-Control", "no-cache, no-store, must-revalidate")
            self.send_header("Access-Control-Allow-Origin", "*")
            self.end_headers()
            self.wfile.write(jpeg.tobytes())
            return

        # Continuous MJPEG stream endpoint
        if path.startswith("stream"):
            self.send_response(200)
            self.send_header("Content-Type", "multipart/x-mixed-replace; boundary=frame")
            self.send_header("Cache-Control", "no-cache, no-store, must-revalidate")
            self.send_header("Pragma", "no-cache")
            self.send_header("Expires", "0")
            self.send_header("Access-Control-Allow-Origin", "*")
            self.end_headers()

            fps_delay = 0.045  # ~22 FPS target
            try:
                while True:
                    frame = getter() if getter else None
                    if frame is None:
                        frame = _create_placeholder_frame(cam_id, "Awaiting Camera Feed...")

                    ret, jpeg = cv2.imencode(".jpg", frame, [cv2.IMWRITE_JPEG_QUALITY, 75])
                    if ret:
                        data = jpeg.tobytes()
                        chunk = (
                            b"--frame\r\n"
                            b"Content-Type: image/jpeg\r\n"
                            b"Content-Length: " + str(len(data)).encode("ascii") + b"\r\n\r\n" +
                            data + b"\r\n"
                        )
                        self.wfile.write(chunk)
                    time.sleep(fps_delay)
            except (BrokenPipeError, ConnectionResetError, ConnectionAbortedError):
                # Normal client disconnect
                pass
            except Exception:
                pass
            return

        self.send_error(404, f"Endpoint not found: {self.path}")


class ThreadedHTTPServer(ThreadingHTTPServer):
    daemon_threads = True
    allow_reuse_address = True


def start_stream_server(
    frame_getters: Dict[str, Callable[[], Optional[np.ndarray]]],
    port: int = DEFAULT_STREAM_PORT,
    host: str = "0.0.0.0",
) -> Optional[ThreadedHTTPServer]:
    """Starts the background MJPEG streaming server in a daemon thread."""
    MJPEGStreamHandler.frame_getters = frame_getters

    try:
        server = ThreadedHTTPServer((host, port), MJPEGStreamHandler)
        server_thread = threading.Thread(target=server.serve_forever, daemon=True, name="MJPEGStreamServer")
        server_thread.start()
        print(f"[StreamServer] Live Camera MJPEG Server active on http://127.0.0.1:{port}/stream/CAM-02")
        return server
    except Exception as ex:
        print(f"[StreamServer Warning] Could not start streaming server on port {port}: {ex}")
        return None

