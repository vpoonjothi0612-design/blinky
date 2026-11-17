"""Headless Multi-Employee Face Recognition Service.

Encapsulates face detection, spatial tracking, quality gating, temporal liveness,
shared preprocessing, 5-point landmark affine alignment, ArcFace feature extraction,
and employee candidate decision logic in a pure frame-based Python API with zero GUI dependencies.
"""

from __future__ import annotations

import sys
import time
from dataclasses import dataclass, field
from pathlib import Path
from typing import Dict, List, Optional, Tuple, Any

import cv2
import numpy as np
from insightface.model_zoo import get_model

# -----------------------------------------------------------------------------
# Path Configurations & Imports
# -----------------------------------------------------------------------------

_SERVICE_DIR = Path(__file__).resolve().parent
_FACE_DIR = _SERVICE_DIR.parent
if str(_FACE_DIR) not in sys.path:
    sys.path.append(str(_FACE_DIR))
_REC_DIR = _FACE_DIR / "recognition"
if str(_REC_DIR) not in sys.path:
    sys.path.append(str(_REC_DIR))

from face_config import (
    YUNET_MODEL_PATH,
    ARCFACE_MODEL_PATH,
    REFERENCE_POINTS,
    RECOGNITION_THRESHOLD,
    DEFAULT_MIN_MATCH_MARGIN,
    YUNET_SCORE_THRESHOLD_STATIC,
    YUNET_NMS_THRESHOLD,
    YUNET_TOP_K,
    ALIGNMENT_SIZE,
    TRACK_REVALIDATION_INTERVAL_FRAMES,
    TRACK_UNKNOWN_RETRY_INTERVAL_FRAMES,
    TRACK_MAX_MISSED_FRAMES,
    TRACK_MAX_CONSECUTIVE_LOW_QUALITY,
)
from face_preprocess import preprocess_face
from employee_registry import load_all_active_embeddings
from multi_employee_recognition import (
    MultiFaceTracker,
    evaluate_multi_employee_match,
    check_face_crop_quality,
)
from service.track_recognition_policy import TrackRecognitionPolicy, TrackState


# -----------------------------------------------------------------------------
# Structured Result Dataclass
# -----------------------------------------------------------------------------

@dataclass
class FaceRecognitionResult:
    """Structured decision output for a single detected face in a frame.

    Attributes:
        employee_id: Identifier of recognized employee (None for UNKNOWN, AMBIGUOUS, or rejected).
        name: Display name of recognized employee (None for UNKNOWN, AMBIGUOUS, or rejected).
        status: Canonical decision status ("RECOGNIZED", "UNKNOWN", "AMBIGUOUS", "LOW_QUALITY", "SPOOF", "CHECKING_LIVENESS").
        similarity: Cosine similarity score against the top matched employee.
        second_candidate: Employee ID of the runner-up candidate (if multiple employees registered).
        second_similarity: Cosine similarity score of the runner-up candidate.
        margin: Difference between top similarity and second similarity.
        bbox: Bounding box as (x, y, width, height).
        landmarks: 5-point facial landmarks as float numpy array of shape (5, 2).
        quality_status: Quality evaluation label ("QUALITY_PASS", "LOW_QUALITY", "PARTIALLY_VISIBLE").
        quality_reason: Detailed explanation of quality or boundary rejection.
        liveness_status: Temporal liveness evaluation ("LIVE", "CHECKING_LIVENESS", "SPOOF", "BYPASSED").
        track_id: Persistent spatial tracking identifier across consecutive frames.
        frame_index: Sequential index of the frame processed by this service instance.
        timestamp: Unix epoch timestamp associated with the frame ingestion.
        raw_decision: Unmodified decision string from the internal evaluation engine.
        rankings: Complete candidate rankings list sorted by similarity.
        recognition_source: Provenance of recognition result ("NEW_RECOGNITION", "REUSED_FROM_TRACK", "REVALIDATED", "BYPASSED").
    """
    employee_id: Optional[str] = None
    name: Optional[str] = None
    status: str = "UNKNOWN"
    similarity: Optional[float] = None
    second_candidate: Optional[str] = None
    second_similarity: Optional[float] = None
    margin: Optional[float] = None
    bbox: Tuple[int, int, int, int] = (0, 0, 0, 0)
    landmarks: Optional[np.ndarray] = None
    quality_status: str = "QUALITY_PASS"
    quality_reason: Optional[str] = None
    liveness_status: str = "BYPASSED"
    track_id: Optional[int] = None
    frame_index: Optional[int] = None
    timestamp: Optional[float] = None
    raw_decision: Optional[str] = None
    rankings: List[Dict[str, Any]] = field(default_factory=list)
    recognition_source: str = "NEW_RECOGNITION"



# -----------------------------------------------------------------------------
# Headless Face Recognition Service
# -----------------------------------------------------------------------------

class FaceRecognitionService:
    """Production headless service for multi-employee face detection and recognition.

    Encapsulates YuNet and ArcFace ONNX models, loading them strictly once during
    service initialization. Provides a pure BGR numpy frame processing API without
    GUI windows, display callbacks, or camera hardware locks.
    """

    def __init__(
        self,
        recognition_threshold: Optional[float] = RECOGNITION_THRESHOLD,
        min_match_margin: float = DEFAULT_MIN_MATCH_MARGIN,
        strict_boundary: bool = False,
        score_threshold: float = YUNET_SCORE_THRESHOLD_STATIC,
        nms_threshold: float = YUNET_NMS_THRESHOLD,
        top_k: int = YUNET_TOP_K,
        use_track_policy: bool = True,
        track_revalidation_interval: int = TRACK_REVALIDATION_INTERVAL_FRAMES,
        track_unknown_retry_interval: int = TRACK_UNKNOWN_RETRY_INTERVAL_FRAMES,
        track_max_missed_frames: int = TRACK_MAX_MISSED_FRAMES,
        track_max_consecutive_low_quality: int = TRACK_MAX_CONSECUTIVE_LOW_QUALITY,
    ):
        """Initializes the face recognition service, models, and employee registry.

        Args:
            recognition_threshold: Minimum cosine similarity to accept a face as RECOGNIZED.
            min_match_margin: Minimum margin required between Top-1 and Top-2 to prevent ambiguity.
            strict_boundary: Whether faces touching frame edges are rejected immediately.
            score_threshold: YuNet face detection confidence threshold.
            nms_threshold: YuNet non-maximum suppression threshold.
            top_k: YuNet maximum bounding boxes before NMS.
            use_track_policy: Whether track-based recognition scheduling is enabled.
            track_revalidation_interval: Frames between ArcFace revalidation on confirmed tracks.
            track_unknown_retry_interval: Frames between ArcFace retries on unconfirmed/unknown tracks.
            track_max_missed_frames: Frames before a lost track's state is pruned.
            track_max_consecutive_low_quality: Frames of low quality before confirmed track is invalidated.
        """
        self.recognition_threshold = recognition_threshold
        self.min_match_margin = min_match_margin
        self.strict_boundary = strict_boundary
        self.score_threshold = score_threshold
        self.nms_threshold = nms_threshold
        self.top_k = top_k
        self.use_track_policy = use_track_policy

        # Frame counter & timing state
        self._frame_count = 0
        self._arcface_call_count = 0
        self._current_input_size: Optional[Tuple[int, int]] = None

        # 1. Initialize YuNet Detector (Loaded Once)
        if not YUNET_MODEL_PATH.exists():
            raise FileNotFoundError(f"YuNet ONNX model not found: {YUNET_MODEL_PATH}")

        self.detector = cv2.FaceDetectorYN.create(
            str(YUNET_MODEL_PATH),
            "",
            (640, 480),
            self.score_threshold,
            self.nms_threshold,
            self.top_k,
        )

        # 2. Initialize ArcFace Feature Extractor (Loaded Once)
        if not ARCFACE_MODEL_PATH.exists():
            raise FileNotFoundError(f"ArcFace ONNX model not found: {ARCFACE_MODEL_PATH}")

        self.arcface = get_model(
            str(ARCFACE_MODEL_PATH),
            providers=["CPUExecutionProvider"],
        )
        self.arcface.prepare(ctx_id=0)

        # 3. Load Active Employee Registry (Cached in Memory)
        self.active_employees: Dict[str, Dict[str, Any]] = {}
        self.reload_employee_registry()

        # 4. Initialize Multi-Face Tracker & Track Recognition Policy
        self.tracker = MultiFaceTracker(max_missed=track_max_missed_frames)
        self.track_policy = TrackRecognitionPolicy(
            revalidation_interval=track_revalidation_interval,
            unknown_retry_interval=track_unknown_retry_interval,
            max_missed_frames=track_max_missed_frames,
            max_consecutive_low_quality=track_max_consecutive_low_quality,
            recognition_threshold=self.recognition_threshold or RECOGNITION_THRESHOLD,
            min_match_margin=self.min_match_margin,
        )

    @property
    def arcface_call_count(self) -> int:
        """Returns the total number of ArcFace neural inference passes executed."""
        return self._arcface_call_count

    def reset_arcface_call_count(self) -> None:
        """Resets the ArcFace neural inference call counter to 0."""
        self._arcface_call_count = 0

    @property
    def active_employee_count(self) -> int:
        """Returns the number of currently active employees in memory."""
        return len(self.active_employees)

    @property
    def registered_employee_ids(self) -> List[str]:
        """Returns the list of all active employee IDs currently in memory."""
        return sorted(list(self.active_employees.keys()))

    def reload_employee_registry(self) -> int:
        """Reloads active employee reference embeddings from disk into memory.

        Returns:
            Number of active employee records loaded.
        """
        self.active_employees = load_all_active_embeddings()
        return len(self.active_employees)

    def reset_tracker(self) -> None:
        """Resets the internal multi-face tracker, liveness histories, and track recognition policy."""
        self.tracker = MultiFaceTracker()
        self.track_policy.reset()

    def process_frame(
        self,
        frame: np.ndarray,
        timestamp: Optional[float] = None,
        enable_liveness: bool = True,
        use_track_policy: Optional[bool] = None,
    ) -> List[FaceRecognitionResult]:
        """Processes a single BGR OpenCV frame and returns structured face recognition results.

        Pipeline:
        1. YuNet face detection & multi-face extraction.
        2. Spatial tracking association across frames (IoU & centroid).
        3. Face crop extraction & quality gating (size, blur, exposure, boundary).
        4. Temporal liveness verification (if enabled).
        5. Track recognition policy evaluation (determines whether to run ArcFace or reuse identity).
        6. Shared preprocessing (LAB -> CLAHE -> Gamma -> Denoising -> Unsharp).
        7. Canonical 5-point affine alignment (112x112).
        8. ArcFace 512-D feature vector extraction & L2-normalization.
        9. Cosine similarity matching, UNKNOWN filtering, and ambiguity guarding.

        Args:
            frame: Input BGR image as numpy array of shape (height, width, 3).
            timestamp: Optional epoch timestamp. Defaults to current time if None.
            enable_liveness: Whether temporal liveness tracking is evaluated. Set to False
                for static image testing or single-image processing.
            use_track_policy: Optional override for track recognition policy. Defaults to
                self.use_track_policy if None.

        Returns:
            List of FaceRecognitionResult instances, one for each detected face in the frame.
        """
        if frame is None or frame.size == 0:
            return []

        use_policy = self.use_track_policy if use_track_policy is None else use_track_policy

        self._frame_count += 1
        frame_idx = self._frame_count
        frame_time = timestamp if timestamp is not None else time.time()

        h, w = frame.shape[:2]

        # Dynamically synchronize YuNet input size if frame dimensions changed
        if self._current_input_size != (w, h):
            self.detector.setInputSize((w, h))
            self._current_input_size = (w, h)

        # 1. Run YuNet face detection
        _, faces = self.detector.detect(frame)
        if faces is None or len(faces) == 0:
            self.tracker.update([])
            if use_policy:
                self.track_policy.update_active_tracks(set())
            return []


        # 2. Extract bounding boxes and 5-point landmarks
        raw_detections: List[Tuple[Tuple[int, int, int, int], np.ndarray]] = []
        for face in faces:
            bx, by, bw, bh = map(int, face[0:4])
            landmarks = face[4:14].reshape(5, 2)
            raw_detections.append(((bx, by, bw, bh), landmarks))

        # 3. Associate detections with persistent spatial tracks
        active_tracks = self.tracker.update(raw_detections)

        # Synchronize track policy with active tracks
        active_track_ids = {t.track_id for t in active_tracks}
        if use_policy:
            self.track_policy.update_active_tracks(active_track_ids)

        # Pre-compute grayscale frame if liveness is active
        gray_frame: Optional[np.ndarray] = None
        if enable_liveness:
            gray_frame = cv2.cvtColor(frame, cv2.COLOR_BGR2GRAY)

        results: List[FaceRecognitionResult] = []

        # 4. Process each detected face independently
        for track in active_tracks:
            bbox = track.bbox
            landmarks = track.landmarks
            track_id = track.track_id
            bx, by, bw, bh = bbox

            # 4a. Face Quality & Boundary Clipping Check
            quality_ok, quality_msg, face_crop = check_face_crop_quality(
                frame,
                bbox,
                strict_boundary=self.strict_boundary,
            )

            if not quality_ok or face_crop is None:
                if use_policy:
                    self.track_policy.record_quality_failure(track_id, bbox)
                is_clipped = "Edge clipped" in quality_msg
                results.append(
                    FaceRecognitionResult(
                        employee_id=None,
                        name=None,
                        status="LOW_QUALITY",
                        similarity=None,
                        bbox=bbox,
                        landmarks=landmarks,
                        quality_status="PARTIALLY_VISIBLE" if is_clipped else "LOW_QUALITY",
                        quality_reason=quality_msg,
                        liveness_status="BYPASSED",
                        track_id=track_id,
                        frame_index=frame_idx,
                        timestamp=frame_time,
                        raw_decision=quality_msg,
                        recognition_source="BYPASSED",
                    )
                )
                continue

            # 4b. Temporal Liveness Verification
            if enable_liveness and gray_frame is not None:
                is_live, live_state, motion_score = track.liveness_tracker.update(
                    bbox,
                    landmarks,
                    gray_frame,
                )

                if live_state != "LIVE":
                    if use_policy:
                        self.track_policy.record_liveness_failure(track_id, live_state)
                    is_spoof = ("SPOOF" in live_state) or ("FAILED" in live_state)
                    status_label = "SPOOF" if is_spoof else "CHECKING_LIVENESS"
                    results.append(
                        FaceRecognitionResult(
                            employee_id=None,
                            name=None,
                            status=status_label,
                            similarity=None,
                            bbox=bbox,
                            landmarks=landmarks,
                            quality_status="QUALITY_PASS",
                            quality_reason="Quality checks passed",
                            liveness_status=live_state,
                            track_id=track_id,
                            frame_index=frame_idx,
                            timestamp=frame_time,
                            raw_decision=f"Liveness state: {live_state}",
                            recognition_source="BYPASSED",
                        )
                    )
                    continue
                else:
                    liveness_label = "LIVE"
            else:
                liveness_label = "BYPASSED"

            # 4c. Track Recognition Policy Decision (Skip ArcFace if already confirmed or waiting retry)
            reason_code = "POLICY_DISABLED"
            if use_policy:
                should_run, reason_code = self.track_policy.should_recognize(track_id, frame_idx)
                if not should_run:
                    cached = self.track_policy.get_track_state(track_id)
                    if cached is not None and cached.identity_confirmation_state == "CONFIRMED":
                        results.append(
                            FaceRecognitionResult(
                                employee_id=cached.employee_id,
                                name=cached.name,
                                status="RECOGNIZED",
                                similarity=cached.similarity,
                                second_candidate=cached.second_candidate,
                                second_similarity=cached.second_similarity,
                                margin=cached.margin,
                                bbox=bbox,
                                landmarks=landmarks,
                                quality_status="QUALITY_PASS",
                                quality_reason="Quality checks passed",
                                liveness_status=liveness_label,
                                track_id=track_id,
                                frame_index=frame_idx,
                                timestamp=frame_time,
                                raw_decision=f"Confirmed identity reused from track (Reason: {reason_code})",
                                rankings=cached.rankings,
                                recognition_source="REUSED_FROM_TRACK",
                            )
                        )
                        continue
                    elif cached is not None and cached.identity_confirmation_state in ("UNKNOWN", "AMBIGUOUS", "VERIFYING"):
                        results.append(
                            FaceRecognitionResult(
                                employee_id=None,
                                name=None,
                                status=cached.recognition_status,
                                similarity=cached.similarity,
                                second_candidate=cached.second_candidate,
                                second_similarity=cached.second_similarity,
                                margin=cached.margin,
                                bbox=bbox,
                                landmarks=landmarks,
                                quality_status="QUALITY_PASS",
                                quality_reason="Quality checks passed",
                                liveness_status=liveness_label,
                                track_id=track_id,
                                frame_index=frame_idx,
                                timestamp=frame_time,
                                raw_decision=f"Unconfirmed identity retry backoff (Reason: {reason_code})",
                                rankings=cached.rankings,
                                recognition_source="REUSED_FROM_TRACK",
                            )
                        )
                        continue

            # 4d. Shared Preprocessing (Exact Match to Enrollment Pipeline)
            working_frame = frame.copy()
            x1, y1 = max(0, bx), max(0, by)
            x2, y2 = min(w, bx + bw), min(h, by + bh)

            try:
                enhanced_crop = preprocess_face(face_crop)
                working_frame[y1:y2, x1:x2] = enhanced_crop
            except Exception:
                pass  # Fall back to raw crop if enhancement encounters an unexpected format

            # 4e. 5-Point Affine Landmark Alignment to 112x112
            transform, _ = cv2.estimateAffinePartial2D(
                landmarks.astype(np.float32),
                REFERENCE_POINTS,
                method=cv2.LMEDS,
            )

            if transform is None:
                results.append(
                    FaceRecognitionResult(
                        employee_id=None,
                        name=None,
                        status="LOW_QUALITY",
                        similarity=None,
                        bbox=bbox,
                        landmarks=landmarks,
                        quality_status="LOW_QUALITY",
                        quality_reason="Affine alignment estimation failed",
                        liveness_status=liveness_label,
                        track_id=track_id,
                        frame_index=frame_idx,
                        timestamp=frame_time,
                        raw_decision="Affine alignment estimation failed",
                        recognition_source="BYPASSED",
                    )
                )
                continue

            aligned_face = cv2.warpAffine(working_frame, transform, ALIGNMENT_SIZE)

            # 4f. ArcFace Feature Extraction & Employee Candidate Matching
            self._arcface_call_count += 1
            decision = evaluate_multi_employee_match(
                aligned_face=aligned_face,
                arcface_model=self.arcface,
                active_employees=self.active_employees,
                recognition_threshold=self.recognition_threshold,
                min_match_margin=self.min_match_margin,
            )

            raw_status = decision.get("status", "")
            top_cand = decision.get("top_candidate")
            top_name = decision.get("top_name")
            top_sim = decision.get("top_similarity")
            sec_cand = decision.get("second_candidate")
            sec_sim = decision.get("second_similarity")
            margin = decision.get("margin")
            rankings = decision.get("rankings", [])

            # Standardize decision status
            if raw_status.startswith("RECOGNIZED:"):
                canonical_status = "RECOGNIZED"
                final_emp_id = top_cand
                final_name = top_name
            elif raw_status == "UNKNOWN / NOT REGISTERED":
                canonical_status = "UNKNOWN"
                final_emp_id = None
                final_name = None
            elif "UNCERTAIN" in raw_status or "AMBIGUOUS" in raw_status:
                canonical_status = "AMBIGUOUS"
                final_emp_id = None
                final_name = None
            else:
                canonical_status = "UNKNOWN"
                final_emp_id = None
                final_name = None

            if reason_code == "REVALIDATE":
                rec_source = "REVALIDATED"
            else:
                rec_source = "NEW_RECOGNITION"

            # Update track recognition policy
            if use_policy:
                self.track_policy.record_recognition(
                    track_id=track_id,
                    frame_idx=frame_idx,
                    timestamp=frame_time,
                    bbox=bbox,
                    liveness_status=liveness_label,
                    employee_id=final_emp_id,
                    name=final_name,
                    status=canonical_status,
                    similarity=top_sim,
                    second_candidate=sec_cand,
                    second_similarity=sec_sim,
                    margin=margin,
                    rankings=rankings,
                    raw_decision=raw_status,
                )
                state = self.track_policy.get_track_state(track_id)
                if state and state.identity_confirmation_state != "CONFIRMED":
                    final_emp_id = None
                    final_name = None
                    canonical_status = "UNKNOWN" if state.identity_confirmation_state == "UNKNOWN" else "CHECKING_IDENTITY"

            results.append(
                FaceRecognitionResult(
                    employee_id=final_emp_id,
                    name=final_name,
                    status=canonical_status,
                    similarity=top_sim,
                    second_candidate=sec_cand,
                    second_similarity=sec_sim,
                    margin=margin,
                    bbox=bbox,
                    landmarks=landmarks,
                    quality_status="QUALITY_PASS",
                    quality_reason="Quality checks passed",
                    liveness_status=liveness_label,
                    track_id=track_id,
                    frame_index=frame_idx,
                    timestamp=frame_time,
                    raw_decision=raw_status,
                    rankings=rankings,
                    recognition_source=rec_source,
                )
            )

        return results


    def process_image(self, image: np.ndarray) -> List[FaceRecognitionResult]:
        """Convenience method for processing static images with liveness bypassed.

        Args:
            image: Input BGR image as numpy array.

        Returns:
            List of FaceRecognitionResult instances.
        """
        return self.process_frame(image, enable_liveness=False)
