"""Aesthetic High-Performance Gate Surveillance HUD Overlay.

Renders color-coded object boxes (PERSON, VEHICLE, ANIMAL),
tripwire gate crossing lines, telemetry KPIs, and timestamps onto video stream frames.
"""

from __future__ import annotations

import time
import os
from datetime import datetime, timezone, timedelta
from typing import Dict, List, Tuple, Any, Optional

import cv2
import numpy as np

_crossing_mode = str(os.environ.get("FACE_CROSSING_MODE", "false")).lower() == "true"
SHOW_BODY_BOX = str(os.environ.get("SHOW_BODY_BOX", "false" if _crossing_mode else "true")).lower() == "true"


def should_draw_body_box(class_name: str, show_body_box: Optional[bool] = None) -> bool:
    return class_name != "PERSON" or (SHOW_BODY_BOX if show_body_box is None else show_body_box)

IST = timezone(timedelta(hours=5, minutes=30))

# Visual color mapping (BGR)
COLOR_PERSON_REC = (0, 220, 50)       # Emerald Green
COLOR_PERSON_UNK = (0, 0, 255)        # Confirmed unknown person
COLOR_VEHICLE = (255, 180, 0)         # Cyan / Sky Blue
COLOR_ANIMAL = (0, 215, 255)          # Gold / Yellow
COLOR_OTHER = (180, 180, 180)         # Neutral Slate
COLOR_FACE_PENDING = (255, 200, 0)   # Face visible/evaluation pending
COLOR_FACE_REJECTED = (0, 255, 255)  # Face quality/pose needs attention
COLOR_FACE_NOT_VISIBLE = (150, 150, 150)
COLOR_RECOGNITION_ERROR = (180, 70, 180)


def person_status_color(status: str) -> Tuple[int, int, int]:
    return {
        "REGISTERED": COLOR_PERSON_REC,
        "UNKNOWN_PERSON": COLOR_PERSON_UNK,
        "RECOGNITION_PENDING": COLOR_FACE_PENDING,
        "LOW_FACE_QUALITY": COLOR_FACE_REJECTED,
        "FACE_NOT_VISIBLE": COLOR_FACE_NOT_VISIBLE,
        "BACK_VIEW": COLOR_FACE_NOT_VISIBLE,
        "RECOGNITION_ERROR": COLOR_RECOGNITION_ERROR,
    }.get(status, COLOR_FACE_PENDING)


def draw_gate_surveillance_hud(
    frame: np.ndarray,
    tracks_info: List[Dict[str, Any]],
    camera_id: str,
    event_type: str,
    fps: float,
    tripwire_normalized_y: float = 0.58,
    stats: Dict[str, Any] = None,
) -> np.ndarray:
    """Draws rich multi-class surveillance overlay on the camera frame."""
    if frame is None or frame.size == 0:
        return frame

    display = frame.copy()
    h, w = display.shape[:2]

    # 1. Draw Virtual Tripwire Gate Line
    line_y = int(tripwire_normalized_y * h) if tripwire_normalized_y <= 1.0 else int(tripwire_normalized_y)
    line_color = (0, 220, 100) if event_type == "IN" else (0, 100, 255)

    # Semi-transparent tripwire glow
    overlay = display.copy()
    cv2.line(overlay, (40, line_y), (w - 40, line_y), line_color, 3)
    cv2.addWeighted(overlay, 0.7, display, 0.3, 0, display)

    # Tripwire marker badge
    tag_text = f"--- {camera_id} {event_type} TRIPWIRE GATE BOUNDARY ---"
    cv2.putText(
        display,
        tag_text,
        (w // 2 - 200, max(25, line_y - 8)),
        cv2.FONT_HERSHEY_SIMPLEX,
        0.45,
        line_color,
        1,
        cv2.LINE_AA,
    )

    # Count categories for bottom telemetry
    counts = {"PERSON": 0, "VEHICLE": 0, "ANIMAL": 0}

    # 2. Draw Classified Track Boxes
    for t in tracks_info:
        cls_name = t.get("class", "OTHER")
        sub_label = t.get("sub_label", "").title()
        name = t.get("name") or "Unknown"
        event_label = t.get("event_type")
        tid = t.get("track_id", 0)
        face_state = t.get("face_state")
        recognition_status = t.get("recognition_status")
        orientation = t.get("human_orientation") or "UNKNOWN_ORIENTATION"

        counts[cls_name] = counts.get(cls_name, 0) + 1

        bx1, by1, bx2, by2 = t.get("bbox", (0, 0, 0, 0))
        if bx2 <= bx1 or by2 <= by1:
            continue

        # Choose box color
        if cls_name == "PERSON":
            legacy_status = "REGISTERED" if face_state == "CONFIRMED" else "UNKNOWN_PERSON" if face_state == "UNKNOWN" else None
            recognition_status = recognition_status or legacy_status or "RECOGNITION_PENDING"
            color = person_status_color(recognition_status)
            status_label = recognition_status.replace("_", " ")
            similarity = t.get("similarity")
            score_label = f" {float(similarity) * 100:.1f}%" if similarity is not None else ""
            badge_title = f"[{status_label}] {name} #{tid} {orientation}{score_label}"
        elif cls_name == "VEHICLE":
            color = COLOR_VEHICLE
            badge_title = f"[VEHICLE] {sub_label}: {name}" if name and name != sub_label else f"[VEHICLE] {sub_label}"
        elif cls_name == "ANIMAL":
            color = COLOR_ANIMAL
            badge_title = f"[ANIMAL] {name.upper()}"
        else:
            color = COLOR_OTHER
            badge_title = f"[OBJECT #{tid}]"

        # Person body boxes are hidden by default; the YuNet face box remains.
        if should_draw_body_box(cls_name):
            cv2.rectangle(display, (bx1, by1), (bx2, by2), color, 2)
            corner_len = min(15, (bx2 - bx1) // 4, (by2 - by1) // 4)
            if corner_len > 4:
                cv2.line(display, (bx1, by1), (bx1 + corner_len, by1), color, 4)
                cv2.line(display, (bx1, by1), (bx1, by1 + corner_len), color, 4)
                cv2.line(display, (bx2, by2), (bx2 - corner_len, by2), color, 4)
                cv2.line(display, (bx2, by2), (bx2, by2 - corner_len), color, 4)

        # Keep the body label attached to its body box. In face-only mode the
        # face box below carries the person's state and score instead.
        if should_draw_body_box(cls_name):
            (tw, th), _ = cv2.getTextSize(badge_title, cv2.FONT_HERSHEY_SIMPLEX, 0.42, 1)
            pill_y1 = max(0, by1 - th - 8)
            pill_y2 = by1
            pill_x1 = max(0, bx1)
            pill_x2 = min(w, bx1 + tw + 14)

            cv2.rectangle(display, (pill_x1, pill_y1), (pill_x2, pill_y2), color, -1)
            text_color = (15, 23, 42) if color in (COLOR_PERSON_REC, COLOR_ANIMAL, COLOR_VEHICLE, COLOR_FACE_PENDING) else (255, 255, 255)
            cv2.putText(
                display,
                badge_title,
                (pill_x1 + 6, by1 - 4),
                cv2.FONT_HERSHEY_SIMPLEX,
                0.42,
                text_color,
                1,
                cv2.LINE_AA,
            )

        # The smaller YuNet box shows the actual face being evaluated, separate
        # from the YOLO person/body box above.
        face_bbox = t.get("face_bbox")
        if cls_name == "PERSON" and face_bbox:
            fx, fy, fw, fh = map(int, face_bbox)
            if fw > 0 and fh > 0:
                face_color = person_status_color(recognition_status)
                cv2.rectangle(display, (fx, fy), (fx + fw, fy + fh), face_color, 2)
                face_label = f"#{tid} {orientation} {recognition_status.replace('_', ' ')} {float(t.get('best_face_score') or 0.0):.2f}"
                cv2.putText(display, face_label, (fx, max(12, fy - 4)), cv2.FONT_HERSHEY_SIMPLEX, 0.38, face_color, 1, cv2.LINE_AA)
                for point in t.get("face_landmarks") or []:
                    px, py = int(round(point[0])), int(round(point[1]))
                    cv2.circle(display, (px, py), 4, (0, 255, 255), -1, cv2.LINE_AA)
                    cv2.circle(display, (px, py), 5, (10, 15, 26), 1, cv2.LINE_AA)

    # 3. Top Banner HUD (Live Status, Time, and Category Tallies)
    hud_bg = display[0:36, 0:w].copy()
    cv2.rectangle(hud_bg, (0, 0), (w, 36), (10, 15, 26), -1)
    cv2.addWeighted(hud_bg, 0.82, display[0:36, 0:w], 0.18, 0, display[0:36, 0:w])

    # Left: Camera ID and Live dot
    cv2.circle(display, (18, 18), 5, (0, 220, 50), -1)
    cam_title = f"{camera_id} • GATE {event_type} (LIVE)"
    cv2.putText(display, cam_title, (32, 23), cv2.FONT_HERSHEY_SIMPLEX, 0.52, (240, 240, 240), 1, cv2.LINE_AA)

    # Center: Real-Time Active Category Counts
    counts_str = f"PERSONS: {counts['PERSON']}   VEHICLES: {counts['VEHICLE']}   ANIMALS: {counts['ANIMAL']}"
    (cw, ch), _ = cv2.getTextSize(counts_str, cv2.FONT_HERSHEY_SIMPLEX, 0.42, 1)
    cv2.putText(
        display,
        counts_str,
        (w // 2 - cw // 2, 23),
        cv2.FONT_HERSHEY_SIMPLEX,
        0.42,
        (200, 220, 255),
        1,
        cv2.LINE_AA,
    )

    # Right: FPS & Wall Clock in IST
    ist_time = datetime.now(IST).strftime("%H:%M:%S IST")
    right_info = f"{fps:.1f} FPS | {ist_time}"
    (rw, rh), _ = cv2.getTextSize(right_info, cv2.FONT_HERSHEY_SIMPLEX, 0.45, 1)
    cv2.putText(
        display,
        right_info,
        (w - rw - 16, 23),
        cv2.FONT_HERSHEY_SIMPLEX,
        0.45,
        (160, 200, 255),
        1,
        cv2.LINE_AA,
    )

    return display
