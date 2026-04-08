#!/usr/bin/env bash
# post-build.sh — Copy custom web files into the Pd4Web/ output directory
# after running `pd4web Main_scenes_adc.pd --nogui -m 512`.
#
# The pd4web compiler generates:
#   Pd4Web/pd4web.js
#   Pd4Web/pd4web.threads.js
#   Pd4Web/pd4web.wasm
#   Pd4Web/index.pd  (compiled patch)
#   Pd4Web/index.html  (default template — replaced below)
#   Pd4Web/manifest.json
#   Pd4Web/Audios/   (audio assets)
#
# This script overlays our custom files on top so that the served page:
#   1. Asks for Microphone permission (already handled by pd4web / adc~)
#   2. Asks for GPS/Geolocation permission via navigator.geolocation.watchPosition()
#      → custom-js/index.html calls startGeolocation() after the wasm loads
#   3. Runs the AI urban-sound classifier (custom-js/ai-classifier-bridge.js)
#      for Street Aura zones 32–35
#
# Usage (from the Dev-Sources project root):
#   pd4web Main_scenes_adc.pd --nogui -m 512
#   bash scripts/post-build.sh
#   cd Pd4Web && python3 -m http.server 8080
#   # open http://localhost:8080

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
PROJECT_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"
OUTPUT_DIR="$PROJECT_ROOT/Pd4Web"

if [ ! -d "$OUTPUT_DIR" ]; then
    echo "ERROR: Pd4Web/ output directory not found at $OUTPUT_DIR"
    echo "Run 'pd4web Main_scenes_adc.pd --nogui -m 512' first, then re-run this script."
    exit 1
fi

echo "Copying custom web files into $OUTPUT_DIR/ ..."

# Replace the default pd4web index.html with our custom one that includes
# geolocation and AI classifier wiring.
cp "$PROJECT_ROOT/custom-js/index.html"             "$OUTPUT_DIR/index.html"

# Pure geolocation logic (route projection, zone mapping, polygon helpers).
cp "$PROJECT_ROOT/custom-js/geolocation.js"         "$OUTPUT_DIR/geolocation.js"

# YAMNet-based AI sound classifier bridge (microphone → Pd parameters).
cp "$PROJECT_ROOT/custom-js/ai-classifier-bridge.js" "$OUTPUT_DIR/ai-classifier-bridge.js"

echo ""
echo "Done. To serve the app locally:"
echo "  cd $OUTPUT_DIR && python3 -m http.server 8080"
echo "  open http://localhost:8080"
echo ""
echo "The page will request:"
echo "  • Microphone — required by [adc~] in streetAuraAdcCapture06_idlework.pd"
echo "  • Geolocation (GPS) — required by startGeolocation() in custom-js/index.html"
echo "    which sends zone numbers (1–35) to Pd via PD4WEB.sendFloat('zone', z)"
