"""Video-based Temporal Face Liveness / Anti-Spoofing Detector.

=============================================================================
CONCEPT EXPLANATION & ARCHITECTURE
=============================================================================
1. What is Liveness Detection?
   Liveness detection (anti-spoofing) verifies whether a detected face
   originates from a live, physically present human being or from an artificial
   presentation attack (e.g. printed paper photo, smartphone/tablet screen,
   cutout mask, or video replay).

2. Why Can't a Single Static Image Reliably Prove Liveness?
   A single 2D image contains no temporal dimension. An attacker can place a
   high-resolution printed photograph or hold up a phone displaying a photo
   of an enrolled employee. From a single frame perspective, ArcFace cannot
   distinguish between light reflected off human skin vs. light emitted by
   a phone screen or reflected off paper.

3. Why Use Temporal Information?
   Live humans exhibit involuntary biological micro-motions:
   - Micro-nodding and 3D rotational perspective shifts.
   - Facial landmark distance ratio fluctuations (perspective changes).
   - Eyelid blinking and eye region intensity variations.
   Static presentation attacks (paper or static photos) are either completely
   rigid (zero relative landmark variance) or exhibit pure planar translation
   without perspective changes.

4. Limitations of this Heuristic Implementation:
   - Does NOT use deep anti-spoofing neural networks (e.g. MiniFASNet, CDCN).
   - Can be tricked by video replay attacks on high-refresh screens.
   - Sensitive to extreme camera shake.
   - Serves as a baseline temporal gate for development before deploying
     deep FAS or active challenge-response protocols.
=============================================================================
"""

import sys
import time
from collections import deque
from pathlib import Path

import cv2
import numpy as np


# -----------------------------------
# Configuration & Paths
# -----------------------------------

BASE_DIR = Path(__file__).resolve().parents[3]

YUNET_MODEL_PATH = (
    BASE_DIR
    / "models"
    / "yunet"
    / "face_detection_yunet_2023mar.onnx"
)

# Temporal window & threshold configuration
HISTORY_WINDOW = 30           # Number of consecutive frames analyzed (~1 second at 30fps)
MIN_FRAMES_FOR_DECISION = 25  # Minimum face detections required before evaluation

# Micro-movement thresholds (normalized by face width)
MIN_MOTION_THRESHOLD = 0.008   # Below this is suspicious (completely static / printed card)
MAX_MOTION_THRESHOLD = 0.25    # Above this is erratic (unstable tracking / camera shake)

# Relative landmark ratio variation (perspective change from 3D head movement)
MIN_RATIO_VARIANCE = 0.00015   # Natural 3D micro-rotation causes relative distance changes

# Eye micro-motion / blink evidence threshold
MIN_EYE_VARIANCE = 2.5         # Pixel intensity change in eye patch


class LivenessDetector:
    """Tracks facial landmarks across consecutive video frames to assess liveness."""

    def __init__(self, model_path: Path):
        if not model_path.exists():
            raise FileNotFoundError(f"YuNet model not found: {model_path}")

        self.model_path = model_path
        self.detector = None
        self.current_frame_size = None

        # State tracking
        self.state = "WAITING"  # WAITING, CHECKING, LIVE, SPOOF / FAILED
        self.history = deque(maxlen=HISTORY_WINDOW)
        self.consecutive_live_frames = 0

        # Overall session statistics
        self.total_frames = 0
        self.face_detected_frames = 0
        self.movement_detected = False
        self.blink_motion_evidence = False

    def _init_detector(self, width: int, height: int):
        """Initializes or updates YuNet input size."""
        if self.detector is None or self.current_frame_size != (width, height):
            self.detector = cv2.FaceDetectorYN.create(
                str(self.model_path),
                "",
                (width, height),
                0.5,
                0.3,
                5000,
            )
            self.detector.setInputSize((width, height))
            self.current_frame_size = (width, height)

    def _extract_eye_patch_intensity(self, gray: np.ndarray, landmark: np.ndarray) -> float:
        """Extracts average grayscale intensity around an eye landmark point."""
        lx, ly = int(landmark[0]), int(landmark[1])
        radius = 8
        h, w = gray.shape[:2]
        x1, y1 = max(0, lx - radius), max(0, ly - radius)
        x2, y2 = min(w, lx + radius), min(h, ly + radius)
        patch = gray[y1:y2, x1:x2]
        return float(patch.mean()) if patch.size > 0 else 0.0

    def process_frame(self, frame: np.ndarray) -> tuple[np.ndarray, dict]:
        """Processes one video frame and updates temporal liveness state."""
        self.total_frames += 1
        h, w = frame.shape[:2]
        self._init_detector(w, h)

        _, faces = self.detector.detect(frame)
        gray = cv2.cvtColor(frame, cv2.COLOR_BGR2GRAY)

        frame_info = {
            "face_detected": False,
            "bbox": None,
            "landmarks": None,
            "state": self.state,
            "motion_score": 0.0,
            "ratio_variance": 0.0,
            "eye_variance": 0.0,
        }

        # If no face detected, gradually clear history
        if faces is None or len(faces) == 0:
            if len(self.history) > 0:
                self.history.popleft()
            if len(self.history) == 0 and self.state != "LIVE":
                self.state = "WAITING"
            frame_info["state"] = self.state
            return frame, frame_info

        # Track primary face (first detected)
        self.face_detected_frames += 1
        face = faces[0]
        bx, by, bw, bh = map(int, face[0:4])
        landmarks = face[4:14].reshape(5, 2)  # [left_eye, right_eye, nose, left_mouth, right_mouth]

        frame_info["face_detected"] = True
        frame_info["bbox"] = (bx, by, bw, bh)
        frame_info["landmarks"] = landmarks

        # Extract features for temporal analysis
        left_eye = landmarks[0]
        right_eye = landmarks[1]
        nose = landmarks[2]

        centroid = np.array([bx + bw / 2.0, by + bh / 2.0], dtype=np.float32)
        eye_dist = np.linalg.norm(left_eye - right_eye)
        left_eye_to_nose = np.linalg.norm(left_eye - nose)
        right_eye_to_nose = np.linalg.norm(right_eye - nose)

        # Perspective ratio: asymmetry changes as a 3D head rotates
        geom_ratio = float(left_eye_to_nose / (right_eye_to_nose + 1e-6))

        # Eye region intensities for blink / micro-expression detection
        l_eye_intensity = self._extract_eye_patch_intensity(gray, left_eye)
        r_eye_intensity = self._extract_eye_patch_intensity(gray, right_eye)

        self.history.append({
            "centroid": centroid,
            "face_size": float(bw),
            "geom_ratio": geom_ratio,
            "eye_intensity": (l_eye_intensity + r_eye_intensity) / 2.0,
            "timestamp": time.time(),
        })

        # Evaluate temporal window
        if len(self.history) < MIN_FRAMES_FOR_DECISION:
            self.state = "CHECKING"
        else:
            motion_score, ratio_var, eye_var = self._compute_window_metrics()
            frame_info["motion_score"] = motion_score
            frame_info["ratio_variance"] = ratio_var
            frame_info["eye_variance"] = eye_var

            # Decision Logic
            is_natural_motion = MIN_MOTION_THRESHOLD <= motion_score <= MAX_MOTION_THRESHOLD
            has_3d_rotation = ratio_var >= MIN_RATIO_VARIANCE
            has_eye_action = eye_var >= MIN_EYE_VARIANCE

            if is_natural_motion:
                self.movement_detected = True
            if has_eye_action or has_3d_rotation:
                self.blink_motion_evidence = True

            # Require both motion sanity and either 3D ratio change or eye micro-movement
            if is_natural_motion and (has_3d_rotation or has_eye_action):
                self.consecutive_live_frames += 1
                if self.consecutive_live_frames >= 10:
                    self.state = "LIVE"
            elif motion_score < MIN_MOTION_THRESHOLD:
                # Face completely frozen across frames (classic static photo attack)
                self.consecutive_live_frames = 0
                if len(self.history) >= HISTORY_WINDOW:
                    self.state = "SPOOF / FAILED"
            else:
                self.consecutive_live_frames = 0
                self.state = "CHECKING"

        frame_info["state"] = self.state
        return frame, frame_info

    def _compute_window_metrics(self) -> tuple[float, float, float]:
        """Calculates normalized movement, landmark ratio variance, and eye intensity variance."""
        centroids = [entry["centroid"] for entry in self.history]
        face_sizes = [entry["face_size"] for entry in self.history]
        geom_ratios = [entry["geom_ratio"] for entry in self.history]
        eye_intensities = [entry["eye_intensity"] for entry in self.history]

        mean_face_size = max(float(np.mean(face_sizes)), 1.0)

        # Average inter-frame displacement normalized by face size
        displacements = [
            np.linalg.norm(centroids[i] - centroids[i - 1]) / mean_face_size
            for i in range(1, len(centroids))
        ]
        mean_motion = float(np.mean(displacements)) if displacements else 0.0

        # Variance of 3D perspective geometry ratio
        ratio_variance = float(np.var(geom_ratios)) if geom_ratios else 0.0

        # Variance of eye patch intensity (blinks create large variance)
        eye_variance = float(np.var(eye_intensities)) if eye_intensities else 0.0

        return mean_motion, ratio_variance, eye_variance


def draw_hud(frame: np.ndarray, frame_info: dict, frame_idx: int) -> np.ndarray:
    """Renders informative overlay (HUD) on the video frame."""
    canvas = frame.copy()
    state = frame_info["state"]

    # Color coding based on state
    if state == "LIVE":
        state_color = (0, 220, 0)       # Green
    elif state == "CHECKING":
        state_color = (0, 200, 255)     # Yellow / Amber
    elif state == "SPOOF / FAILED":
        state_color = (0, 0, 255)       # Red
    else:
        state_color = (200, 200, 200)   # Gray / Neutral

    # Draw face bounding box and landmarks
    if frame_info["face_detected"]:
        bx, by, bw, bh = frame_info["bbox"]
        cv2.rectangle(canvas, (bx, by), (bx + bw, by + bh), state_color, 2)

        landmarks = frame_info["landmarks"]
        for pt in landmarks:
            cv2.circle(canvas, (int(pt[0]), int(pt[1])), 3, (0, 255, 255), -1)

    # Top banner background
    cv2.rectangle(canvas, (10, 10), (380, 140), (25, 25, 25), -1)
    cv2.rectangle(canvas, (10, 10), (380, 140), (80, 80, 80), 1)

    cv2.putText(
        canvas,
        f"STATE: {state}",
        (25, 40),
        cv2.FONT_HERSHEY_SIMPLEX,
        0.8,
        state_color,
        2,
    )
    cv2.putText(
        canvas,
        f"Frame: {frame_idx}",
        (25, 70),
        cv2.FONT_HERSHEY_SIMPLEX,
        0.55,
        (220, 220, 220),
        1,
    )
    cv2.putText(
        canvas,
        f"Motion Score : {frame_info['motion_score']:.4f}",
        (25, 95),
        cv2.FONT_HERSHEY_SIMPLEX,
        0.55,
        (220, 220, 220),
        1,
    )
    cv2.putText(
        canvas,
        f"Ratio Var    : {frame_info['ratio_variance']:.5f}",
        (25, 120),
        cv2.FONT_HERSHEY_SIMPLEX,
        0.55,
        (220, 220, 220),
        1,
    )

    return canvas


def main():
    """Runs interactive liveness detection using webcam or video file."""
    # Video source: accepts video file as argument, or defaults to webcam 0
    video_source = sys.argv[1] if len(sys.argv) > 1 else 0

    print("========================================")
    print("STARTING FACE LIVENESS DETECTOR")
    print("========================================")
    print(f"Video Source : {video_source}")
    print("Controls     : Press 'q' or ESC in window to quit")
    print("========================================\n")

    detector = LivenessDetector(YUNET_MODEL_PATH)
    cap = cv2.VideoCapture(video_source)

    if not cap.isOpened() and video_source == 0:
        cap = cv2.VideoCapture(video_source, cv2.CAP_DSHOW)

    if not cap.isOpened():
        print(f"Error: Could not open video source: {video_source}")
        print("Note: If testing without a live webcam, you can provide a video file:")
        print("      python liveness_detector.py path/to/video.mp4")
        return

    # Read initial frame to verify camera and pre-initialize detector input size
    ret, initial_frame = cap.read()
    if ret and initial_frame is not None:
        init_h, init_w = initial_frame.shape[:2]
        print(f"Camera opened : OK")
        print(f"Resolution    : {init_w} x {init_h}\n")
        detector._init_detector(init_w, init_h)

    frame_count = 0

    try:
        while True:
            ret, frame = cap.read()
            if not ret or frame is None:
                break

            frame_count += 1
            processed_frame, frame_info = detector.process_frame(frame)
            display_frame = draw_hud(processed_frame, frame_info, frame_count)

            cv2.imshow("Face Liveness & Anti-Spoofing Detection", display_frame)

            key = cv2.waitKey(1) & 0xFF
            if key == ord("q") or key == 27:
                break

    finally:
        cap.release()
        cv2.destroyAllWindows()

        # Terminal Summary Report
        print("\n================================")
        print("LIVENESS TEST")
        print("================================")
        print(f"Frames processed      : {detector.total_frames}")
        print(f"Face detected frames  : {detector.face_detected_frames}")
        print(f"Movement detected     : {'YES' if detector.movement_detected else 'NO'}")
        print(f"Blink/motion evidence : {'YES' if detector.blink_motion_evidence else 'NO'}")
        print(f"Final status          : {detector.state}")
        print("================================")


if __name__ == "__main__":
    main()
