import glob
import sys
from pathlib import Path

import cv2

root = Path(__file__).resolve().parents[1]
models = glob.glob(str(root / "models" / "**" / "*yunet*.onnx"), recursive=True)
if not models:
    sys.exit("YuNet model not found under models/")

url = sys.argv[1] if len(sys.argv) > 1 else "http://127.0.0.1:5055/stream/CAM-02"
cap = cv2.VideoCapture(url)
ok, frame = cap.read()
if not ok:
    sys.exit(f"No frame from {url}")

h, w = frame.shape[:2]
det = cv2.FaceDetectorYN.create(models[0], "", (w, h), 0.7, 0.3, 5000)
_, faces = det.detect(frame)
count = 0 if faces is None else len(faces)
print(f"frame {w}x{h}, faces detected: {count}")
if faces is not None:
    for f in faces:
        x, y, bw, bh = f[:4].astype(int)
        print(f"  face box x={x} y={y} w={bw} h={bh} score={float(f[14]):.2f}")

out = root / "data" / "detect_check.jpg"
out.parent.mkdir(parents=True, exist_ok=True)
cv2.imwrite(str(out), frame)
print(f"saved {out}")
