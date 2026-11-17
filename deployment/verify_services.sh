dw#!/usr/bin/env bash
# =============================================================================
# Production Verification Script: Camera Mapping, Directional Logic & Startup
# =============================================================================
set -euo pipefail

GREEN='\033[0;32m'
RED='\033[0;31m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m'

PASSED=0
FAILED=0

check() {
    local desc="$1"
    local condition="$2"
    if eval "$condition"; then
        echo -e "${GREEN}[PASS] ${desc}${NC}"
        PASSED=$((PASSED + 1))
    else
        echo -e "${RED}[FAIL] ${desc}${NC}"
        FAILED=$((FAILED + 1))
    fi
}

echo -e "${BLUE}=====================================================================${NC}"
echo -e "${BLUE}  PRODUCTION SERVICES & CAMERA MAPPING VERIFICATION SUITE            ${NC}"
echo -e "${BLUE}=====================================================================${NC}\n"

# 1. Systemd Service Status Checks
check "PostgreSQL service is active" "systemctl is-active --quiet postgresql"
check "AI FastAPI service (attendance-ai-api) is active" "systemctl is-active --quiet attendance-ai-api.service"
check "Node.js Backend service (attendance-backend) is active" "systemctl is-active --quiet attendance-backend.service"
check "Dual-Camera AI Service (attendance-ai-camera) is active" "systemctl is-active --quiet attendance-ai-camera.service"

# 2. Boot Enablement Checks
check "attendance-ai-camera is enabled to start on system boot" "systemctl is-enabled --quiet attendance-ai-camera.service"
check "attendance-ai-api is enabled to start on system boot" "systemctl is-enabled --quiet attendance-ai-api.service"
check "attendance-backend is enabled to start on system boot" "systemctl is-enabled --quiet attendance-backend.service"

# 3. HTTP Health Endpoints
BACKEND_HEALTH=$(curl -s -o /dev/null -w "%{http_code}" http://localhost:3000/api/health || echo "000")
check "Backend /api/health returns HTTP 200" "[ '$BACKEND_HEALTH' = '200' ]"

AI_API_HEALTH=$(curl -s -o /dev/null -w "%{http_code}" http://localhost:8000/health || echo "000")
check "AI FastAPI /health returns HTTP 200" "[ '$AI_API_HEALTH' = '200' ]"

AI_PROXIED_HEALTH=$(curl -s http://localhost:3000/api/ai/health || echo "{}")
check "Backend /api/ai/health proxies AI health with camera pipeline" "echo '$AI_PROXIED_HEALTH' | grep -q '\"camera_pipeline\"'"

# 4. Camera Mapping Verification in Health Payload
check "CAM-01 is configured with IP 192.168.9.207 and role OUT" "echo '$AI_PROXIED_HEALTH' | grep -q '192.168.9.207' && echo '$AI_PROXIED_HEALTH' | grep -q '\"role\": \"OUT\"'"
check "CAM-02 is configured with IP 192.168.9.208 and role IN" "echo '$AI_PROXIED_HEALTH' | grep -q '192.168.9.208' && echo '$AI_PROXIED_HEALTH' | grep -q '\"role\": \"IN\"'"

# 5. Directional Validation Enforcement
# CAM-01 MUST reject IN events (400)
CAM1_IN_CODE=$(curl -s -o /dev/null -w "%{http_code}" -X POST http://localhost:3000/api/attendance \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer AI_SYSTEM_INTERNAL_TOKEN_V1" \
  -d '{"employeeId":"TEST","cameraId":"CAM-01","eventType":"IN","similarity":0.9}' || echo "000")
check "CAM-01 rejects invalid IN punch with HTTP 400" "[ '$CAM1_IN_CODE' = '400' ]"

# CAM-02 MUST reject OUT events (400)
CAM2_OUT_CODE=$(curl -s -o /dev/null -w "%{http_code}" -X POST http://localhost:3000/api/attendance \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer AI_SYSTEM_INTERNAL_TOKEN_V1" \
  -d '{"employeeId":"TEST","cameraId":"CAM-02","eventType":"OUT","similarity":0.9}' || echo "000")
check "CAM-02 rejects invalid OUT punch with HTTP 400" "[ '$CAM2_OUT_CODE' = '400' ]"

# 6. Unknown Face Rejection
UNKNOWN_CODE=$(curl -s -o /dev/null -w "%{http_code}" -X POST http://localhost:3000/api/attendance \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer AI_SYSTEM_INTERNAL_TOKEN_V1" \
  -d '{"employeeId":"NON_EXISTENT_UNKNOWN","cameraId":"CAM-02","eventType":"IN","similarity":0.4}' || echo "000")
check "Unknown face is rejected with HTTP 404 (never recorded)" "[ '$UNKNOWN_CODE' = '404' ]"

echo -e "\n${BLUE}=====================================================================${NC}"
echo -e "VERIFICATION SUMMARY: ${GREEN}${PASSED} PASSED${NC}, ${RED}${FAILED} FAILED${NC}"
echo -e "${BLUE}=====================================================================${NC}"

if [ "$FAILED" -gt 0 ]; then
    exit 1
fi
exit 0
