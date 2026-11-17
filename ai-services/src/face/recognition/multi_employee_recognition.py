"""Multi-Employee Real-Time Face Recognition Engine.

Features:
1. Dynamic loading of ALL registered employees from data/employees.json and data/face_embeddings/*.
2. Multi-face processing: Detects and independently recognizes multiple people in the same frame.
3. Multi-track association: Lightweight centroid + IoU tracking keeps identity and liveness stable.
4. Per-face temporal liveness verification (prevents recognizing unverified faces).
5. Face quality & occlusion guard: Partially visible or severely blurred faces are labeled
   'PARTIALLY VISIBLE' or 'LOW QUALITY' without guessing.
6. Configurable recognition threshold (default: None for calibration mode).
7. Top-1 vs Top-2 ambiguity guard: Clashing close candidates are flagged as 'UNCERTAIN / AMBIGUOUS'.
8. Real-time visual HUD with per-face diagnostic telemetry.
"""

from __future__ import annotations

import argparse
import json
import sys
import time
from collections import deque
from pathlib import Path
from typing import Dict, List, Optional, Tuple, Any

import cv2
import numpy as np
import requests
from insightface.model_zoo import get_model

# -----------------------------------------------------------------------------
# Path Configurations & Imports
# -----------------------------------------------------------------------------

AI_SERVICES_DIR = Path(__file__).resolve().parents[3]

sys.path.append(str(AI_SERVICES_DIR / "src" / "face"))
sys.path.append(str(AI_SERVICES_DIR / "src" / "face" / "recognition"))

_CAM_DIR = AI_SERVICES_DIR / "src" / "camera"
if str(_CAM_DIR) not in sys.path:
    sys.path.append(str(_CAM_DIR))

try:
    from camera_config import get_camera_config, sanitize_rtsp_url, get_available_camera_configs
    from camera_worker import CameraWorker
except ImportError:
    from src.camera.camera_config import get_camera_config, sanitize_rtsp_url, get_available_camera_configs
    from src.camera.camera_worker import CameraWorker

try:
    from face_preprocess import preprocess_face
except ImportError:
    from src.face.recognition.face_preprocess import preprocess_face

from employee_registry import load_all_active_embeddings
from live_face_recognition import TemporalLivenessTracker

from face_config import (
    YUNET_MODEL_PATH,
    ARCFACE_MODEL_PATH,
    REFERENCE_POINTS,
    MIN_FACE_DIM_LIVE as MIN_FACE_DIM,
    MIN_SHARPNESS_LIVE as MIN_SHARPNESS,
    MIN_SHARPNESS_LIVE_RELAXED,
    DEFAULT_MIN_MATCH_MARGIN,
    RECOGNITION_THRESHOLD,
    BOUNDARY_MARGIN_PX,
)


# -----------------------------------------------------------------------------
# Lightweight Spatial Face Tracker
# -----------------------------------------------------------------------------

def calculate_iou(boxA: Tuple[int, int, int, int], boxB: Tuple[int, int, int, int]) -> float:
    """Calculates Intersection over Union between two (x, y, w, h) bounding boxes."""
    xA = max(boxA[0], boxB[0])
    yA = max(boxA[1], boxB[1])
    xB = min(boxA[0] + boxA[2], boxB[0] + boxB[2])
    yB = min(boxA[1] + boxA[3], boxB[1] + boxB[3])

    interW = max(0, xB - xA)
    interH = max(0, yB - yA)
    interArea = interW * interH

    boxAArea = boxA[2] * boxA[3]
    boxBArea = boxB[2] * boxB[3]
    unionArea = float(boxAArea + boxBArea - interArea)

    if unionArea <= 0:
        return 0.0
    return interArea / unionArea


def calculate_normalized_centroid_distance(
    boxA: Tuple[int, int, int, int], boxB: Tuple[int, int, int, int]
) -> float:
    """Calculates Euclidean distance between box centroids, normalized by face scale."""
    cxA = boxA[0] + boxA[2] / 2.0
    cyA = boxA[1] + boxA[3] / 2.0
    cxB = boxB[0] + boxB[2] / 2.0
    cyB = boxB[1] + boxB[3] / 2.0

    scale = max(boxA[2], boxA[3], boxB[2], boxB[3], 1.0)
    dist_px = float(np.hypot(cxA - cxB, cyA - cyB))
    return dist_px / scale


class TrackedFace:
    """Maintains state, liveness, spatial smoothing and recognition history for a single detected face."""

    def __init__(self, track_id: int, bbox: Tuple[int, int, int, int], landmarks: np.ndarray):
        self.track_id = track_id
        self.bbox = bbox
        self.raw_bbox = bbox
        self.landmarks = landmarks
        self.liveness_tracker = TemporalLivenessTracker()
        self.missed_frames = 0
        self.total_frames_seen = 1
        self.smooth_alpha = 0.70  # Responsive yet jitter-free smoothing
        self.recognition_history = deque(maxlen=10)
        self.last_status = "DETECTED"
        self.last_candidate = None
        self.last_similarity = None
        self.confirmed_employee_id: Optional[str] = None
        self.confirmed_employee_name: Optional[str] = None

    def update_spatial(self, bbox: Tuple[int, int, int, int], landmarks: np.ndarray):
        self.raw_bbox = bbox
        # Exponential moving average spatial smoothing on bounding box
        old_x, old_y, old_w, old_h = self.bbox
        new_x, new_y, new_w, new_h = bbox
        sm_x = int(self.smooth_alpha * new_x + (1.0 - self.smooth_alpha) * old_x)
        sm_y = int(self.smooth_alpha * new_y + (1.0 - self.smooth_alpha) * old_y)
        sm_w = int(self.smooth_alpha * new_w + (1.0 - self.smooth_alpha) * old_w)
        sm_h = int(self.smooth_alpha * new_h + (1.0 - self.smooth_alpha) * old_h)
        self.bbox = (sm_x, sm_y, sm_w, sm_h)
        self.landmarks = landmarks
        self.missed_frames = 0
        self.total_frames_seen += 1


class MultiFaceTracker:
    """Production-grade multi-face association tracker with IoU + centroid proximity fallback.

    Prevents track ID thrashing when an employee turns their head to profile, looks down,
    blinks, or experiences momentary 1-3 frame detector drops.
    """

    def __init__(self, max_missed: int = 45):
        self.tracks: Dict[int, TrackedFace] = {}
        self.next_track_id = 1
        self.max_missed = max_missed

    def update(
        self,
        detections: List[Tuple[Tuple[int, int, int, int], np.ndarray]],
    ) -> List[TrackedFace]:
        """Matches current detections to existing tracks or creates new tracks.

        Two-stage association:
        Stage 1: High-confidence spatial overlap (IoU >= 0.25).
        Stage 2: Centroid proximity fallback (normalized distance <= 1.1 face widths)
                 for profile turns, downward tilt, and rapid approach motion.
        """
        matched_track_ids = set()
        matched_det_indices = set()
        active_tracks: List[TrackedFace] = []

        # --- Stage 1: Greedy IoU matching for overlapping faces ---
        candidates: List[Tuple[float, int, int]] = []  # (iou, det_idx, track_id)
        for det_idx, (bbox, _) in enumerate(detections):
            for tid, track in self.tracks.items():
                iou = calculate_iou(bbox, track.bbox)
                if iou >= 0.25:
                    candidates.append((iou, det_idx, tid))

        candidates.sort(key=lambda x: x[0], reverse=True)
        for iou, det_idx, tid in candidates:
            if det_idx in matched_det_indices or tid in matched_track_ids:
                continue
            bbox, landmarks = detections[det_idx]
            track = self.tracks[tid]
            track.update_spatial(bbox, landmarks)
            matched_det_indices.add(det_idx)
            matched_track_ids.add(tid)
            active_tracks.append(track)

        # --- Stage 2: Normalized Centroid Proximity matching for turned heads & motion ---
        stage2_candidates: List[Tuple[float, int, int]] = []  # (norm_dist, det_idx, track_id)
        for det_idx, (bbox, _) in enumerate(detections):
            if det_idx in matched_det_indices:
                continue
            for tid, track in self.tracks.items():
                if tid in matched_track_ids:
                    continue
                norm_dist = calculate_normalized_centroid_distance(bbox, track.bbox)
                if norm_dist <= 1.10:
                    stage2_candidates.append((norm_dist, det_idx, tid))

        stage2_candidates.sort(key=lambda x: x[0])
        for norm_dist, det_idx, tid in stage2_candidates:
            if det_idx in matched_det_indices or tid in matched_track_ids:
                continue
            bbox, landmarks = detections[det_idx]
            track = self.tracks[tid]
            track.update_spatial(bbox, landmarks)
            matched_det_indices.add(det_idx)
            matched_track_ids.add(tid)
            active_tracks.append(track)

        # --- Stage 3: Unmatched detections become new tracks ---
        for det_idx, (bbox, landmarks) in enumerate(detections):
            if det_idx in matched_det_indices:
                continue
            new_track = TrackedFace(self.next_track_id, bbox, landmarks)
            self.tracks[self.next_track_id] = new_track
            matched_track_ids.add(self.next_track_id)
            active_tracks.append(new_track)
            self.next_track_id += 1

        # --- Stage 4: Prune stale tracks that exceeded max_missed frames ---
        stale_ids = []
        for tid, track in self.tracks.items():
            if tid not in matched_track_ids:
                track.missed_frames += 1
                if track.missed_frames > self.max_missed:
                    stale_ids.append(tid)

        for tid in stale_ids:
            del self.tracks[tid]

        return active_tracks


# -----------------------------------------------------------------------------
# Multi-Employee Comparison & Decision Engine
# -----------------------------------------------------------------------------

def evaluate_multi_employee_match(
    aligned_face: np.ndarray,
    arcface_model: Any,
    active_employees: Dict[str, Dict[str, Any]],
    recognition_threshold: Optional[float] = None,
    min_match_margin: float = DEFAULT_MIN_MATCH_MARGIN,
) -> Dict[str, Any]:
    """Generates embedding and matches against all registered employees.

    Returns detailed match decision and sorted candidate rankings.
    """
    if not active_employees:
        return {
            "status": "NO REGISTERED EMPLOYEES",
            "top_candidate": None,
            "top_similarity": None,
            "rankings": [],
            "margin": 0.0,
        }

    raw_feat = arcface_model.get_feat(aligned_face).flatten()
    norm = float(np.linalg.norm(raw_feat))
    if norm == 0.0 or np.isnan(norm):
        return {
            "status": "EMBEDDING FAILED",
            "top_candidate": None,
            "top_similarity": None,
            "rankings": [],
            "margin": 0.0,
        }

    query_emb = raw_feat / norm

    # Calculate similarity against all registered employees
    rankings = []
    for emp_id, emp_data in active_employees.items():
        auth_embs = emp_data.get("embeddings") or [emp_data.get("embedding")]
        max_sim = -1.0
        for ref in auth_embs:
            if ref is not None:
                sim = float(np.dot(query_emb, ref))
                if sim > max_sim:
                    max_sim = sim
        rankings.append({
            "employeeId": emp_id,
            "name": emp_data.get("name", emp_id),
            "similarity": max_sim,
        })

    rankings.sort(key=lambda x: x["similarity"], reverse=True)

    top1 = rankings[0]
    top1_sim = top1["similarity"]
    top2_sim = rankings[1]["similarity"] if len(rankings) > 1 else -1.0
    margin = top1_sim - top2_sim if len(rankings) > 1 else 1.0

    # Decision Logic
    # 1. Threshold uncalibrated mode
    if recognition_threshold is None:
        status = "THRESHOLD NOT CALIBRATED"
    # 2. Unknown / Not registered check
    elif top1_sim < recognition_threshold:
        status = "UNKNOWN / NOT REGISTERED"
    # 3. Top-1 vs Top-2 ambiguity check
    elif len(rankings) > 1 and margin < min_match_margin and top2_sim >= (recognition_threshold - 0.08):
        top2 = rankings[1]
        status = f"UNCERTAIN / AMBIGUOUS ({top1['employeeId']}:{top1_sim:.2f} vs {top2['employeeId']}:{top2_sim:.2f})"
    else:
        status = f"RECOGNIZED: {top1['employeeId']}"

    return {
        "status": status,
        "top_candidate": top1["employeeId"],
        "top_name": top1["name"],
        "top_similarity": top1_sim,
        "second_candidate": rankings[1]["employeeId"] if len(rankings) > 1 else None,
        "second_similarity": top2_sim if len(rankings) > 1 else None,
        "margin": margin,
        "rankings": rankings,
    }


# -----------------------------------------------------------------------------
# Occlusion & Face Quality Verification
# -----------------------------------------------------------------------------

def check_face_crop_quality(
    frame: np.ndarray,
    bbox: Tuple[int, int, int, int],
    strict_boundary: bool = True,
) -> Tuple[bool, str, Optional[np.ndarray]]:
    """Guards against partially hidden, boundary-clipped, or blurred faces."""
    img_h, img_w = frame.shape[:2]
    bx, by, bw, bh = bbox

    # Boundary clipping guard
    if strict_boundary:
        is_clipped = (
            bx <= 2
            or by <= 2
            or (bx + bw) >= (img_w - 2)
            or (by + bh) >= (img_h - 2)
        )
        if is_clipped:
            return False, "PARTIALLY VISIBLE (Edge clipped)", None
    else:
        # In live single-person stream, allow edges as long as face is mostly inside frame
        if (bx + bw) <= 10 or (by + bh) <= 10 or bx >= (img_w - 10) or by >= (img_h - 10):
            return False, "PARTIALLY VISIBLE (Edge clipped)", None

    if bw < MIN_FACE_DIM or bh < MIN_FACE_DIM:
        return False, f"TOO FAR (face {bw}x{bh}; move closer; minimum {MIN_FACE_DIM}x{MIN_FACE_DIM})", None

    x1, y1 = max(0, bx), max(0, by)
    x2, y2 = min(img_w, bx + bw), min(img_h, by + bh)
    crop = frame[y1:y2, x1:x2].copy()

    if crop.size == 0 or crop.shape[0] < 20 or crop.shape[1] < 20:
        return False, "LOW QUALITY (Empty crop)", None

    gray = cv2.cvtColor(crop, cv2.COLOR_BGR2GRAY)
    sharpness = float(cv2.Laplacian(gray, cv2.CV_64F).var())
    required_sharpness = MIN_SHARPNESS if strict_boundary else MIN_SHARPNESS_LIVE_RELAXED

    if sharpness < required_sharpness:
        return False, f"LOW QUALITY (Blur {sharpness:.1f} < {required_sharpness:.1f})", None

    return True, "QUALITY PASS", crop


# -----------------------------------------------------------------------------
# HUD Rendering
# -----------------------------------------------------------------------------

def draw_recognition_hud(
    frame: np.ndarray,
    face_detected: bool,
    bbox: Optional[Tuple[int, int, int, int]],
    landmarks: Optional[np.ndarray],
    liveness_state: str,
    status: str,
    top_candidate: Optional[str],
    top_similarity: Optional[float],
    recognition_threshold: Optional[float],
    active_employees_count: int,
    fps: float,
) -> np.ndarray:
    """Renders real-time visual HUD for single-person face recognition."""
    canvas = frame.copy()
    h, w = frame.shape[:2]

    # Color selection
    if "SPOOF" in status or "FAILED" in status or "SPOOF" in liveness_state:
        box_color = (0, 0, 255)       # Red
    elif "RECOGNIZED" in status:
        box_color = (0, 230, 0)       # Green
    elif "UNKNOWN" in status:
        box_color = (0, 0, 255)       # Red
    elif "UNCERTAIN" in status:
        box_color = (0, 165, 255)     # Orange
    elif liveness_state == "LIVE":
        box_color = (0, 200, 255)     # Amber / Live
    elif face_detected:
        box_color = (255, 180, 0)     # Light cyan / checking
    else:
        box_color = (120, 120, 120)   # Gray

    # Top Status Dashboard
    cv2.rectangle(canvas, (10, 10), (w - 10, 75), (20, 20, 20), -1)
    cv2.rectangle(canvas, (10, 10), (w - 10, 75), (70, 70, 70), 1)

    thresh_str = f"{recognition_threshold:.2f}" if recognition_threshold is not None else "None (Calibration Mode)"
    title = f"AI ATTENDANCE -- SINGLE-PERSON RECOGNITION (Active: {active_employees_count})"
    cv2.putText(canvas, title, (20, 35), cv2.FONT_HERSHEY_SIMPLEX, 0.65, (0, 255, 255), 2)

    sim_str = f"{top_similarity:.4f}" if top_similarity is not None else "---"
    cand_str = top_candidate if top_candidate is not None else "---"
    sub_info = f"Threshold: {thresh_str}  |  Top: {cand_str} ({sim_str})  |  FPS: {fps:.1f}"
    cv2.putText(canvas, sub_info, (20, 60), cv2.FONT_HERSHEY_SIMPLEX, 0.48, (200, 200, 200), 1)

    # Face annotation
    if face_detected and bbox is not None:
        bx, by, bw, bh = bbox
        cv2.rectangle(canvas, (bx, by), (bx + bw, by + bh), box_color, 2)

        if landmarks is not None:
            for pt in landmarks:
                cv2.circle(canvas, (int(pt[0]), int(pt[1])), 3, (0, 255, 255), -1)

        # Label above bounding box
        tag_y = max(90, by - 10)
        if "SPOOF" in status or "FAILED" in status or "SPOOF" in liveness_state:
            tag_text = "SPOOF / LIVENESS FAILED"
        elif top_candidate is not None and top_similarity is not None:
            tag_text = f"{status.split(':')[0]}: {top_candidate} ({top_similarity:.2f})"
        else:
            tag_text = f"{liveness_state}"
        cv2.putText(canvas, tag_text, (bx, tag_y), cv2.FONT_HERSHEY_SIMPLEX, 0.55, box_color, 2)

        # Sub-label below bounding box
        stat_y = min(h - 10, by + bh + 20)
        cv2.putText(canvas, f"Liveness: {liveness_state} | Size: {bw}x{bh}", (bx, stat_y), cv2.FONT_HERSHEY_SIMPLEX, 0.45, (220, 220, 220), 1)
    else:
        cv2.putText(canvas, "NO FACE DETECTED", (20, 110), cv2.FONT_HERSHEY_SIMPLEX, 0.7, (120, 120, 120), 2)

    return canvas


def draw_multi_recognition_hud(
    frame: np.ndarray,
    face_results: List[Dict[str, Any]],
    active_employees_count: int,
    recognition_threshold: Optional[float],
    min_margin: float,
    fps: float,
) -> np.ndarray:
    """Renders comprehensive multi-person recognition HUD (for compatibility with multi-face testing)."""
    canvas = frame.copy()
    h, w = frame.shape[:2]

    # Top System Dashboard
    cv2.rectangle(canvas, (10, 10), (w - 10, 75), (20, 20, 20), -1)
    cv2.rectangle(canvas, (10, 10), (w - 10, 75), (70, 70, 70), 1)

    thresh_str = f"{recognition_threshold:.2f}" if recognition_threshold is not None else "NONE (Calibration Mode)"
    title = f"AI ATTENDANCE -- MULTI-EMPLOYEE RECOGNITION (Active: {active_employees_count})"
    cv2.putText(canvas, title, (20, 35), cv2.FONT_HERSHEY_SIMPLEX, 0.65, (0, 255, 255), 2)

    sub_info = f"Threshold: {thresh_str}  |  Min Margin: {min_margin:.2f}  |  Faces: {len(face_results)}  |  FPS: {fps:.1f}"
    cv2.putText(canvas, sub_info, (20, 60), cv2.FONT_HERSHEY_SIMPLEX, 0.5, (200, 200, 200), 1)

    for f_res in face_results:
        track_id = f_res.get("track_id", 1)
        bx, by, bw, bh = f_res["bbox"]
        status = f_res["status"]
        liveness = f_res["liveness"]
        top_cand = f_res.get("top_candidate")
        top_sim = f_res.get("top_similarity")

        if "RECOGNIZED" in status:
            box_color = (0, 220, 0)
        elif "UNKNOWN" in status:
            box_color = (0, 0, 255)
        elif "PARTIALLY" in status or "LOW QUALITY" in status:
            box_color = (120, 120, 120)
        elif "UNCERTAIN" in status:
            box_color = (0, 165, 255)
        else:
            box_color = (0, 200, 255)

        cv2.rectangle(canvas, (bx, by), (bx + bw, by + bh), box_color, 2)

        for pt in f_res.get("landmarks", []):
            cv2.circle(canvas, (int(pt[0]), int(pt[1])), 3, (0, 255, 255), -1)

        tag_y = max(90, by - 10)
        sim_text = f"Sim: {top_sim:.2f}" if top_sim is not None else ""
        cand_text = f"{top_cand}" if top_cand is not None else "---"
        label_text = f"[#{track_id}] {cand_text} ({sim_text})" if top_cand else f"[#{track_id}]"

        cv2.putText(canvas, label_text, (bx, tag_y), cv2.FONT_HERSHEY_SIMPLEX, 0.55, box_color, 2)
        stat_y = min(h - 10, by + bh + 18)
        status_disp = f"{liveness} | {status}"
        cv2.putText(canvas, status_disp, (bx, stat_y), cv2.FONT_HERSHEY_SIMPLEX, 0.45, (220, 220, 220), 1)

    return canvas


# -----------------------------------------------------------------------------
# Main Single-Person Recognition Stream
# -----------------------------------------------------------------------------

def run_multi_employee_recognition(
    camera_idx: int | str = 0,
    recognition_threshold: Optional[float] = None,
    min_match_margin: float = DEFAULT_MIN_MATCH_MARGIN,
    headless_duration: Optional[float] = None,
) -> Dict[str, Any]:
    """Runs real-time single-person face recognition against all registered employees."""
    cam_target = str(camera_idx).strip()
    print("========================================")
    print("MULTI-EMPLOYEE FACE RECOGNITION SYSTEM")
    print("========================================")
    print(f"Camera Target         : {cam_target}")
    print(f"Recognition Threshold : {recognition_threshold if recognition_threshold is not None else 'None (Calibration Mode)'}")
    print(f"Min Match Margin      : {min_match_margin:.2f}")

    # 1. Load All Active Employees
    active_employees = load_all_active_embeddings()
    print(f"Loaded {len(active_employees)} registered active employee(s):")
    for emp_id, data in active_employees.items():
        print(f"  - {emp_id:<10}: {data['name']} ({data['embeddingFile']})")
    print()

    if not active_employees:
        print("[Warning] No active employee embeddings found in registry. Unknown mode only.")

    # 2. Open Video Stream (CP PLUS Worker or Direct OpenCV)
    camera_worker: Optional[CameraWorker] = None
    cap: Optional[cv2.VideoCapture] = None
    init_frame = None

    target_upper = cam_target.upper()
    if target_upper in ("CAM-01", "CAM-02", "1", "2"):
        try:
            cfg = get_camera_config(target_upper)
            print(f"Opening CP PLUS camera {cfg.camera_id}: {cfg.sanitized_url}...")
            camera_worker = CameraWorker(config=cfg, auto_start=True)
        except Exception as e:
            print(f"[Error] Could not load camera config for {cam_target}: {e}")
            return {"error": str(e)}
    elif cam_target.startswith("rtsp://") or cam_target.startswith("rtsps://"):
        print(f"Opening RTSP camera stream: {sanitize_rtsp_url(cam_target)}...")
        camera_worker = CameraWorker(config=cam_target, camera_id="RTSP-CAM", auto_start=True)
    else:
        cam_int = int(cam_target) if cam_target.isdigit() else 0
        print(f"Opening local camera {cam_int}...")
        cap = cv2.VideoCapture(cam_int)
        if not cap.isOpened():
            cap = cv2.VideoCapture(cam_int, cv2.CAP_DSHOW)

        if not cap.isOpened():
            print(f"[Error] Could not open local camera {cam_int}.")
            return {"error": f"Could not open camera {cam_int}"}

    # Acquire initial frame
    if camera_worker is not None:
        print("Waiting for camera connection and first frame...")
        wait_start = time.time()
        while time.time() - wait_start < 10.0:
            has_f, f, _, _ = camera_worker.get_latest_frame()
            if has_f and f is not None:
                init_frame = f
                break
            time.sleep(0.1)

        if init_frame is None:
            status = camera_worker.get_status()
            print(f"[Error] Could not read frame from camera worker ({status['state']}).")
            if status.get("last_error"):
                print(f"Diagnostic error: {status['last_error']}")
            camera_worker.stop()
            return {"error": "Camera worker failed to receive frames"}
    else:
        ret, init_frame = cap.read()
        if not ret or init_frame is None:
            print(f"[Error] Could not read initial frame from camera {cam_target}.")
            if cap:
                cap.release()
            return {"error": "Could not read frame"}

    cam_h, cam_w = init_frame.shape[:2]
    print(f"Camera opened successfully ({cam_w} x {cam_h}).")

    # 3. Initialize Models
    print("Initializing YuNet and ArcFace models...")
    detector = cv2.FaceDetectorYN.create(
        str(YUNET_MODEL_PATH),
        "",
        (cam_w, cam_h),
        0.5,
        0.3,
        5000,
    )
    detector.setInputSize((cam_w, cam_h))

    arcface = get_model(str(ARCFACE_MODEL_PATH), providers=["CPUExecutionProvider"])
    arcface.prepare(ctx_id=0)
    print("Models loaded successfully.\n")

    liveness_tracker = TemporalLivenessTracker()

    total_frames = 0
    faces_detected = 0
    liveness_passed = 0
    recognition_attempts = 0
    recognized = 0
    unknown = 0
    uncertain = 0

    start_time = time.time()
    last_fps_time = start_time
    fps = 0.0

    last_terminal_status = None
    last_print_frame = -999
    last_had_face = False
    missed_face_count = 0
    last_attendance_sent = {} # Add local debounce to prevent flooding backend
    unknown_captured_for_current_track = False # Track if current face was already captured

    print("Controls: Press Q or ESC in the image window to stop stream.\n")

    try:
        while True:
            try:
                if camera_worker is not None:
                    has_frame, frame, ts, f_idx = camera_worker.get_latest_frame()
                    if not has_frame or frame is None:
                        time.sleep(0.01)
                        continue
                else:
                    ret, frame = cap.read()
                    if not ret or frame is None:
                        time.sleep(0.02)
                        continue
            except KeyboardInterrupt:
                print("\n[STOPPED] Recognition interrupted by user.")
                break

            total_frames += 1
            now = time.time()

            if headless_duration and (now - start_time) >= headless_duration:
                print(f"[Info] Reached target duration of {headless_duration}s.")
                break

            if total_frames % 10 == 0:
                fps = 10.0 / (now - last_fps_time)
                last_fps_time = now

            h, w = frame.shape[:2]
            if (w, h) != (cam_w, cam_h):
                cam_w, cam_h = w, h
                detector.setInputSize((cam_w, cam_h))

            # Detect faces with YuNet
            _, raw_faces = detector.detect(frame)

            face_detected = False
            current_bbox = None
            current_landmarks = None
            current_liveness_state = "WAITING"
            current_decision_status = "WAITING"
            top_cand = None
            top_sim = None
            face_crop = None

            if raw_faces is not None and len(raw_faces) > 0:
                face_detected = True
                faces_detected += 1
                missed_face_count = 0
                last_had_face = True

                # ONE PERSON AT A TIME: Select primary face (largest area)
                primary_face = max(raw_faces, key=lambda f: f[2] * f[3])
                bx, by, bw, bh = map(int, primary_face[0:4])
                landmarks = primary_face[4:14].reshape(5, 2)
                current_bbox = (bx, by, bw, bh)
                current_landmarks = landmarks

                # Quality check (lenient boundary for webcam live stream)
                quality_ok, quality_msg, face_crop = check_face_crop_quality(
                    frame, (bx, by, bw, bh), strict_boundary=False
                )

                if not quality_ok:
                    current_decision_status = quality_msg
                    current_liveness_state = "UNCHECKED"
                    status_key = "LOW_QUALITY" if "LOW QUALITY" in quality_msg else quality_msg
                    if (total_frames - last_print_frame >= 25) or (status_key != last_terminal_status):
                        last_print_frame = total_frames
                        last_terminal_status = status_key
                        print(f"\n[Frame {total_frames:04d}]")
                        print("Face detected: YES")
                        print(f"Face size: {bw} x {bh}")
                        print("Liveness: UNCHECKED")
                        print(f"Status: {quality_msg}")
                else:
                    # Temporal liveness verification
                    gray = cv2.cvtColor(frame, cv2.COLOR_BGR2GRAY)
                    is_live, live_state, motion = liveness_tracker.update(
                        (bx, by, bw, bh), landmarks, gray
                    )
                    current_liveness_state = live_state

                    if not is_live:
                        if "SPOOF" in live_state or "FAILED" in live_state:
                            current_decision_status = "SPOOF / LIVENESS FAILED"
                        else:
                            current_decision_status = "VERIFYING LIVENESS"

                        if (total_frames - last_print_frame >= 15) or (current_decision_status != last_terminal_status):
                            last_print_frame = total_frames
                            last_terminal_status = current_decision_status
                            print(f"\n[Frame {total_frames:04d}]")
                            print("Face detected: YES")
                            print(f"Face size: {bw} x {bh}")
                            print(f"Liveness: {live_state}")
                            print(f"Status: {current_decision_status}")
                    else:
                        # Liveness passed -> run shared preprocessing, alignment, and ArcFace
                        liveness_passed += 1
                        recognition_attempts += 1

                        working_frame = frame.copy()
                        try:
                            x1, y1 = max(0, bx), max(0, by)
                            x2, y2 = min(w, bx + bw), min(h, by + bh)
                            enhanced = preprocess_face(face_crop)
                            working_frame[y1:y2, x1:x2] = enhanced
                        except Exception:
                            pass

                        transform, _ = cv2.estimateAffinePartial2D(
                            landmarks.astype(np.float32),
                            REFERENCE_POINTS,
                            method=cv2.LMEDS,
                        )

                        if transform is not None:
                            aligned_face = cv2.warpAffine(working_frame, transform, (112, 112))
                            decision = evaluate_multi_employee_match(
                                aligned_face=aligned_face,
                                arcface_model=arcface,
                                active_employees=active_employees,
                                recognition_threshold=recognition_threshold,
                                min_match_margin=min_match_margin,
                            )

                            current_decision_status = decision["status"]
                            top_cand = decision["top_candidate"]
                            top_sim = decision["top_similarity"]

                            # Update counters
                            if current_decision_status.startswith("RECOGNIZED"):
                                recognized += 1
                                # --- Trigger Attendance API ---
                                now_time = time.time()
                                if top_cand and (now_time - last_attendance_sent.get(top_cand, 0)) > 60:
                                    last_attendance_sent[top_cand] = now_time
                                    try:
                                        payload = {
                                            "employeeId": top_cand,
                                            "status": "PRESENT",
                                            "source": "AI_CAMERA"
                                        }
                                        headers = {
                                            "Authorization": "Bearer AI_SYSTEM_INTERNAL_TOKEN_V1",
                                            "Content-Type": "application/json"
                                        }
                                        backend_url = os.environ.get("BACKEND_API_URL", "https://facetrack.gldatacenter.com/api")
                                        requests.post(f"{backend_url}/attendance", json=payload, headers=headers, timeout=2.0)
                                    except Exception as e:
                                        print(f"[Warning] Failed to send attendance for {top_cand}: {e}")

                            elif current_decision_status == "UNKNOWN / NOT REGISTERED":
                                unknown += 1
                                if not unknown_captured_for_current_track:
                                    unknown_captured_for_current_track = True
                                    try:
                                        unknown_dir = Path(AI_SERVICES_DIR) / "data" / "unknown"
                                        unknown_dir.mkdir(parents=True, exist_ok=True)
                                        fname = f"unknown_{int(time.time()*1000)}.jpg"
                                        fpath = unknown_dir / fname
                                        cv2.imwrite(str(fpath), face_crop)
                                        
                                        payload = {
                                            "image": fname,
                                            "visitCount": unknown,
                                            "metadata": {
                                                "camera": "CAM-01 (IN)",
                                                "location": "Main Entrance Gate",
                                            }
                                        }
                                        headers = {
                                            "Authorization": "Bearer AI_SYSTEM_INTERNAL_TOKEN_V1",
                                            "Content-Type": "application/json"
                                        }
                                        backend_url = os.environ.get("BACKEND_API_URL", "https://facetrack.gldatacenter.com/api")
                                        requests.post(f"{backend_url}/face-enrollments/capture-unknown", json=payload, headers=headers, timeout=2.0)
                                        if unknown > 3:
                                            print(f"🚨 [ALERT: UNKNOWN VISITOR DETECTED > 3 TIMES] Occurrence count: {unknown}")
                                    except Exception as e:
                                        print(f"[Warning] Failed to auto-capture unknown face: {e}")
                            elif "UNCERTAIN" in current_decision_status:
                                uncertain += 1

                            # Print clear terminal output
                            should_print = (
                                (recognition_attempts == 1)
                                or (current_decision_status != last_terminal_status)
                                or (total_frames - last_print_frame >= 10)
                            )

                            if should_print:
                                last_print_frame = total_frames
                                last_terminal_status = current_decision_status
                                thresh_disp = f"{recognition_threshold:.2f}" if recognition_threshold is not None else "None"
                                print(f"\n[Frame {total_frames:04d}]")
                                print("Face detected: YES")
                                print(f"Face size: {bw} x {bh}")
                                print("Liveness: LIVE")
                                print(f"Top candidate: {top_cand if top_cand else 'None'}")
                                print(f"Similarity: {top_sim:.4f}" if top_sim is not None else "Similarity: None")
                                print(f"Threshold: {thresh_disp}")
                                print(f"Status: {current_decision_status}")
            else:
                # No face detected
                missed_face_count += 1
                if missed_face_count >= 5:
                    liveness_tracker.reset()
                    unknown_captured_for_current_track = False

                if last_had_face and (total_frames - last_print_frame >= 20):
                    last_print_frame = total_frames
                    last_terminal_status = "NO_FACE"
                    last_had_face = False
                    print(f"\n[Frame {total_frames:04d}]")
                    print("Face detected: NO")

            # (Manual Unknown Capture Bridge removed as capture is now fully automatic)

            # Render Visual HUD
            if headless_duration is None:
                hud = draw_recognition_hud(
                    frame=frame,
                    face_detected=face_detected,
                    bbox=current_bbox,
                    landmarks=current_landmarks,
                    liveness_state=current_liveness_state,
                    status=current_decision_status,
                    top_candidate=top_cand,
                    top_similarity=top_sim,
                    recognition_threshold=recognition_threshold,
                    active_employees_count=len(active_employees),
                    fps=fps,
                )
                cv2.imshow("Face Recognition Stream", hud)

                try:
                    key = cv2.waitKey(1) & 0xFF
                    if key in (ord("q"), ord("Q"), 27):
                        break
                except KeyboardInterrupt:
                    print("\n[STOPPED] Recognition interrupted by user.")
                    break

    except KeyboardInterrupt:
        print("\n[STOPPED] Recognition interrupted by user.")
    finally:
        if camera_worker is not None:
            camera_worker.stop()
        if cap is not None:
            try:
                cap.release()
            except Exception:
                pass
        try:
            cv2.destroyAllWindows()
        except Exception:
            pass
        print("[INFO] Camera released and windows closed.")

    print("\n" + "=" * 40)
    print("SESSION SUMMARY")
    print("========================================")
    print(f"Frames processed     : {total_frames}")
    print(f"Faces detected       : {faces_detected}")
    print(f"Liveness passed      : {liveness_passed}")
    print(f"Recognition attempts : {recognition_attempts}")
    print(f"Recognized           : {recognized}")
    print(f"Unknown              : {unknown}")
    print(f"Uncertain            : {uncertain}")
    print("========================================\n")

    return {
        "frames_processed": total_frames,
        "faces_detected": faces_detected,
        "liveness_passed": liveness_passed,
        "recognition_attempts": recognition_attempts,
        "recognized": recognized,
        "unknown": unknown,
        "uncertain": uncertain,
        "active_employees": len(active_employees),
    }


def main():
    parser = argparse.ArgumentParser(description="Multi-Employee Face Recognition System")
    parser.add_argument(
        "--camera",
        "-c",
        type=str,
        default="0",
        help="Camera identifier: 0 (webcam), CAM-01, CAM-02, or RTSP URL",
    )
    parser.add_argument(
        "--threshold",
        type=float,
        default=RECOGNITION_THRESHOLD,
        help=f"Recognition decision threshold (default: {RECOGNITION_THRESHOLD} from face_config.py)",
    )
    parser.add_argument(
        "--margin",
        type=float,
        default=DEFAULT_MIN_MATCH_MARGIN,
        help=f"Top-1 vs Top-2 ambiguity margin (default: {DEFAULT_MIN_MATCH_MARGIN})",
    )
    parser.add_argument(
        "--duration",
        type=float,
        default=None,
        help="Run for N seconds automatically without interactive window (for automated testing)",
    )
    args = parser.parse_args()

    run_multi_employee_recognition(
        camera_idx=args.camera,
        recognition_threshold=args.threshold,
        min_match_margin=args.margin,
        headless_duration=args.duration,
    )


if __name__ == "__main__":
    main()
