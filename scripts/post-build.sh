#!/usr/bin/env bash
# post-build.sh — Copy custom JS files into the pd4web build output directory.
#
# Run this after every:
#   pd4web Main_scenes_adc.pd --nogui -m 512
#
# Usage:
#   bash scripts/post-build.sh [BUILD_DIR]
#
# BUILD_DIR defaults to ./Pd4Web (relative to the repo root).

set -euo pipefail

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
BUILD_DIR="${1:-"${REPO_ROOT}/Pd4Web"}"
SRC_DIR="${REPO_ROOT}/custom-js"

echo "==> post-build.sh"
echo "    Repo root : ${REPO_ROOT}"
echo "    Build dir : ${BUILD_DIR}"
echo "    Source dir: ${SRC_DIR}"

if [ ! -d "${BUILD_DIR}" ]; then
    echo "ERROR: Build directory not found: ${BUILD_DIR}"
    echo "       Run 'pd4web Main_scenes_adc.pd --nogui -m 512' first."
    exit 1
fi

# Files to copy from custom-js/ into the build output
FILES=(
    "index.html"
    "geolocation.js"
    "gps_zone_bridge.js"
    "ai-classifier-bridge.js"
)

for f in "${FILES[@]}"; do
    src="${SRC_DIR}/${f}"
    dst="${BUILD_DIR}/${f}"
    if [ -f "${src}" ]; then
        cp -v "${src}" "${dst}"
    else
        echo "WARNING: source file not found, skipping: ${src}"
    fi
done

echo "==> Done. Serve ${BUILD_DIR}/ over HTTPS to test GPS features."
