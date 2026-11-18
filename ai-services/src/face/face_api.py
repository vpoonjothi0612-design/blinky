"""FastAPI REST Endpoint for Face Recognition & Enrollment (Step 7 & 8).

Exposes:
    POST /api/v1/face/recognize
    POST /api/v1/face/enroll
    GET  /api/v1/face/health
"""

from __future__ import annotations

import sys
import json
import base64
from pathlib import Path
from typing import Optional, Dict, Any, List

import cv2
import numpy as np
from fastapi import APIRouter, File, Form, HTTPException, UploadFile
from fastapi.responses import JSONResponse

_CURRENT_DIR = Path(__file__).resolve().parent
_SRC_DIR = _CURRENT_DIR.parent
_FACE_DIR = _CURRENT_DIR
_REC_DIR = _CURRENT_DIR / "recognition"
_SERVICE_DIR = _CURRENT_DIR / "service"

for p in (str(_SRC_DIR), str(_FACE_DIR), str(_REC_DIR), str(_SERVICE_DIR)):
    if p not in sys.path:
        sys.path.append(p)

from face_config import (
    YUNET_MODEL_PATH,
    ARCFACE_MODEL_PATH,
    REFERENCE_POINTS,
)

ALLOWED_IMAGE_EXTENSIONS = {".jpg", ".jpeg", ".png"}
MAX_IMAGE_UPLOAD_BYTES = 10 * 1024 * 1024  # 10 MB

from face_preprocess import preprocess_face
from employee_registry import estimate_face_pose
from service.face_service import FaceRecognitionService

router = APIRouter(prefix="/api/v1/face", tags=["Face Recognition & Enrollment"])

_face_service: Optional[FaceRecognitionService] = None
MODEL_NAME = "InsightFace ArcFace w600k_r50"
MODEL_VERSION = "w600k_r50.onnx"


def get_face_service() -> FaceRecognitionService:
    global _face_service
    if _face_service is None:
        _face_service = FaceRecognitionService()
    return _face_service


def extract_enrollment_embedding(service: FaceRecognitionService, image: np.ndarray):
    img_h, img_w = image.shape[:2]
    service.detector.setInputSize((img_w, img_h))
    _, faces = service.detector.detect(image)
    face_count = 0 if faces is None else len(faces)
    if face_count != 1:
        raise ValueError(f"Expected exactly 1 face for enrollment, found {face_count}")
    face = faces[0]
    bx, by, bw, bh = map(int, face[0:4])
    landmarks = face[4:14].reshape(5, 2)
    x1, y1 = max(0, bx), max(0, by)
    x2, y2 = min(img_w, bx + bw), min(img_h, by + bh)
    face_crop = image[y1:y2, x1:x2].copy()
    if bw < 112 or bh < 112:
        raise ValueError("Face too small; move closer until the face is at least 112x112 pixels.")
    gray = cv2.cvtColor(face_crop, cv2.COLOR_BGR2GRAY)
    brightness = float(gray.mean())
    sharpness = float(cv2.Laplacian(gray, cv2.CV_64F).var())
    if brightness < 45:
        raise ValueError("Image is too dark; improve lighting and try again.")
    if brightness > 220:
        raise ValueError("Image is too bright; reduce backlighting and try again.")
    if sharpness < 20:
        raise ValueError("Image is too blurry; hold the camera steady and try again.")
    working_image = image.copy()
    enhanced = preprocess_face(face_crop)
    working_image[y1:y2, x1:x2] = enhanced
    transform, _ = cv2.estimateAffinePartial2D(landmarks.astype(np.float32), REFERENCE_POINTS, method=cv2.LMEDS)
    if transform is None:
        raise ValueError("Could not compute affine face alignment.")
    aligned = cv2.warpAffine(working_image, transform, (112, 112))
    raw_emb = service.arcface.get_feat(aligned).flatten()
    norm = float(np.linalg.norm(raw_emb))
    if norm == 0.0 or np.isnan(norm):
        raise ValueError("Zero or invalid embedding norm.")
    return (raw_emb / norm).astype(float).tolist(), {"size": [int(bw), int(bh)], "brightness": round(brightness, 2), "sharpness": round(sharpness, 2), "faceCount": 1, "pose": estimate_face_pose(landmarks)}


@router.get("/health")
def face_service_health():
    """Health check for face recognition AI service."""
    service = get_face_service()
    return {
        "status": "healthy",
        "service": "face-recognition",
        "yunet_loaded": service.detector is not None,
        "arcface_loaded": service.arcface is not None,
        "active_employees": service.active_employee_count,
        "registered_employee_ids": service.registered_employee_ids,
    }


@router.post("/registry/reload")
def reload_face_registry():
    service = get_face_service()
    return {"success": True, "activeEmployees": service.reload_employee_registry(),
            "registeredEmployeeIds": service.registered_employee_ids}


@router.delete("/registry/{employee_id}")
def delete_face_registry_entry(employee_id: str):
    from employee_registry import remove_employee_safely
    try:
        removed = remove_employee_safely(employee_id)
    except (ValueError, PermissionError) as ex:
        raise HTTPException(status_code=400, detail=str(ex))
    service = get_face_service()
    service.reload_employee_registry()
    return {"success": True, "removed": removed}


@router.post("/recognize")
async def recognize_face(
    file: UploadFile = File(..., description="Face image file (.jpg, .jpeg, .png)"),
    camera_id: str = Form("API"),
    static_search: bool = Form(False),
    include_face_image: bool = Form(False),
):
    """Processes an uploaded image through YuNet face detection & ArcFace recognition."""
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

    # Decode image to BGR numpy array
    nparr = np.frombuffer(content, np.uint8)
    image = cv2.imdecode(nparr, cv2.IMREAD_COLOR)
    if image is None or image.size == 0:
        raise HTTPException(status_code=400, detail="Corrupted or invalid image file.")

    service = get_face_service()
    # Process single static frame (liveness evaluated if enabled, disabled for static image)
    results = service.process_frame(
        image,
        enable_liveness=False,
        use_track_policy=not static_search,
    )

    formatted_results: List[Dict[str, Any]] = []
    for r in results:
        print(f"[FaceMatch] camera={camera_id} track={r.track_id} best={r.similarity} second={r.second_similarity} threshold={service.recognition_threshold} status={r.status}")
        formatted_result = {
            "employeeId": r.employee_id,
            "name": r.name,
            "status": r.status,
            "similarity": round(float(r.similarity), 4) if r.similarity is not None else None,
            "secondCandidate": r.second_candidate,
            "secondSimilarity": round(float(r.second_similarity), 4) if r.second_similarity is not None else None,
            "margin": round(float(r.margin), 4) if r.margin is not None else None,
            "bbox": list(r.bbox),
            "qualityStatus": r.quality_status,
            "qualityReason": r.quality_reason,
            "livenessStatus": r.liveness_status,
            "recognitionSource": r.recognition_source,
            "trackId": r.track_id,
            "topCandidates": r.rankings[:3],
            "threshold": service.recognition_threshold,
        }
        if include_face_image and r.status == "RECOGNIZED" and r.employee_id:
            x, y, width, height = (int(round(float(value))) for value in r.bbox)
            if width > 0 and height > 0:
                pad_x = max(8, int(width * 0.2))
                pad_y = max(8, int(height * 0.25))
                left = max(0, x - pad_x)
                top = max(0, y - pad_y)
                right = min(image.shape[1], x + width + pad_x)
                bottom = min(image.shape[0], y + height + pad_y)
                face_crop = image[top:bottom, left:right]
                if face_crop.size:
                    encoded_ok, encoded_crop = cv2.imencode(
                        ".jpg",
                        face_crop,
                        [cv2.IMWRITE_JPEG_QUALITY, 90],
                    )
                    if encoded_ok:
                        formatted_result["faceImageBase64"] = base64.b64encode(encoded_crop).decode("ascii")
        formatted_results.append(formatted_result)

    return JSONResponse(status_code=200, content={
        "success": True,
        "facesDetected": len(formatted_results),
        "results": formatted_results,
    })


@router.get("/debug/candidates")
def debug_candidates():
    service = get_face_service()
    return {"threshold": service.recognition_threshold, "registeredEmployees": service.registered_employee_ids,
            "message": "Submit a frame to /recognize; each result contains the current face's topCandidates scores."}


@router.get("/debug/last")
def debug_last_face(camera_id: str = "CAM-02"):
    debug_path = _SRC_DIR.parent / "data" / "debug" / f"face_last_{camera_id}.json"
    if not debug_path.exists():
        raise HTTPException(status_code=404, detail=f"No face decision recorded for {camera_id} yet")
    try:
        return json.loads(debug_path.read_text(encoding="utf-8"))
    except (OSError, json.JSONDecodeError) as ex:
        raise HTTPException(status_code=503, detail=f"Face diagnostics are updating: {ex}")


@router.get("/tracks")
def debug_face_tracks(camera_id: Optional[str] = None):
    """Return the current person/face lifecycle states written by each camera worker."""
    debug_dir = _SRC_DIR.parent / "data" / "debug"
    cameras = [camera_id] if camera_id else ["CAM-01", "CAM-02"]
    snapshots = []
    for camera in cameras:
        if camera not in {"CAM-01", "CAM-02"}:
            raise HTTPException(status_code=400, detail="camera_id must be CAM-01 or CAM-02")
        snapshot_path = debug_dir / f"face_tracks_{camera}.json"
        if not snapshot_path.exists():
            snapshots.append({"camera_id": camera, "tracks": []})
            continue
        try:
            snapshots.append(json.loads(snapshot_path.read_text(encoding="utf-8")))
        except (OSError, json.JSONDecodeError) as ex:
            raise HTTPException(status_code=503, detail=f"Track diagnostics are updating for {camera}: {ex}")
    return snapshots[0] if camera_id else {"cameras": snapshots}


@router.post("/enroll")
async def enroll_face(
    file: UploadFile = File(..., description="Face image file (.jpg, .jpeg, .png)"),
):
    """Processes an uploaded face photo, extracts ArcFace 512-D embedding, and returns it."""
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

    nparr = np.frombuffer(content, np.uint8)
    image = cv2.imdecode(nparr, cv2.IMREAD_COLOR)
    if image is None or image.size == 0:
        raise HTTPException(status_code=400, detail="Corrupted or invalid image file.")

    service = get_face_service()
    try:
        norm_emb, metadata = extract_enrollment_embedding(service, image)
    except ValueError as ex:
        raise HTTPException(status_code=400, detail=str(ex))

    return JSONResponse(status_code=200, content={
        "success": True,
        "embedding": norm_emb,
        "model": MODEL_NAME,
        "modelVersion": MODEL_VERSION,
        "metadata": metadata,
    })
