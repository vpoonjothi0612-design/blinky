# Vehicle Detection & Tracking Module (YOLO11n)

Production-ready vehicle detection, multi-object tracking (ByteTrack), and unique vehicle counting engine for the AI Attendance & Vehicle Detection system.

---

## 1. Architecture & Pipeline

```
OpenCV Video / Image Stream
           ↓
    YOLO11n Model
 (models/yolo/yolo11n.pt)
           ↓
 Vehicle Filtering & NMS
  (car, motorcycle, bus, truck)
           ↓
  Multi-Object Tracker
 (ByteTrack / BoT-SORT)
           ↓
  Stable Track IDs (#1, #2, ...)
           ↓
Real-Time Counting & Telemetry HUD
```

---

## 2. Directory Structure

```
ai-services/
├── models/
│   └── yolo/
│       └── yolo11n.pt
├── src/
│   └── vehicle/
│       ├── detection/
│       │   ├── vehicle_classes.py
│       │   └── yolo_detector.py
│       ├── tracking/
│       │   └── vehicle_tracker.py
│       ├── testing/
│       │   ├── setup_test_data.py
│       │   ├── vehicle_image_test.py
│       │   ├── vehicle_video_test.py
│       │   └── vehicle_pipeline_test.py
│       └── README.md
└── data/
    └── vehicle/
        ├── input/
        └── output/
```

---

## 3. Vehicle Classes

Only authorized road vehicle classes are detected:
- **`car`** (COCO ID: `2`)
- **`motorcycle`** (COCO ID: `3`)
- **`bus`** (COCO ID: `5`)
- **`truck`** (COCO ID: `7`)

Non-vehicle objects (e.g., `person`, `bicycle`, etc.) are explicitly excluded.

---

## 4. CLI Execution Commands

### A. Run Image Vehicle Detection
```bash
.venv\Scripts\python.exe src\vehicle\testing\vehicle_image_test.py --input data/vehicle/input/test_a_single_car.jpg --conf 0.40
```

### B. Run Video Detection & Tracking (File or Webcam)
```bash
# On local MP4 video file
.venv\Scripts\python.exe src\vehicle\testing\vehicle_video_test.py --source data/vehicle/input/test_d_car_moving.mp4 --conf 0.40

# On live webcam (index 0)
.venv\Scripts\python.exe src\vehicle\testing\vehicle_video_test.py --source 0 --conf 0.40
```

### C. Run Video Tracking with Virtual Line Counting
```bash
.venv\Scripts\python.exe src\vehicle\testing\vehicle_video_test.py --source data/vehicle/input/test_d_car_moving.mp4 --line --conf 0.40
```

### D. Run Full Detection & Tracking Test Suite (Tests A through F)
```bash
.venv\Scripts\python.exe src\vehicle\testing\vehicle_pipeline_test.py
```

### E. Run Phase 5 Line Counter Test Suite (Tests A through G)
```bash
.venv\Scripts\python.exe src\vehicle\testing\vehicle_line_counter_test.py
```
