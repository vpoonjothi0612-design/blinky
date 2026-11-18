"""Local PC webcam face-recognition test only.

The Python process makes no backend, attendance, outbox, RTSP, or camera-server
requests. In web mode the localhost frontend may save unknown captures and
recognized attendance events through the authenticated local backend.

Usage:
  python scripts/local_webcam_test.py
  python scripts/local_webcam_test.py --camera 1
"""

from __future__ import annotations

import argparse
import base64
import json
import os
import socket
import sys
import threading
import time
import uuid
import webbrowser
from collections import deque
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from urllib.parse import urlparse

import cv2
import numpy as np
from insightface.model_zoo import get_model

AI_ROOT = Path(__file__).resolve().parents[1]
FACE_ROOT = AI_ROOT / "src" / "face"
RECOGNITION_ROOT = FACE_ROOT / "recognition"
for path in (str(FACE_ROOT), str(RECOGNITION_ROOT)):
    if path not in sys.path:
        sys.path.insert(0, path)

from face_config import (
    ARCFACE_MODEL_PATH,
    REFERENCE_POINTS,
    YUNET_MODEL_PATH,
    RECOGNITION_THRESHOLD,
)
from employee_registry import load_all_active_embeddings, match_probe_against_registry

WEB_STATE = {
    "lock": threading.Lock(),
    "jpeg": None,
    "connected": False,
    "resolution": None,
    "fps": 0.0,
    "detections": [],
    "registry": {},
    "pending_events": deque(maxlen=50),
}


class LocalWebcamHandler(BaseHTTPRequestHandler):
    server_version = "LocalWebcamTest/1.0"

    def log_message(self, _format, *_args):
        return

    def _set_cors(self):
        origin = self.headers.get("Origin", "")
        parsed = urlparse(origin)
        if parsed.scheme == "http" and parsed.hostname in {"localhost", "127.0.0.1", "::1"} and parsed.port in {5173, 5174}:
            self.send_header("Access-Control-Allow-Origin", origin)
            self.send_header("Vary", "Origin")
            self.send_header("Access-Control-Allow-Methods", "GET, POST, OPTIONS")
            self.send_header("Access-Control-Allow-Headers", "Content-Type")

    def _send_json(self, payload, status=200):
        body = json.dumps(payload).encode("utf-8")
        self.send_response(status)
        self.send_header("Content-Type", "application/json")
        self.send_header("Content-Length", str(len(body)))
        self._set_cors()
        self.end_headers()
        self.wfile.write(body)

    def do_OPTIONS(self):
        self.send_response(204)
        self._set_cors()
        self.end_headers()

    def do_GET(self):
        if self.path == "/":
            body = (
                "<!doctype html><html><head><meta charset=\"utf-8\">"
                "<title>Local PC Webcam Test</title></head>"
                "<body style=\"margin:0;background:#111;color:#fff;font:16px sans-serif\">"
                "<p style=\"padding:12px\">Local PC Webcam Test</p>"
                "<img src=\"/stream.mjpg\" alt=\"Local webcam preview\" "
                "style=\"display:block;max-width:100%;height:auto;margin:auto\">"
                "</body></html>"
            ).encode("utf-8")
            self.send_response(200)
            self.send_header("Content-Type", "text/html; charset=utf-8")
            self.send_header("Content-Length", str(len(body)))
            self.end_headers()
            self.wfile.write(body)
            return

        if self.path == "/status":
            with WEB_STATE["lock"]:
                payload = {
                    "connected": WEB_STATE["connected"],
                    "resolution": WEB_STATE["resolution"],
                    "fps": WEB_STATE["fps"],
                    "detections": WEB_STATE["detections"],
                    "registryCount": len(WEB_STATE["registry"]),
                    "facePreviewEnabled": True,
                    "pendingEvents": list(WEB_STATE["pending_events"]),
                }
            self._send_json(payload)
            return

        if self.path == "/stream.mjpg":
            self.send_response(200)
            self.send_header("Content-Type", "multipart/x-mixed-replace; boundary=frame")
            self.send_header("Cache-Control", "no-store")
            self._set_cors()
            self.end_headers()
            try:
                while True:
                    with WEB_STATE["lock"]:
                        jpeg = WEB_STATE["jpeg"]
                    if jpeg:
                        self.wfile.write(b"--frame\r\nContent-Type: image/jpeg\r\n")
                        self.wfile.write(f"Content-Length: {len(jpeg)}\r\n\r\n".encode("ascii"))
                        self.wfile.write(jpeg)
                        self.wfile.write(b"\r\n")
                    time.sleep(0.1)
            except (BrokenPipeError, ConnectionAbortedError, ConnectionResetError):
                return

        self._send_json({"error": "Not found"}, status=404)

    def do_POST(self):
        if self.path == "/registry":
            try:
                length = int(self.headers.get("Content-Length", "0"))
                if length <= 0 or length > 10 * 1024 * 1024:
                    self._send_json({"error": "Registry payload size is invalid"}, status=413)
                    return
                payload = json.loads(self.rfile.read(length))
                if not isinstance(payload, dict):
                    raise ValueError("payload must be an object")
                employees = payload.get("employees")
                if not isinstance(employees, list):
                    raise ValueError("employees must be a list")

                registry = {}
                for employee in employees:
                    if not isinstance(employee, dict):
                        raise ValueError("Each employee profile must be an object")
                    employee_id = str(employee.get("employeeId") or "").strip()
                    if not employee_id:
                        raise ValueError("Each employee profile must have an employeeId")

                    vectors = employee.get("embeddings")
                    if not isinstance(vectors, list):
                        raise ValueError(f"Embeddings for {employee_id} must be a list")
                    normalized = []
                    for vector in vectors:
                        embedding = np.asarray(vector, dtype=np.float32)
                        if embedding.shape != (512,) or not np.isfinite(embedding).all():
                            raise ValueError(f"Embedding for {employee_id} must contain 512 finite values")
                        norm = float(np.linalg.norm(embedding))
                        if norm <= 0:
                            raise ValueError(f"Embedding for {employee_id} has zero magnitude")
                        normalized.append(embedding / norm)

                    if normalized:
                        registry[employee_id] = {
                            "employeeId": employee_id,
                            "name": str(employee.get("name") or employee_id),
                            "department": str(employee.get("department") or ""),
                            "embedding": normalized[0],
                            "embeddings": normalized,
                            "views": ["FRONT"] * len(normalized),
                            "status": "active",
                        }
            except (TypeError, ValueError, OverflowError, json.JSONDecodeError) as error:
                self._send_json({"error": f"Invalid registry payload: {error}"}, status=400)
                return

            with WEB_STATE["lock"]:
                WEB_STATE["registry"] = registry
            print(f"[LOCAL TEST] Loaded {len(registry)} registered profile(s) from the local app.")
            self._send_json({"success": True, "registryCount": len(registry)})
            return

        if self.path != "/ack":
            self._send_json({"error": "Not found"}, status=404)
            return
        try:
            length = min(int(self.headers.get("Content-Length", "0")), 4096)
            payload = json.loads(self.rfile.read(length) or b"{}")
            event_id = str(payload.get("eventId") or "")
        except (ValueError, json.JSONDecodeError):
            self._send_json({"error": "Invalid JSON payload"}, status=400)
            return
        with WEB_STATE["lock"]:
            WEB_STATE["pending_events"] = deque(
                (event for event in WEB_STATE["pending_events"] if event["eventId"] != event_id),
                maxlen=50,
            )
        self._send_json({"success": True})


def _overlap(box_a, box_b):
    ax, ay, aw, ah = box_a
    bx, by, bw, bh = box_b
    left, top = max(ax, bx), max(ay, by)
    right, bottom = min(ax + aw, bx + bw), min(ay + ah, by + bh)
    intersection = max(0, right - left) * max(0, bottom - top)
    union = aw * ah + bw * bh - intersection
    return intersection / union if union else 0.0


def _face_capture_crop(frame, x, y, face_width, face_height):
    height, width = frame.shape[:2]
    pad_x = int(face_width * 0.55)
    pad_top = int(face_height * 0.35)
    pad_bottom = int(face_height * 0.9)
    x1, y1 = max(0, x - pad_x), max(0, y - pad_top)
    x2 = min(width, x + face_width + pad_x)
    y2 = min(height, y + face_height + pad_bottom)
    portrait = frame[y1:y2, x1:x2]
    return portrait if portrait.size else None


def _encode_face_preview(frame, x, y, face_width, face_height):
    portrait = _face_capture_crop(frame, x, y, face_width, face_height)
    if portrait is None:
        return None

    encoded, buffer = cv2.imencode(
        ".jpg", portrait, [cv2.IMWRITE_JPEG_QUALITY, 92],
    )
    return base64.b64encode(buffer).decode("ascii") if encoded else None


def run_web_mode(args, registry, arcface):
    cap = open_local_camera(args.camera)
    if not cap.isOpened():
        print(f"[ERROR] Could not open local webcam index {args.camera}")
        return 1

    ok, first_frame = cap.read()
    if not ok or first_frame is None:
        cap.release()
        print("[ERROR] Local webcam opened but did not return a frame")
        return 1

    height, width = first_frame.shape[:2]
    yunet = cv2.FaceDetectorYN.create(
        str(YUNET_MODEL_PATH), "", (width, height),
        float(os.environ.get("YUNET_LIVE_SCORE_THRESHOLD", "0.55")), 0.3, 5000,
    )
    run_dir = AI_ROOT / "data" / "captures" / "local_webcam"
    run_dir.mkdir(parents=True, exist_ok=True)
    tracks = {}
    frame_count = 0
    fps_started = time.perf_counter()
    print(f"[LOCAL TEST] Webcam index {args.camera}: {width}x{height}")
    print(f"[LOCAL TEST] Frontend stream: http://127.0.0.1:{args.port}/stream.mjpg")
    if not registry:
        print("[LOCAL TEST] Waiting for registered profiles from the authenticated local frontend.")
    print("[LOCAL TEST] Recognized IN attendance and unknown captures are sent only by the localhost frontend.")
    with WEB_STATE["lock"]:
        WEB_STATE["registry"] = dict(registry)

    try:
        server = ThreadingHTTPServer(("127.0.0.1", args.port), LocalWebcamHandler)
    except OSError as error:
        cap.release()
        print(f"[ERROR] Could not start local webcam preview on port {args.port}: {error}")
        return 1
    server.daemon_threads = True
    server_thread = threading.Thread(target=server.serve_forever, name="LocalWebcamHttp", daemon=True)
    server_thread.start()
    stream_url = f"http://127.0.0.1:{args.port}/"
    preview_url = stream_url
    for frontend_port in (5173, 5174):
        try:
            with socket.create_connection(("127.0.0.1", frontend_port), timeout=0.5):
                preview_url = f"http://localhost:{frontend_port}/unknown-faces"
                break
        except OSError:
            continue
    print(f"[LOCAL TEST] Opening preview in browser: {preview_url}")
    try:
        if not webbrowser.open(preview_url):
            print(f"[WARN] Could not open a browser automatically. Open {stream_url}")
    except webbrowser.Error as error:
        print(f"[WARN] Could not open a browser automatically: {error}. Open {stream_url}")

    try:
        while True:
            ok, frame = cap.read()
            if not ok or frame is None:
                with WEB_STATE["lock"]:
                    WEB_STATE["connected"] = False
                time.sleep(0.05)
                continue

            frame_count += 1
            now = time.time()
            height, width = frame.shape[:2]
            with WEB_STATE["lock"]:
                active_registry = WEB_STATE["registry"]
            yunet.setInputSize((width, height))
            _, faces = yunet.detect(frame)
            detections = []
            used_tracks = set()

            if faces is not None:
                for face in faces:
                    x, y, fw, fh = map(int, face[:4])
                    x, y = max(0, x), max(0, y)
                    fw, fh = min(fw, width - x), min(fh, height - y)
                    crop = frame[y:y + fh, x:x + fw]
                    if crop.size == 0:
                        continue

                    gray = cv2.cvtColor(crop, cv2.COLOR_BGR2GRAY)
                    sharpness = float(cv2.Laplacian(gray, cv2.CV_64F).var())
                    brightness = float(gray.mean())
                    label, color = "LOW FACE QUALITY", (0, 200, 255)
                    employee_id, name, similarity, embedding = None, None, 0.0, None
                    quality_ok = (
                        fw >= args.min_face_px and fh >= args.min_face_px
                        and sharpness >= 6.0 and 45.0 <= brightness <= 220.0
                    )

                    if quality_ok and not active_registry:
                        label, color = "REGISTRY NOT LOADED", (0, 165, 255)
                    elif quality_ok:
                        landmarks = face[4:14].reshape((5, 2)).astype(np.float32)
                        transform, _ = cv2.estimateAffinePartial2D(
                            landmarks, REFERENCE_POINTS, method=cv2.LMEDS,
                        )
                        if transform is not None:
                            aligned = cv2.warpAffine(frame, transform, (112, 112))
                            raw_embedding = arcface.get_feat(aligned).flatten()
                            norm = float(np.linalg.norm(raw_embedding))
                            if norm > 0:
                                embedding = raw_embedding / norm
                                decision = match_probe_against_registry(
                                    embedding, active_registry, RECOGNITION_THRESHOLD,
                                    min_match_margin=0.05,
                                    profile_recognition_threshold=RECOGNITION_THRESHOLD,
                                    probe_landmarks=landmarks,
                                )
                                employee_id = decision.get("employee_id")
                                name = decision.get("name")
                                similarity = float(decision.get("similarity") or 0.0)
                                if employee_id:
                                    label = f"{name or employee_id} ({similarity:.2f})"
                                    color = (0, 220, 0)
                                elif decision.get("status") == "AMBIGUOUS":
                                    label, color = "UNCERTAIN", (0, 165, 255)
                                else:
                                    label, color = "UNKNOWN", (0, 0, 255)
                            else:
                                label = "LOW FACE QUALITY"
                        else:
                            label = "LOW FACE QUALITY"

                    best_track_id, best_overlap = None, 0.0
                    for track_id, track in tracks.items():
                        if track_id in used_tracks or now - track["lastSeen"] > 3.0:
                            continue
                        overlap = _overlap((x, y, fw, fh), track["bbox"])
                        if overlap > best_overlap:
                            best_track_id, best_overlap = track_id, overlap
                    if best_track_id is None or best_overlap < 0.05:
                        best_track_id = str(uuid.uuid4())
                        tracks[best_track_id] = {
                            "bbox": (x, y, fw, fh),
                            "lastSeen": now,
                            "lastEventAt": 0.0,
                            "lastAttendanceAt": 0.0,
                            "lastPreviewAt": 0.0,
                            "previewKey": None,
                            "faceImage": None,
                        }
                    track = tracks[best_track_id]
                    track.update({"bbox": (x, y, fw, fh), "lastSeen": now})
                    used_tracks.add(best_track_id)

                    preview_key = employee_id or label
                    if label in ("UNKNOWN", "UNCERTAIN") or employee_id:
                        if (
                            track["previewKey"] != preview_key
                            or now - track["lastPreviewAt"] >= 0.75
                        ):
                            face_image = _encode_face_preview(frame, x, y, fw, fh)
                            if face_image:
                                track["faceImage"] = face_image
                                track["lastPreviewAt"] = now
                                track["previewKey"] = preview_key

                    if employee_id and embedding is not None and now - track["lastAttendanceAt"] >= 60.0:
                        event_id = str(uuid.uuid4())
                        captured_image = None
                        portrait = _face_capture_crop(frame, x, y, fw, fh)
                        if portrait is not None:
                            filename = f"recognized_{event_id}.jpg"
                            if cv2.imwrite(
                                str(run_dir / filename),
                                portrait,
                                [cv2.IMWRITE_JPEG_QUALITY, 92],
                            ):
                                captured_image = f"captures/local_webcam/{filename}"
                            else:
                                print("[LOCAL TEST] Could not save the recognized-face capture.")
                        else:
                            print("[LOCAL TEST] No valid face crop was available for attendance.")

                        attendance_event = {
                            "eventId": event_id,
                            "decision": "RECOGNIZED",
                            "employeeId": employee_id,
                            "employeeName": name or employee_id,
                            "similarity": similarity,
                            "timestamp": time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime(now)),
                            "trackId": best_track_id,
                            "faceWidth": fw,
                            "faceHeight": fh,
                            "imagePath": captured_image,
                        }
                        with WEB_STATE["lock"]:
                            WEB_STATE["pending_events"].append(attendance_event)
                        track["lastAttendanceAt"] = now

                    if label == "UNKNOWN" and embedding is not None and fw >= 112 and fh >= 112:
                        if now - track["lastEventAt"] >= 45.0:
                            pad_x, pad_y = int(fw * 0.25), int(fh * 0.25)
                            x1, y1 = max(0, x - pad_x), max(0, y - pad_y)
                            x2, y2 = min(width, x + fw + pad_x), min(height, y + fh + pad_y)
                            evidence = frame[y1:y2, x1:x2]
                            filename = f"local_{best_track_id}_{int(now * 1000)}.jpg"
                            if evidence.size and cv2.imwrite(str(run_dir / filename), evidence):
                                event = {
                                    "eventId": str(uuid.uuid4()),
                                    "trackId": best_track_id,
                                    "imagePath": f"captures/local_webcam/{filename}",
                                    "embedding": embedding.astype(float).tolist(),
                                    "similarity": similarity,
                                    "faceWidth": fw,
                                    "faceHeight": fh,
                                    "sharpness": sharpness,
                                    "brightness": brightness,
                                    "timestamp": time.strftime("%Y-%m-%dT%H:%M:%S", time.gmtime(now)),
                                }
                                with WEB_STATE["lock"]:
                                    WEB_STATE["pending_events"].append(event)
                                track["lastEventAt"] = now

                    detections.append({
                        "trackId": best_track_id,
                        "label": label,
                        "employeeId": employee_id,
                        "name": name,
                        "department": active_registry.get(employee_id, {}).get("department") if employee_id else None,
                        "faceImage": track.get("faceImage"),
                        "similarity": round(similarity, 4),
                        "faceWidth": fw,
                        "faceHeight": fh,
                        "sharpness": round(sharpness, 2),
                        "brightness": round(brightness, 2),
                        "bbox": [x, y, fw, fh],
                    })
                    cv2.rectangle(frame, (x, y), (x + fw, y + fh), color, 2)
                    cv2.putText(frame, label, (x, max(24, y - 8)),
                                cv2.FONT_HERSHEY_SIMPLEX, 0.65, color, 2)

            tracks = {key: value for key, value in tracks.items() if now - value["lastSeen"] <= 3.0}
            elapsed = max(0.001, time.perf_counter() - fps_started)
            fps = frame_count / elapsed
            cv2.putText(frame, f"LOCAL PC WEBCAM TEST | {fps:.1f} FPS", (12, 28),
                        cv2.FONT_HERSHEY_SIMPLEX, 0.65, (255, 255, 255), 2)
            encoded, buffer = cv2.imencode(".jpg", frame, [cv2.IMWRITE_JPEG_QUALITY, 92])
            if encoded:
                with WEB_STATE["lock"]:
                    WEB_STATE.update({
                        "jpeg": buffer.tobytes(),
                        "connected": True,
                        "resolution": f"{width}x{height}",
                        "fps": round(fps, 1),
                        "detections": detections,
                    })
    except KeyboardInterrupt:
        print("\n[LOCAL TEST] Stopping webcam test.")
    finally:
        cap.release()
        server.shutdown()
        server.server_close()
        with WEB_STATE["lock"]:
            WEB_STATE["connected"] = False
    return 0

def open_local_camera(index: int) -> cv2.VideoCapture:
    cap = cv2.VideoCapture(index, cv2.CAP_DSHOW)
    if not cap.isOpened():
        cap.release()
        cap = cv2.VideoCapture(index)
    if cap.isOpened():
        cap.set(cv2.CAP_PROP_FRAME_WIDTH, 1920)
        cap.set(cv2.CAP_PROP_FRAME_HEIGHT, 1080)
        cap.set(cv2.CAP_PROP_FPS, 30)
        cap.set(cv2.CAP_PROP_BUFFERSIZE, 1)
    return cap


def main() -> int:
    parser = argparse.ArgumentParser(description="Local webcam recognition test")
    parser.add_argument("--camera", "-c", type=int, default=0)
    parser.add_argument("--min-face-px", type=int, default=64)
    parser.add_argument("--web", action="store_true", help="Serve the local preview to the frontend")
    parser.add_argument("--port", type=int, default=5056)
    args = parser.parse_args()

    if not YUNET_MODEL_PATH.exists():
        print(f"[ERROR] YuNet model missing: {YUNET_MODEL_PATH}")
        return 1
    if not ARCFACE_MODEL_PATH.exists():
        print(f"[ERROR] ArcFace model missing: {ARCFACE_MODEL_PATH}")
        return 1

    registry = load_all_active_embeddings()
    print(f"[LOCAL TEST] Loaded {len(registry)} registered employee embedding(s)")

    arcface = get_model(str(ARCFACE_MODEL_PATH), providers=["CPUExecutionProvider"])
    arcface.prepare(ctx_id=-1)

    if args.web:
        return run_web_mode(args, registry, arcface)

    cap = open_local_camera(args.camera)
    if not cap.isOpened():
        print(f"[ERROR] Could not open local webcam index {args.camera}")
        return 1

    ok, probe_frame = cap.read()
    if not ok or probe_frame is None:
        print("[ERROR] Local webcam opened but did not return a frame")
        cap.release()
        return 1
    height, width = probe_frame.shape[:2]
    yunet = cv2.FaceDetectorYN.create(
        str(YUNET_MODEL_PATH),
        "",
        (width, height),
        float(os.environ.get("YUNET_LIVE_SCORE_THRESHOLD", "0.55")),
        0.3,
        5000,
    )
    yunet.setInputSize((width, height))

    print(f"[LOCAL TEST] Webcam index {args.camera}: {width}x{height}")
    print("[LOCAL TEST] Press Q or ESC to stop. No server writes are performed.")

    window = "Local Webcam Recognition Test"
    previous_time = time.perf_counter()
    fps = 0.0

    try:
        while True:
            ok, frame = cap.read()
            if not ok or frame is None:
                time.sleep(0.01)
                continue

            frame_height, frame_width = frame.shape[:2]
            yunet.setInputSize((frame_width, frame_height))
            _, faces = yunet.detect(frame)

            now = time.perf_counter()
            elapsed = now - previous_time
            if elapsed > 0:
                fps = 0.9 * fps + 0.1 * (1.0 / elapsed)
            previous_time = now

            if faces is not None:
                for face in faces:
                    fx, fy, fw, fh = map(int, face[:4])
                    fx, fy = max(0, fx), max(0, fy)
                    fw = min(fw, frame_width - fx)
                    fh = min(fh, frame_height - fy)
                    landmarks = face[4:14].reshape((5, 2)).astype(np.float32)

                    color = (0, 165, 255)
                    label = "LOW FACE QUALITY"
                    if fw < args.min_face_px or fh < args.min_face_px:
                        cv2.rectangle(frame, (fx, fy), (fx + fw, fy + fh), color, 2)
                        cv2.putText(frame, label, (fx, max(25, fy - 10)),
                                    cv2.FONT_HERSHEY_SIMPLEX, 0.65, color, 2)
                        continue

                    crop = frame[fy:fy + fh, fx:fx + fw]
                    if crop.size == 0:
                        continue
                    gray = cv2.cvtColor(crop, cv2.COLOR_BGR2GRAY)
                    sharpness = float(cv2.Laplacian(gray, cv2.CV_64F).var())
                    brightness = float(gray.mean())
                    if sharpness < 6.0 or brightness < 45.0 or brightness > 220.0:
                        cv2.rectangle(frame, (fx, fy), (fx + fw, fy + fh), color, 2)
                        cv2.putText(frame, "LOW FACE QUALITY", (fx, max(25, fy - 10)),
                                    cv2.FONT_HERSHEY_SIMPLEX, 0.65, color, 2)
                        continue

                    transform, _ = cv2.estimateAffinePartial2D(
                        landmarks,
                        REFERENCE_POINTS,
                        method=cv2.LMEDS,
                    )
                    if transform is None:
                        continue

                    aligned = cv2.warpAffine(frame, transform, (112, 112))
                    embedding = arcface.get_feat(aligned).flatten()
                    norm = float(np.linalg.norm(embedding))
                    if norm <= 0:
                        continue

                    decision = match_probe_against_registry(
                        embedding / norm,
                        registry,
                        RECOGNITION_THRESHOLD,
                        min_match_margin=0.05,
                        profile_recognition_threshold=RECOGNITION_THRESHOLD,
                        probe_landmarks=landmarks,
                    )
                    employee_id = decision.get("employee_id")
                    status = str(decision.get("status", "UNKNOWN"))
                    similarity = float(decision.get("similarity") or 0.0)

                    if employee_id:
                        name = decision.get("name") or employee_id
                        color = (0, 255, 0)
                        label = f"{name}  {similarity:.2f}"
                    else:
                        color = (0, 0, 255)
                        label = "UNKNOWN" if status == "UNKNOWN" else "UNCERTAIN"

                    cv2.rectangle(frame, (fx, fy), (fx + fw, fy + fh), color, 2)
                    cv2.putText(frame, label, (fx, max(25, fy - 10)),
                                cv2.FONT_HERSHEY_SIMPLEX, 0.65, color, 2)

            cv2.putText(frame, f"LOCAL TEST FPS: {fps:.1f}", (10, 30),
                        cv2.FONT_HERSHEY_SIMPLEX, 0.7, (255, 255, 255), 2)
            cv2.imshow(window, frame)

            key = cv2.waitKey(1) & 0xFF
            if key in (ord("q"), ord("Q"), 27):
                break
    finally:
        cap.release()
        cv2.destroyAllWindows()

    return 0


if __name__ == "__main__":
    raise SystemExit(main())
