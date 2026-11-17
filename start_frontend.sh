#!/usr/bin/env bash
# =============================================================================
# Start FaceDetect Vite React Frontend (Port 5173)
# =============================================================================
set -e

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
FRONTEND_DIR="${SCRIPT_DIR}/frontend"

echo "====================================================================="
echo "  STARTING FRONTEND WEB UI (Port 5173)                               "
echo "====================================================================="

cd "${FRONTEND_DIR}"
exec npm run dev
