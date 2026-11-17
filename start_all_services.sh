#!/usr/bin/env bash
# =============================================================================
# Start All Services: Backend, AI Camera Pipeline & Frontend
# =============================================================================
set -e

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
LOG_DIR="${SCRIPT_DIR}/logs"
mkdir -p "${LOG_DIR}"

RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m'

echo -e "${BLUE}=====================================================================${NC}"
echo -e "${BLUE}  FACETRACK - DUAL CAMERA SURVEILLANCE & ATTENDANCE SYSTEM           ${NC}"
echo -e "${BLUE}=====================================================================${NC}"

# 1. Clean stale locks if process not running
LOCK_FILE="${SCRIPT_DIR}/ai-services/data/dual_camera_service.lock"
if [ -f "${LOCK_FILE}" ]; then
    OLD_PID=$(cat "${LOCK_FILE}" 2>/dev/null || echo "")
    if [ -n "${OLD_PID}" ] && ! ps -p "${OLD_PID}" >/dev/null 2>&1; then
        rm -f "${LOCK_FILE}"
    fi
fi
rm -f "${SCRIPT_DIR}/ai-services/data/attendance_outbox.lock"

# 2. Check / Start Backend
echo -e "\n${YELLOW}[1/3] Starting Backend API Service (Port 3000)...${NC}"
if curl -s -m 1 http://localhost:3000/api/health >/dev/null 2>&1; then
    echo -e "${GREEN}✓ Backend is already running on http://localhost:3000${NC}"
else
    cd "${SCRIPT_DIR}/backend"
    nohup npm run dev > "${LOG_DIR}/backend.log" 2>&1 &
    BACKEND_PID=$!
    disown "${BACKEND_PID}" 2>/dev/null || true
    echo -e "${GREEN}✓ Backend started (PID: ${BACKEND_PID}). Waiting for health check...${NC}"
    
    for i in {1..15}; do
        if curl -s -m 1 http://localhost:3000/api/health >/dev/null 2>&1; then
            echo -e "${GREEN}✓ Backend is healthy!${NC}"
            break
        fi
        sleep 1
    done
fi

# 3. Check / Start AI Dual Camera Service
echo -e "\n${YELLOW}[2/3] Starting AI Dual-Camera & Live Stream Service (Port 5055)...${NC}"
AI_PID_FILE="${SCRIPT_DIR}/ai-services/data/dual_camera_supervisor.pid"
AI_PID=""
if [ -f "${AI_PID_FILE}" ]; then
    AI_PID=$(cat "${AI_PID_FILE}" 2>/dev/null || true)
fi
if [ -n "${AI_PID}" ] && kill -0 "${AI_PID}" 2>/dev/null; then
    echo -e "${GREEN}✓ AI Dual-Camera pipeline is already running${NC}"
else
    rm -f "${AI_PID_FILE}"
    nohup "${SCRIPT_DIR}/start_ai_service.sh" > "${LOG_DIR}/ai-camera.log" 2>&1 &
    AI_PID=$!
    for i in {1..5}; do
        [ -f "${AI_PID_FILE}" ] && break
        sleep 1
    done
    disown "${AI_PID}" 2>/dev/null || true
    echo -e "${GREEN}✓ AI Dual-Camera supervisor started (PID: ${AI_PID}). Waiting for stream server...${NC}"

    for i in {1..20}; do
        if curl -s -m 1 http://127.0.0.1:5055/stream/CAM-02 >/dev/null 2>&1 || grep -q "Live Camera MJPEG Server active" "${LOG_DIR}/ai-camera.log" 2>/dev/null; then
            echo -e "${GREEN}✓ Live MJPEG Stream Server active on http://127.0.0.1:5055!${NC}"
            break
        fi
        sleep 1
    done
fi

# 4. Check / Start Frontend
echo -e "\n${YELLOW}[3/3] Starting Frontend Web Dashboard (Port 5173)...${NC}"
if curl -s -m 1 http://localhost:5173 >/dev/null 2>&1; then
    echo -e "${GREEN}✓ Frontend is already running on http://localhost:5173${NC}"
else
    cd "${SCRIPT_DIR}/frontend"
    nohup npm run dev > "${LOG_DIR}/frontend.log" 2>&1 &
    FRONTEND_PID=$!
    disown "${FRONTEND_PID}" 2>/dev/null || true
    echo -e "${GREEN}✓ Frontend started (PID: ${FRONTEND_PID}).${NC}"
fi

echo -e "\n${BLUE}=====================================================================${NC}"
echo -e "${GREEN}ALL SERVICES ARE RUNNING!${NC}"
echo -e "${BLUE}=====================================================================${NC}"
echo -e "Web Application URL  : ${GREEN}http://localhost:5173${NC} (or http://192.168.15.111:5173)"
echo -e "Live Monitoring Page : ${GREEN}http://localhost:5173/live-monitoring${NC}"
echo -e "Backend API URL      : ${BLUE}http://localhost:3000/api${NC}"
echo -e "AI Stream Server     : ${BLUE}http://127.0.0.1:5055${NC}"
echo -e "\nAdministrator Login Credentials:"
echo -e "  Email    : ${GREEN}admin@gmail.com${NC}"
echo -e "  Password : ${GREEN}admin123${NC}"
echo -e "  Role     : ${GREEN}Admin${NC}"
echo -e "\nTo view real-time logs:"
echo -e "  tail -f ${LOG_DIR}/ai-camera.log"
echo -e "  tail -f ${LOG_DIR}/backend.log"
echo -e "  tail -f ${LOG_DIR}/frontend.log"
echo -e "\nTo stop services:"
echo -e "  bash ./stop_all_services.sh"
echo -e "${BLUE}=====================================================================${NC}"
