import cv2
from pathlib import Path


# -----------------------------------
# Paths
# -----------------------------------

BASE_DIR = Path(__file__).resolve().parents[3]

FACE_CROP_PATH = BASE_DIR / "face_crop.jpg"


# -----------------------------------
# Thresholds
# -----------------------------------

MIN_FACE_WIDTH = 120
MIN_FACE_HEIGHT = 120

MIN_SHARPNESS = 100.0

MIN_BRIGHTNESS = 60.0
MAX_BRIGHTNESS = 200.0


# -----------------------------------
# Load face
# -----------------------------------

face = cv2.imread(str(FACE_CROP_PATH))

if face is None:
    raise FileNotFoundError(
        f"Could not load face crop: {FACE_CROP_PATH}"
    )


# -----------------------------------
# Face dimensions
# -----------------------------------

height, width = face.shape[:2]

print("================================")
print("FACE QUALITY CHECK")
print("================================")

print(f"Face width: {width}")
print(f"Face height: {height}")


# -----------------------------------
# 1. Face Size Check
# -----------------------------------

size_pass = (
    width >= MIN_FACE_WIDTH
    and height >= MIN_FACE_HEIGHT
)

if size_pass:
    print("Face Size      : PASS")
else:
    print("Face Size      : REJECT")


# -----------------------------------
# Convert to grayscale
# -----------------------------------

gray = cv2.cvtColor(face, cv2.COLOR_BGR2GRAY)


# -----------------------------------
# 2. Sharpness Check
# -----------------------------------

laplacian = cv2.Laplacian(gray, cv2.CV_64F)

sharpness_score = laplacian.var()

print(f"Sharpness      : {sharpness_score:.2f}")

sharpness_pass = sharpness_score >= MIN_SHARPNESS

if sharpness_pass:
    print("Sharpness      : PASS")
else:
    print("Sharpness      : REJECT")


# -----------------------------------
# 3. Brightness Check
# -----------------------------------

brightness_score = gray.mean()

print(f"Brightness     : {brightness_score:.2f}")

brightness_pass = (
    MIN_BRIGHTNESS
    <= brightness_score
    <= MAX_BRIGHTNESS
)

if brightness_pass:
    print("Brightness     : PASS")
else:
    print("Brightness     : REJECT")


# -----------------------------------
# Overall Quality
# -----------------------------------

overall_pass = (
    size_pass
    and sharpness_pass
    and brightness_pass
)


print("--------------------------------")
print(
    f"Overall Quality: "
    f"{'PASS' if overall_pass else 'REJECT'}"
)
print("================================")


# -----------------------------------
# Display
# -----------------------------------

cv2.imshow("Face Quality Check", face)

print("Press any key to close...")

cv2.waitKey(0)
cv2.destroyAllWindows()