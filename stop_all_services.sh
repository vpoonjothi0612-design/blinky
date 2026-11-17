#!/usr/bin/env bash
# =============================================================================
# Cleanly Stop FaceTrack Services
# =============================================================================

echo "Stopping FaceTrack AI camera services..."
AI_PID_FILE="ai-services/data/dual_camera_supervisor.pid"
AI_PID=""
if [ -f "${AI_PID_FILE}" ]; then
    AI_PID=$(cat "${AI_PID_FILE}" 2>/dev/null || true)
fi
if [ -n "${AI_PID}" ] && kill -0 "${AI_PID}" 2>/dev/null; then
    kill -TERM "${AI_PID}" 2>/dev/null || true
    for _ in {1..10}; do
        kill -0 "${AI_PID}" 2>/dev/null || break
        sleep 0.5
    done
    kill -KILL "${AI_PID}" 2>/dev/null || true
    echo "✓ Stopped AI dual camera pipeline and supervisor"
else
    SUPERVISOR_PID=$(pgrep -f "[s]tart_ai_service.sh" | head -n 1 || true)
    if [ -n "${SUPERVISOR_PID}" ]; then
        kill -TERM "${SUPERVISOR_PID}" 2>/dev/null || true
        echo "✓ Stopped AI camera supervisor"
    else
        pkill -f "dual_camera_live_face_recognition" 2>/dev/null && echo "✓ Stopped AI dual camera pipeline" || true
    fi
fi
rm -f "${AI_PID_FILE}"
pkill -f "uvicorn src.vehicle.vehicle_api:app" 2>/dev/null && echo "✓ Stopped AI vehicle API" || true

rm -f "ai-services/data/dual_camera_service.lock"
rm -f "ai-services/data/attendance_outbox.lock"

STOP_ALL=false
if [ "$1" == "--all" ] || [ "$1" == "-y" ]; then
    STOP_ALL=true
else
    read -p "Do you also want to stop Node.js Backend & Vite Frontend? (y/N): " -n 1 -r
    echo
    if [[ $REPLY =~ ^[Yy]$ ]]; then
        STOP_ALL=true
    fi
fi

if [ "$STOP_ALL" = true ]; then
    pkill -f "nodemon.*src/server.js" 2>/dev/null || true
    pkill -f "node src/server.js" 2>/dev/null || true
    pkill -f "vite" 2>/dev/null || true
    echo "✓ Stopped Node backend and Vite frontend."
fi

echo "All requested services stopped cleanly."
