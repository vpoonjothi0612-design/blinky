import cv2
import numpy as np
from pathlib import Path


# -----------------------------------
# Paths & Configuration
# -----------------------------------

BASE_DIR = Path(__file__).resolve().parents[3]

YUNET_MODEL_PATH = (
    BASE_DIR
    / "models"
    / "yunet"
    / "face_detection_yunet_2023mar.onnx"
)

SCORE_THRESHOLD = 0.5
NMS_THRESHOLD = 0.3
TOP_K = 5000
CAMERA_INDEX = 0


def main():
    print("========================================")
    print("YUNET WEBCAM DEBUGGER")
    print("========================================")

    # 1. Verify Model File
    if not YUNET_MODEL_PATH.exists():
        print(f"Error: YuNet model not found at:\n  {YUNET_MODEL_PATH}")
        return
    print(f"YuNet model       : OK ({YUNET_MODEL_PATH.name})")
    print(f"Score threshold   : {SCORE_THRESHOLD}")

    # 2. Open Camera
    print(f"\nAttempting to open camera index {CAMERA_INDEX}...")
    cap = cv2.VideoCapture(CAMERA_INDEX)

    # On Windows, try DirectShow fallback if standard open fails
    if not cap.isOpened():
        print("Standard backend failed, trying cv2.CAP_DSHOW...")
        cap = cv2.VideoCapture(CAMERA_INDEX, cv2.CAP_DSHOW)

    if not cap.isOpened():
        print(f"Error: Could not open camera {CAMERA_INDEX}.")
        print("Please verify your webcam is connected and not in use by another app.")
        return

    # 3. Read initial frame to get actual resolution
    ret, frame = cap.read()
    if not ret or frame is None:
        print("Error: Could not grab initial frame from camera.")
        cap.release()
        return

    frame_height, frame_width = frame.shape[:2]
    print(f"Camera opened     : OK")
    print(f"Resolution        : {frame_width} x {frame_height}")
    print("\nStarting video stream... (Press 'q' or ESC to exit)\n")

    # 4. Create YuNet Detector & set input size explicitly
    detector = cv2.FaceDetectorYN.create(
        str(YUNET_MODEL_PATH),
        "",
        (frame_width, frame_height),
        SCORE_THRESHOLD,
        NMS_THRESHOLD,
        TOP_K,
    )
    detector.setInputSize((frame_width, frame_height))

    first_detection_logged = False
    total_frames = 0
    total_face_frames = 0
    landmark_labels = ["Left Eye", "Right Eye", "Nose", "Left Mouth", "Right Mouth"]

    try:
        while True:
            ret, frame = cap.read()
            if not ret or frame is None:
                print("Warning: Dropped frame from camera.")
                continue

            total_frames += 1
            h, w = frame.shape[:2]

            # Update input size dynamically if resolution changes
            if (w, h) != (frame_width, frame_height):
                frame_width, frame_height = w, h
                detector.setInputSize((frame_width, frame_height))

            # Detect faces
            _, faces = detector.detect(frame)
            num_faces = 0 if faces is None else len(faces)

            display_frame = frame.copy()

            if num_faces > 0:
                total_face_frames += 1

                for idx, face in enumerate(faces):
                    # Bounding box
                    bx, by, bw, bh = map(int, face[0:4])
                    conf = float(face[-1])

                    # Draw rectangle (Green)
                    cv2.rectangle(display_frame, (bx, by), (bx + bw, by + bh), (0, 255, 0), 2)
                    cv2.putText(
                        display_frame,
                        f"Face {idx + 1}: {conf:.2f}",
                        (bx, max(20, by - 8)),
                        cv2.FONT_HERSHEY_SIMPLEX,
                        0.55,
                        (0, 255, 0),
                        2,
                    )

                    # Draw 5 landmarks (Yellow circles)
                    landmarks = face[4:14].reshape(5, 2)
                    for pt in landmarks:
                        cv2.circle(display_frame, (int(pt[0]), int(pt[1])), 4, (0, 255, 255), -1)

                    # Log the first detected face to console
                    if not first_detection_logged:
                        first_detection_logged = True
                        print("========================================")
                        print("FIRST FACE DETECTED!")
                        print("========================================")
                        print(f"Confidence   : {conf:.4f}")
                        print(f"Bounding box : [{bx}, {by}, {bw}, {bh}]")
                        print("Landmarks    :")
                        for label, pt in zip(landmark_labels, landmarks):
                            print(f"  {label:<12}: ({pt[0]:.2f}, {pt[1]:.2f})")
                        print("========================================\n")

            # On-screen HUD overlay
            hud_bg_color = (30, 30, 30)
            status_color = (0, 255, 0) if num_faces > 0 else (0, 165, 255)

            cv2.rectangle(display_frame, (10, 10), (320, 105), hud_bg_color, -1)
            cv2.rectangle(display_frame, (10, 10), (320, 105), (100, 100, 100), 1)

            cv2.putText(
                display_frame,
                "Camera: OK",
                (20, 35),
                cv2.FONT_HERSHEY_SIMPLEX,
                0.6,
                (255, 255, 255),
                2,
            )
            cv2.putText(
                display_frame,
                f"Resolution: {frame_width} x {frame_height}",
                (20, 60),
                cv2.FONT_HERSHEY_SIMPLEX,
                0.55,
                (200, 200, 200),
                1,
            )
            cv2.putText(
                display_frame,
                f"Faces: {num_faces}",
                (20, 90),
                cv2.FONT_HERSHEY_SIMPLEX,
                0.7,
                status_color,
                2,
            )

            cv2.imshow("YuNet Webcam Debugger", display_frame)

            key = cv2.waitKey(1) & 0xFF
            if key == ord("q") or key == 27:
                break

    finally:
        cap.release()
        cv2.destroyAllWindows()

        print("\n========================================")
        print("DEBUG SUMMARY")
        print("========================================")
        print(f"Total frames read   : {total_frames}")
        print(f"Face detected frames: {total_face_frames}")
        print(f"Camera resolution   : {frame_width} x {frame_height}")
        print(f"Score threshold     : {SCORE_THRESHOLD}")
        print(f"YuNet model path    : {YUNET_MODEL_PATH}")
        if total_face_frames == 0:
            print("\nDIAGNOSIS: No faces were detected.")
            print("Check:")
            print("1. Room lighting (ensure face is well illuminated).")
            print("2. Camera angle (face must be reasonably front-facing).")
            print("3. Try lowering threshold to 0.4 or 0.3 if lighting is dim.")
        else:
            print("\nSTATUS: YuNet detection verified successfully on webcam feed!")
        print("========================================")


if __name__ == "__main__":
    main()
