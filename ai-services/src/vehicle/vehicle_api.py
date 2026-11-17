"""FastAPI REST Endpoint for Vehicle Image Upload & Recognition (Step 5).

Exposes:
    POST /api/v1/vehicle/recognize-image
    GET  /api/v1/vehicle/health
"""

from __future__ import annotations

import asyncio
import sys
import time
from pathlib import Path
from typing import Optional

from fastapi import APIRouter, FastAPI, File, HTTPException, Query, UploadFile
from fastapi.responses import JSONResponse



_CURRENT_DIR = Path(__file__).resolve().parent
_SRC_DIR = _CURRENT_DIR.parent
if str(_SRC_DIR) not in sys.path:
    sys.path.append(str(_SRC_DIR))

from vehicle.service.vehicle_image_service import VehicleImageRecognitionService
from vehicle.service.vehicle_video_service import VehicleVideoAnalysisService
from vehicle.vehicle_config import (
    ALLOWED_IMAGE_EXTENSIONS,
    MAX_IMAGE_UPLOAD_BYTES,
    ALLOWED_VIDEO_EXTENSIONS,
    MAX_VIDEO_UPLOAD_BYTES,
    DEFAULT_VIDEO_PROCESSING_FPS,
    TEST_DATA_OUTPUT_DIR,
)

router = APIRouter(prefix="/api/v1/vehicle", tags=["Vehicle Recognition"])

# Singleton service instances
_service: Optional[VehicleImageRecognitionService] = None
_video_service: Optional[VehicleVideoAnalysisService] = None


def get_service() -> VehicleImageRecognitionService:
    global _service
    if _service is None:
        _service = VehicleImageRecognitionService()
    return _service


def get_video_service() -> VehicleVideoAnalysisService:
    global _video_service
    if _video_service is None:
        _video_service = VehicleVideoAnalysisService()
    return _video_service


@router.get("/health")
def vehicle_service_health():
    """Health check for vehicle AI service."""
    service = get_service()
    return {
        "status": "healthy",
        "service": "vehicle-image-recognition",
        "configured_classes": ["car", "motorcycle", "bus", "truck"],
        "ocr_available": service.plate_pipeline.ocr_engine.is_available(),
    }


@router.post("/recognize-image")
async def recognize_vehicle_image(
    file: UploadFile = File(..., description="Vehicle image file (.jpg, .jpeg, .png)"),
    conf_threshold: Optional[float] = Query(0.40, ge=0.05, le=0.99, description="Confidence threshold"),
):
    """Processes an uploaded vehicle image and returns detection and plate telemetry."""
    if not file or not file.filename:
        raise HTTPException(status_code=400, detail="No image file provided.")

    filename = file.filename
    ext = Path(filename).suffix.lower()
    if ext not in ALLOWED_IMAGE_EXTENSIONS:
        raise HTTPException(
            status_code=400,
            detail=f"Unsupported file format '{ext}'. Allowed: {', '.join(sorted(ALLOWED_IMAGE_EXTENSIONS))}",
        )

    try:
        content = await file.read()
    except Exception as e:
        raise HTTPException(status_code=400, detail=f"Failed to read uploaded file: {str(e)}")

    if len(content) == 0:
        raise HTTPException(status_code=400, detail="Uploaded file is empty (0 bytes).")

    if len(content) > MAX_IMAGE_UPLOAD_BYTES:
        raise HTTPException(
            status_code=413,
            detail=f"File exceeds maximum allowed size of {MAX_IMAGE_UPLOAD_BYTES // (1024 * 1024)}MB",
        )

    service = get_service()
    result = service.process_image(
        image_input=content,
        filename=filename,
        conf_threshold=conf_threshold,
        save_annotated=True,
        print_telemetry=False,
    )

    status_code = 200 if result.get("success", False) else (
        400 if result.get("status") in ("INVALID_IMAGE_FORMAT", "CORRUPTED_OR_INVALID_IMAGE") else 200
    )
    return JSONResponse(status_code=status_code, content=result)


@router.post("/video")
async def process_vehicle_video(
    file: UploadFile = File(..., description="Vehicle video file (.mp4, .avi, .mov, .mkv)"),
    conf_threshold: Optional[float] = Query(0.40, ge=0.05, le=0.99, description="Confidence threshold"),
    processing_fps: Optional[float] = Query(
        DEFAULT_VIDEO_PROCESSING_FPS,
        ge=0.1,
        le=60.0,
        description="Target inference sampling FPS",
    ),
    save_annotated: Optional[bool] = Query(False, description="Whether to render annotated output video"),
    max_frames: Optional[int] = Query(None, ge=1, le=100000, description="Cap on video frames for fast testing"),
):
    """Processes an uploaded traffic video and returns tracked vehicles, plates, events, and annotated video."""
    if not file or not file.filename:
        raise HTTPException(status_code=400, detail="No video file provided.")

    filename = file.filename
    ext = Path(filename).suffix.lower()
    if ext not in ALLOWED_VIDEO_EXTENSIONS:
        raise HTTPException(
            status_code=400,
            detail=f"Unsupported file format '{ext}'. Allowed formats: {', '.join(sorted(ALLOWED_VIDEO_EXTENSIONS))}",
        )

    # Save uploaded video to temporary working location
    output_dir = TEST_DATA_OUTPUT_DIR
    output_dir.mkdir(parents=True, exist_ok=True)
    temp_video_path = output_dir / f"upload_{int(time.time())}_{Path(filename).name}"

    try:
        total_bytes = 0
        with open(temp_video_path, "wb") as out_f:
            while chunk := await file.read(1024 * 1024):
                total_bytes += len(chunk)
                if total_bytes > MAX_VIDEO_UPLOAD_BYTES:
                    raise HTTPException(
                        status_code=413,
                        detail=f"File exceeds maximum allowed size of {MAX_VIDEO_UPLOAD_BYTES // (1024 * 1024)}MB",
                    )
                out_f.write(chunk)

        if total_bytes == 0:
            raise HTTPException(status_code=400, detail="Uploaded file is empty (0 bytes).")

        service = get_video_service()
        result = await asyncio.to_thread(
            service.process_video,
            video_source=temp_video_path,
            conf_threshold=conf_threshold,
            processing_fps=processing_fps,
            save_annotated=save_annotated,
            max_frames=max_frames,
            print_progress=False,
        )


        status_code = 200 if result.get("success", False) else (
            400 if result.get("status") in ("UNSUPPORTED_FORMAT", "CORRUPTED_OR_INVALID_VIDEO", "EMPTY_OR_CORRUPT_VIDEO") else 200
        )
        return JSONResponse(status_code=status_code, content=result)

    finally:
        # Cleanup uploaded temporary raw file if it was created
        if temp_video_path.exists():
            try:
                temp_video_path.unlink()
            except OSError:
                pass



# Application instance for running with uvicorn
app = FastAPI(
    title="AI Services API (Vehicle & Face Recognition)",
    description="Step 7: Production AI Service API for Node.js Backend Integration",
    version="1.0.0",
)

@app.get("/health")
def root_health():
    """Consolidated root health endpoint for Node.js backend integration."""
    service = get_service()

    # Inspect dual-camera pipeline process and heartbeat
    camera_health = {
        "running": False,
        "pid": None,
        "status": "STOPPED",
        "mapping": {
            "CAM-01": {"ip": "192.168.15.56", "role": "OUT", "nvr_channel": 2},
            "CAM-02": {"ip": "192.168.15.57", "role": "IN", "nvr_channel": 1},
        },
        "cameras": {},
    }
    status_file = _SRC_DIR.parent / "data" / "ai_camera_status.json"
    if status_file.exists():
        try:
            with open(status_file, "r", encoding="utf-8") as f:
                st = json.load(f)
            pid = st.get("pid")
            is_alive = False
            if pid:
                try:
                    import psutil
                    is_alive = psutil.pid_exists(pid)
                except Exception:
                    pass
            
            # Heartbeat freshness check (within 15 seconds)
            updated_at = st.get("updated_at")
            fresh = False
            if updated_at:
                try:
                    from datetime import datetime, timezone
                    dt = datetime.fromisoformat(updated_at)
                    now_utc = datetime.now(timezone.utc)
                    fresh = (now_utc - dt).total_seconds() < 15.0
                except Exception:
                    pass

            camera_health["running"] = bool(is_alive and fresh and st.get("status") == "RUNNING")
            camera_health["pid"] = pid if is_alive else None
            camera_health["status"] = "RUNNING" if (is_alive and fresh and st.get("status") == "RUNNING") else "STOPPED"
            camera_health["last_heartbeat"] = updated_at
            camera_health["cameras"] = st.get("cameras", {})
            camera_health["outbox"] = st.get("outbox", {})
        except Exception:
            pass

    return {
        "status": "healthy",
        "service": "ai-services",
        "vehicle": {
            "status": "healthy",
            "ocr_available": service.plate_pipeline.ocr_engine.is_available(),
            "configured_classes": ["car", "motorcycle", "bus", "truck"],
        },
        "camera_pipeline": camera_health,
    }

app.include_router(router)

# Mount face recognition & enrollment router
try:
    from face.face_api import router as face_router
    app.include_router(face_router)
except ImportError:
    try:
        from src.face.face_api import router as face_router
        app.include_router(face_router)
    except Exception as _e:
        print(f"[WARN] Face router could not be imported: {_e}")

