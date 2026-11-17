# 🤖 AI Services — Run Guide

> **Stack:** Python · FastAPI · OpenCV · InsightFace (ArcFace) · YuNet · YOLO11n · Ultralytics · ONNX Runtime  
> **Location:** `ai-services/`

---

## 📁 Folder Structure

```
ai-services/
├── requirements.txt
├── models/
│   ├── yunet/
│   │   ├── face_detection_yunet_2023mar.onnx   ✅ present
│   │   └── face_detection_yunet_2026may.onnx   ✅ present
│   └── yolo/
│       └── yolo11n.pt                           ✅ present
└── src/
    ├── camera/
    │   └── opencv_test.py
    ├── face/
    │   ├── face_config.py                  # All face pipeline config
    │   ├── live_face_recognition.py        # ▶ Live webcam face recognition (standalone)
    │   ├── detection/
    │   ├── liveness/
    │   ├── recognition/
    │   ├── service/
    │   │   ├── face_service.py             # Core headless face service
    │   │   └── track_recognition_policy.py
    │   └── testing/                        # Test scripts
    └── vehicle/
        ├── vehicle_config.py               # All vehicle pipeline config
        ├── camera/
        ├── detection/
        ├── events/
        ├── service/
        │   └── vehicle_stream_processor.py # Core vehicle stream service
        ├── tracking/
        └── testing/                        # Test scripts
```

---

## ✅ Step 1 — Prerequisites

Make sure you have:
- **Python 3.10+** installed
- A **webcam** connected (for live face recognition)
- The **ArcFace model** (`w600k_r50.onnx`) — auto-downloaded by InsightFace on first run  
  OR manually place it at:
  ```
  ai-services/models/arcface/w600k_r50.onnx
  ```

---

## ✅ Step 2 — Create a Virtual Environment

Open a terminal in the `ai-services/` folder:

```bash
# Navigate to ai-services
cd "d:\Damodharan\Face Detection\ai-services"

# Create virtual environment
python -m venv venv

# Activate virtual environment (Windows)
venv\Scripts\activate
```

---

## ✅ Step 3 — Install Dependencies

```bash
pip install -r requirements.txt
```

> ⚠️ This installs heavy packages like `torch`, `ultralytics`, `insightface`, `opencv`, `onnxruntime` — may take a few minutes.

---

## ▶️ Step 4 — Run the Services

### Production (API plus live camera worker)

From `ai-services/`, run:

```bash
./.venv/bin/python src/main.py
```

The API starts on port 8000 and automatically launches the headless dual-camera worker, which serves the MJPEG streams on port 5055. Stop the API with Ctrl+C to stop its worker. Set `AI_LIVE_WORKER_ENABLED=false` only when the camera worker is managed separately. Production mode does not enable auto-reload.

For development reload, run `./.venv/bin/python src/main.py --dev`.

### Option A — Live Face Recognition (Webcam)

Runs real-time face recognition using YuNet + ArcFace on your webcam:

```bash
# From ai-services/ with venv activated
cd "d:\Damodharan\Face Detection\ai-services"
python src/face/live_face_recognition.py
```

**What it does:**
- Opens webcam (index `0`)
- Detects faces using YuNet ONNX model
- Extracts ArcFace 512-D embeddings
- Compares with saved employee embeddings in `data/face_embeddings/`
- Applies liveness detection
- Prints recognition telemetry to terminal

---

### Option B — Camera / OpenCV Test

Quick test to verify webcam and OpenCV are working:

```bash
python src/camera/opencv_test.py
```

---

### Option C — Run Face Pipeline Tests

```bash
# Full pipeline test
python src/face/testing/face_pipeline_test.py

# Multi-employee test
python src/face/testing/multi_employee_test.py

# Face service unit test
python src/face/testing/face_service_test.py

# Validate enrolled embeddings
python src/face/testing/validate_enrollment.py
```

---

### Option D — Run Vehicle Detection Tests

```bash
# Image-based vehicle detection test
python src/vehicle/testing/vehicle_image_test.py

# Video-based vehicle detection test
python src/vehicle/testing/vehicle_video_test.py

# Full pipeline test
python src/vehicle/testing/vehicle_pipeline_test.py

# Stream processor test
python src/vehicle/testing/vehicle_stream_processor_test.py

# Camera worker test (requires webcam/RTSP)
python src/vehicle/testing/vehicle_camera_worker_test.py
```

---

## 🔑 Step 5 — Enroll an Employee Face (Required for Recognition)

Before face recognition works, you must enroll employee face embeddings:

```bash
# Embeddings are stored in: ai-services/data/face_embeddings/<EMPLOYEE_ID>.npy
# Run the enrollment validation script to check existing enrollments
python src/face/testing/validate_enrollment.py
```

> The `live_face_recognition.py` script is hardcoded to compare against `EMP001.npy`.  
> Change `EMPLOYEE_ID = "EMP001"` in the script to test with a different employee.

---

## ⚙️ Configuration Files

### Face — `src/face/face_config.py`
| Setting | Description |
|---|---|
| `YUNET_MODEL_PATH` | Path to YuNet ONNX detection model |
| `ARCFACE_MODEL_PATH` | Path to ArcFace recognition model |
| `EMBEDDINGS_DIR` | `data/face_embeddings/` — stored `.npy` files |
| `RECOGNITION_THRESHOLD` | Cosine similarity threshold for match |
| `LIVENESS_*` | Liveness detection parameters |

### Vehicle — `src/vehicle/vehicle_config.py`
| Setting | Description |
|---|---|
| `DEFAULT_YOLO_MODEL_PATH` | `models/yolo/yolo11n.pt` |
| `VEHICLE_PROCESSING_FPS` | AI inference rate (default: `5.0 FPS`) |
| `DEFAULT_CONF_THRESHOLD` | YOLO confidence threshold (`0.40`) |
| `DEFAULT_DEVICE` | `"cpu"` (change to `"cuda"` for GPU) |
| `DEFAULT_TRACKER_TYPE` | `"bytetrack.yaml"` |

---

## 🔗 Integration with Backend API

The AI service communicates with the Node.js backend via HTTP:

| Direction | Endpoint | Purpose |
|---|---|---|
| AI → Backend | `GET /api/ai-integration/sync` | Fetch face embeddings + vehicle registrations |
| AI → Backend | `POST /api/ai-integration/detect` | Push detection events (FACE / VEHICLE) |

**Detection event payload:**
```json
{
  "type": "FACE",
  "employeeId": "uuid-here",
  "cameraId": "uuid-here",
  "timestamp": "2026-09-28T08:30:00.000Z"
}
```

> Make sure the backend is running at `http://localhost:3000` before integrating.

---

## 🚀 Quick Start Summary

```bash
# 1. Go to ai-services folder
cd "d:\Damodharan\Face Detection\ai-services"

# 2. Create & activate virtual environment
python -m venv venv
venv\Scripts\activate

# 3. Install all packages
pip install -r requirements.txt

# 4. Test webcam
python src/camera/opencv_test.py

# 5. Run live face recognition
python src/face/live_face_recognition.py
```

---

## 🧪 Available Test Scripts

### Face Tests (`src/face/testing/`)
| Script | Purpose |
|---|---|
| `face_pipeline_test.py` | Full face detection + recognition pipeline |
| `face_service_test.py` | Headless face service unit tests |
| `final_face_pipeline_test.py` | Final integration test |
| `multi_employee_test.py` | Multi-employee recognition test |
| `cross_camera_validation.py` | Cross-camera recognition validation |
| `track_recognition_policy_test.py` | Track-based recognition policy test |
| `validate_enrollment.py` | Validates stored face embeddings |

### Vehicle Tests (`src/vehicle/testing/`)
| Script | Purpose |
|---|---|
| `vehicle_image_test.py` | Static image vehicle detection |
| `vehicle_video_test.py` | Video file vehicle detection |
| `vehicle_pipeline_test.py` | Full pipeline integration test |
| `vehicle_stream_processor_test.py` | Stream processor logic test |
| `vehicle_camera_worker_test.py` | Webcam capture worker test |
| `vehicle_rtsp_worker_test.py` | RTSP camera stream test |
| `vehicle_line_counter_test.py` | Virtual counting line test |
| `vehicle_event_store_test.py` | Event persistence test |
| `setup_test_data.py` | Sets up test data fixtures |
