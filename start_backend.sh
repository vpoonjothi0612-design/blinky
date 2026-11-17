#!/usr/bin/env bash
# =============================================================================
# Start FaceDetect Express Backend (Port 3000)
# =============================================================================
set -e

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
BACKEND_DIR="${SCRIPT_DIR}/backend"

echo "====================================================================="
echo "  STARTING BACKEND API SERVICE (Port 3000)                           "
echo "====================================================================="

cd "${BACKEND_DIR}"
exec npm run dev
