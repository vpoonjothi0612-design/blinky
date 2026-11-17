# Face Liveness & Anti-Spoofing Detection

## 1. Overview
Face liveness detection (Presentation Attack Detection / PAD) is the security layer in an automated attendance system that verifies whether a detected face originates from a **physically present, living human** or a **fraudulent artifact** (such as a printed photograph, smartphone screen replay, or static mask).

---

## 2. Why Single-Image Verification Cannot Prove Liveness
In pure 2D face recognition (YuNet + ArcFace):
- ArcFace extracts high-dimensional biometric identity features from an image.
- A high-resolution printed photo or phone screen displaying an employee's face yields nearly the same ArcFace embedding ($\sim 0.90+$ cosine similarity) as their real face.
- Therefore, **facial recognition similarity cannot determine liveness**. An independent anti-spoofing mechanism is required before granting attendance.

---

## 3. How Temporal Anti-Spoofing Works
Living humans continuously exhibit subtle, involuntary biological micro-motions:

1. **Centroid Displacement / Micro-Nodding**:
   A live head cannot remain mathematically stationary over time. Natural respiration, posture balance, and micro-tremors produce continuous small centroid movements. A printed photo on a table or tripod has $0.0$ motion.

2. **3D Perspective Ratio Variation**:
   When a 3D head rotates even slightly, the relative distance ratios between facial landmarks (e.g. left eye to nose vs. right eye to nose) shift dynamically due to 3D perspective projection. In contrast, a 2D planar photograph held up in front of the camera undergoes uniform planar affine scaling with zero 3D perspective distortion.

3. **Eye Region Micro-Motion & Blinking**:
   Micro-movements of the eyelids and periodic blinking create measurable pixel intensity fluctuations in the eye patch bounding regions over a multi-frame temporal window.

---

## 4. State Machine Architecture

```text
       [No Face]
           │
           ▼
      ┌─────────┐       Face detected
      │ WAITING │ ─────────────────────────► ┌──────────┐
      └─────────┘                            │ CHECKING │ (Accumulating 25-30 frames)
           ▲                                 └──────────┘
           │                                   │      │
           │ No Face / Reset                   │      │
           │                                   │      ▼ (Motion score < threshold)
           │            Natural 3D motion +    │   ┌────────────────┐
           │            eye micro-activity     │   │ SPOOF / FAILED │
           │                                   ▼   └────────────────┘
           │                             ┌──────────┐
           └──────────────────────────── │   LIVE   │ (Verified for attendance)
                                         └──────────┘
```

- **`WAITING`**: No face in frame or searching for a stable subject.
- **`CHECKING`**: A temporal buffer (rolling window of 30 frames $\approx$ 1 second) is actively gathering movement and landmark consistency metrics.
- **`LIVE`**: Confirmed natural movement and temporal variation sustained over consecutive frames.
- **`SPOOF / FAILED`**: Completely rigid/frozen across the entire temporal window (characteristic of a static printed photo or fixed screen presentation attack).

---

## 5. Limitations of this Heuristic Baseline
> [!NOTE]
> This is a development implementation designed to introduce temporal verification without heavy external dependencies.

1. **Video Replay Attacks**: A high-resolution video of a person blinking played on an iPad/phone screen may pass temporal motion checks.
2. **Camera Shake**: Significant hand jitter holding a printed photo can produce artificial motion scores.
3. **Lighting Variations**: Sudden lighting changes (e.g. fluorescent flicker) can cause minor landmark jitter.

---

## 6. Production Upgrade Roadmap
For enterprise production attendance deployments, this heuristic module can be supplemented or upgraded with:

| Upgrade Technique | How It Works | Defense Against |
| :--- | :--- | :--- |
| **Deep FAS Neural Networks** (e.g., MiniFASNet, CDCN) | Analyzes moiré patterns, screen glare, specular reflection, and paper color texture in Fourier/frequency domains. | Print attacks, screen replays, paper cutouts. |
| **Active Challenge-Response** | Prompts user to perform a randomized action (e.g. *"Turn head left"*, *"Blink twice"*, *"Smile"*). | Pre-recorded video replays, static photos. |
| **Hardware Depth / IR Sensors** | Structured light, Time-of-Flight (ToF), or Active Infrared cameras that capture real 3D depth maps. | All 2D presentation attacks. |

---

## 7. How to Run

### Live Webcam Mode:
From the root workspace directory:
```cmd
cd /d "D:\Attendance & Vehicle Detection Project"
ai-services\.venv\Scripts\activate
python ai-services\src\face\liveness\liveness_detector.py
```

### Video File Mode (Testing without Webcam):
```cmd
python ai-services\src\face\liveness\liveness_detector.py path\to\test_video.mp4
```

- Press `q` or `ESC` in the display window to end the session and print the terminal summary report.
