#!/usr/bin/env bash
# Populates ./assets/ with the openWakeWord WASM engine + ONNX models.
# Everything here is gitignored (binaries). Re-run to restore after a fresh clone.
set -euo pipefail

cd "$(dirname "$0")"

REPO_RAW="https://github.com/dnavarrom/openwakeword_wasm/raw/main"
TARBALL="openwakeword-wasm-browser-0.1.0.tgz"

mkdir -p assets/vendor assets/models

echo "==> downloading engine tarball (~16MB, includes models)"
curl -fSL -o "assets/vendor/$TARBALL" "$REPO_RAW/$TARBALL"

echo "==> extracting"
tar xzf "assets/vendor/$TARBALL" -C assets/vendor/
# tarball lays out: assets/vendor/package/{src,models}

echo "==> copying ONNX models to assets/models/ (flat, for baseAssetUrl)"
cp assets/vendor/package/models/*.onnx assets/models/

echo "==> downloading sample WAV (for the offline runWav test button)"
curl -fSL -o assets/hey_jarvis_11-2.wav "$REPO_RAW/hey_jarvis_11-2.wav"

echo "==> done. assets/:"
ls -lh assets/models/
echo
echo "Serve this dir over http/localhost (getUserMedia needs a secure context):"
echo "    python3 -m http.server 8080"
echo "then open http://localhost:8080/"
