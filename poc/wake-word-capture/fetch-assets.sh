#!/usr/bin/env bash
# Populates ./assets/ for the wake-to-wake capture POC.
# Source: DeepCoreLabs openWakeWord package (models + sample WAV + success.mp3).
# Everything here is gitignored. Re-run to restore after a fresh clone.
set -euo pipefail

cd "$(dirname "$0")"

ZIP_URL="https://deepcorelabs.com/projects/openwakeword/package.zip"

mkdir -p assets/models
tmp="$(mktemp -d)"

echo "==> downloading DeepCoreLabs package.zip (~16MB)"
curl -fSL -o "$tmp/package.zip" "$ZIP_URL"

echo "==> extracting models + sample WAV + success.mp3"
unzip -o "$tmp/package.zip" 'models/*' hey_jarvis_11-2.wav success.mp3 -d "$tmp" >/dev/null

cp "$tmp"/models/*.onnx assets/models/
cp "$tmp"/hey_jarvis_11-2.wav assets/
cp "$tmp"/success.mp3 assets/
rm -rf "$tmp"

echo "==> done. assets/:"
ls -lh assets/models/*.onnx
echo
echo "Serve over http/localhost (getUserMedia needs a secure context):"
echo "    python3 -m http.server 8080"
echo "then open http://localhost:8080/"
