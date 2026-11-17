"""Track-Based Face Recognition Policy Module.

Provides intelligent recognition scheduling per persistent spatial track to drastically
reduce redundant ArcFace neural inference cycles on video frames while maintaining strict
safety guards against drift, ambiguity, liveness failures, and identity theft.
"""

from __future__ import annotations

import sys
from collections import deque
from dataclasses import dataclass, field
from pathlib import Path
from typing import Dict, List, Optional, Set, Tuple, Any

# Ensure parent and face paths are in sys.path
_SERVICE_DIR = Path(__file__).resolve().parent
_FACE_DIR = _SERVICE_DIR.parent
if str(_FACE_DIR) not in sys.path:
    sys.path.append(str(_FACE_DIR))

from face_config import (
    TRACK_REVALIDATION_INTERVAL_FRAMES,
    TRACK_UNKNOWN_RETRY_INTERVAL_FRAMES,
    TRACK_MAX_MISSED_FRAMES,
    TRACK_MAX_CONSECUTIVE_LOW_QUALITY,
    RECOGNITION_THRESHOLD,
    DEFAULT_MIN_MATCH_MARGIN,
)


@dataclass
class TrackState:
    """Maintains persistent recognition, quality, and confirmation state for a tracked face.

    Attributes:
        track_id: Unique spatial tracking identifier.
        employee_id: Identifier of confirmed employee (None if UNKNOWN, AMBIGUOUS, or INVALIDATED).
        name: Human-readable display name of confirmed employee.
        recognition_status: Canonical recognition status ("RECOGNIZED", "UNKNOWN", "AMBIGUOUS", "INVALIDATED", etc.).
        similarity: Cosine similarity score from the most recent ArcFace recognition pass.
        confidence: Alias for similarity score.
        second_candidate: Employee ID of runner-up candidate.
        second_similarity: Cosine similarity of runner-up candidate.
        margin: Match separation margin between top-1 and top-2 candidates.
        liveness_status: Temporal liveness evaluation label ("LIVE", "CHECKING_LIVENESS", "SPOOF", "BYPASSED").
        last_recognition_frame: Frame index when ArcFace inference was last executed.
        last_recognition_timestamp: Epoch timestamp of the last ArcFace inference pass.
        recognition_count: Total number of times ArcFace inference was executed for this track.
        bbox: Bounding box tuple (x, y, width, height) of the face.
        identity_confirmation_state: State of identity confirmation ("UNCONFIRMED", "CONFIRMED", "UNKNOWN", "AMBIGUOUS", "INVALIDATED").
        consecutive_low_quality_frames: Count of consecutive frames where face crop failed quality gates.
        missed_frames: Count of consecutive frames where this track was not detected.
        first_frame: Frame index when this track was first observed.
        last_seen_frame: Frame index when this track was most recently observed.
        rankings: Candidate ranking list from most recent evaluation.
        raw_decision: Unmodified raw decision string from recognition engine.
    """
    track_id: int
    employee_id: Optional[str] = None
    name: Optional[str] = None
    recognition_status: str = "UNPROCESSED"
    similarity: Optional[float] = None
    confidence: Optional[float] = None
    second_candidate: Optional[str] = None
    second_similarity: Optional[float] = None
    margin: Optional[float] = None
    liveness_status: str = "BYPASSED"
    last_recognition_frame: Optional[int] = None
    last_recognition_timestamp: Optional[float] = None
    recognition_count: int = 0
    bbox: Tuple[int, int, int, int] = (0, 0, 0, 0)
    identity_confirmation_state: str = "UNCONFIRMED"
    consecutive_low_quality_frames: int = 0
    missed_frames: int = 0
    first_frame: int = 0
    last_seen_frame: int = 0
    rankings: List[Dict[str, Any]] = field(default_factory=list)
    raw_decision: Optional[str] = None
    recent_votes: Any = field(default_factory=lambda: deque(maxlen=5))


class TrackRecognitionPolicy:
    """Policy engine governing when to trigger ArcFace neural inference vs reuse confirmed track identity.

    Guarantees:
    1. New tracks undergo full quality, liveness, and ArcFace recognition.
    2. Once confirmed, identity is cached and reused on intermediate frames, saving inference cycles.
    3. Confirmed tracks are periodically revalidated every `revalidation_interval` frames.
    4. Unconfirmed/UNKNOWN tracks are retried with an exponential/linear backoff window (`unknown_retry_interval`).
    5. Ambiguous faces (margin < min_margin) are NEVER cached as confirmed employees.
    6. Unknown faces (similarity < threshold) are NEVER cached as confirmed employees.
    7. Tracks that fail liveness (SPOOF / FAILED) or suffer prolonged low quality are immediately invalidated.
    8. Disappeared tracks (`missed_frames > max_missed_frames`) have their states pruned.
    """

    def __init__(
        self,
        revalidation_interval: int = TRACK_REVALIDATION_INTERVAL_FRAMES,
        unknown_retry_interval: int = TRACK_UNKNOWN_RETRY_INTERVAL_FRAMES,
        max_missed_frames: int = TRACK_MAX_MISSED_FRAMES,
        max_consecutive_low_quality: int = TRACK_MAX_CONSECUTIVE_LOW_QUALITY,
        recognition_threshold: float = RECOGNITION_THRESHOLD,
        min_match_margin: float = DEFAULT_MIN_MATCH_MARGIN,
    ):
        """Initializes the track recognition policy with configurable scheduling parameters."""
        self.revalidation_interval = max(1, revalidation_interval)
        self.unknown_retry_interval = max(1, unknown_retry_interval)
        self.max_missed_frames = max(1, max_missed_frames)
        self.max_consecutive_low_quality = max(1, max_consecutive_low_quality)
        self.recognition_threshold = recognition_threshold
        self.min_match_margin = min_match_margin

        self.tracks: Dict[int, TrackState] = {}

    @property
    def active_track_count(self) -> int:
        """Returns the number of currently tracked states."""
        return len(self.tracks)

    def get_track_state(self, track_id: int) -> Optional[TrackState]:
        """Retrieves current track state if present."""
        return self.tracks.get(track_id)

    def should_recognize(self, track_id: int, frame_idx: int) -> Tuple[bool, str]:
        """Evaluates whether ArcFace neural inference must be executed for the given track on `frame_idx`.

        Args:
            track_id: Spatial track ID.
            frame_idx: Current sequential frame index.

        Returns:
            Tuple of (should_run_arcface: bool, reason_code: str).
            Reason codes:
                "NEW_TRACK": First observation of this track; requires initial recognition.
                "REVALIDATE": Confirmed track revalidation interval elapsed; scheduled for check.
                "RETRY_UNKNOWN": Unknown track retry interval elapsed; re-evaluating.
                "RETRY_AMBIGUOUS": Ambiguous track retry interval elapsed; re-evaluating.
                "RETRY_AFTER_INVALIDATION": Track previously invalidated; evaluating fresh observation.
                "REUSE_CONFIRMED": Confirmed track within validity window; ArcFace skipped.
                "WAIT_RETRY": Unknown or ambiguous track within backoff window; ArcFace skipped.
        """
        state = self.tracks.get(track_id)

        # 1. New track -> must run ArcFace
        if state is None or state.last_recognition_frame is None:
            return True, "NEW_TRACK"

        # 2. Confirmed track -> check revalidation schedule
        if state.identity_confirmation_state == "CONFIRMED":
            frames_since_rec = frame_idx - state.last_recognition_frame
            if frames_since_rec >= self.revalidation_interval:
                return True, "REVALIDATE"
            return False, "REUSE_CONFIRMED"

        # 3. Unknown track -> check retry schedule
        if state.identity_confirmation_state == "UNKNOWN":
            frames_since_rec = frame_idx - state.last_recognition_frame
            if frames_since_rec >= self.unknown_retry_interval:
                return True, "RETRY_UNKNOWN"
            return False, "WAIT_RETRY"

        # 4. Ambiguous track -> check retry schedule
        if state.identity_confirmation_state == "AMBIGUOUS":
            frames_since_rec = frame_idx - state.last_recognition_frame
            if frames_since_rec >= self.unknown_retry_interval:
                return True, "RETRY_AMBIGUOUS"
            return False, "WAIT_RETRY"

        # 5. Invalidated track -> evaluate fresh observation
        if state.identity_confirmation_state == "INVALIDATED":
            return True, "RETRY_AFTER_INVALIDATION"

        # Default fallback for unconfirmed states
        return True, "NEW_TRACK"

    def record_recognition(
        self,
        track_id: int,
        frame_idx: int,
        timestamp: float,
        bbox: Tuple[int, int, int, int],
        liveness_status: str,
        employee_id: Optional[str],
        name: Optional[str],
        status: str,
        similarity: Optional[float],
        second_candidate: Optional[str] = None,
        second_similarity: Optional[float] = None,
        margin: Optional[float] = None,
        rankings: Optional[List[Dict[str, Any]]] = None,
        raw_decision: Optional[str] = None,
    ) -> TrackState:
        """Records an ArcFace inference pass and updates identity confirmation state.

        Args:
            track_id: Spatial track ID.
            frame_idx: Frame index of inference pass.
            timestamp: Timestamp of frame.
            bbox: Bounding box tuple.
            liveness_status: Liveness status at inference time.
            employee_id: Recognized employee ID (None if unknown or ambiguous).
            name: Recognized employee display name.
            status: Canonical status label ("RECOGNIZED", "UNKNOWN", "AMBIGUOUS").
            similarity: Top cosine similarity.
            second_candidate: Runner up candidate.
            second_similarity: Runner up similarity.
            margin: Score separation.
            rankings: Candidate ranking list.
            raw_decision: Raw decision text.

        Returns:
            Updated TrackState instance.
        """
        state = self.tracks.get(track_id)
        if state is None:
            state = TrackState(track_id=track_id, first_frame=frame_idx)
            self.tracks[track_id] = state

        # Require three votes for the same identity in a five-observation window.
        state.recent_votes.append(employee_id if status == "RECOGNIZED" else None)
        votes = list(state.recent_votes)
        if status == "RECOGNIZED" and employee_id is not None and votes.count(employee_id) >= 3:
            confirmation_state = "CONFIRMED"
        elif status == "RECOGNIZED" and employee_id is not None:
            confirmation_state = "VERIFYING"
            employee_id = None
            name = None
            status = "CHECKING_IDENTITY"
        elif len(votes) >= 3 and votes.count(None) >= 3:
            confirmation_state = "UNKNOWN"
        elif status == "AMBIGUOUS":
            confirmation_state = "AMBIGUOUS"
            employee_id = None
            name = None
        else:
            confirmation_state = "VERIFYING"
            employee_id = None
            name = None

        state.employee_id = employee_id
        state.name = name
        state.recognition_status = status
        state.similarity = similarity
        state.confidence = similarity
        state.second_candidate = second_candidate
        state.second_similarity = second_similarity
        state.margin = margin
        state.liveness_status = liveness_status
        state.last_recognition_frame = frame_idx
        state.last_recognition_timestamp = timestamp
        state.last_seen_frame = frame_idx
        state.recognition_count += 1
        state.bbox = bbox
        state.identity_confirmation_state = confirmation_state
        state.consecutive_low_quality_frames = 0
        state.missed_frames = 0
        state.rankings = rankings or []
        state.raw_decision = raw_decision

        return state

    def record_quality_failure(self, track_id: int, bbox: Tuple[int, int, int, int]) -> bool:
        """Records a quality failure for a track and invalidates if threshold exceeded.

        Returns:
            True if identity was invalidated due to prolonged low quality, False otherwise.
        """
        state = self.tracks.get(track_id)
        if state is None:
            state = TrackState(track_id=track_id)
            self.tracks[track_id] = state

        state.bbox = bbox
        state.consecutive_low_quality_frames += 1

        if (
            state.identity_confirmation_state == "CONFIRMED"
            and state.consecutive_low_quality_frames > self.max_consecutive_low_quality
        ):
            self.invalidate_track(track_id, "PROLONGED_LOW_QUALITY")
            return True

        return False

    def record_liveness_failure(self, track_id: int, liveness_state: str) -> None:
        """Invalidates track if liveness tracker detects spoof or failed motion."""
        if ("SPOOF" in liveness_state) or ("FAILED" in liveness_state):
            self.invalidate_track(track_id, f"LIVENESS_FAILED_{liveness_state}")

    def invalidate_track(self, track_id: int, reason: str = "") -> None:
        """Explicitly invalidates track identity due to security or tracking breakdown."""
        state = self.tracks.get(track_id)
        if state is not None:
            state.identity_confirmation_state = "INVALIDATED"
            state.employee_id = None
            state.name = None
            state.recognition_status = "INVALIDATED"
            state.similarity = None
            state.confidence = None
            state.raw_decision = f"Identity invalidated: {reason}"

    def update_active_tracks(self, active_track_ids: Set[int]) -> List[int]:
        """Updates tracking presence for all known tracks and prunes stale tracks.

        Args:
            active_track_ids: Set of track IDs detected in the current frame.

        Returns:
            List of track IDs that were pruned due to exceeding max_missed_frames.
        """
        stale_ids: List[int] = []

        for tid, state in self.tracks.items():
            if tid in active_track_ids:
                state.missed_frames = 0
            else:
                state.missed_frames += 1
                if state.missed_frames > self.max_missed_frames:
                    stale_ids.append(tid)

        for tid in stale_ids:
            del self.tracks[tid]

        return stale_ids

    def reset(self) -> None:
        """Clears all track states completely."""
        self.tracks.clear()
