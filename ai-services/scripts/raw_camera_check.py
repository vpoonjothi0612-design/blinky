import glob
import os
import sys
import urllib.parse

import cv2

env = {}
for line in open(".env", encoding="utf-8"):
    line = line.strip()
    if line and not line.startswith("#") and "=" in line:
        k, v = line.split("=", 1)
        env[k.strip()] = v.strip().strip('"').strip("'")

cam = sys.argv[1] if len(sys.argv) > 1 else "2"
p = f"CAMERA_{cam}_"
user = urllib.parse.quote(env[p + "USERNAME"], safe="")
pw = urllib.parse.quote(env[p + "PASSWORD"], safe="")
url = (f"{env[p + 'SCHEME']}://{user}:{pw}@{env[p + 'IP']}:"
       f"{env[p + 'RTSP_PORT']}{env[p + 'RTSP_PATH']}")

os.environ["OPENCV_FFMPEG_CAPTURE_OPTIONS"] = "rtsp_transport;tcp"
cap = cv2.VideoCapture(url, cv2.CAP_FFMPEG)
frame = None
for _ in range(30):  # discard buffered frames to get a current image
    ok, f = cap.read()
    if ok:
        frame = f
if frame is None:
    sys.exit(f"No frame from CAM-{cam} ({env[p + 'IP']})")

h, w = frame.shape[:2]
models = glob.glob("models/**/*yunet*.onnx", recursive=True)
det = cv2.FaceDetectorYN.create(models[0], "", (w, h), 0.5, 0.3, 5000)
_, faces = det.detect(frame)
n = 0 if faces is None else len(faces)
print(f"CAM-{cam} ({env[p + 'IP']}) native frame {w}x{h}, faces at 0.5: {n}")
if faces is not None:
    for f in faces:
        print("  box", f[:4].astype(int).tolist(), "score", round(float(f[14]), 2))

out = f"data/raw_cam{cam}.jpg"
os.makedirs("data", exist_ok=True)
cv2.imwrite(out, frame)
print("saved", out)
