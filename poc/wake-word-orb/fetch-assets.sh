#!/usr/bin/env bash
# Populates ./assets/models/ with the openWakeWord ONNX models.
# Gitignored. Re-run to restore after a fresh clone.
set -euo pipefail
cd "$(dirname "$0")"

ZIP_URL="https://deepcorelabs.com/projects/openwakeword/package.zip"
mkdir -p assets/models
tmp="$(mktemp -d)"

echo "==> downloading DeepCoreLabs package.zip (~16MB)"
curl -fSL -o "$tmp/package.zip" "$ZIP_URL"

echo "==> extracting ONNX models"
unzip -o "$tmp/package.zip" 'models/*.onnx' -d "$tmp" >/dev/null
cp "$tmp"/models/*.onnx assets/models/
rm -rf "$tmp"

echo "==> done:"
ls -lh assets/models/*.onnx
echo
echo "Serve over localhost/https (getUserMedia needs a secure context):"
echo "    python3 -m http.server 8080"
