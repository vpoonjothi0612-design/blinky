#!/usr/bin/env bash
# =============================================================================
# Reset Database & Seed Fresh Administrator and Cameras
# =============================================================================
set -e

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
cd "${SCRIPT_DIR}/backend"
node src/scripts/reset_database.js
