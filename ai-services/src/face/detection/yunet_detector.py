"""
YuNet Face Detection Module using OpenCV's FaceDetectorYN API.

Pipeline:
Image (test.jpg) -> OpenCV -> YuNet ONNX Model -> Face Detection ->
Bounding Box & 5 Facial Landmarks -> Draw Annotations -> Save Result -> Display Result
"""

from pathlib import Path
import sys
import cv2


def main():
    # -------------------------------------------------------------------------
    # 1. Determine Project Root and File Paths Dynamically
    # -------------------------------------------------------------------------
    # Path of this file: ai-services/src/face/detection/yunet_detector.py
    # .parent: ai-services/src/face/detection
    # .parent.parent: ai-services/src/face
    # .parent.parent.parent: ai-services/src
    # .parent.parent.parent.parent: ai-services (project root)
    project_root = Path(__file__).resolve().parent.parent.parent.parent

    # Path to the official OpenCV Zoo YuNet ONNX model
    model_path = project_root / "models" / "yunet" / "face_detection_yunet_2023mar.onnx"

    # Input test image path
    image_path = project_root / "test.jpg"

    # Output annotated image path
    output_path = project_root / "yunet_result.jpg"

    # -------------------------------------------------------------------------
    # 2. Check Prerequisites: Model and Test Image Existence
    # -------------------------------------------------------------------------
    if not model_path.exists():
        print(f"ERROR: YuNet ONNX model not found at expected path:\n  {model_path}")
        print("Please ensure the official YuNet ONNX model is placed in models/yunet/.")
        sys.exit(1)

    if not image_path.exists():
        print(f"ERROR: Test image not found at expected path:\n  {image_path}")
        print("Please ensure test.jpg exists in the project root.")
        sys.exit(1)

    # -------------------------------------------------------------------------
    # 3. Load the Test Image
    # -------------------------------------------------------------------------
    image = cv2.imread(str(image_path))
    if image is None:
        print(f"ERROR: Failed to load image from {image_path}")
        sys.exit(1)

    # Extract dynamic dimensions from the actual image (height, width)
    height, width = image.shape[:2]

    # Print OpenCV and image information
    print(f"OpenCV version: {cv2.__version__}")
    print(f"Image width: {width}")
    print(f"Image height: {height}")

    # -------------------------------------------------------------------------
    # 4. Initialize YuNet Face Detector (cv2.FaceDetectorYN)
    # -------------------------------------------------------------------------
    # Parameters:
    # - model: Path to the ONNX model file
    # - config: Empty string for ONNX models
    # - input_size: (width, height) tuple matching the image dimensions
    # - score_threshold: Minimum confidence score to filter detections (default 0.8)
    # - nms_threshold: Non-Maximum Suppression threshold (default 0.3)
    # - top_k: Maximum number of bounding boxes kept before NMS (default 5000)
    score_threshold = 0.8
    nms_threshold = 0.3
    top_k = 5000

    detector = cv2.FaceDetectorYN.create(
        model=str(model_path),
        config="",
        input_size=(width, height),
        score_threshold=score_threshold,
        nms_threshold=nms_threshold,
        top_k=top_k,
    )

    # -------------------------------------------------------------------------
    # 5. Run Face Detection
    # -------------------------------------------------------------------------
    # detector.detect() returns a tuple: (retval, faces)
    # faces is a 2D numpy array of shape (N, 15), or None if no face is detected
    _, faces = detector.detect(image)

    # Create a copy of the original image for drawing annotations
    annotated_image = image.copy()

    # -------------------------------------------------------------------------
    # 6. Process Detection Results
    # -------------------------------------------------------------------------
    if faces is None or len(faces) == 0:
        print("No faces detected")
        # Save the original image as result
        cv2.imwrite(str(output_path), annotated_image)
        print(f"\nResult saved to:\n{output_path}")

        # Display the image window
        try:
            cv2.imshow("YuNet Face Detection Result", annotated_image)
            print("Press any key to close the window...")
            cv2.waitKey(0)
            cv2.destroyAllWindows()
        except Exception:
            pass
        return

    # When faces are detected:
    num_faces = len(faces)
    print(f"Faces detected: {num_faces}")

    # YuNet face array structure for each detected face (15 elements):
    # - face[0:4]: [x, y, width, height] (Bounding box)
    # - face[4:6]: [right_eye_x, right_eye_y]
    # - face[6:8]: [left_eye_x, left_eye_y]
    # - face[8:10]: [nose_tip_x, nose_tip_y]
    # - face[10:12]: [right_mouth_corner_x, right_mouth_corner_y]
    # - face[12:14]: [left_mouth_corner_x, left_mouth_corner_y]
    # - face[14]: confidence score
    for i, face in enumerate(faces):
        x = int(face[0])
        y = int(face[1])
        w = int(face[2])
        h = int(face[3])

        print(f"\nFace {i + 1}:")
        print(f"x={x}")
        print(f"y={y}")
        print(f"width={w}")
        print(f"height={h}")

        # Extract the 5 facial landmarks
        landmarks = [
            (int(face[4]), int(face[5])),    # Landmark 1: Right eye
            (int(face[6]), int(face[7])),    # Landmark 2: Left eye
            (int(face[8]), int(face[9])),    # Landmark 3: Nose tip
            (int(face[10]), int(face[11])),  # Landmark 4: Right mouth corner
            (int(face[12]), int(face[13])),  # Landmark 5: Left mouth corner
        ]

        print("\nLandmarks:")
        for idx, (lx, ly) in enumerate(landmarks, start=1):
            print(f"Landmark {idx}: ({lx}, {ly})")

        # ---------------------------------------------------------------------
        # 7. Draw Visual Annotations
        # ---------------------------------------------------------------------
        # 7a. Draw the bounding box rectangle (Green, thickness 2)
        cv2.rectangle(
            annotated_image,
            (x, y),
            (x + w, y + h),
            (0, 255, 0),
            2
        )

        # 7b. Draw the 5 facial landmarks as small solid circles (Red, radius 4)
        for lx, ly in landmarks:
            cv2.circle(
                annotated_image,
                (lx, ly),
                radius=4,
                color=(0, 0, 255),
                thickness=-1
            )

        # 7c. Draw face number label above the bounding box
        label = f"Face {i + 1}"
        label_y = max(20, y - 10)
        cv2.putText(
            annotated_image,
            label,
            (x, label_y),
            cv2.FONT_HERSHEY_SIMPLEX,
            0.6,
            (0, 255, 0),
            2
        )

    # -------------------------------------------------------------------------
    # 8. Save and Display Results
    # -------------------------------------------------------------------------
    cv2.imwrite(str(output_path), annotated_image)
    print(f"\nResult saved to:\n{output_path}")

    try:
        cv2.imshow("YuNet Face Detection Result", annotated_image)
        print("Press any key to close the window...")
        cv2.waitKey(0)
        cv2.destroyAllWindows()
    except Exception:
        pass


if __name__ == "__main__":
    main()
