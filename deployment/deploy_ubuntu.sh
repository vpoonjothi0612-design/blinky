#!/usr/bin/env bash
# =============================================================================
# Automated Ubuntu Deployment Script: Systemd Service Setup & Auto-Start
# Attendance & Vehicle Detection Production Pipeline
# =============================================================================
set -euo pipefail

RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m'

echo -e "${BLUE}=====================================================================${NC}"
echo -e "${BLUE}  ATTENDANCE & VEHICLE DETECTION - UBUNTU PRODUCTION DEPLOYMENT      ${NC}"
echo -e "${BLUE}=====================================================================${NC}"

if [[ $EUID -ne 0 ]]; then
   echo -e "${RED}[ERROR] This deployment script must be run as root (use sudo).${NC}"
   exit 1
fi

INSTALL_DIR="${INSTALL_DIR:-/opt/attendance}"
SERVICE_USER="${SERVICE_USER:-attendance}"
SERVICE_GROUP="${SERVICE_GROUP:-attendance}"

echo -e "\n${YELLOW}[1/7] Ensuring system service user (${SERVICE_USER})...${NC}"
if ! id -u "${SERVICE_USER}" >/dev/null 2>&1; then
    useradd --system --shell /bin/false --user-group "${SERVICE_USER}"
    echo -e "${GREEN}Created system user '${SERVICE_USER}'.${NC}"
else
    echo -e "${GREEN}System user '${SERVICE_USER}' already exists.${NC}"
fi

echo -e "\n${YELLOW}[2/7] Checking PostgreSQL service...${NC}"
if systemctl is-active --quiet postgresql; then
    echo -e "${GREEN}PostgreSQL is active and running.${NC}"
else
    echo -e "${YELLOW}Starting and enabling PostgreSQL...${NC}"
    systemctl enable postgresql
    systemctl start postgresql
fi

echo -e "\n${YELLOW}[3/7] Setting permissions for ${INSTALL_DIR}...${NC}"
mkdir -p "${INSTALL_DIR}/ai-services/data"
mkdir -p "${INSTALL_DIR}/ai-services/data/face_embeddings"
mkdir -p "${INSTALL_DIR}/ai-services/data/unknown"
chown -R "${SERVICE_USER}:${SERVICE_GROUP}" "${INSTALL_DIR}"
chmod 750 "${INSTALL_DIR}/ai-services/data"

echo -e "\n${YELLOW}[4/7] Installing Systemd Service Units...${NC}"
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
cp "${SCRIPT_DIR}/systemd/attendance-ai-api.service" /etc/systemd/system/
cp "${SCRIPT_DIR}/systemd/attendance-ai-camera.service" /etc/systemd/system/
cp "${SCRIPT_DIR}/systemd/attendance-backend.service" /etc/systemd/system/
cp "${SCRIPT_DIR}/systemd/attendance.target" /etc/systemd/system/
chmod 644 /etc/systemd/system/attendance*.service /etc/systemd/system/attendance.target

echo -e "\n${YELLOW}[5/7] Reloading systemd daemon...${NC}"
systemctl daemon-reload

echo -e "\n${YELLOW}[6/7] Enabling services to start automatically on system boot...${NC}"
systemctl enable attendance-ai-api.service
systemctl enable attendance-backend.service
systemctl enable attendance-ai-camera.service
systemctl enable attendance.target

echo -e "\n${YELLOW}[7/7] Starting production services in dependency order...${NC}"
# 1. Start AI FastAPI API Service
systemctl restart attendance-ai-api.service
sleep 2

# 2. Start Node.js Express Backend
systemctl restart attendance-backend.service
sleep 2

# 3. Start Dedicated Dual-Camera Real-Time Processing Service
systemctl restart attendance-ai-camera.service
sleep 2

echo -e "\n${BLUE}=====================================================================${NC}"
echo -e "${GREEN}DEPLOYMENT COMPLETED SUCCESSFULLY!${NC}"
echo -e "${BLUE}=====================================================================${NC}"
echo -e "Service Status Summary:"
systemctl --no-pager status attendance-ai-api.service attendance-backend.service attendance-ai-camera.service || true

echo -e "\n${YELLOW}Useful System Commands:${NC}"
echo -e "  Check Camera Service Logs : sudo journalctl -u attendance-ai-camera.service -f"
echo -e "  Check Backend Logs        : sudo journalctl -u attendance-backend.service -f"
echo -e "  Check AI API Logs         : sudo journalctl -u attendance-ai-api.service -f"
echo -e "  Verify Services           : bash ${SCRIPT_DIR}/verify_services.sh"
