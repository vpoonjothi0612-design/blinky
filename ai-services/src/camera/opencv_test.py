"""
OpenCV Verification and Image Loading Test Script.

This script verifies that OpenCV is installed correctly, loads test.jpg
from the project root using pathlib, prints image information, and displays
the image in a GUI window.
"""

from pathlib import Path
import sys
import cv2


def main():
    # 1. Determine the ai-services project root directory dynamically using pathlib
    # This file is located at: ai-services/src/camera/opencv_test.py
    # .parent -> src/camera
    # .parent.parent -> src
    # .parent.parent.parent -> ai-services (project root)
    project_root = Path(__file__).resolve().parent.parent.parent
    image_path = project_root / "test.jpg"

    # 2. Print OpenCV version
    print(f"OpenCV version: {cv2.__version__}")

    # 3. Check whether the test image exists on disk
    if not image_path.exists():
        print(f"ERROR: Image file not found at: {image_path}")
        sys.exit(1)

    # 4. Load the image using OpenCV
    image = cv2.imread(str(image_path))

    # 5. Check whether the image was successfully loaded
    if image is None:
        print(f"ERROR: Failed to read image from: {image_path}")
        sys.exit(1)

    # 6. Extract and print image dimensions
    height, width, channels = image.shape
    print(f"Image loaded successfully from: {image_path.name}")
    print(f"Image dimensions: {width} x {height} (Width x Height), Channels: {channels}")

    # 7. Display the image in an OpenCV window
    window_name = "OpenCV Test Window"
    cv2.imshow(window_name, image)
    print("Displaying image. Press any key to close the window...")

    # 8. Wait indefinitely for a key press, then destroy all windows
    cv2.waitKey(0)
    cv2.destroyAllWindows()
    print("Window closed successfully.")


if __name__ == "__main__":
    main()