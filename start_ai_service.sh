#!/usr/bin/env bash
# =============================================================================
# Production Dual-Camera Face Recognition Attendance & Live Stream Service
# CAM-01: Exit Gate (192.168.15.56) | CAM-02: Entry Gate (192.168.15.57)
# =============================================================================
set -e

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
AI_DIR="${SCRIPT_DIR}/ai-services"
VENV_PYTHON="${AI_DIR}/.venv/bin/python"

if [ ! -f "${VENV_PYTHON}" ]; then
    VENV_PYTHON="${AI_DIR}/venv/bin/python"
fi

if [ ! -f "${VENV_PYTHON}" ]; then
    echo "[ERROR] Python virtual environment not found in ${AI_DIR}/.venv or venv."
    echo "Please create a virtual environment first: python3 -m venv ai-services/.venv"
    exit 1
fi

# Clean up stale locks if no live process holds them
LOCK_FILE="${AI_DIR}/data/dual_camera_service.lock"
if [ -f "${LOCK_FILE}" ]; then
    OLD_PID=$(cat "${LOCK_FILE}" 2>/dev/null || echo "")
    if [ -n "${OLD_PID}" ]; then
        if ! ps -p "${OLD_PID}" > /dev/null 2>&1; then
            echo "[Notice] Removing stale lockfile from PID ${OLD_PID}..."
            rm -f "${LOCK_FILE}"
        fi
    fi
fi

echo "====================================================================="
echo "  STARTING DUAL-CAMERA AI ATTENDANCE & LIVE STREAM PIPELINE          "
echo "====================================================================="
echo "  CAM-01 (Exit Gate)  : 192.168.15.56 -> OUT"
echo "  CAM-02 (Entry Gate) : 192.168.15.57 -> IN"
echo "  MJPEG Stream Server : http://127.0.0.1:5055/stream/{CAM-01,CAM-02}"
echo "====================================================================="

cd "${AI_DIR}"

# Keep the stream alive if a camera disconnect or inference exception terminates
# the worker. SIGINT/SIGTERM stop both the worker and this supervisor cleanly.
PID_FILE="${AI_DIR}/data/dual_camera_supervisor.pid"
CHILD_PID=""
STOPPING=false
mkdir -p "${AI_DIR}/data"
printf '%s\n' "$$" > "${PID_FILE}"

stop_worker() {
    STOPPING=true
    if [ -n "${CHILD_PID}" ] && kill -0 "${CHILD_PID}" 2>/dev/null; then
        kill -TERM "${CHILD_PID}" 2>/dev/null || true
        wait "${CHILD_PID}" 2>/dev/null || true
    fi
    CHILD_PID=""
    if [ -f "${PID_FILE}" ] && [ "$(cat "${PID_FILE}" 2>/dev/null || true)" = "$$" ]; then
        rm -f "${PID_FILE}"
    fi
}
trap stop_worker INT TERM HUP

while [ "${STOPPING}" != true ]; do
    "${VENV_PYTHON}" -u src/face/dual_camera_live_face_recognition.py --headless "$@" &
    CHILD_PID=$!
    if wait "${CHILD_PID}"; then
        exit_code=0
    else
        exit_code=$?
    fi
    CHILD_PID=""
    [ "${STOPPING}" = true ] && break
    echo "[Supervisor] Camera worker exited with status ${exit_code}; restarting in 3 seconds."
    sleep 3 &
    CHILD_PID=$!
    wait "${CHILD_PID}" 2>/dev/null || true
    CHILD_PID=""
done

stop_worker
